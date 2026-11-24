import { afterEach, describe, expect, it } from "bun:test";

import { Flag, type PlayerId, playerId, type ToClient, visitRoom } from "@sequoia-leaf/core";
import {
  check,
  decode,
  play,
  readAnswer,
  readCommand,
  readView,
  route,
  stepTo,
  writeAct,
  type Yard,
} from "@sequoia-leaf/factory";
import { Effect, Schema } from "effect";

import { Live } from "../src/live/live.ts";
import { Watchers } from "../src/live/watchers.ts";
import { LiveClient } from "./live-client.ts";
import { fakeBackend, sessionOf, testLeaf } from "./support.ts";

/**
 * A visit's room: everybody visiting a player's yard hears each batch Leaf keeps of it as Leaf
 * keeps it (`did`), and a copy that does what they hear is Leaf's yard. Against Leaf on a real port,
 * with its live connections, on the real clock.
 */

const alice = playerId("10000000-0000-0000-0000-000000000001");
const bob = playerId("10000000-0000-0000-0000-000000000002");
const carol = playerId("10000000-0000-0000-0000-000000000003");
const ORIGIN = "https://leaf.seqwawa.com";
const TOKENS: Record<PlayerId, string> = { [alice]: "alice-token", [bob]: "bob-token", [carol]: "carol-token" };
const token = (who: PlayerId): string => TOKENS[who] ?? "";

// The real clock: Live's tick and its waits keep time by it.
const clock = {
  get now() {
    return Date.now();
  },
  set now(_: number) {},
};
let services: ReturnType<typeof testLeaf> | null = null;
let server: Awaited<ReturnType<ReturnType<typeof testLeaf>["serve"]>> | null = null;
const open: LiveClient[] = [];

async function start(): Promise<void> {
  const fake = fakeBackend({
    "alice-token": () => Response.json(sessionOf(alice, "Alice", "CAPTAIN")),
    "bob-token": () => Response.json(sessionOf(bob, "Bob", "RECRUIT")),
    "carol-token": () => Response.json(sessionOf(carol, "Carol", null)),
  });
  // A visitor whose connection closes leaves their room at once.
  services = testLeaf(clock, fake.fetcher, {}, { live: { graceMs: 0 } });
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
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const Shown = Schema.Struct({ rev: Schema.Number, state: Schema.Unknown });

/** A yard as Leaf gave it, its revision, and Leaf's tick then. */
async function yardOf(answer: Response): Promise<{ rev: number; clock: number; yard: Yard }> {
  const { rev, state } = Schema.decodeUnknownSync(Shown)(await answer.json());
  const view = readView(state);
  const yard = view && decode(view.yard);
  if (!view || !yard) throw new Error(`Not a yard: ${JSON.stringify(state)}`);
  return { rev, clock: view.clock, yard };
}

/** The owner opens their yard and puts the starter line down by the depot, in one batch from their page. */
async function buildStarter(owner: PlayerId): Promise<Response> {
  const { clock: tick, yard } = await yardOf(await call("GET", "/v1/game/play/works", owner));
  const { legs } = writeAct({ do: "lay", legs: route(yard, [22, 15], [23, 17]) ?? [] });
  return call("POST", "/v1/game/play/works", owner, {
    player: owner,
    commands: [
      { id: `${owner}-1`, do: "build", kind: "gatherer", x: 20, y: 15, dir: 0, tick },
      { id: `${owner}-2`, do: "build", kind: "mill", x: 21, y: 15, dir: 0, tick },
      { id: `${owner}-3`, do: "lay", legs, tick },
      // Refused: there is nothing there. A visitor is told only what was done.
      { id: `${owner}-4`, do: "remove", x: 0, y: 0, tick },
    ],
  });
}

/** A visitor's page in the room of a visit to `owner`'s yard. */
async function visiting(visitor: PlayerId, owner: PlayerId): Promise<LiveClient> {
  const client = await LiveClient.open(
    server?.origin ?? "",
    { cookie: token(visitor), origin: ORIGIN },
    visitRoom("works", owner),
  );
  open.push(client);
  await client.welcome();
  return client;
}

type Did = Extract<ToClient, { t: "did" }>;

/** Does to a copy what a visitor heard a batch did, each command at its tick, then on to the tick Leaf's answer is of. */
function follow(copy: Yard, did: Did): { mine: number; leafs: number } {
  const after = readAnswer(did.after);
  if (!after) throw new Error(`Not an answer: ${JSON.stringify(did.after)}`);
  for (const echo of did.did) {
    const c = readCommand(echo);
    if (!c) throw new Error(`Not a command: ${JSON.stringify(echo)}`);
    expect("refused" in play(copy, c)).toBe(false);
  }
  stepTo(copy, after.tick);
  return { mine: check(copy), leafs: after.check };
}

/** How many frames Leaf has told visits' rooms. */
const told = async (): Promise<number> => (await services?.run(Watchers.use((w) => Effect.sync(w.told)))) ?? -1;

describe("a visit's room", () => {
  it("hears each batch the owner's page sends as Leaf keeps it, and a copy that does it is Leaf's yard", async () => {
    await start();
    await call("GET", "/v1/game/play/works", alice);
    const bobs = await visiting(bob, alice);
    const visited = await yardOf(await call("GET", `/v1/game/play/works/of/${alice}`, bob));

    const built = await buildStarter(alice);
    expect(built.status).toBe(200);
    const answered = Schema.decodeUnknownSync(Shown)(await built.json());
    const did = await bobs.next("did");
    // The three commands done, in order, at the ticks Leaf did them; not the one it refused.
    expect(did.did.map((c) => readCommand(c)?.do)).toEqual(["build", "build", "lay"]);
    // Each with its id as the owner's page gave it, so that page knows its own.
    expect(did.ids).toEqual([`${alice}-1`, `${alice}-2`, `${alice}-3`]);
    expect(did.rev).toBe(answered.rev);
    expect(did.rev).toBeGreaterThan(visited.rev);
    // With Leaf's answer to the batch, as the owner's page was given it.
    expect(did.after).toEqual(answered.state);
    const { mine, leafs } = follow(visited.yard, did);
    expect(mine).toBe(leafs);
  });

  it("hears nothing of anybody else's yard", async () => {
    await start();
    const bobs = await visiting(bob, carol);
    expect((await buildStarter(alice)).status).toBe(200);
    expect((await buildStarter(carol)).status).toBe(200);
    // The first thing heard is Carol's batch, and nothing came of Alice's.
    const did = await bobs.next("did");
    const carols = await yardOf(await call("GET", "/v1/game/play/works/of/" + carol, bob));
    expect(did.rev).toBeLessThanOrEqual(carols.rev);
    expect(did.did.map((c) => readCommand(c)?.do)).toEqual(["build", "build", "lay"]);
    await Bun.sleep(100);
    expect(bobs.texts.filter((m) => m.t === "did")).toEqual([]);
  });

  it("is still: what a visitor does there reaches nobody, and their commands change nothing of the owner's", async () => {
    await start();
    await call("GET", "/v1/game/play/works", alice);
    const bobs = await visiting(bob, alice);
    const carols = await visiting(carol, alice);
    const before = await yardOf(await call("GET", `/v1/game/play/works/of/${alice}`, bob));
    bobs.send({ t: "act", kind: "emote", arg: "wave" });
    bobs.move({ x: 4, y: 4, vx: 0, vy: 0, facing: 0, pose: 0, flags: Flag.Moving, jump: 0 });
    // A batch sent for the owner from somebody else's page is turned down whole.
    const forHer = await call("POST", "/v1/game/play/works", bob, {
      player: alice,
      commands: [{ id: "b-1", do: "collect", tick: before.clock }],
    });
    expect(forHer.status).toBe(409);
    // A batch of his own is his own yard's, and nobody in hers is told of it.
    expect((await buildStarter(bob)).status).toBe(200);
    await Bun.sleep(200);
    expect(carols.texts.filter((m) => m.t === "act" || m.t === "did")).toEqual([]);
    expect(carols.snapshots).toEqual([]);
    const after = await yardOf(await call("GET", `/v1/game/play/works/of/${alice}`, carol));
    expect(after.yard.kind).toEqual(before.yard.kind);
    expect(after.yard.seen).toEqual(before.yard.seen);
  });

  it("makes nothing and tells nothing while nobody visits", async () => {
    await start();
    expect((await buildStarter(alice)).status).toBe(200);
    expect(await told()).toBe(0);
    // Bob comes in and hears her next batch; once he has gone, nothing more is told.
    const bobs = await visiting(bob, alice);
    const { clock: tick } = await yardOf(await call("GET", "/v1/game/play/works", alice));
    const collect = (id: string) =>
      call("POST", "/v1/game/play/works", alice, { player: alice, commands: [{ id, do: "collect", tick }] });
    expect((await collect("a-5")).status).toBe(200);
    await bobs.next("did");
    expect(await told()).toBe(1);
    bobs.close();
    await Bun.sleep(300);
    expect((await services?.run(Live.use((live) => live.census)))?.rooms).toEqual({});
    expect((await collect("a-6")).status).toBe(200);
    expect(await told()).toBe(1);
    expect((await services?.run(Live.use((live) => live.line)))?.told).toBe(1);
  });
});
