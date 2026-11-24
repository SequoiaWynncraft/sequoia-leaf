import { describe, expect, it } from "bun:test";

import { decodeSnapshot, Flag, type Motion, readToClient, type ToClient } from "@sequoia-leaf/core";
import { Effect } from "effect";

import {
  type Connection,
  halted,
  moved,
  type Occupant,
  QUIET_MS,
  reconnected,
  Room,
  Rooms,
  type Shown,
} from "../src/live/room.ts";

/** Where the room shows somebody, or null before their first move. */
const motionOf = (o: Occupant) => (o.shown.state === "seen" ? o.shown.motion : null);
/** The number of the move the room shows of somebody, or null before their first. */
const seqOf = (o: Occupant) => (o.shown.state === "seen" ? o.shown.seq : null);

/** What one person in a room was sent, on the one connection they have: the text decoded, and the binary frames as they were. */
function inbox() {
  const texts: ToClient[] = [];
  const frames: Uint8Array[] = [];
  const connection = {
    writeIf: (still: () => boolean, frame: Uint8Array) =>
      Effect.sync(() => {
        if (still()) frames.push(frame);
      }),
  };
  return {
    texts,
    frames,
    outbox: {
      send(frame: string | Uint8Array) {
        if (typeof frame !== "string") frames.push(frame);
        else {
          const m = readToClient(frame);
          if (m) texts.push(m);
        }
      },
      connection: () => connection,
    },
  };
}

/** One of the room's ticks: its snapshot, if anything moved, written to everybody it is for as Live writes it. Says whether there was one. */
function tick(room: Room, n: number, time: number): boolean {
  const snapshot = room.flush(n, time);
  if (snapshot === null) return false;
  for (const r of snapshot.to) Effect.runSync(r.connection.writeIf(() => room.reaches(r), snapshot.frame));
  return true;
}

const TOWN = { width: 512, height: 352, capacity: 3, speed: 160 };
const person = (name: string, guest = false) => ({ player: `id-${name}`, name, rank: guest ? null : "Captain", guest });
const at = (x: number, y: number, flags = 0, jump = 0): Motion => ({
  x,
  y,
  vx: 0,
  vy: 0,
  facing: 1,
  pose: 0,
  flags,
  jump,
});

describe("a room", () => {
  it("welcomes whoever comes in with everybody there, and tells the others", () => {
    const room = new Room("town", 1, TOWN);
    const a = inbox();
    const b = inbox();
    const alice = room.join(person("Alice"), a.outbox, 1000, 30, 1);
    const bob = room.join(person("Bob", true), b.outbox, 2000, 30, 1);

    expect(b.texts).toEqual([
      {
        t: "welcome",
        v: 1,
        you: 2,
        room: "town/1",
        hz: 30,
        time: 2000,
        roster: [alice.member, { id: 2, player: "id-Bob", name: "Bob", rank: null, guest: true }],
      },
    ]);
    expect(a.texts.at(-1)).toEqual({ t: "joined", member: bob.member });
    // Nobody has moved yet, so there is nobody to show.
    expect(b.frames).toEqual([]);
  });

  it("shows whoever comes in where everybody already is, at once", () => {
    const room = new Room("town", 1, TOWN);
    const alice = room.join(person("Alice"), inbox().outbox, 0, 30, 1);
    room.move(alice.member.id, 1, at(100, 50), 0);
    const b = inbox();
    room.join(person("Bob"), b.outbox, 0, 30, 1);

    expect(b.frames.map((f) => decodeSnapshot(f)?.entries.map((e) => [e.id, e.x, e.y]))).toEqual([[[1, 100, 50]]]);
  });

  it("sends the motion that changed since the last tick, once a tick, one frame made once for all", () => {
    const room = new Room("town", 1, TOWN);
    const a = inbox();
    const b = inbox();
    const alice = room.join(person("Alice"), a.outbox, 0, 30, 1);
    const bob = room.join(person("Bob"), b.outbox, 0, 30, 1);
    room.move(alice.member.id, 1, at(10, 10), 5000);
    room.move(alice.member.id, 2, at(12, 10, Flag.Moving), 5000);

    expect(tick(room, 1, 5000)).toBe(true);
    expect(tick(room, 2, 5033)).toBe(false);
    room.move(bob.member.id, 1, at(300, 200), 0);
    tick(room, 3, 5066);

    expect(a.frames.length).toBe(2);
    expect(a.frames[0]).toBe(b.frames[0]);
    expect(decodeSnapshot(a.frames[0] ?? new Uint8Array())).toEqual({
      tick: 1,
      time: 5000,
      // Their first move counts as a jump: nobody has seen them anywhere yet.
      entries: [{ id: 1, seq: 2, ...at(12, 10, Flag.Moving, 1) }],
    });
    expect(decodeSnapshot(b.frames[1] ?? new Uint8Array())?.entries.map((e) => e.id)).toEqual([2]);
  });

  it("keeps motion inside the room and below the fastest anybody moves", () => {
    const room = new Room("town", 1, TOWN);
    const a = inbox();
    const alice = room.join(person("Alice"), a.outbox, 0, 30, 1);
    room.move(alice.member.id, 1, { x: -40, y: 9000, vx: 1e9, vy: -1e9, facing: 3, pose: 2, flags: 0, jump: 4 }, 0);

    expect(motionOf(alice)).toEqual({ x: 0, y: 352, vx: 1024, vy: -1024, facing: 3, pose: 2, flags: 0, jump: 1 });
  });

  it("takes every move of the present connection, in the order sent, whatever its numbers", () => {
    const room = new Room("town", 1, TOWN);
    const alice = room.join(person("Alice"), inbox().outbox, 0, 30, 1);
    const id = alice.member.id;
    room.move(id, 1200, at(1, 1), 0);
    // A new tab numbers its moves from the start again.
    room.reconnected(id);
    room.move(id, 1, at(2, 2), 0);

    expect([seqOf(alice), motionOf(alice)?.x]).toEqual([1, 2]);
  });

  it("counts jumps itself: when the game's count changes, and at a new connection's first move", () => {
    const room = new Room("town", 1, TOWN);
    const alice = room.join(person("Alice"), inbox().outbox, 0, 30, 1);
    const id = alice.member.id;
    const shown: number[] = [];
    const move = (jump: number) => {
      room.move(id, 1, at(0, 0, 0, jump), 0);
      shown.push(motionOf(alice)?.jump ?? -1);
    };
    move(0);
    move(0);
    move(1);
    move(1);
    // A fresh tab counts from 0 again, and an old tab that had jumped once counts from 1: both are a
    // jump all the same, since nobody may see them slide from where the last connection left them.
    room.reconnected(id);
    move(1);
    room.reconnected(id);
    move(0);
    move(0);

    expect(shown).toEqual([1, 1, 2, 2, 3, 4, 4]);
  });

  it("shows a move further than the room's pace allows as a jump, though the game did not count one", () => {
    const room = new Room("town", 1, TOWN);
    const alice = room.join(person("Alice"), inbox().outbox, 0, 30, 1);
    const id = alice.member.id;
    const shown: number[] = [];
    const move = (x: number, time: number, jump = 0) => {
      room.move(id, 1, at(x, 100, Flag.Moving, jump), time);
      shown.push(motionOf(alice)?.jump ?? -1);
    };
    move(100, 1000);
    // Walking at the town's pace, 64 a second, twenty moves a second: never a jump.
    for (let n = 1; n <= 20; n++) move(100 + n * 3.2, 1000 + n * 50);
    // 50 ms after the last, the pace allows 160 x 0.05 x 1.5 + 8 = 20 units: 19 is a walk, 21 more is not.
    move(183, 2050);
    move(204, 2100);
    // Half a second standing, then 128 units in one move: within 160 x 0.5 x 1.5 + 8.
    move(332, 2600);
    // Across the town at once: a jump, however long it has been since.
    move(20, 2700);
    // A jump the game counted is one jump, not two, however far it goes.
    move(500, 2750, 1);

    expect(shown).toEqual([1, ...Array.from({ length: 20 }, () => 1), 1, 2, 2, 3, 4]);
  });

  it("measures the pace between the places as the room keeps them, inside it", () => {
    const room = new Room("town", 1, TOWN);
    const alice = room.join(person("Alice"), inbox().outbox, 0, 30, 1);
    room.move(alice.member.id, 1, at(0, 100), 1000);
    // Far outside the room on its left: kept at its edge, where Alice already is.
    room.move(alice.member.id, 2, at(-5000, 100), 1050);

    expect(motionOf(alice)).toMatchObject({ x: 0, jump: 1 });
  });

  it("keeps a jump through a later move before the tick, since only the newest motion counts", () => {
    const room = new Room("town", 1, TOWN);
    const a = inbox();
    const alice = room.join(person("Alice"), inbox().outbox, 0, 30, 1);
    room.join(person("Bob"), a.outbox, 0, 30, 1);
    room.move(alice.member.id, 1, at(400, 300, 0, 1), 0);
    room.move(alice.member.id, 2, at(401, 300, Flag.Moving, 1), 0);
    tick(room, 1, 0);

    expect(decodeSnapshot(a.frames.at(-1) ?? new Uint8Array())?.entries.map((e) => [e.x, e.jump])).toEqual([[401, 1]]);
  });

  it("greets somebody again with who is here and where, telling nobody else", () => {
    const room = new Room("town", 1, TOWN);
    const a = inbox();
    const b = inbox();
    const alice = room.join(person("Alice"), a.outbox, 0, 30, 1);
    room.join(person("Bob"), b.outbox, 0, 30, 1);
    room.move(alice.member.id, 1, at(5, 6), 0);
    const before = b.texts.length;
    room.greet(alice, 9, 30, 1);

    expect(a.texts.at(-1)).toMatchObject({ t: "welcome", you: alice.member.id, time: 9 });
    expect(a.texts.at(-1)?.t === "welcome" ? a.texts.at(-1) : null).toMatchObject({
      roster: [{ name: "Alice" }, { name: "Bob" }],
    });
    expect(decodeSnapshot(a.frames.at(-1) ?? new Uint8Array())?.entries.map((e) => [e.id, e.x])).toEqual([[1, 5]]);
    expect(b.texts.length).toBe(before);
  });

  it("stands somebody still where they are when told to halt", () => {
    const room = new Room("town", 1, TOWN);
    const b = inbox();
    const alice = room.join(person("Alice"), inbox().outbox, 0, 30, 1);
    room.join(person("Bob"), b.outbox, 0, 30, 1);
    room.move(alice.member.id, 1, { ...at(50, 60, Flag.Moving | 4), vx: 30 }, 0);
    tick(room, 1, 0);
    room.halt(alice.member.id);
    tick(room, 2, 0);
    room.halt(alice.member.id);

    expect(tick(room, 3, 0)).toBe(false);
    expect(decodeSnapshot(b.frames.at(-1) ?? new Uint8Array())?.entries.map((e) => [e.x, e.vx, e.flags])).toEqual([
      [50, 0, 4],
    ]);
  });

  it("stands somebody shown walking still where they are once their game has said nothing for a while", () => {
    const room = new Room("town", 1, TOWN);
    const b = inbox();
    const alice = room.join(person("Alice"), inbox().outbox, 0, 30, 1);
    room.join(person("Bob"), b.outbox, 0, 30, 1);
    // Alice walks right, twenty moves a second, and her tab is hidden after the last.
    for (let i = 0; i <= 10; i++)
      room.move(alice.member.id, i + 1, { ...at(50 + i * 3, 60, Flag.Moving), vx: 64 }, i * 50);
    tick(room, 1, 500);
    const shown = () => decodeSnapshot(b.frames.at(-1) ?? new Uint8Array())?.entries.map((e) => [e.x, e.vx, e.flags]);
    expect(shown()).toEqual([[80, 64, Flag.Moving]]);

    // Still walking a moment after her last move: a move may be a little late.
    expect(tick(room, 2, 500 + QUIET_MS - 1)).toBe(false);
    tick(room, 3, 500 + QUIET_MS);
    expect(shown()).toEqual([[80, 0, 0]]);
    // Standing, she stays as she is, however long it is quiet; her next move walks her on.
    expect(tick(room, 4, 60_000)).toBe(false);
    room.move(alice.member.id, 20, { ...at(83, 60, Flag.Moving), vx: 64 }, 60_010);
    tick(room, 5, 60_010);
    expect(shown()).toEqual([[83, 64, Flag.Moving]]);
  });

  it("tells the others what somebody did, and that they left", () => {
    const room = new Room("town", 1, TOWN);
    const a = inbox();
    const b = inbox();
    const alice = room.join(person("Alice"), a.outbox, 0, 30, 1);
    room.join(person("Bob"), b.outbox, 0, 30, 1);
    room.act(alice.member.id, "emote", "wave");
    room.leave(alice.member.id);
    room.leave(alice.member.id);

    expect(b.texts.slice(1)).toEqual([
      { t: "act", id: 1, kind: "emote", arg: "wave" },
      { t: "left", id: 1 },
    ]);
    expect(a.texts.some((m) => m.t === "act")).toBe(false);
    expect(room.size).toBe(1);
  });

  it("makes a snapshot for everybody with a connection, and it stays for them only while they are there on it", () => {
    const room = new Room("town", 1, TOWN);
    const a = inbox();
    const b = inbox();
    const c = inbox();
    let bobs: Connection | null = b.outbox.connection();
    const alice = room.join(person("Alice"), a.outbox, 0, 30, 1);
    room.join(person("Bob"), { send: (frame) => b.outbox.send(frame), connection: () => bobs }, 0, 30, 1);
    const carol = room.join(person("Carol"), c.outbox, 0, 30, 1);
    room.move(alice.member.id, 1, at(10, 10), 0);
    const snapshot = room.flush(1, 0);
    expect(snapshot?.to.map((r) => r.occupant.member.name)).toEqual(["Alice", "Bob", "Carol"]);

    // Carol leaves; Bob's page has a new connection, which the room greets afresh.
    room.leave(carol.member.id);
    bobs = inbox().outbox.connection();
    expect(snapshot?.to.map((r) => room.reaches(r))).toEqual([true, false, false]);
    // Somebody whose page has no connection now (in their grace) is not one it is made for.
    bobs = null;
    room.move(alice.member.id, 2, at(12, 10), 10);
    expect(room.flush(2, 10)?.to.map((r) => r.occupant.member.name)).toEqual(["Alice"]);
  });

  it("knows somebody as in it only while they are, not once gone nor gone and back in as another", () => {
    const room = new Room("town", 1, TOWN);
    const alice = room.join(person("Alice"), inbox().outbox, 0, 30, 1);
    expect(room.has(alice)).toBe(true);
    room.leave(alice.member.id);
    expect(room.has(alice)).toBe(false);
    // Numbers wrap round: somebody else comes in with hers, and is not her.
    for (let i = 0; i < 65_534; i++) room.leave(room.join(person("x"), inbox().outbox, 0, 30, 1).member.id);
    const bob = room.join(person("Bob"), inbox().outbox, 0, 30, 1);
    expect(bob.member.id).toBe(alice.member.id);
    expect([room.has(alice), room.has(bob)]).toEqual([false, true]);
  });

  it("numbers people counting up, never 0, wrapping and skipping anybody still there", () => {
    const room = new Room("town", 1, { ...TOWN, capacity: 5 });
    const first = room.join(person("A"), inbox().outbox, 0, 30, 1);
    for (let i = 0; i < 65_533; i++) {
      const o = room.join(person("x"), inbox().outbox, 0, 30, 1);
      room.leave(o.member.id);
    }
    const last = room.join(person("B"), inbox().outbox, 0, 30, 1);
    const wrapped = room.join(person("C"), inbox().outbox, 0, 30, 1);

    expect([first.member.id, last.member.id, wrapped.member.id]).toEqual([1, 65_535, 2]);
  });
});

describe("the rooms", () => {
  it("puts people in the first copy with space, opens another when full, and closes empty ones", () => {
    const rooms = new Rooms();
    const join = (i: number) => {
      const room = rooms.place("town");
      room?.join(person(`P${i}`), inbox().outbox, 0, 30, 1);
      return room?.name;
    };
    const inCopies = Array.from({ length: 70 }, (_, i) => join(i));

    expect(inCopies.filter((n) => n === "town/1").length).toBe(32);
    expect([...rooms.all()].map((r) => [r.name, r.size])).toEqual([
      ["town/1", 32],
      ["town/2", 32],
      ["town/3", 6],
    ]);

    // Everybody leaves the first copy: it closes, and its number is taken again once the others are full.
    const first = [...rooms.all()][0];
    for (const id of first?.occupants.keys() ?? []) first?.leave(id);
    if (first) rooms.tidy(first);
    expect([...rooms.all()].map((r) => r.name)).toEqual(["town/2", "town/3"]);
    const more = Array.from({ length: 27 }, (_, i) => join(100 + i));
    expect(more.slice(0, 26).every((n) => n === "town/3")).toBe(true);
    expect(more.at(-1)).toBe("town/1");
    expect([...rooms.all()].map((r) => r.name)).toEqual(["town/1", "town/2", "town/3"]);
  });

  it("has work at a tick only for a room where motion changed or somebody is shown walking", () => {
    const rooms = new Rooms();
    const town = rooms.place("town");
    const visit = rooms.place("visit:works:10000000-0000-0000-0000-000000000001");
    if (!town || !visit) throw new Error("no rooms");
    const alice = town.join(person("Alice"), inbox().outbox, 0, 30, 1);
    const bob = town.join(person("Bob"), inbox().outbox, 0, 30, 1);
    const looker = visit.join(person("Carol"), inbox().outbox, 0, 30, 1);
    // Come in, nobody has moved: no work anywhere. Nothing moves in a still room.
    expect(rooms.busy()).toEqual([]);
    visit.move(looker.member.id, 1, at(5, 5, Flag.Moving), 0);
    expect(rooms.busy()).toEqual([]);

    // A step that stands Alice still is told at the next tick, and then the town has none.
    town.move(alice.member.id, 1, at(10, 10), 0);
    expect(rooms.busy()).toEqual([town]);
    expect(town.flush(1, 0)).not.toBeNull();
    expect(rooms.busy()).toEqual([]);

    // Bob walking keeps it on the list, told or not, until his game goes quiet and he is stood still.
    town.move(bob.member.id, 1, at(20, 20, Flag.Moving), 100);
    expect(town.flush(2, 133)).not.toBeNull();
    expect(town.flush(3, 166)).toBeNull();
    expect(rooms.busy()).toEqual([town]);
    const stood = town.flush(4, 100 + QUIET_MS);
    expect(decodeSnapshot(stood?.frame ?? new Uint8Array())?.entries.map((e) => [e.id, e.flags])).toEqual([
      [bob.member.id, 0],
    ]);
    expect(rooms.busy()).toEqual([]);

    // A halt of somebody walking is work; of somebody standing, none.
    town.move(bob.member.id, 2, at(21, 20, Flag.Moving), 2000);
    town.flush(5, 2000);
    town.halt(bob.member.id);
    expect(decodeSnapshot(town.flush(6, 2010)?.frame ?? new Uint8Array())?.entries.map((e) => e.flags)).toEqual([0]);
    town.halt(bob.member.id);
    expect(rooms.busy()).toEqual([]);

    // A room closed with somebody walking in it is off the list.
    town.move(bob.member.id, 3, at(22, 20, Flag.Moving), 3000);
    town.leave(alice.member.id);
    town.leave(bob.member.id);
    rooms.tidy(town);
    expect(rooms.busy()).toEqual([]);
  });

  it("has no room of a kind there is not", () => {
    expect(new Rooms().place("hall")).toBeUndefined();
  });
});

/** A move walking right along y 100, at the room's pace, with the game's jump count. */
const walking = (x: number, jump = 0): Motion => ({
  x,
  y: 100,
  vx: 64,
  vy: 0,
  facing: 2,
  pose: 1,
  flags: Flag.Moving,
  jump,
});

describe("what a room shows of somebody", () => {
  const kind = { width: 512, height: 352, speed: 64 };

  it("is nothing before a first move, which is a jump from nowhere and goes nowhere", () => {
    const first = moved({ state: "unseen" }, 1, walking(10), 1000, kind);

    expect(first.went).toBe(false);
    expect(first.shown).toMatchObject({ state: "seen", seq: 1, movedAt: 1000, changed: true, jump: 1, heard: 0 });
  });

  it("counts a jump when the game's count changes, when a move outpaces the room, or on a new connection's first move", () => {
    const first = moved({ state: "unseen" }, 1, walking(10), 1000, kind).shown;
    const walked = moved(first, 2, walking(12), 1050, kind);
    const hopped = moved(walked.shown, 3, walking(12, 1), 1100, kind).shown;
    const outpaced = moved(hopped, 4, walking(300, 1), 1150, kind).shown;
    const again = moved(reconnected(outpaced), 5, walking(301, 7), 1200, kind).shown;

    expect([walked.went, walked.shown.state === "seen" ? walked.shown.jump : -1]).toEqual([true, 1]);
    expect([hopped, outpaced, again].map((s) => (s.state === "seen" ? s.jump : -1))).toEqual([2, 3, 4]);
  });

  it("stands somebody walking where they are, to be told, and leaves anybody standing or unseen as they are", () => {
    const seen = moved({ state: "unseen" }, 1, walking(10), 1000, kind).shown;
    const standing = halted(seen);

    expect(standing).toMatchObject({ changed: true, motion: { x: 10, vx: 0, vy: 0, flags: 0 } });
    expect(halted(standing)).toBe(standing);
    const unseen: Shown = { state: "unseen" };
    expect([halted(unseen), reconnected(unseen)]).toEqual([unseen, unseen]);
  });
});
