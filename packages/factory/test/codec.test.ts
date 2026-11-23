/**
 * Keeping a yard: `decode(encode(yard))` is the same yard with the same check, and the same as
 * today's; packed bytes that are not pieces are refused whole, cut short at any byte or with a count
 * past the tables; what could not have come about by playing is left out, as today's `load` leaves
 * it out; and the check changes with every part of a yard but what it names as left out.
 */
import { describe, expect, test } from "bun:test";

import * as Y from "@sequoia-leaf/yard";

import * as F from "../src/index.ts";
import { Player } from "./random.ts";
import { expectSame, fromText, isRec, pairOf, record, strings } from "./sides.ts";

const yardText = (name: string): Promise<string> =>
  Bun.file(new URL(`../../yard/src/yards/${name}.json`, import.meta.url)).text();
const kept = { kept: true } as const;

/** Reads a flat yard back from what it keeps, and says it is today's yard `w` still, with the same check. */
function roundTrip(w: Y.World, y: F.Yard): F.Yard {
  const back = F.decode(F.encode(y), y.land);
  if (!back) throw new Error("the yard did not read back");
  expectSame(w, back, kept);
  expect(F.check(back)).toBe(F.check(y));
  expect(F.encode(back)).toBe(F.encode(y));
  return back;
}

/** A whole number below 16,384 as the packed bytes write it, seven bits a byte. */
const varint = (v: number): number[] => (v < 128 ? [v] : [(v & 127) | 128, v >> 7]);

/** A kept yard with its pieces' bytes put in place of its own. */
const withCells = (good: string, bytes: Uint8Array | readonly number[]): string =>
  JSON.stringify({ ...record(good).rec, cells: F.toBase64(Uint8Array.from(bytes)) });

describe("decode(encode(yard))", () => {
  test("is the same yard, with the same check: new, read, running, and after random play", async () => {
    roundTrip(Y.create({ seed: 3 }), F.create({ seed: 3 }));
    const names = ["small", "short", "mid", "large"];
    const texts = await Promise.all(names.map(yardText));
    for (const [n, name] of names.entries()) {
      const pair = pairOf(texts[n] ?? "");
      roundTrip(pair.yard, pair.flat);
      pair.run(3000, 1000);
      roundTrip(pair.yard, pair.flat);
      new Player(pair, 77).play(200, name);
      roundTrip(pair.yard, pair.flat);
    }
  }, 30_000);

  test("what today's text says, read one way into the flat yard, is the yard today's rules read", async () => {
    const names = ["small", "short", "mid", "large"];
    const texts = await Promise.all(names.map(yardText));
    for (const [n, name] of names.entries()) {
      const text = texts[n] ?? "";
      const w = Y.load(text);
      const y = fromText(text);
      if (!w || !y) throw new Error(`${name} does not read`);
      expectSame(w, y, kept);
    }
  });

  test("the page's view leaves the seed out and keeps the letter; a visitor's leaves the blueprints out", async () => {
    const pair = pairOf(await yardText("large"));
    new Player(pair, 5).play(150, "view");
    const ctx = { now: pair.flat.at + 9e6, player: { id: "p", guest: false }, seed: 1, room: 0, awards: [] };
    const view = F.FACTORY.view(pair.flat, ctx);
    const page = F.decode(view.yard);
    expect(page?.seed).toBeNull();
    expect(view.clock).toBe(Y.WORKS.view(pair.yard, ctx).clock);
    const visit = F.decode(F.FACTORY.visit?.(pair.flat, ctx).yard);
    expect(visit?.blueprints.every((b) => b === null)).toBe(true);
  });
});

describe("decode refuses whole", () => {
  test("anything that is not a kept yard of this version", async () => {
    const good = F.encode(F.create({ seed: 1 }));
    const { rec } = record(good);
    for (const bad of [
      "",
      "not json",
      "[]",
      await yardText("small"),
      JSON.stringify({ ...rec, v: 4 }),
      JSON.stringify({ ...rec, cells: undefined }),
      JSON.stringify({ ...rec, cells: "!!!!" }),
      JSON.stringify({ ...rec, tick: -1 }),
      JSON.stringify({ ...rec, story: 99 }),
      JSON.stringify({ ...rec, plots: "yard" }),
    ])
      expect(F.decode(bad)).toBeNull();
    expect(F.decode(good)).not.toBeNull();
  });

  test("pieces' bytes cut short at any byte, or with a byte left over", async () => {
    const pair = pairOf(await yardText("small"));
    pair.run(3000, 1000);
    const good = F.encode(pair.flat);
    const bytes = F.fromBase64(String(record(good).rec.cells));
    if (!bytes) throw new Error("the kept yard has no pieces' bytes");
    // Holdings, work and things carried, so every kind of part is cut through somewhere.
    expect(pair.flat.holders.size).toBeGreaterThan(0);
    expect(bytes.length).toBeGreaterThan(40);
    for (let cut = 0; cut < bytes.length; cut++) expect(F.decode(withCells(good, bytes.subarray(0, cut)))).toBeNull();
    expect(F.decode(withCells(good, [...bytes, 0]))).toBeNull();
    expect(F.decode(withCells(good, bytes))).not.toBeNull();
  });

  test("a count past what the tables allow: more kinds of thing than there are, more of one than any piece holds, a tunnel too long, more pieces than tiles, a part unknown", () => {
    const good = F.encode(F.create({ seed: 1 }));
    // One crate on tile 5 holding `kinds` things, `many` of each, with as many pairs as `given` says.
    const crate = (kinds: number, given = kinds, many = 1): number[] => [
      1,
      5,
      F.CRATE | 128,
      2,
      kinds,
      ...Array.from({ length: given }, (_, n) => [n, ...varint(many)]).flat(),
    ];
    expect(F.decode(withCells(good, crate(F.ITEM_COUNT)))).not.toBeNull();
    expect(F.decode(withCells(good, crate(F.ITEM_COUNT + 1)))).toBeNull();
    expect(F.decode(withCells(good, crate(F.ITEM_COUNT + 1, F.ITEM_COUNT)))).toBeNull();
    expect(F.decode(withCells(good, crate(1, 1, 128)))).not.toBeNull();
    expect(F.decode(withCells(good, crate(1, 1, 129)))).toBeNull();
    // A tunnel's way-in mouth passing under 3 tiles, under 4, and a far mouth 4 back.
    const tunnel = (span: number): number[] => [
      1,
      5,
      F.TUNNEL | 128,
      ...varint(128),
      span + 8,
      ...Array<number>(Math.max(0, span) * 2).fill(0),
    ];
    expect(F.decode(withCells(good, tunnel(3)))).not.toBeNull();
    expect(F.decode(withCells(good, tunnel(4)))).toBeNull();
    expect(F.decode(withCells(good, tunnel(-4)))).toBeNull();
    // More pieces than the land has tiles.
    expect(F.decode(withCells(good, varint(F.LAND.w * F.LAND.h + 1)))).toBeNull();
    // A part this version does not know: the lowest bit, and the one past the highest.
    expect(F.decode(withCells(good, [1, 5, F.BELT | 128, 1]))).toBeNull();
    expect(F.decode(withCells(good, [1, 5, F.BELT | 128, ...varint(8192)]))).toBeNull();
  });
});

describe("what could not have come about by playing is left out", () => {
  test("as today's load leaves it out: pieces, holdings, plots, plans, orders", async () => {
    const { rec: raw, cells: had } = record(await yardText("mid"));
    const cells = [
      ...had,
      { i: 0, k: "gatherer", d: 0 },
      { i: 5, k: "wheel", d: 0 },
      { i: 1700, k: "belt", d: 9 },
      { i: 99_999, k: "belt", d: 0 },
      { i: 300, k: "rocket", d: 0 },
      { i: 1000, k: "depot", d: 0 },
    ].map((c) =>
      c.k === "mill"
        ? Object.assign({}, c, { b: { gear: 3, deadfall: 9, stone: 2 }, o: "tool", m: "kit", w: 999 })
        : c.k === "belt"
          ? Object.assign({}, c, { it: "plank", p: 0.375, h: 9 })
          : c,
    );
    const text = JSON.stringify({
      ...raw,
      cells,
      plots: [...strings(raw.plots), "pond", "moon"],
      plans: ["jigs", ...strings(raw.plans), "magic"],
      filled: { plank: 9999, crab: 3 },
      board: [
        ...(Array.isArray(raw.board) ? raw.board : []),
        { id: 1, title: "x", from: "y", line: "", want: { plank: 1, gear: 1, tool: 1 }, pay: 5, filled: {} },
      ],
    });
    const w = Y.load(text);
    const y = fromText(text);
    if (!w || !y) throw new Error("the yard does not read");
    expectSame(w, y, kept);
    roundTrip(w, y);
  });
});

/** What the check leaves out, by path: everything else in a yard must change the check when it changes. */
const LEFT_OUT = new Set([
  // Only Leaf holds them: the seed, its clock's moment, the letter.
  "seed",
  "at",
  "away",
  // News no screen has taken yet.
  "news",
  // Shared by every yard on it, and never kept.
  "land",
  // Worked out again from the rest: what is open and how fast things go, power, the plumbing, idle notes.
  "rates",
  "open",
  "lit",
  "powered",
  "wire",
  "supply",
  "demand",
  "holders.idle",
  // Which row of a side table holds a piece's parts: reading a yard back may change it.
  "row",
  "holders.size",
  "holders.tile",
  "tunnels.size",
  "tunnels.tile",
]);

/** Every part of a yard that holds a value, as a path; an order on the board stands for all of them. */
function partsOf(v: unknown, path: string, out: string[]): string[] {
  if (LEFT_OUT.has(path)) return out;
  if (isRec(v) && !ArrayBuffer.isView(v))
    for (const [k, part] of Object.entries(v)) partsOf(part, path ? `${path}.${k}` : k, out);
  else if (Array.isArray(v) && isRec(v[0])) partsOf(v[0], `${path}.0`, out);
  else out.push(path);
  return out;
}

/** Changes one part of a yard, by its path: a tile's part on a tile where something stands, a side table's on its first row. */
function change(y: F.Yard, path: string): void {
  const keys = path.split(".");
  const key = keys.pop() ?? "";
  const parent: unknown = keys.reduce<unknown>((o, k) => Reflect.get(Object(o), k), y);
  const v: unknown = Reflect.get(Object(parent), key);
  // An array the length of the map is a tile's part: changed where a piece stands.
  const tiles = y.kind.length;
  const at = (a: { readonly length: number }): number =>
    a.length === tiles ? y.kind.findIndex((k) => k !== F.NONE && k !== F.DEPOT) : 0;
  if (typeof v === "number") Reflect.set(Object(parent), key, v + 1);
  else if (typeof v === "string") Reflect.set(Object(parent), key, `${v}!`);
  else if (typeof v === "boolean" || v === null) Reflect.set(Object(parent), key, !v);
  else if (v instanceof Float64Array) v[at(v)] = (v[at(v)] ?? 0) + 1;
  else if (v instanceof Uint8Array || v instanceof Int8Array || v instanceof Uint16Array || v instanceof Int32Array)
    v[at(v)] = (v[at(v)] ?? 0) ^ 1;
  else if (Array.isArray(v) && (v[0] === null || v[0] instanceof Uint8Array))
    v[0] = v[0] instanceof Uint8Array ? v[0].map((b) => b ^ 1) : Uint8Array.of(1);
  else if (Array.isArray(v)) v.push(v[0] ?? 0);
  else throw new Error(`${path}: nothing to change`);
}

/** The parts of a yard that change without the check changing, `add` having first added to a copy whatever it adds. */
function unmixed(y: F.Yard, add: (copy: F.Yard) => void = () => {}): string[] {
  const copy = (): F.Yard => {
    const c = F.decode(F.encode(y), y.land);
    if (!c) throw new Error("the yard does not read back");
    add(c);
    return c;
  };
  return partsOf(copy(), "", []).filter((path) => {
    const c = copy();
    const before = F.check(c);
    change(c, path);
    return F.check(c) === before;
  });
}

describe("the check", () => {
  test("tells apart two yards that differ by one thing on one belt, 40 times in 40", async () => {
    const pair = pairOf(await yardText("large"));
    pair.run(3000, 3000);
    const y = pair.flat;
    const sum = F.check(y);
    const belts = [...y.kind.keys()].filter((i) => y.kind[i] === F.BELT);
    let told = 0;
    for (let k = 0; k < 40; k++) {
      const copy = F.decode(F.encode(y));
      if (!copy) throw new Error("no copy");
      const i = belts[(k * 7919) % belts.length] ?? 0;
      copy.item[i] = copy.item[i] === F.NONE ? F.item("plank") : F.NONE;
      if (F.check(copy) !== sum) told++;
    }
    expect(told).toBe(40);
  });

  test("tells apart two yards whose standing orders want the same and pay differently", async () => {
    const y = pairOf(await yardText("large")).flat;
    const other = F.decode(F.encode(y));
    if (!other) throw new Error("no copy");
    other.board = other.board.map((o, k) => (k === 0 ? { ...o, pay: o.pay + 5 } : o));
    expect(F.check(other)).not.toBe(F.check(y));
  });

  test("changes with every part of a yard but those it names as left out, and finds a part added without being mixed in", async () => {
    const pair = pairOf(await yardText("large"));
    pair.run(3000, 3000);
    const [cx, cy] = pair.yard.land.depot;
    pair.choose((s) => ({ do: "saveBlueprint", slot: 1, tiles: s.within(cx - 12, cy - 10, cx + 12, cy + 10) }));
    const y = pair.flat;
    // Every kind of part is there to change: a holder, a tunnel, an order, a blueprint.
    expect([y.holders.size > 0, y.tunnels.size > 0, y.board.length > 0, y.blueprints.some((b) => b)]).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(unmixed(y)).toEqual([]);
    expect(unmixed(y, (c) => Object.assign(c, { glow: 3 }))).toEqual(["glow"]);
    expect(unmixed(y, (c) => Object.assign(c.holders, { heat: new Uint8Array(c.holders.tile.length) }))).toEqual([
      "holders.heat",
    ]);
    expect(unmixed(y, (c) => (c.board = c.board.map((o) => ({ ...o, tip: 2 }))))).toEqual(["board.0.tip"]);
  });
});

describe("where reading today's text differs, for what play cannot make", () => {
  test("the tile a carried thing came from is kept only when it is a neighbour; today's load keeps any tile", async () => {
    const { rec: raw, cells } = record(await yardText("small"));
    const belt = cells.find((c) => c.k === "belt");
    if (!belt) throw new Error("no belt");
    const i = Number(belt.i);
    for (const [via, flat] of [
      [i - 1, i - 1],
      [i + 48, i + 48],
      [3, 0],
    ] as const) {
      const text = JSON.stringify({
        ...raw,
        cells: cells.map((c) => (c === belt ? Object.assign({}, c, { it: "plank", p: 0.5, v: via }) : c)),
      });
      const y = fromText(text) ?? F.create();
      const v = y.via[i] ?? 0;
      expect(v === 0 ? 0 : i + (y.land.step[v - 1] ?? 0)).toBe(flat);
    }
  });
});
