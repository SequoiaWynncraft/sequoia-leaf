import { afterEach, describe, expect, it } from "bun:test";

import { campRoom, Flag, type Motion, type PlayerId, playerId } from "@sequoia-leaf/core";
import { Effect, Schema } from "effect";

import { Live, TICK } from "../src/live/live.ts";
import { Watchers } from "../src/live/watchers.ts";
import { LiveClient } from "./live-client.ts";
import { asPage, fakeBackend, sessionOf, testLeaf } from "./support.ts";

/**
 * A camp's room: everybody at one player's camp, the owner at home too, sees everybody else there
 * move as the town's room has them, and hears when the owner's camp changes (`changed`). Against
 * Leaf on a real port, with its live connections, on a test clock that moves only as a test moves it.
 */

const alice = playerId("20000000-0000-0000-0000-000000000001");
const bob = playerId("20000000-0000-0000-0000-000000000002");
const carol = playerId("20000000-0000-0000-0000-000000000003");
const ORIGIN = "https://leaf.seqwawa.com";
const TOKENS: Record<PlayerId, string> = { [alice]: "alice-token", [bob]: "bob-token", [carol]: "carol-token" };
const token = (who: PlayerId): string => TOKENS[who] ?? "";

const clock = { now: Date.UTC(2026, 10, 25, 12) };
let services: ReturnType<typeof testLeaf> | null = null;
let server: Awaited<ReturnType<ReturnType<typeof testLeaf>["serve"]>> | null = null;
const open: LiveClient[] = [];

async function start(): Promise<void> {
  const fake = fakeBackend({
    "alice-token": () => Response.json(sessionOf(alice, "Alice", "CAPTAIN")),
    "bob-token": () => Response.json(sessionOf(bob, "Bob", "RECRUIT")),
    "carol-token": () => Response.json(sessionOf(carol, "Carol", null)),
  });
  // Somebody whose connection closes leaves their room at once.
  services = testLeaf(clock, fake.fetcher, {}, { live: { graceMs: 0 }, testClock: true });
  server = await services.serve();
}

afterEach(async () => {
  for (const c of open.splice(0)) c.close();
  await server?.close();
  await services?.dispose();
  server = null;
  services = null;
});

/** A request as a player's page sends it, with the website's cookie, from Leaf's own page. */
function call(method: string, path: string, who: PlayerId, body?: unknown): Promise<Response> {
  return fetch(`${server?.origin ?? ""}${path}`, {
    method,
    headers: { Cookie: `seq_session=${token(who)}`, Origin: ORIGIN, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(asPage(path, body)) }),
  });
}

/** A player's page, live in a room. */
async function into(who: PlayerId, room: string): Promise<LiveClient> {
  const client = await LiveClient.open(server?.origin ?? "", { cookie: token(who), origin: ORIGIN }, room);
  open.push(client);
  await client.welcome();
  return client;
}

const walking = (x: number, y: number): Motion => ({
  x,
  y,
  vx: 0,
  vy: 0,
  facing: 1,
  pose: 0,
  flags: Flag.Moving,
  jump: 0,
});
/** One of Live's ticks, at which each room sends what moved in it. */
const liveTick = () => services?.adjust(TICK) ?? Promise.resolve();
const census = async () => services?.run(Live.use((live) => live.census));
const heard = async (room: string) => services?.run(Watchers.use((w) => Effect.sync(() => w.heard(room))));
/** Waits until Leaf has no connection open: the last close, which comes off the socket, is through. */
async function closedThrough(turns = 10_000): Promise<void> {
  if ((await census())?.connected === 0) return;
  if (turns === 0) throw new Error("a connection never closed");
  await new Promise((resolve) => setImmediate(resolve));
  return closedThrough(turns - 1);
}

const Placed = Schema.Struct({ n: Schema.Number, id: Schema.String, s: Schema.Number });
const Shown = Schema.Struct({
  rev: Schema.Number,
  state: Schema.Struct({ camp: Schema.Struct({ placed: Schema.Array(Placed) }) }),
});
const shown = async (answer: Response) => Schema.decodeUnknownSync(Shown)(await answer.json());

describe("a camp's room", () => {
  it("has the owner at home and a visitor see each other walk and wave, kept to the camp, and nobody else's camp", async () => {
    await start();
    const home = await into(alice, campRoom(alice));
    const visitor = await into(bob, campRoom(alice));
    const elsewhere = await into(carol, campRoom(carol));
    const joined = await home.next("joined");
    expect(joined.member.name).toBe("Bob");

    // Out past the trail's posts, where whoever comes in appears, and on beyond the camp: kept to it.
    visitor.move(walking(430, 218));
    await visitor.settled();
    await liveTick();
    expect((await home.snapshot((s) => s.entries.some((e) => e.id === joined.member.id))).entries).toEqual([
      expect.objectContaining({ id: joined.member.id, x: 430, y: 218, flags: Flag.Moving }),
    ]);
    visitor.move(walking(5000, 218));
    await visitor.settled();
    await liveTick();
    expect((await home.snapshot((s) => s.entries.some((e) => e.x === 432))).entries[0]?.y).toBe(218);

    visitor.send({ t: "act", kind: "emote", arg: "wave" });
    expect(await home.next("act")).toEqual({ t: "act", id: joined.member.id, kind: "emote", arg: "wave" });
    await elsewhere.settled();
    expect(elsewhere.texts.filter((m) => m.t === "joined" || m.t === "act")).toEqual([]);
    expect(elsewhere.snapshots).toEqual([]);
  });

  it("is one of the rooms a page goes through on one connection: camp to camp to town, each seeing them go and come", async () => {
    await start();
    const atAlices = await into(alice, campRoom(alice));
    const atCarols = await into(carol, campRoom(carol));
    const bobs = await into(bob, campRoom(alice));
    const bob1 = (await atAlices.next("joined")).member.id;

    expect((await bobs.join(campRoom(carol))).room).toBe(`${campRoom(carol)}/1`);
    expect(await atAlices.next("left")).toEqual({ t: "left", id: bob1 });
    expect((await atCarols.next("joined")).member.name).toBe("Bob");
    // Carol goes into town ahead of him, and sees him come in after her.
    await atCarols.join("town");
    expect((await bobs.join("town")).roster.map((m) => m.name)).toEqual(["Carol", "Bob"]);
    expect((await atCarols.next("joined")).member.name).toBe("Bob");
    expect((await census())?.rooms).toEqual({ [`${campRoom(alice)}/1`]: 1, "town/1": 2 });
    // Three players, three connections, all the while.
    expect((await services?.run(Live.use((live) => live.line)))?.opened).toBe(3);
    expect(bobs.closed).toBeNull();
  });

  it("closes once nobody is in it: a page that walks through twenty camps leaves none behind", async () => {
    await start();
    const bobs = await into(bob, campRoom(alice));
    const camps = Array.from({ length: 20 }, (_, i) =>
      campRoom(playerId(`30000000-0000-0000-0000-${String(i).padStart(12, "0")}`)),
    );
    for (const camp of camps) {
      // oxlint-disable-next-line no-await-in-loop -- one camp after another, as a page walks them
      await bobs.join(camp);
    }
    expect((await census())?.rooms).toEqual({ [`${camps.at(-1) ?? ""}/1`]: 1 });
    expect(await Promise.all([campRoom(alice), ...camps.slice(0, -1)].map(heard))).toEqual(camps.map(() => false));
    bobs.close();
    await closedThrough();
    await liveTick();
    expect((await census())?.rooms).toEqual({});
    expect(await heard(camps.at(-1) ?? "")).toBe(false);
  });

  it("hears that the owner's camp changed once Leaf keeps it, and nothing of what changes nothing a visitor sees", async () => {
    await start();
    const opened = await shown(await call("GET", "/v1/game/play/town", alice));
    const lantern = opened.state.camp.placed.find((p) => p.id === "lantern-post");
    if (!lantern) throw new Error("A new camp has a lantern post");
    const visitor = await into(bob, campRoom(alice));

    const lit = await call("POST", "/v1/game/play/town", alice, {
      player: alice,
      commands: [{ id: "a-1", do: "toggle", n: lantern.n }],
    });
    expect(lit.status).toBe(200);
    const { rev } = await shown(lit);
    expect(await visitor.next("changed")).toEqual({ t: "changed", rev });
    // Read again at once, the camp is as the owner left it.
    const seen = await shown(await call("GET", `/v1/game/play/town/of/${alice}`, bob));
    expect(seen.rev).toBe(rev);
    expect(seen.state.camp.placed.find((p) => p.n === lantern.n)?.s).not.toBe(lantern.s);

    // Saying she is still here changes her town, and nothing a visitor sees.
    const here = await call("POST", "/v1/game/play/town", alice, {
      player: alice,
      commands: [{ id: "a-2", do: "here", cursor: null }],
    });
    expect(here.status).toBe(200);
    await visitor.settled();
    expect(visitor.texts.filter((m) => m.t === "changed" || m.t === "did")).toEqual([]);
  });

  it("makes nothing and tells nothing while nobody else is there", async () => {
    await start();
    const opened = await shown(await call("GET", "/v1/game/play/town", alice));
    const lantern = opened.state.camp.placed.find((p) => p.id === "lantern-post");
    const toggle = (id: string) =>
      call("POST", "/v1/game/play/town", alice, {
        player: alice,
        commands: [{ id, do: "toggle", n: lantern?.n ?? 0 }],
      });
    expect((await toggle("a-1")).status).toBe(200);
    expect(await services?.run(Watchers.use((w) => Effect.sync(w.told)))).toBe(0);
  });
});
