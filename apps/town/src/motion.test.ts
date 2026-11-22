import { afterEach, describe, expect, test } from "bun:test";

import type { Emote } from "@sequoia-leaf/kit/emotes.ts";
import { LET_GO, restart, start } from "@sequoia-leaf/kit/live.ts";
import { forgetLedger } from "@sequoia-leaf/kit/purse.ts";
import {
  Flag,
  joinLive,
  type LiveMember,
  type LiveRoom,
  type LiveStatus,
  type Motion,
} from "@sequoia-leaf/kit/realtime.ts";
import {
  CLOSE,
  type FakeSocket,
  HELLO,
  liveSockets,
  type Standin,
  standin,
  TESTER,
} from "@sequoia-leaf/kit/standin.ts";

import {
  Company,
  FADE,
  type Fellow,
  follow,
  linkShown,
  newFigure,
  othersIn,
  type Placed,
  Pose,
  stepOf,
} from "./motion.ts";
import { inTownLine } from "./news.ts";

const DT = 1 / 30;
const at = (x: number, y: number, more: Partial<Motion> = {}): Motion => ({
  x,
  y,
  vx: 0,
  vy: 0,
  facing: 0,
  pose: Pose.Foot,
  flags: 0,
  jump: 1,
  ...more,
});
const walking = (x: number, y: number, more: Partial<Motion> = {}): Motion =>
  at(x, y, { vx: 64, flags: Flag.Moving, facing: 2, ...more });

const figure = (more: Partial<Placed> = {}): Placed => ({
  x: 100,
  y: 150,
  dir: 0,
  moving: false,
  seat: null,
  ...more,
});

describe("what the member's figure tells the room", () => {
  test("standing: where their feet are, facing as they do, still", () => {
    expect(stepOf(figure({ dir: 3 }), { x: 100, y: 150 }, DT)).toEqual({
      x: 100,
      y: 150,
      vx: 0,
      vy: 0,
      facing: 3,
      pose: Pose.Foot,
      flags: 0,
    });
  });

  test("walking: moving, at the speed they went since the last moment, facing the way they go", () => {
    const step = stepOf(figure({ x: 102, y: 149, dir: 2, moving: true }), { x: 100, y: 150 }, 1 / 32);

    expect(step).toEqual({ x: 102, y: 149, vx: 64, vy: -32, facing: 2, pose: Pose.Foot, flags: Flag.Moving });
  });

  test("sitting: where the seat is, facing the way it faces, still, whatever their feet were doing", () => {
    const seat = { x: 248, y: 201, dir: 0 as const };
    const step = stepOf(figure({ x: 248, y: 188, dir: 3, moving: true, seat }), { x: 248, y: 190 }, DT);

    expect(step).toEqual({ x: 248, y: 201, vx: 0, vy: 0, facing: 0, pose: Pose.Sitting, flags: 0 });
  });

  test("arriving through a door: put there, not walked there, so with no speed and counted as a jump", async () => {
    const world = await live();
    const room = joinLive("town");
    rooms.push(room);
    const s = socket(world, 0);
    s.open();
    s.says(welcome(1, world.standin.clock.now, [me(1)]));
    // Walking up to the Works' door; then out of its doorway again, at the threshold, from the dark.
    room.move(stepOf(figure({ x: 373, y: 127, dir: 3 }), { x: 373, y: 127 }, DT));
    const out = figure({ x: 373, y: 121, dir: 0, moving: true });
    room.move(stepOf(out, null, DT), true);
    world.standin.clock.now += 100;
    room.move(stepOf(figure({ x: 373, y: 123, dir: 0, moving: true }), { x: 373, y: 121 }, 1 / 16));

    expect(s.moves().map((m) => [m?.motion.y, m?.motion.vy, m?.motion.jump])).toEqual([
      [127, 0, 0],
      [121, 0, 1],
      [123, 32, 1],
    ]);
  });
});

describe("somebody else, drawn from what the room says", () => {
  test("exactly where they are, never walked there of the town's own accord", () => {
    const f = newFigure();
    follow(f, at(120, 80), DT);
    follow(f, at(300, 200, { facing: 1 }), DT);

    expect([f.x, f.y, f.dir]).toEqual([300, 200, 1]);
  });

  test("fades in over 0.3 seconds from their first motion, and is not drawn before it", () => {
    const f = newFigure();
    expect(follow(f, null, DT)).toBeNull();
    expect(f.alpha).toBe(0);
    expect(follow(f, at(10, 10), DT)).toBe("first");
    expect(f.alpha).toBe(0);
    follow(f, at(10, 10), FADE / 2);
    expect(f.alpha).toBeCloseTo(0.5);
    follow(f, at(10, 10), FADE);
    expect(f.alpha).toBe(1);
  });

  test("moves their legs only while moving, at the pace their speed gives", () => {
    const f = newFigure();
    follow(f, at(10, 10), DT);
    follow(f, walking(12, 10), 0.5);
    expect([f.moving, f.walked]).toEqual([true, 32]);
    // Put further along without the moving flag: drawn there, legs still.
    follow(f, at(40, 10), 0.5);
    expect([f.x, f.moving, f.walked]).toEqual([40, false, 32]);
    // Moving with no speed said: the legs keep up with how far they went.
    follow(f, walking(43, 14, { vx: 0 }), DT);
    expect(f.walked).toBe(37);
  });

  test("seated where they are when their pose is sitting, legs still", () => {
    const f = newFigure();
    follow(f, at(248, 188), DT);
    follow(f, walking(248, 201, { pose: Pose.Sitting, facing: 0 }), DT);

    expect([f.x, f.y, f.seated, f.moving, f.dir]).toEqual([248, 201, true, false, 0]);
    follow(f, at(248, 188), DT);
    expect(f.seated).toBe(false);
  });

  test("put at the new place at once when their jump count changes, legs not walked there", () => {
    const f = newFigure();
    follow(f, walking(100, 100), DT);
    const walked = f.walked;

    expect(follow(f, walking(400, 300, { jump: 2 }), DT)).toBe("jump");
    expect([f.x, f.y, f.walked]).toEqual([400, 300, walked]);
    expect(follow(f, walking(402, 300, { jump: 2 }), DT)).toBeNull();
  });

  test("fades out over 0.3 seconds once they have gone, wherever the room says they are", () => {
    const f = newFigure();
    follow(f, at(50, 50), DT);
    follow(f, at(50, 50), FADE);
    f.gone = true;
    follow(f, at(90, 90), FADE / 2);
    expect([f.x, f.alpha]).toEqual([50, 0.5]);
    follow(f, at(90, 90), FADE);
    expect(f.alpha).toBe(0);
  });

  test("stands where they were when nothing new is said", () => {
    const f = newFigure();
    follow(f, walking(50, 50), DT);
    follow(f, null, DT);

    expect([f.x, f.moving]).toEqual([50, false]);
  });
});

// ---------- in the room, against a stand-in for Leaf ----------

const ALICE: LiveMember = { id: 2, player: "alice-uuid", name: "Alice", rank: "captain", guest: false };
const BOB: LiveMember = { id: 3, player: "bob-uuid", name: "Bob", rank: null, guest: true };
const me = (id: number): LiveMember => ({
  id,
  player: TESTER.player.id,
  name: "Tester",
  rank: "captain",
  guest: false,
});
const welcome = (you: number, time: number, roster: LiveMember[]) =>
  ({ t: "welcome", v: 2, you, room: "town/1", hz: 30, time, roster }) as const;

const rooms: LiveRoom[] = [];
let undo: (() => void)[] = [];
afterEach(() => {
  for (const r of rooms.splice(0)) r.close();
  for (const fn of undo.splice(0)) fn();
  restart();
  forgetLedger();
});

/** A live game, as Tester, whose live connections the test plays Leaf's side of. */
async function live(): Promise<{ standin: Standin; sockets: FakeSocket[] }> {
  const world = standin({ "GET /v1/game/hello": HELLO, "GET /v1/game/me": { status: 200, body: TESTER } });
  await start();
  const { sockets, done } = liveSockets();
  undo = [done, () => world.done()];
  return { standin: world, sockets };
}

const socket = (world: { sockets: FakeSocket[] }, i: number): FakeSocket => {
  const s = world.sockets[i];
  if (!s) throw new Error(`no socket ${i}`);
  return s;
};

/** The town's company in a room: everybody heard of, and every emote and status heard. */
async function inTown() {
  const world = await live();
  const emotes: string[] = [];
  const statuses: LiveStatus[] = [];
  const company = new Company<string>((m) => `figure of ${m.name}`, {
    emote: (f: Fellow<string>, kind: Emote) => emotes.push(`${f.who.name} ${kind}`),
    status: (s) => statuses.push(s),
  });
  const room = joinLive("town", company.ears);
  rooms.push(room);
  const s = socket(world, 0);
  s.open();
  return { world, company, room, s, emotes, statuses, now: world.standin.clock.now };
}

describe("everybody else in the room", () => {
  test("are followed by their account, so a new connection's numbering never mixes two people up", async () => {
    const { company, s, now } = await inTown();
    s.says(welcome(1, now, [me(1), ALICE]));
    s.says({ t: "joined", member: BOB });
    expect(company.all().map((f) => [f.who.name, f.id, f.own])).toEqual([
      ["Alice", 2, "figure of Alice"],
      ["Bob", 3, "figure of Bob"],
    ]);
    s.says({ t: "left", id: 3 });
    expect([...company.here()]).toEqual(["alice-uuid"]);

    // A new connection: Leaf numbers the member and Alice afresh. She is the same figure.
    const alice = company.all()[0];
    s.says(welcome(4, now, [{ ...ALICE, id: 1 }, me(4)]));
    expect(company.all()[0]).toBe(alice);
    expect(company.byId(1)?.who.name).toBe("Alice");
    expect(company.byId(2)).toBeUndefined();
  });

  test("are drawn from the room's samples, and those who have gone fade away and are forgotten", async () => {
    const { company, room, s, now } = await inTown();
    s.says(welcome(1, now, [me(1), ALICE]));
    s.snapshot(now - 200, [{ id: 2, seq: 1, ...walking(100, 50) }]);
    s.snapshot(now - 100, [{ id: 2, seq: 2, ...walking(110, 50) }]);
    const sample = (id: number): Motion | null => room.sample(id);

    expect(company.step(sample, DT).came.map((f) => f.who.name)).toEqual(["Alice"]);
    company.step(sample, FADE);
    expect(company.all().map((f) => [f.fig.x, f.fig.moving, f.fig.alpha])).toEqual([[110, true, 1]]);

    s.says({ t: "left", id: 2 });
    company.step(sample, FADE / 2);
    expect(company.all().map((f) => f.fig.alpha)).toEqual([0.5]);
    expect(company.step(sample, FADE / 2).went.map((f) => f.own)).toEqual(["figure of Alice"]);
    expect(company.all()).toEqual([]);
  });

  test("are counted for the feed: everybody in the room but the member", async () => {
    const { room, s, now } = await inTown();
    const line = (): string => inTownLine(othersIn(room.members(), room.you()));
    s.says(welcome(1, now, [me(1)]));
    expect(line()).toBe("The town is quiet.");
    s.says({ t: "joined", member: ALICE });
    expect(line()).toBe("1 is in town.");
    s.says({ t: "joined", member: BOB });
    expect(line()).toBe("2 are in town.");
    s.says({ t: "left", id: 2 });
    expect(line()).toBe("1 is in town.");
  });
});

describe("an emote", () => {
  test("goes to the room as an act, and comes back from somebody else to their figure once it is drawn", async () => {
    const { company, room, s, emotes, now } = await inTown();
    s.says(welcome(1, now, [me(1), ALICE, BOB]));
    room.act("emote", "wave");
    expect(s.texts().filter((m) => m.t === "act")).toEqual([{ t: "act", kind: "emote", arg: "wave" }]);

    // Alice is drawn; Bob has not moved yet, so there is nobody to see hop.
    s.snapshot(now - 100, [{ id: 2, seq: 1, ...at(40, 40) }]);
    company.step((id) => room.sample(id), DT);
    company.step((id) => room.sample(id), DT);
    s.says({ t: "act", id: 2, kind: "emote", arg: "cheer" });
    s.says({ t: "act", id: 3, kind: "emote", arg: "laugh" });
    // Only the town's four emotes are anybody's to see here.
    s.says({ t: "act", id: 2, kind: "emote", arg: "crab" });
    s.says({ t: "act", id: 2, kind: "point", arg: "heart" });

    expect(emotes).toEqual(["Alice cheer"]);
  });
});

describe("the connection, shown", () => {
  test("says Reconnecting from a drop until the room welcomes the page again", async () => {
    const { s, statuses, now, world } = await inTown();
    let dropped = false;
    const shown = (): string => linkShown(statuses.at(-1) ?? null, dropped);
    s.says(welcome(1, now, [me(1)]));
    expect(shown()).toBe("none");
    s.drop();
    dropped = statuses.at(-1) === "closed";
    expect(shown()).toBe("reconnecting");
    await Bun.sleep(800);
    const again = socket(world, 1);
    again.open();
    expect(shown()).toBe("reconnecting");
    again.says(welcome(1, now, [me(1)]));
    dropped = false;
    expect(shown()).toBe("none");
  });

  test.each([
    [CLOSE.replaced, "replaced", ["Playing somewhere else", "This page has let go of the town.", "Play here"]],
    [
      CLOSE.signedOut,
      "signedout",
      ["Signed out", "Sign in with the guild's website, and the gate will know you.", "Sign in"],
    ],
  ] as const)("closed with %d: the kit's card for it, and no Reconnecting", async (code, card, words) => {
    const { s, statuses, now } = await inTown();
    s.says(welcome(1, now, [me(1)]));
    s.drop(code);

    expect(statuses.at(-1)).toBe(card);
    expect(linkShown(statuses.at(-1) ?? null, true)).toBe(card);
    expect(LET_GO[card]).toEqual(words);
  });
});
