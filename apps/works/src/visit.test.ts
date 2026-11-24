import { afterEach, describe, expect, test } from "bun:test";

import { livePath, playerId, type ToClient, visitRoom } from "@sequoia-leaf/core";
import {
  check,
  clockOf,
  decode,
  encode,
  FACTORY as WORKS,
  PYLON,
  refusal,
  type Short,
  stepTo,
  type Yard,
} from "@sequoia-leaf/factory";
import { staged } from "@sequoia-leaf/factory/test/yards.ts";
import { restart, start } from "@sequoia-leaf/kit/live.ts";
import { type FakeSocket, HELLO, liveSockets, type Reply, standin, TESTER } from "@sequoia-leaf/kit/standin.ts";

import { ctx, fakeLeaf, kindAt, net, until, useFakeLeaf } from "../test/fake-leaf.ts";
import { S } from "./state.ts";
import { differences, doNow, openYard, runYard, visitFollowing, yardReads } from "./yard.ts";

useFakeLeaf();

const OWNER = playerId("10000000-0000-0000-0000-0000000000c1");
const VISIT = `GET /v1/game/play/works/of/${OWNER}`;
let sockets: { sockets: FakeSocket[]; done: () => void } | null = null;
afterEach(() => {
  sockets?.done();
  sockets = null;
  S.visiting = null;
  restart();
});

/**
 * Somebody visits the owner's staged yard, which a stand-in Leaf keeps with the real rules: they
 * open it, the page goes into the visit's room, and the room welcomes it. Leaf's clock and the
 * page's run on together from here (`clock`); `owner` is Leaf doing a batch of the owner's commands
 * as the play service does and telling the room, and `reads` how many times the visit read the yard.
 */
async function visit(yard: Yard = staged("mid")) {
  const fake = fakeLeaf(yard);
  yard.at = ctx().now;
  let rev = 1;
  const leafAt = () => ({ ...ctx(), now: ctx().now + fake.leaf.ms });
  const visited = (): Reply => {
    fake.leaf.reads.push("visit");
    const at = leafAt();
    WORKS.tend?.(fake.leaf.yard, at, () => true);
    WORKS.advance(fake.leaf.yard, at);
    return { status: 200, body: { rev, now: "x", state: WORKS.visit?.(fake.leaf.yard, at) } };
  };
  net.world = standin({
    "GET /v1/game/hello": HELLO,
    "GET /v1/game/me": { status: 200, body: TESTER },
    [VISIT]: visited,
  });
  await start();
  sockets = liveSockets();
  S.visiting = { id: OWNER, name: "Owner" };
  expect(await openYard(TESTER.player.id, () => undefined)).toBeNull();
  const room = sockets.sockets[0];
  if (!room) throw new Error("the visit did not go into its room");
  expect(room.url).toBe(`wss://leaf.example${livePath(visitRoom("works", OWNER))}&device=desktop`);
  room.open();
  room.says({ t: "welcome", v: 2, you: 1, room: `${visitRoom("works", OWNER)}/1`, hz: 30, time: 0, roster: [] });
  // Welcomed, it reads the yard again: what was done before it was in the room was never told.
  await settle(0);
  const clock = { ms: 0 };
  /** Leaf's clock and the page's `ms` past the opening, and a frame on the page. */
  const at = async (ms: number) => {
    clock.ms = ms;
    fake.leaf.ms = ms;
    await settle(ms);
  };
  /**
   * Leaf does the owner's commands, stamped with its clock now, and tells the room, its answer
   * changed by `change`; with `tell` false, the room is told only when the returned function is called.
   */
  const owner = (commands: Record<string, unknown>[], change = (after: Short): Short => after, tell = true) => {
    const y = fake.leaf.yard;
    const atNow = leafAt();
    WORKS.tend?.(y, atNow, () => true);
    WORKS.advance(y, atNow);
    const did: unknown[] = [];
    for (const raw of commands) {
      const c = WORKS.command({ ...raw, tick: clockOf(y, atNow.now) });
      if (!c) throw new Error(`${JSON.stringify(raw)} does not read`);
      WORKS.tend?.(y, atNow, () => true, c);
      if (!("refused" in WORKS.apply(y, c, atNow))) did.push(WORKS.echo?.(y, c));
    }
    const after = WORKS.answer?.(y, atNow);
    if (!after) throw new Error("no answer");
    rev++;
    const said: ToClient = { t: "did", rev, did, after: change(after) };
    const say = (): void => {
      room.says(said);
    };
    if (tell) say();
    return say;
  };
  return { fake, room, at, owner, clock, reads: () => fake.leaf.reads.length };
}

/** `frames` frames of the page at `ms` past the opening, and after each, whatever it asked Leaf answered. */
async function settle(ms: number, frames = 10): Promise<void> {
  performance.now = () => 1000 + ms;
  runYard(1000 + ms);
  await until(() => false, 2);
  if (frames > 1) await settle(ms, frames - 1);
}

/** The copy is Leaf's yard: the same check at the copy's tick. */
function likeLeafs(leafs: Yard): void {
  const there = decode(encode(leafs), leafs.land);
  if (!there) throw new Error("Leaf's yard does not read back");
  stepTo(there, S.world.tick);
  expect(check(S.world)).toBe(check(there));
}

/** Leaf collects the owner's till for them once a second, `n` times from `ms`, and the page runs on with it. */
async function collecting(v: Awaited<ReturnType<typeof visit>>, ms: number, n: number): Promise<void> {
  if (n === 0) return;
  await v.at(ms);
  v.owner([{ do: "collect" }]);
  await collecting(v, ms + 1000, n - 1);
}

/** The first tile by the depot where a pylon may stand, on the copy. */
function pylonSpot(): { x: number; y: number } {
  const [dx, dy] = S.world.land.depot;
  for (let r = 2; r < 12; r++)
    for (let y = dy - r; y <= dy + r; y++)
      for (let x = dx - r; x <= dx + r; x++) if (refusal(S.world, PYLON, x, y, Infinity) === null) return { x, y };
  throw new Error("nowhere for a pylon");
}

describe("a visit", () => {
  test("does what the owner did at the tick Leaf did it, and reads nothing for it", async () => {
    const v = await visit();
    expect(v.reads()).toBe(2);
    const spot = pylonSpot();
    await v.at(1000);
    v.owner([{ do: "build", kind: "pylon", dir: 0, ...spot }]);
    // Half a second behind Leaf's clock, the copy has not reached the tick yet; then it has.
    expect(kindAt(spot)).toBeUndefined();
    await v.at(1600);
    expect(kindAt(spot)).toBe("pylon");
    likeLeafs(v.fake.leaf.yard);
    expect(v.reads()).toBe(2);
    expect(visitFollowing()).toMatchObject({ live: true, batches: 1, late: 0, unlike: 0, waiting: 0 });
  });

  test("told of a batch its copy does not end as Leaf's yard did, reads the yard once", async () => {
    const v = await visit();
    const spot = pylonSpot();
    await v.at(1000);
    v.owner([{ do: "build", kind: "pylon", dir: 0, ...spot }], (after) => ({
      ...after,
      check: (after.check ^ 1) >>> 0,
    }));
    await v.at(1600);
    await v.at(1700);
    expect(visitFollowing()).toMatchObject({ unlike: 1 });
    expect(v.reads()).toBe(3);
    expect(yardReads()).toBe(3);
    // Leaf's yard, as read: what the owner built is there, and the copy runs on with nothing more to ask.
    expect(kindAt(spot)).toBe("pylon");
    await v.at(5000);
    expect(v.reads()).toBe(3);
  });

  test("told after its copy passed the tick, reads the yard once and runs further behind, until it is told in time again", async () => {
    const v = await visit();
    const spot = pylonSpot();
    // The page's clock runs on two seconds before Leaf's word of what was done a second in comes.
    await v.at(1000);
    performance.now = () => 1000 + 3000;
    runYard(1000 + 3000);
    v.owner([{ do: "build", kind: "pylon", dir: 0, ...spot }]);
    await v.at(3100);
    expect(visitFollowing()).toMatchObject({ late: 1 });
    expect(visitFollowing()?.hold).toBeGreaterThan(5);
    expect(v.reads()).toBe(3);
    expect(kindAt(spot)).toBe("pylon");
    likeLeafs(v.fake.leaf.yard);
    // Told in time, batch after batch, it comes back to half a second behind, and reads nothing more.
    await collecting(v, 4100, 30);
    await v.at(3100 + 31 * 1000);
    expect(visitFollowing()).toMatchObject({ hold: 5, late: 1, unlike: 0, waiting: 0 });
    expect(v.reads()).toBe(3);
    likeLeafs(v.fake.leaf.yard);
  });

  test("reads the yard every few minutes while Leaf tells it what it does, and every fifteen seconds while it hears nothing", async () => {
    const v = await visit();
    await v.at(60_000);
    expect(v.reads()).toBe(2);
    await v.at(5 * 60_000 + 1);
    expect(v.reads()).toBe(3);
    // The connection drops: until a welcome comes again, the visit reads the yard on its own.
    v.room.drop();
    await v.at(5 * 60_000 + 15_002);
    expect(v.reads()).toBe(4);
    expect(visitFollowing()?.live).toBe(false);
  });
});

describe("a visit, told late", () => {
  test("of a batch a read of the yard already holds, lets it go: nothing done twice, and nothing read again for it", async () => {
    const v = await visit();
    await v.at(1000);
    const spot = pylonSpot();
    const tell = v.owner([{ do: "build", kind: "pylon", ...spot, dir: 0 }], undefined, false);
    // The room welcomes the page again (a connection back after a drop): it reads the yard, which holds the batch.
    await v.at(3000);
    v.room.says({ t: "welcome", v: 2, you: 1, room: `${visitRoom("works", OWNER)}/1`, hz: 30, time: 0, roster: [] });
    await v.at(3100);
    expect(kindAt(spot)).toBe("pylon");
    const reads = v.reads();
    // The batch's word comes after, two seconds after Leaf did it: past the tick the copy now stands at.
    tell();
    await v.at(4500);
    expect(kindAt(spot)).toBe("pylon");
    expect([v.reads(), visitFollowing()?.late, visitFollowing()?.unlike]).toEqual([reads, 0, 0]);
  });
});

/**
 * The owner's own page, with another page of theirs (another tab, another device) that Leaf keeps
 * batches for too: the page opens its yard from a stand-in Leaf that counts its revisions as the play
 * service does (one for each batch that changed the yard), goes into the yard's room, and the room
 * welcomes it. `elsewhere` is Leaf doing the other page's commands and telling the room, with their ids.
 */
async function owned(yard: Yard = staged("mid")) {
  const me = TESTER.player.id;
  yard.at = ctx().now;
  const leaf = { yard, rev: 1, ms: 0, reads: [] as string[], posts: 0, others: 0 };
  const leafAt = () => ({ ...ctx(), now: ctx().now + leaf.ms });
  const runOn = () => {
    WORKS.tend?.(leaf.yard, leafAt(), () => true);
    WORKS.advance(leaf.yard, leafAt());
  };
  const said: ToClient[] = [];
  let room: FakeSocket | null = null;
  const tell = (m: ToClient) => {
    said.push(m);
    room?.says(m);
  };
  /** Does commands as Leaf does a batch, each with its id, and tells the room what was kept. */
  const batch = (commands: readonly Record<string, unknown>[]) => {
    runOn();
    const did: unknown[] = [];
    const ids: string[] = [];
    const results = commands.map((c) => {
      const id = typeof c.id === "string" ? c.id : "";
      const command = WORKS.command(c);
      const done = command ? WORKS.apply(leaf.yard, command, leafAt()) : { refused: "invalid" };
      if ("refused" in done) return { id, refused: done.refused };
      if (command) did.push(WORKS.echo?.(leaf.yard, command));
      ids.push(id);
      return { id, notes: done.notes };
    });
    if (did.length > 0) leaf.rev++;
    const after = WORKS.answer?.(leaf.yard, leafAt());
    if (did.length > 0) tell({ t: "did", rev: leaf.rev, did, after, ids });
    return { results, after };
  };
  net.world = standin({
    "GET /v1/game/hello": HELLO,
    "GET /v1/game/me": { status: 200, body: TESTER },
    "GET /v1/game/play/works": (sent): Reply => {
      leaf.reads.push(sent.path);
      runOn();
      return { status: 200, body: { rev: leaf.rev, now: "x", state: WORKS.view(leaf.yard, leafAt()) } };
    },
    "POST /v1/game/play/works": (sent): Reply => {
      leaf.posts++;
      const body = sent.body;
      const commands =
        typeof body === "object" && body !== null && "commands" in body && Array.isArray(body.commands)
          ? body.commands
          : [];
      const { results, after } = batch(commands);
      return { status: 200, body: { rev: leaf.rev, now: "x", results, state: after } };
    },
  });
  await start();
  sockets = liveSockets();
  S.visiting = null;
  expect(await openYard(me, () => undefined)).toBeNull();
  room = sockets.sockets[0] ?? null;
  if (!room) throw new Error("the owner's page did not go into its yard's room");
  expect(room.url).toBe(`wss://leaf.example${livePath(visitRoom("works", playerId(me)))}&device=desktop`);
  room.open();
  room.says({ t: "welcome", v: 2, you: 1, room: `${visitRoom("works", playerId(me))}/1`, hz: 30, time: 0, roster: [] });
  await settle(0);
  const at = async (ms: number) => {
    leaf.ms = ms;
    await settle(ms);
  };
  /** Leaf does a batch of the owner's other page's commands. */
  const elsewhere = (commands: Record<string, unknown>[]) => {
    runOn();
    const tick = clockOf(leaf.yard, leafAt().now);
    batch(commands.map((c) => ({ ...c, tick, id: `other-${++leaf.others}` })));
  };
  return { leaf, room, at, elsewhere, said };
}

describe("the owner's own page, in its yard's room", () => {
  test("is told what another page of the owner's did, and takes Leaf's yard at once, counting no fault", async () => {
    const o = await owned();
    await o.at(500);
    const reads = o.leaf.reads.length;
    const spot = pylonSpot();
    o.elsewhere([{ do: "build", kind: "pylon", ...spot, dir: 0 }]);
    await o.at(800);
    expect(kindAt(spot)).toBe("pylon");
    expect([o.leaf.reads.length, differences()]).toEqual([reads + 1, 0]);
    expect(o.leaf.reads.some((r) => r.includes("differs"))).toBe(false);
  });

  test("lets its own batches go as the room tells them: nothing read for them", async () => {
    const o = await owned();
    await o.at(500);
    const reads = o.leaf.reads.length;
    expect(doNow({ do: "build", kind: PYLON, ...pylonSpot(), dir: 0, grade: 1 })).not.toHaveProperty("refused");
    await until(() => o.leaf.posts >= 1);
    await o.at(800);
    expect(o.said.filter((m) => m.t === "did")).toHaveLength(1);
    expect([o.leaf.reads.length, differences()]).toEqual([reads, 0]);
  });

  test("out of the room (signed in elsewhere since), finds another page's batch at its next command, and counts no fault", async () => {
    const o = await owned();
    await o.at(500);
    // Another page of the owner's opens Live: this one is let go, and hears nothing more.
    o.room.drop(4001);
    await o.at(600);
    const spot = pylonSpot();
    o.elsewhere([{ do: "build", kind: "pylon", ...spot, dir: 0 }]);
    await o.at(900);
    expect(kindAt(spot)).toBeUndefined();
    expect(doNow({ do: "collect" })).not.toHaveProperty("refused");
    await until(() => o.leaf.posts >= 1);
    await o.at(1200);
    expect(kindAt(spot)).toBe("pylon");
    expect(differences()).toBe(0);
    expect(o.leaf.reads.some((r) => r.includes("differs"))).toBe(false);
  });
});
