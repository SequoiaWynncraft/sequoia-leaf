/**
 * Keeping a yard: `decode(encode(yard))` is the same yard with the same check; packed bytes that
 * are not pieces are refused whole, cut short at any byte or with a count no yard could have; what
 * today's rules would not have, read back, is clamped, carried or paid back (`saves.test.ts` has
 * the rest); and the check changes with every part of a yard but what it names as left out.
 */
import { describe, expect, test } from "bun:test";

import { unpackCells } from "../src/cells.ts";
import * as F from "../src/index.ts";
import { beforeReach } from "./goals.ts";
import { bareLand } from "./land.ts";
import { delivering, flatOut, generated, must } from "./yards.ts";

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
/** A kept yard as a record. */
function record(text: string): Rec {
  const raw: unknown = JSON.parse(text);
  if (!isRec(raw)) throw new Error("not a record");
  return raw;
}

/** Reads a yard back from what it keeps, and says it is the same yard, with the same check. */
function roundTrip(y: F.Yard): F.Yard {
  const back = F.decode(F.encode(y), y.land);
  if (!back) throw new Error("the yard did not read back");
  expect(F.check(back)).toBe(F.check(y));
  expect(F.encode(back)).toBe(F.encode(y));
  return back;
}

/** A generated yard run on, read back from what it keeps: everything worked out again. */
function running(ticks = 3000): F.Yard {
  const y = F.decode(F.encode(generated().y), generated().y.land);
  if (!y) throw new Error("the generated yard does not read back");
  for (let k = 0; k < ticks; k++) F.step(y);
  return y;
}

/** A whole number below 16,384 as the packed bytes write it, seven bits a byte. */
const varint = (v: number): number[] => (v < 128 ? [v] : [(v & 127) | 128, v >> 7]);

/** A piece on tile 5 whose kind has its bits past four (`high`) in a part of their own (0x4000), as only a kind past 15 has. */
const wide = (high: number): number[] => [1, 5, F.SPLITTER | 128, 0x80, 0x80, 0x01, high];

/** A kept yard with its pieces' bytes put in place of its own. */
const withCells = (good: string, bytes: Uint8Array | readonly number[]): string =>
  JSON.stringify({ ...record(good), cells: F.toBase64(Uint8Array.from(bytes)) });

describe("decode(encode(yard))", () => {
  test("is the same yard, with the same check: new, generated, running, and delivering", () => {
    roundTrip(F.create({ seed: 3 }));
    roundTrip(generated().y);
    const y = running();
    roundTrip(y);
    for (let k = 0; k < 500; k++) F.step(y);
    roundTrip(y);
    roundTrip(delivering());
  }, 30_000);

  test("the page's view leaves the seed out and keeps the letter and the blueprints; a visitor is given the same", () => {
    const y = running(100);
    expect(F.saveBlueprint(y, 0, F.within(y, 0, 0, 20, 20))).toBeNull();
    const ctx = { now: y.at + 9e6, player: { id: "p", guest: false }, seed: 1, room: 0, awards: [], postcards: {} };
    const page = F.decode(F.FACTORY.view(y, ctx).yard, y.land);
    expect(page?.seed).toBeNull();
    expect(page?.blueprints[0]).not.toBeNull();
    // A visitor's copy does the owner's commands as Leaf tells it them, a blueprint set down among them.
    expect(F.FACTORY.visit?.(y, ctx)).toEqual(F.FACTORY.view(y, ctx));
  });
});

describe("a yard kept before the rules stopped counting a pace", () => {
  test("reads back without it: the same yard, with the same check, and it is not kept again", () => {
    const y = delivering();
    const kept = record(F.encode(y));
    expect("pace" in kept).toBe(false);
    const old = JSON.stringify({ ...kept, pace: { ticks: 412, warm: 0, made: { plank: 31, deadfall: 12 } } });
    const back = F.decode(old, y.land);
    if (!back) throw new Error("the older yard did not read back");
    expect(F.check(back)).toBe(F.check(y));
    expect(F.encode(back)).toBe(F.encode(y));
  });
});

/** A line of grade II belt from a crate into the depot through a splitter, a sorter and a joiner, all three at grade I, and a blueprint of it; nothing past version 10 known. */
function line(): F.Yard {
  const y = beforeReach(F.create({ land: bareLand(13, 9, [], [9, 4]), tier: 4, seed: 1 }));
  must(y, { do: "build", kind: "crate", x: 1, y: 4, dir: 0 });
  for (const [x, kind] of [
    [2, "belt"],
    [3, "splitter"],
    [4, "sorter"],
    [5, "joiner"],
    [6, "belt"],
    [7, "belt"],
  ] as const)
    must(y, { do: "build", kind, x, y: 4, dir: 0, ...(kind === "belt" ? { grade: 2 } : {}) });
  must(y, { do: "saveBlueprint", slot: 0, tiles: F.within(y, 2, 4, 7, 4) });
  return y;
}
/**
 * What version 6 kept of a yard: this version's record of it, with its splitters, joiners and
 * sorters at grade I, which this version keeps as that one kept them, with no grade.
 */
const asKept = (y: F.Yard): string => JSON.stringify({ ...record(F.encode(y)), v: 6 });
/** The grades of the pieces along the line. */
const lineGrades = (y: F.Yard): number[] => [2, 3, 4, 5, 6, 7].map((x) => y.grade[F.at(y, x, 4)] ?? 0);

describe("a yard kept before splitters, joiners and sorters had grades", () => {
  test("reads each in the yard back at the highest grade the yard may build, for nothing, so its line carries what its belts carry", () => {
    const y = line();
    expect(lineGrades(y)).toEqual([2, 1, 1, 1, 2, 2]);
    const back = F.decode(asKept(y), y.land);
    if (!back) throw new Error("the older yard did not read back");
    expect(F.highest(back.open, F.BELT)).toBe(2);
    expect(lineGrades(back)).toEqual([2, 2, 2, 2, 2, 2]);
    expect([back.till, back.paid]).toEqual([y.till, y.paid]);
    expect(flatOut(back, 1, 4)).toBe(F.carried(2));
    // Kept again, it is this version's for a yard of no kind past 15, and reads back as itself.
    expect(record(F.encode(back)).v).toBe(F.PLACED);
    roundTrip(back);
    // This version keeps a splitter of grade I as grade I.
    expect(lineGrades(roundTrip(y))).toEqual([2, 1, 1, 1, 2, 2]);
  });

  test("with grade III belts unlocked, at grade III; and one kept in a blueprint at the grade of the belts kept with it", () => {
    const y = line();
    for (const node of ["brassfittings"]) {
      must(y, { do: "take", node });
      const g = y.hand;
      if (g === -1) throw new Error("nothing is in hand");
      for (const n of F.ALL_ITEMS) F.deliver(y, n, (F.GOALS[g]?.want[n] ?? 0) - (y.got[g]?.[n] ?? 0));
    }
    const back = F.decode(asKept(y), y.land);
    expect(back && lineGrades(back)).toEqual([2, 3, 3, 3, 2, 2]);
    expect(
      back && F.piecesOf(back.blueprints[0]?.pieces ?? new Uint8Array()).map((p) => [F.kindName(p.kind), p.grade ?? 1]),
    ).toEqual([
      ["belt", 2],
      ["splitter", 2],
      ["sorter", 2],
      ["joiner", 2],
      ["belt", 2],
      ["belt", 2],
    ]);
  });
});

describe("decode refuses whole", () => {
  test("anything that is not a kept yard of this version", () => {
    const good = F.encode(F.create({ seed: 1 }));
    const rec = record(good);
    for (const bad of [
      "",
      "not json",
      "[]",
      JSON.stringify({ ...rec, v: F.VERSION + 1 }),
      JSON.stringify({ ...rec, v: 5 }),
      JSON.stringify({ ...rec, cells: undefined }),
      JSON.stringify({ ...rec, cells: "!!!!" }),
      JSON.stringify({ ...rec, tick: -1 }),
      JSON.stringify({ ...rec, tick: 1.5 }),
      JSON.stringify({ ...rec, plots: "yard" }),
    ])
      expect(F.decode(bad)).toBeNull();
    expect(F.decode(good)).not.toBeNull();
  });

  test("pieces' bytes cut short at any byte, or with a byte left over", () => {
    const y = delivering();
    const good = F.encode(y);
    const bytes = F.fromBase64(String(record(good).cells));
    if (!bytes) throw new Error("the kept yard has no pieces' bytes");
    // Holdings, work and things carried, so every kind of part is cut through somewhere.
    expect(y.holders.size).toBeGreaterThan(0);
    expect(bytes.length).toBeGreaterThan(40);
    for (let cut = 0; cut < bytes.length; cut++) expect(F.decode(withCells(good, bytes.subarray(0, cut)))).toBeNull();
    expect(F.decode(withCells(good, [...bytes, 0]))).toBeNull();
    expect(F.decode(withCells(good, bytes))).not.toBeNull();
  });

  test("a count no yard could have: more pieces than tiles, pairs short of the count, a part unknown; what today's tables allow is no part of the shape", () => {
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
    // More of one than a crate holds today reads (and is clamped). A thing today's tables do not have is
    // a newer Leaf's: not read here, never with it let go.
    expect(F.decode(withCells(good, crate(F.ITEM_COUNT + 1)))).toBeNull();
    expect(F.keptLater(withCells(good, crate(F.ITEM_COUNT + 1)))).toBe(true);
    expect(F.decode(withCells(good, crate(F.ITEM_COUNT + 1, F.ITEM_COUNT)))).toBeNull();
    expect(F.decode(withCells(good, crate(1, 1, F.CRATE_MOST)))).not.toBeNull();
    expect(F.decode(withCells(good, crate(1, 1, F.CRATE_MOST + 1)))).not.toBeNull();
    // A tunnel's way-in mouth passing under as many tiles as any tunnel may, under one more, and a far mouth one more back.
    const tunnel = (span: number): number[] => [
      1,
      5,
      F.TUNNEL | 128,
      ...varint(128),
      span + 8,
      ...Array<number>(Math.max(0, span) * 2).fill(0),
    ];
    expect(F.decode(withCells(good, tunnel(F.SPAN_MOST)))).not.toBeNull();
    // Longer than tunnels go today, from either mouth: a newer Leaf's, not read here.
    for (const span of [F.SPAN_MOST + 1, -(F.SPAN_MOST + 1)])
      expect([F.decode(withCells(good, tunnel(span))), F.keptLater(withCells(good, tunnel(span)))]).toEqual([
        null,
        true,
      ]);
    // More pieces than the land has tiles.
    expect(F.decode(withCells(good, varint(F.LAND.w * F.LAND.h + 1)))).toBeNull();
    // A part this version does not know: the lowest bit, and the one past the highest.
    expect(F.decode(withCells(good, [1, 5, F.BELT | 128, 1]))).toBeNull();
    expect(F.decode(withCells(good, [1, 5, F.BELT | 128, ...varint(8192)]))).toBeNull();
  });

  test("a kind's bits past four that are none, or more than four", () => {
    expect(unpackCells(Uint8Array.from(wide(1)), 100)?.map((p) => p.kind)).toEqual([F.SPLITTER | 16]);
    expect(unpackCells(Uint8Array.from(wide(15)), 100)?.map((p) => p.kind)).toEqual([F.SPLITTER | 240]);
    expect(unpackCells(Uint8Array.from(wide(0)), 100)).toBeNull();
    expect(unpackCells(Uint8Array.from(wide(16)), 100)).toBeNull();
    expect(F.decode(withCells(F.encode(F.create({ seed: 1 })), wide(0)))).toBeNull();
  });
});

describe("what today's rules would not have, read back", () => {
  test("a piece where it may not stand is paid back, a plot today's tier does not sell is carried, an order out of its sequence is let go", () => {
    const y = delivering();
    const good = F.encode(y);
    // A gatherer on the first tile, which has no deposit and is not the yard's land; and one on
    // the yard's own ground with no deposit under it.
    F.place(y, 0, F.GATHERER, 0);
    const bare = F.at(y, 17, 19);
    F.place(y, bare, F.GATHERER, 0);
    y.plots.push(F.plot("pond"));
    const want = F.counts();
    for (const name of ["plank", "gear", "tool"] as const) want[F.item(name)] = 1;
    y.board.push({ id: 99, title: "x", from: "y", line: "", want, pay: 5, filled: F.counts(), starts: 0 });
    const back = F.decode(F.encode(y));
    if (!back) throw new Error("the yard does not read");
    expect([back.kind[0], back.kind[bare]]).toEqual([F.NONE, F.NONE]);
    expect(back.till).toBe(y.till + 2 * F.price(F.GATHERER, 1) * F.MILLI);
    expect(back.plots).toContain(F.plot("pond"));
    // Its id is past the count of orders ever hung: no order of the yard's.
    expect(back.board.some((o) => o.id === 99)).toBe(false);
    expect(record(F.encode(back)).cells).toBe(record(good).cells);
  });

  test("a setting the yard may not make is let go; a colour and a blueprint without Paint and blueprints are carried", () => {
    const y = F.create({ land: bareLand(13, 9, [], [9, 4]), tier: 4, seed: 1 });
    must(y, { do: "build", kind: "mill", x: 2, y: 2, dir: 0 });
    must(y, { do: "recipe", x: 2, y: 2, item: "oil" });
    must(y, { do: "build", kind: "belt", x: 3, y: 2, dir: 0 });
    must(y, { do: "paint", x: 3, y: 2, tint: 4 });
    must(y, { do: "saveBlueprint", slot: 0, tiles: F.within(y, 2, 2, 3, 2) });
    const rec = record(F.encode(y));
    const done = Array.isArray(rec.done) ? rec.done.filter((id) => id !== "oilpress" && id !== "signs") : [];
    const back = F.decode(JSON.stringify({ ...rec, done }), y.land);
    if (!back) throw new Error("the yard does not read back");
    expect([back.kind[F.at(back, 2, 2)], back.set[F.at(back, 2, 2)], back.tint[F.at(back, 3, 2)]]).toEqual([
      F.MILL,
      F.NONE,
      4,
    ]);
    expect(back.blueprints[0]).toEqual(y.blueprints[0]);
    expect(F.decode(F.encode(y), y.land)?.blueprints[0]).not.toBeNull();
  });
});

describe("work is kept only toward what is being made", () => {
  test("a mill's work on lamp oil read back without the oil press goes with the oil, never toward a plank; a gatherer's past one gather is dropped", () => {
    const y = F.create({ land: bareLand(13, 9, [[6, 6, "deadfall"]], [9, 4]), tier: 4, seed: 1 });
    must(y, { do: "build", kind: "mill", x: 6, y: 4, dir: 2 });
    must(y, { do: "build", kind: "gatherer", x: 6, y: 6, dir: 2 });
    const mill = F.at(y, 6, 4);
    const m = y.row[mill] ?? -1;
    F.put(y.holders, m, F.item("resin"));
    for (let k = 0; k < 10; k++) F.step(y);
    expect([y.holders.making[m], y.holders.work[m]]).toEqual([F.item("oil"), 20]);
    // A plank's deadfall arrives while the oil is pressed.
    F.put(y.holders, m, F.item("deadfall"));
    const rec = record(F.encode(y));
    const done = Array.isArray(rec.done) ? rec.done.filter((id) => id !== "oilpress") : [];
    const back = F.decode(JSON.stringify({ ...rec, done }), y.land);
    if (!back) throw new Error("the yard does not read back");
    const r = back.row[mill] ?? -1;
    expect([back.holders.making[r], back.holders.work[r], F.held(back.holders, r, F.item("deadfall"))]).toEqual([
      F.NONE,
      0,
      1,
    ]);
    for (let k = 0; k < 11; k++) F.step(back);
    expect(back.holders.out[r]).toBe(F.NONE);
    F.step(back);
    expect(back.holders.out[r]).toBe(F.item("plank"));
    // A gatherer kept with one gather's work or more.
    const g = y.row[F.at(y, 6, 6)] ?? -1;
    for (const [work, kept] of [
      [F.WORK.gather - 1, F.WORK.gather - 1],
      [F.WORK.gather, 0],
    ] as const) {
      y.holders.out[g] = F.NONE;
      y.holders.work[g] = work;
      const read = F.decode(F.encode(y), y.land);
      expect(read?.holders.work[read.row[F.at(read, 6, 6)] ?? -1]).toBe(kept);
    }
  });
});

/** What the check leaves out, by path: everything else in a yard must change the check when it changes. */
const LEFT_OUT = new Set([
  // Only Leaf holds and moves them: the seed and the orders ever hung, its clock's moment, the letter.
  "seed",
  "serial",
  "at",
  "away",
  // News no screen has taken yet, and the count of changes a screen keys what it works out on.
  "news",
  "rev",
  // Shared by every yard on it, and never kept.
  "land",
  // Worked out again from the rest: what is open, power, the plumbing, idle notes.
  "open",
  "lit",
  "powered",
  "wire",
  "supply",
  "demand",
  "holders.idle",
  // Read only by a screen, and never kept: the recipe a machine last began.
  "holders.last",
  // Which row of a side table holds a piece's parts: reading a yard back may change it.
  "row",
  // How often each tile has been cleared, for Undo within a command: reading a yard back stands every piece anew.
  "made",
  // Where a tile's piece of more than one tile stands: worked out from that tile's kind and way, which are mixed in.
  "part",
  // What Undo would undo is mixed in as its bytes: an entry's id, longest span and highest kind are worked out from them.
  "history.0.id",
  "history.0.span",
  "history.0.top",
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
  else if (
    v instanceof Uint8Array ||
    v instanceof Int8Array ||
    v instanceof Uint16Array ||
    v instanceof Int32Array ||
    v instanceof Uint32Array
  )
    v[at(v)] = (v[at(v)] ?? 0) ^ 1;
  // An empty place for a blueprint: given one.
  else if (Array.isArray(v) && v[0] === null) v[0] = { pieces: Uint8Array.of(1), whole: false };
  else if (Array.isArray(v)) v.push(v[0] ?? 0);
  else throw new Error(`${path}: nothing to change`);
}

/** A plot being cleared, given something, and a plot cleared, added to a copy of a yard, and then whatever `more` adds. */
const and =
  (more: (c: F.Yard) => void = () => {}) =>
  (c: F.Yard): void => {
    c.clearing = { plot: F.plot("workings"), filled: F.countsOf({ pipe: 3 }) };
    c.cleared = [F.plot("flats")];
    more(c);
  };

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
  test("tells apart two yards that differ by one thing on one belt, 40 times in 40", () => {
    const y = running();
    const sum = F.check(y);
    const belts = [...y.kind.keys()].filter((i) => y.kind[i] === F.BELT);
    let told = 0;
    for (let k = 0; k < 40; k++) {
      const copy = F.decode(F.encode(y), y.land);
      if (!copy) throw new Error("no copy");
      const i = belts[(k * 7919) % belts.length] ?? 0;
      copy.item[i] = copy.item[i] === F.NONE ? F.item("plank") : F.NONE;
      if (F.check(copy) !== sum) told++;
    }
    expect(told).toBe(40);
  });

  test("mixes in the high halves of wide counters", () => {
    const y = delivering();
    for (const part of ["tick", "bank", "till"] as const) {
      const other = F.decode(F.encode(y), y.land);
      if (!other) throw new Error("no copy");
      other[part] += 2 ** 32;
      expect(F.check(other)).not.toBe(F.check(y));
    }
  });

  test("tells apart two yards whose standing orders want the same and pay differently", () => {
    const y = delivering();
    const other = F.decode(F.encode(y));
    if (!other) throw new Error("no copy");
    other.board = other.board.map((o, k) => (k === 0 ? { ...o, pay: o.pay + 5 } : o));
    expect(F.check(other)).not.toBe(F.check(y));
  });

  test("changes with every part of a yard but those it names as left out, and finds a part added without being mixed in", () => {
    const y = running();
    expect(F.saveBlueprint(y, 1, F.within(y, 10, 10, 30, 26))).toBeNull();
    // Every kind of part is there to change: a holder, a tunnel, an order, a blueprint, something to undo.
    expect([
      y.holders.size > 0,
      y.tunnels.size > 0,
      y.board.length > 0,
      y.blueprints.some((b) => b),
      y.history.length > 0,
    ]).toEqual([true, true, true, true, true]);
    // And a plot being cleared, given something, and a plot cleared, as a yard past tier 4's commission has them (`and`).
    expect(unmixed(y, and())).toEqual([]);
    expect(
      unmixed(
        y,
        and((c) => Object.assign(c, { glow: 3 })),
      ),
    ).toEqual(["glow"]);
    expect(
      unmixed(
        y,
        and((c) => Object.assign(c.holders, { heat: new Uint8Array(c.holders.tile.length) })),
      ),
    ).toEqual(["holders.heat"]);
    expect(
      unmixed(
        y,
        and((c) => (c.board = c.board.map((o) => ({ ...o, tip: 2 })))),
      ),
    ).toEqual(["board.0.tip"]);
  });
});
