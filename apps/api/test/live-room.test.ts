import { describe, expect, it } from "bun:test";

import { decodeSnapshot, Flag, type Motion, readToClient, type ToClient } from "@sequoia-leaf/core";

import { Room, Rooms } from "../src/live/room.ts";

/** What one person in a room was sent: the text decoded, and the binary frames as they were. */
function inbox() {
  const texts: ToClient[] = [];
  const frames: Uint8Array[] = [];
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
    },
  };
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
    room.move(alice.member.id, 1, at(10, 10), 0);
    room.move(alice.member.id, 2, at(12, 10, Flag.Moving), 0);

    expect(room.flush(1, 5000)).toBe(true);
    expect(room.flush(2, 5033)).toBe(false);
    room.move(bob.member.id, 1, at(300, 200), 0);
    room.flush(3, 5066);

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

    expect(alice.motion).toEqual({ x: 0, y: 352, vx: 1024, vy: -1024, facing: 3, pose: 2, flags: 0, jump: 1 });
  });

  it("takes every move of the present connection, in the order sent, whatever its numbers", () => {
    const room = new Room("town", 1, TOWN);
    const alice = room.join(person("Alice"), inbox().outbox, 0, 30, 1);
    const id = alice.member.id;
    room.move(id, 1200, at(1, 1), 0);
    // A new tab numbers its moves from the start again.
    room.reconnected(id);
    room.move(id, 1, at(2, 2), 0);

    expect([alice.seq, alice.motion?.x]).toEqual([1, 2]);
  });

  it("counts jumps itself: when the game's count changes, and at a new connection's first move", () => {
    const room = new Room("town", 1, TOWN);
    const alice = room.join(person("Alice"), inbox().outbox, 0, 30, 1);
    const id = alice.member.id;
    const shown: number[] = [];
    const move = (jump: number) => {
      room.move(id, 1, at(0, 0, 0, jump), 0);
      shown.push(alice.motion?.jump ?? -1);
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
      shown.push(alice.motion?.jump ?? -1);
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

    expect(alice.motion).toMatchObject({ x: 0, jump: 1 });
  });

  it("keeps a jump through a later move before the tick, since only the newest motion counts", () => {
    const room = new Room("town", 1, TOWN);
    const a = inbox();
    const alice = room.join(person("Alice"), inbox().outbox, 0, 30, 1);
    room.join(person("Bob"), a.outbox, 0, 30, 1);
    room.move(alice.member.id, 1, at(400, 300, 0, 1), 0);
    room.move(alice.member.id, 2, at(401, 300, Flag.Moving, 1), 0);
    room.flush(1, 0);

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
    room.flush(1, 0);
    room.halt(alice.member.id);
    room.flush(2, 0);
    room.halt(alice.member.id);

    expect(room.flush(3, 0)).toBe(false);
    expect(decodeSnapshot(b.frames.at(-1) ?? new Uint8Array())?.entries.map((e) => [e.x, e.vx, e.flags])).toEqual([
      [50, 0, 4],
    ]);
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

  it("has no room of a kind there is not", () => {
    expect(new Rooms().place("hall")).toBeUndefined();
  });
});
