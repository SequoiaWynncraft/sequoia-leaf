import { describe, expect, test } from "bun:test";

import {
  CLOSE,
  decodeMove,
  decodeSnapshot,
  encodeMove,
  encodeSnapshot,
  type Entry,
  ENTRY_BYTES,
  Flag,
  isAct,
  type Motion,
  MOVE_BYTES,
  readToClient,
  reconnects,
  roomKind,
  SNAPSHOT_HEAD_BYTES,
  type ToClient,
} from "./live.ts";

const walking: Motion = { x: 120.5, y: 88.25, vx: 64, vy: -12.5, facing: 2, pose: 7, flags: Flag.Moving, jump: 3 };

describe("a move", () => {
  test("is 23 bytes and reads back as it was", () => {
    const bytes = encodeMove(65_535, walking);
    expect(bytes.byteLength).toBe(MOVE_BYTES);
    expect(decodeMove(bytes)).toEqual({ seq: 65_535, motion: walking });
  });

  test("wraps its number and its jumps, and keeps only a byte of facing, pose and flags", () => {
    expect(decodeMove(encodeMove(65_537, { ...walking, facing: 258, pose: -1, flags: 0x1ff, jump: 256 }))).toEqual({
      seq: 1,
      motion: { ...walking, facing: 2, pose: 255, flags: 255, jump: 0 },
    });
  });

  test("is refused when it is not exactly one", () => {
    const good = encodeMove(1, walking);
    expect(decodeMove(good.subarray(0, MOVE_BYTES - 1))).toBeNull();
    expect(decodeMove(new Uint8Array([...good, 0]))).toBeNull();
    expect(decodeMove(encodeSnapshot(1, 1, []))).toBeNull();
    expect(decodeMove(encodeMove(1, { ...walking, x: Number.NaN }))).toBeNull();
    expect(decodeMove(encodeMove(1, { ...walking, vy: Number.POSITIVE_INFINITY }))).toBeNull();
  });

  test("reads from the middle of a larger buffer", () => {
    const bytes = encodeMove(9, walking);
    const larger = new Uint8Array(MOVE_BYTES + 8);
    larger.set(bytes, 5);
    expect(decodeMove(larger.subarray(5, 5 + MOVE_BYTES))).toEqual({ seq: 9, motion: walking });
  });
});

describe("a snapshot", () => {
  const entries: Entry[] = [
    { id: 1, seq: 40, ...walking },
    { id: 65_535, seq: 0, x: 0, y: 352, vx: 0, vy: 0, facing: 0, pose: 0, flags: 0, jump: 255 },
  ];

  test("reads back as it was, its size its head and 24 bytes a player", () => {
    const bytes = encodeSnapshot(123_456, 1_795_610_400_123, entries);
    expect(bytes.byteLength).toBe(SNAPSHOT_HEAD_BYTES + 2 * ENTRY_BYTES);
    expect(decodeSnapshot(bytes)).toEqual({ tick: 123_456, time: 1_795_610_400_123, entries });
  });

  test("may be empty", () => {
    expect(decodeSnapshot(encodeSnapshot(0, 5, []))).toEqual({ tick: 0, time: 5, entries: [] });
  });

  test("is refused when its length is not what its count says, or it is a move", () => {
    const bytes = encodeSnapshot(1, 1, entries);
    expect(decodeSnapshot(bytes.subarray(0, bytes.byteLength - 1))).toBeNull();
    expect(decodeSnapshot(new Uint8Array([...bytes, 0]))).toBeNull();
    expect(decodeSnapshot(encodeMove(1, walking))).toBeNull();
    expect(decodeSnapshot(new Uint8Array(3))).toBeNull();
  });
});

describe("rooms", () => {
  test("only the kinds there are, and none of an object's own names", () => {
    expect(roomKind("town")).toEqual({ width: 512, height: 352, capacity: 32, speed: 160 });
    expect([roomKind("hall"), roomKind("toString"), roomKind("__proto__")]).toEqual([undefined, undefined, undefined]);
  });
});

describe("reading what Leaf says", () => {
  const alice = { id: 1, player: "p", name: "Alice", rank: "Captain", guest: false };

  test("takes each of its messages as it is", () => {
    const all: ToClient[] = [
      {
        t: "welcome",
        v: 1,
        you: 1,
        room: "town/1",
        hz: 30,
        time: 5,
        roster: [alice, { ...alice, id: 2, rank: null, guest: true }],
      },
      { t: "joined", member: alice },
      { t: "left", id: 3 },
      { t: "act", id: 1, kind: "emote", arg: "wave" },
      { t: "pong", c: 1.5, s: 2 },
      { t: "error", code: "not_in_room" },
    ];
    for (const m of all) expect(readToClient(JSON.stringify(m))).toEqual(m);
  });

  test("takes nothing that is not one, or not whole", () => {
    for (const text of [
      "not json",
      "[]",
      JSON.stringify({ t: "teleport" }),
      JSON.stringify({ t: "left", id: "3" }),
      JSON.stringify({ t: "bye", code: "restart" }),
      JSON.stringify({ t: "joined", member: { ...alice, guest: "no" } }),
      JSON.stringify({ t: "welcome", v: 1, you: 1, room: "town/1", hz: 30, time: 5, roster: [alice, null] }),
    ])
      expect(readToClient(text)).toBeNull();
  });
});

describe("closing", () => {
  test("the game tries again after anything but being replaced or signed out", () => {
    expect([CLOSE.done, CLOSE.policy, CLOSE.tooBig, CLOSE.restart, 1006].map(reconnects)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect([CLOSE.replaced, CLOSE.signedOut].map(reconnects)).toEqual([false, false]);
  });
});

describe("actions", () => {
  test("are only those listed, so nothing a player types reaches anybody", () => {
    expect([isAct("emote", "wave"), isAct("emote", "crab")]).toEqual([true, true]);
    expect([isAct("emote", "you_are_dumb"), isAct("say", "hi"), isAct("toString", ""), isAct("emote", "")]).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  test("a touch names one of the town's things, and the point on it, its number, or neither", () => {
    const good = ["post:174,100", "sky:256,-41", "crab:3", "roll", "fire:256,206"];
    expect(good.map((n) => isAct("touch", n))).toEqual([true, true, true, true, true]);
    const bad = ["", "you_are_dumb:1,2", "post:", "post:1,2,3", "post:1000,5", "post: 1,2", "crab:3e2", "roll\n"];
    expect(bad.map((n) => isAct("touch", n))).toEqual(bad.map(() => false));
  });
});
