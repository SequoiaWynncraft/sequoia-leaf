import { afterEach, describe, expect, it } from "bun:test";

import { type PlayerId, playerId, SITTINGS_ROOM, type ToClient } from "@sequoia-leaf/core";
import { advance } from "@sequoia-leaf/raid/sitting/clock.ts";
import { type Call, command, openSitting, type SittingCommand } from "@sequoia-leaf/raid/sitting/commands.ts";
import { CLOCK, type Sitting } from "@sequoia-leaf/raid/sitting/sitting.ts";

import { Sittings } from "../src/sittings/service.ts";
import { listMoved, toldOf } from "../src/sittings/told.ts";
import { LiveClient } from "./live-client.ts";
import { playThrough, type Reach, type Seen, seen } from "./sittings-drive.ts";
import { fakeBackend, sessionOf, steadyDice, testLeaf } from "./support.ts";

/**
 * Leaf says when a raid sitting moves on (core's `Nudge`), so that pages read it then rather than ask
 * on a timer: every member at it is told its id and new `rev`, on their own connection whatever room
 * it is in, and everybody in the room of the open tables is told when their list changes. Against
 * Leaf on a real port, with its live connections, and the hand-set clock moved on to each deadline.
 */

const alice = playerId("40000000-0000-0000-0000-000000000001");
const bob = playerId("40000000-0000-0000-0000-000000000002");
const carol = playerId("40000000-0000-0000-0000-000000000003");
const ORIGIN = "https://leaf.seqwawa.com";
const TOKENS: Record<PlayerId, string> = { [alice]: "alice-token", [bob]: "bob-token", [carol]: "carol-token" };
const token = (who: PlayerId): string => TOKENS[who] ?? "";
const T0 = Date.UTC(2026, 10, 27, 12);

const clock = { now: T0 };
let services: ReturnType<typeof testLeaf> | null = null;
let server: Awaited<ReturnType<ReturnType<typeof testLeaf>["serve"]>> | null = null;
const open: LiveClient[] = [];

async function start(): Promise<void> {
  clock.now = T0;
  const fake = fakeBackend({
    "alice-token": () => Response.json(sessionOf(alice, "Alice", "CAPTAIN")),
    "bob-token": () => Response.json(sessionOf(bob, "Bob", "RECRUIT")),
    "carol-token": () => Response.json(sessionOf(carol, "Carol", null)),
  });
  services = testLeaf(clock, fake.fetcher, {}, { dice: steadyDice(7), live: { graceMs: 0 } });
  server = await services.serve();
}

afterEach(async () => {
  for (const c of open.splice(0)) c.close();
  await server?.close();
  await services?.dispose();
  server = null;
  services = null;
});

/** A request as a player's page sends it, with the website's cookie, from Leaf's own page; its JSON. */
async function call(method: string, path: string, who: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${server?.origin ?? ""}${path}`, {
    method,
    headers: { Cookie: `seq_session=${who}`, Origin: ORIGIN, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`${response.status} ${path}: ${await response.text()}`);
  return response.json();
}
const act = async (id: string, who: PlayerId, commands: readonly object[]): Promise<Seen> =>
  seen(await call("POST", `/v1/game/sittings/${id}`, token(who), { player: who, commands }));
const opened = async (who: PlayerId): Promise<Seen & { id: string }> => {
  const answer = await call("POST", "/v1/game/sittings", token(who), { player: who });
  const id = typeof answer === "object" && answer !== null && "id" in answer ? String(answer.id) : "";
  return { ...seen(answer), id };
};

/** A player's page, live in a room. */
async function into(who: PlayerId, room: string): Promise<LiveClient> {
  const client = await LiveClient.open(server?.origin ?? "", { cookie: token(who), origin: ORIGIN }, room);
  open.push(client);
  await client.welcome();
  return client;
}

type Of<T extends ToClient["t"]> = Extract<ToClient, { t: T }>;
/** The nudges of one kind a page has had, in the order they came. */
const nudges = <T extends "sitting" | "sittings">(page: LiveClient, t: T): Of<T>[] =>
  page.texts.filter((m): m is Of<T> => m.t === t);

/** What every member is shown of a sitting alike, from one member's answer: all of it but their seat and run. */
function sharedOf(answer: unknown): string {
  const state = typeof answer === "object" && answer !== null && "state" in answer ? answer.state : null;
  return JSON.stringify(typeof state === "object" && state !== null ? { ...state, you: null, run: null } : null);
}

/** An answer a driver had: whose session, whether it sent commands, the sitting as it read it, and what everybody is shown of it alike. */
interface Had {
  readonly session: string;
  readonly sent: boolean;
  readonly seen: Seen;
  readonly shared: string;
}

/**
 * The driver's way to Leaf, over the port: each answer of a sitting it reads or sends to is kept
 * (`had`), and the clock is moved on to each deadline, a second at least, so that allowances fill.
 */
function overThePort(had: Had[]): Reach {
  const kept = (session: string, sent: boolean, answer: unknown): unknown => {
    had.push({ session, sent, seen: seen(answer), shared: sharedOf(answer) });
    return answer;
  };
  return {
    get: async (path, session) => kept(session, false, await call("GET", path, session)),
    post: async (path, body, session) => kept(session, true, await call("POST", path, session, body)),
    to: async (at) => {
      clock.now = Math.max(clock.now + 1000, at);
    },
  };
}

/** A call at a sitting: Leaf's clock, its dice, and who. */
const at = (now: number, who: PlayerId, name: string): Call => ({ now, seed: 11 + now, player: { id: who, name } });
const A = (now: number) => at(now, alice, "Alice");
const B = (now: number) => at(now, bob, "Bob");
/** A command done, or the test stops. */
function done(t: Sitting, c: SittingCommand, by: Call): Sitting {
  const answer = command(t, c, by);
  if (!answer.ok) throw new Error(`${c.do}: ${answer.why}`);
  return answer.sitting;
}
/** The sitting brought to the moment its stage ends. */
const due = (t: Sitting): Sitting => (t.stage.at === "over" ? t : advance(t, t.stage.until));
const sorted = (s: Set<string>): string[] => [...s].toSorted();

describe("who is told of a write", () => {
  it("is every member before or after it for every change they all see, and only the member whose run moved otherwise", () => {
    const first = openSitting(A(T0));
    expect(sorted(toldOf(null, first))).toEqual([alice]);
    const sat = done(first, { do: "sit" }, B(T0 + 1));
    expect(sorted(toldOf(first, sat))).toEqual([alice, bob]);
    // Bob leaves before the start: he is told too, as one at it before.
    const left = done(sat, { do: "leave" }, B(T0 + 2));
    expect(sorted(toldOf(sat, left))).toEqual([alice, bob]);
    const again = done(left, { do: "sit" }, B(T0 + 3));
    const started = done(again, { do: "start" }, A(T0 + 4));
    expect(started.stage.at).toBe("carousel");
    expect(sorted(toldOf(again, started))).toEqual([alice, bob]);
    // A pick from the ring.
    const turns = started.stage.at === "carousel" ? started.stage.turns : [];
    const aliceTurn = started.seats.findIndex((seat) => seat.who.is === "member" && seat.who.id === alice);
    expect(turns.includes(aliceTurn)).toBe(true);
    const picked = done(started, { do: "pick", offer: 0 }, A(T0 + 5));
    expect(sorted(toldOf(started, picked))).toEqual([alice, bob]);
    // A regular's take, by the clock, and then planning.
    const regular = due(due(picked));
    expect(regular.stage.at).toBe("carousel");
    expect(sorted(toldOf(due(picked), regular))).toEqual([alice, bob]);
    let planning = regular;
    for (let n = 0; n < 20 && planning.stage.at === "carousel"; n++) planning = due(planning);
    expect(planning.stage.at).toBe("plan");
    expect(sorted(toldOf(picked, planning))).toEqual([alice, bob]);
    // Alice's own planning, which nobody else sees until the lock: only she is told.
    const held = done(planning, { do: "hold", on: true }, A(T0 + 20_000));
    expect(sorted(toldOf(planning, held))).toEqual([alice]);
    // Alice is ready: everyone sees who is.
    const ready = done(held, { do: "ready", on: true }, A(T0 + 20_001));
    expect(sorted(toldOf(held, ready))).toEqual([alice, bob]);
    // The lock, by the clock: the fights.
    const locked = due(ready);
    expect(locked.stage.at).toBe("fight");
    expect(sorted(toldOf(ready, locked))).toEqual([alice, bob]);
    // A place: Bob gets up after the start, and is out.
    const out = done(due(locked), { do: "leave" }, B(locked.stage.at === "over" ? 0 : locked.stage.until + 1));
    const placed = out.seats.find((seat) => seat.who.is === "member" && seat.who.id === bob)?.place;
    expect(placed).toBeGreaterThan(0);
    // The end: everything brought to its close.
    let t = out;
    for (let n = 0; n < 500 && t.stage.at !== "over"; n++) t = due(t);
    expect(t.stage.at).toBe("over");
    expect(sorted(toldOf(out, t))).toEqual([alice, bob]);
  });

  it("is the open tables' room whenever a table was open before the write or is after it", () => {
    const first = openSitting(A(T0));
    const sat = done(first, { do: "sit" }, B(T0 + 1));
    const started = done(sat, { do: "start" }, A(T0 + 2));
    expect([listMoved(null, first), listMoved(first, sat), listMoved(sat, started)]).toEqual([true, true, true]);
    expect(listMoved(started, due(started))).toBe(false);
    // Closed unstarted by the clock.
    expect(listMoved(first, due(first))).toBe(true);
  });
});

describe("Leaf's word that a sitting moved on", () => {
  it("is told to every member at it whenever what they see moves, wherever their connection is, and to nobody else", async () => {
    await start();
    // Alice is in town; Bob and Carol look at the open tables.
    const alices = await into(alice, "town");
    const bobs = await into(bob, SITTINGS_ROOM);
    const carols = await into(carol, SITTINGS_ROOM);
    const table = await opened(alice);
    const { id } = table;
    // Someone sits, someone sits and leaves again, and the table starts.
    expect((await act(id, bob, [{ id: "b-1", do: "sit" }])).rev).toBe(1);
    expect((await act(id, carol, [{ id: "c-1", do: "sit" }])).rev).toBe(2);
    expect((await act(id, carol, [{ id: "c-2", do: "leave" }])).rev).toBe(3);
    expect((await act(id, alice, [{ id: "a-1", do: "start" }])).at).toBe("carousel");
    // Picks from the carousel, planning, locks, stages, places and the end, as the clock moves.
    const had: Had[] = [];
    const { end } = await playThrough(overThePort(had), id, [
      { player: alice, session: token(alice) },
      { player: bob, session: token(bob) },
    ]);
    expect(end.at).toBe("over");
    const answers = had.map((h) => h.seen);
    const last = Math.max(...answers.map((a) => a.rev));
    // Everything Leaf said before its answer to a ping has come by the answer.
    await alices.settled();
    await bobs.settled();
    await carols.settled();
    // Every kind of change went by: the carousel's picks, planning, the locks, places and the end.
    const stages = new Set(answers.map((a) => a.at));
    expect([...stages].toSorted()).toEqual(["carousel", "fight", "over", "plan"]);
    expect(answers.some((a) => a.at === "carousel" && a.taken.length > 0)).toBe(true);

    // What everybody is shown, at each `rev` the drivers saw.
    const sharedAt = new Map<number, string>();
    for (const h of had) sharedAt.set(h.seen.rev, h.shared);
    const revs = [...sharedAt.keys()].toSorted((a, b) => a - b);
    for (const page of [alices, bobs]) {
      const told = nudges(page, "sitting").map((m) => m.rev);
      // In order, each once, and the last of them the end.
      expect(told).toEqual(told.toSorted((a, b) => a - b));
      expect(new Set(told).size).toBe(told.length);
      expect(told.at(-1)).toBe(last);
      // Whatever everybody saw move between two `rev`s, each was told of a `rev` between them.
      for (let i = 1; i < revs.length; i++) {
        const [from = 0, to = 0] = [revs[i - 1], revs[i]];
        if (sharedAt.get(from) !== sharedAt.get(to)) expect(told.some((rev) => rev > from && rev <= to)).toBe(true);
      }
    }
    // Alice, who opened it, from its first `rev`; Bob from his sitting down.
    expect(nudges(alices, "sitting")[0]?.rev).toBe(0);
    expect(nudges(bobs, "sitting")[0]?.rev).toBe(1);
    // Alice's own planning, which Bob does not see until the lock, is not told to him.
    const alicesOwn = had
      .filter((h) => h.session === token(alice) && h.sent && h.seen.at === "plan")
      .map((h) => h.seen.rev)
      .filter((rev) => sharedAt.has(rev - 1) && sharedAt.get(rev - 1) === sharedAt.get(rev));
    expect(alicesOwn.length).toBeGreaterThan(5);
    expect(nudges(bobs, "sitting").filter((m) => alicesOwn.includes(m.rev))).toEqual([]);
    expect(nudges(alices, "sitting").filter((m) => alicesOwn.includes(m.rev))).toHaveLength(alicesOwn.length);
    // Nothing of the table: its id and `rev`, no more.
    expect(nudges(bobs, "sitting").every((m) => Object.keys(m).toSorted().join() === "id,rev,t" && m.id === id)).toBe(
      true,
    );
    // Carol, of the two changes she was at it for: her sitting down and her leaving.
    expect(nudges(carols, "sitting").map((m) => m.rev)).toEqual([2, 3]);
  });

  it("is told to the open tables' room when their list changes, and only then", async () => {
    await start();
    const carols = await into(carol, SITTINGS_ROOM);
    const alices = await into(alice, "town");
    const table = await opened(alice);
    await carols.next("sittings");
    await act(table.id, bob, [{ id: "b-1", do: "sit" }]);
    await carols.next("sittings");
    await act(table.id, bob, [{ id: "b-2", do: "leave" }]);
    await carols.next("sittings");
    await act(table.id, alice, [{ id: "a-1", do: "start" }]);
    await carols.next("sittings");
    // Started, the table is off the list: what it does after is no change to the list.
    await playThrough(overThePort([]), table.id, [{ player: alice, session: token(alice) }], {
      stop: (now) => now.room >= 2,
    });
    await alices.settled();
    await carols.settled();
    expect(nudges(carols, "sittings")).toEqual([]);
    // Alice, in town, is not in the open tables' room.
    expect(nudges(alices, "sittings")).toEqual([]);
  });

  it("comes of the clock too: a table nobody started closes at the minute's sweep, told once it is kept", async () => {
    await start();
    const bobs = await into(bob, "town");
    const carols = await into(carol, SITTINGS_ROOM);
    const table = await opened(bob);
    await carols.next("sittings");
    await bobs.next("sitting", (m) => m.rev === 0);
    clock.now += CLOCK.open + 1;
    expect(await services?.run(Sittings.use((sittings) => sittings.sweep))).toBe(1);
    expect(await bobs.next("sitting")).toEqual({ t: "sitting", id: table.id, rev: 1 });
    await carols.next("sittings");
    // Read at once, it is what Leaf was told of: kept before the word went.
    const now = seen(await call("GET", `/v1/game/sittings/${table.id}?rev=0`, token(bob)));
    expect([now.rev, now.at]).toEqual([1, "over"]);
  });
});
