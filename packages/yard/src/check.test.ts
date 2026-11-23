import { describe, expect, test } from "bun:test";

import { setOpen, setWay } from "./build.ts";
import { check } from "./check.ts";
import { awayOf } from "./clock.ts";
import { ITEMS } from "./content/items.ts";
import { KINDS } from "./content/machines.ts";
import { create } from "./create.ts";
import { put, steps, workingYard } from "./fixtures.ts";
import { DIRS, RIGHT } from "./grid.ts";
import { counts, isFilled, ORDER_WAITS, swap, swapRefusal } from "./orders.ts";
import { saveBlueprint, within } from "./pieces.ts";
import { load, save } from "./save.ts";
import { blank, type Building, type World } from "./world.ts";
import large from "./yards/large.json";
import mid from "./yards/mid.json";
import short from "./yards/short.json";
import small from "./yards/small.json";

/** A yard read from its text, or the test fails. */
function read(text: string): World {
  const w = load(text);
  if (!w) throw new Error("not a yard");
  return w;
}
const again = (w: World): World => read(save(w));
/** The kept yards, and a working one with a splitter, a joiner, a crate and a blueprint, each run on a while. */
function yards(): [string, World][] {
  const working = workingYard();
  put(working, "splitter", 17, 13);
  put(working, "joiner", 18, 13);
  put(working, "crate", 19, 13);
  expect(saveBlueprint(working, 0, within(working, 19, 13, 23, 17))).toBeNull();
  const kept = Object.entries({ small, short, mid, large }).map(([name, yard]): [string, World] => [
    name,
    read(JSON.stringify(yard)),
  ]);
  const all: [string, World][] = [...kept, ["working", working]];
  for (const [, w] of all) steps(w, 300);
  return all;
}

/** The first piece of a kind in a yard, or the test fails. */
function first(w: World, kind: Building["kind"]): Building {
  const b = w.cells.find((c) => c?.kind === kind);
  if (!b) throw new Error(`no ${kind}`);
  return b;
}
const belt = (w: World): Building => first(w, "belt");
/** The working yard of `yards`, run on a while. */
const working = (): World => yards().find(([name]) => name === "working")?.[1] ?? create();

const f64 = new Float64Array(1);
const u64 = new BigUint64Array(f64.buffer);
/** A number with one of its 64 bits turned over. */
function flipped(x: number, bit: number): number {
  f64[0] = x;
  u64[0] = (u64[0] ?? 0n) ^ (1n << BigInt(bit));
  return f64[0] ?? Number.NaN;
}
/** A thing by its number from 1, or null for 0; undefined for a number that is none. */
const itemOf = (n: number) => (n === 0 ? null : ITEMS[n - 1]);
const itemNo = (item: Building["item"]): number => (item === null ? 0 : ITEMS.indexOf(item) + 1);
/** A field's setter that every number fits. */
const always =
  (set: (n: number) => void) =>
  (n: number): boolean => {
    set(n);
    return true;
  };

describe("the check", () => {
  test("is the same for a yard and for the yard read back from its save, and for the page's copy of it", () => {
    for (const [name, w] of yards()) {
      expect([name, check(again(w))]).toEqual([name, check(w)]);
      // What the page is shown: no seed, and a letter about a time away; and Leaf sets `at` on its own.
      const page = read(save({ ...w, seed: null, away: awayOf(w) ?? { seconds: 600, coins: 3, made: {} } }));
      page.at += 12_345;
      expect([name, check(page)]).toEqual([name, check(w)]);
    }
  });

  test("of two yards alike stays alike, run on 1,000 ticks", () => {
    for (const [name, w] of yards()) {
      const copy = again(w);
      steps(w, 1000);
      steps(copy, 1000);
      expect([name, check(copy)]).toEqual([name, check(w)]);
      expect(save(copy)).toBe(save(w));
    }
  });

  test("tells apart two yards alike but for two belts' progress, 0.5 and 0.75, swapped: any two belts", () => {
    for (const [name, w] of yards()) {
      const belts = w.cells.filter((c): c is Building => c?.kind === "belt");
      for (const b of belts) b.item ??= "plank";
      let alike = 0;
      for (const [n, a] of belts.entries())
        for (const b of belts.slice(n + 1)) {
          [a.prog, b.prog] = [0.5, 0.75];
          const one = check(w);
          [a.prog, b.prog] = [0.75, 0.5];
          if (check(w) === one) alike++;
        }
      expect([name, belts.length > 1, alike]).toEqual([name, true, 0]);
    }
  });

  test("changes with each bit of each kind of field turned over", () => {
    const w = working();
    const carrier = w.cells.find((c) => c?.kind === "belt" && c.item !== null);
    const mouth = w.cells.find((c) => c?.kind === "tunnel" && c.span > 0);
    const [order] = w.board;
    const [mill, boiler, crate, splitter] = (["mill", "boiler", "crate", "splitter"] as const).map((k) => first(w, k));
    const print = w.blueprints[0];
    if (!carrier || !mouth || !order || !mill || !boiler || !crate || !splitter || !print?.[0])
      throw new Error("not all there");
    crate.count = Math.max(1, crate.count);
    const [piece, ...rest] = print;
    // Fields that are numbers: each of their 64 bits.
    const numbers: Record<string, [() => number, (v: number) => void]> = {
      "the tick": [() => w.tick, (v) => void (w.tick = v)],
      "the till": [() => w.till, (v) => void (w.till = v)],
      "how far a thing is across its belt": [() => carrier.prog, (v) => void (carrier.prog = v)],
      "a machine's work": [() => mill.work, (v) => void (mill.work = v)],
      "a boiler's fuel": [() => boiler.fuel, (v) => void (boiler.fuel = v)],
      "how many of a thing a crate holds": [() => crate.buf.stone ?? 0, (v) => void (crate.buf.stone = v)],
      "how far a thing under a tunnel has come": [() => mouth.underProg[0] ?? 0, (v) => void (mouth.underProg[0] = v)],
      "an order's filled count": [() => order.filled.plank ?? 0, (v) => void (order.filled.plank = v)],
      "the pieces to hand": [() => w.spare.belt ?? 0, (v) => void (w.spare.belt = v)],
      "what the depot has taken in": [() => w.depot.ore ?? 0, (v) => void (w.depot.ore = v)],
      "the pace": [() => w.pace.ticks, (v) => void (w.pace.ticks = v)],
    };
    for (const [what, [get, set]] of Object.entries(numbers)) {
      const was = get();
      const from = was === 0 ? 0.375 : was;
      set(from);
      const before = check(w);
      for (let bit = 0; bit < 64; bit++) {
        set(flipped(from, bit));
        expect([what, bit, check(w) === before]).toEqual([what, bit, false]);
      }
      set(was);
    }
    // Fields that are small whole numbers, or one of a list by its number: each bit of it.
    const codes: Record<string, [number, () => number, (n: number) => boolean]> = {
      "which way a piece faces": [2, () => carrier.dir, always((n) => void (carrier.dir = DIRS[n] ?? 0))],
      "a splitter's turn": [2, () => splitter.turn, always((n) => void (splitter.turn = n))],
      "a splitter's shut ways": [3, () => splitter.shut, always((n) => void (splitter.shut = n))],
      "a colour": [3, () => carrier.tint, always((n) => void (carrier.tint = n))],
      "a tunnel's span": [2, () => mouth.span, always((n) => void (mouth.span = n))],
      "a crate shut": [1, () => Number(crate.open), always((n) => void (crate.open = n === 1))],
      "a piece to hand": [1, () => Number(carrier.free), always((n) => void (carrier.free = n === 1))],
      "a piece's kind": [
        4,
        () => KINDS.indexOf(carrier.kind) + 1,
        (n) => {
          const kind = KINDS[n - 1];
          if (kind) carrier.kind = kind;
          return kind !== undefined;
        },
      ],
      "a blueprint piece's place": [
        5,
        () => piece?.x ?? 0,
        (n) => {
          if (piece) w.blueprints[0] = [{ ...piece, x: n }, ...rest];
          return true;
        },
      ],
    };
    const items: Record<string, [() => Building["item"], (i: Building["item"]) => void]> = {
      "what a belt carries": [() => carrier.item, (i) => void (carrier.item = i)],
      "what a machine has made": [() => mill.out, (i) => void (mill.out = i)],
      "what a machine is making": [() => mill.making, (i) => void (mill.making = i)],
      "a machine's recipe": [() => mill.recipe, (i) => void (mill.recipe = i)],
      "what is under a tunnel": [() => mouth.under[0] ?? null, (i) => void (mouth.under[0] = i)],
    };
    for (const [what, [get, set]] of Object.entries(items))
      codes[what] = [
        5,
        () => itemNo(get()),
        (n) => {
          const item = itemOf(n);
          if (item !== undefined) set(item);
          return item !== undefined;
        },
      ];
    for (const [what, [width, get, set]] of Object.entries(codes)) {
      const was = get();
      const before = check(w);
      for (let bit = 0; bit < width; bit++) {
        if (!set(was ^ (1 << bit))) continue;
        expect([what, bit, check(w) === before]).toEqual([what, bit, false]);
        set(was);
      }
      expect([what, check(w)]).toEqual([what, before]);
    }
  });

  test("differs for any one thing changed", () => {
    const yard = working();
    const before = check(yard);
    const changes: Record<string, (w: World) => void> = {
      "one thing more on a belt": (w) => {
        const b = w.cells.find((c) => c?.kind === "belt" && c.item === null);
        if (!b) throw new Error("no empty belt");
        b.item = "plank";
      },
      "one thing less on a belt": (w) => {
        const b = w.cells.find((c) => c?.kind === "belt" && c.item !== null);
        if (!b) throw new Error("no full belt");
        b.item = null;
      },
      "how far a thing is across its belt": (w) => {
        const b = w.cells.find((c) => c?.kind === "belt" && c.item !== null);
        if (b) b.prog += 0.125;
      },
      "a machine's work one tick on": (w) => void (first(w, "mill").work += 1),
      "a boiler's fuel": (w) => void (first(w, "boiler").fuel += 1),
      "a splitter's turn": (w) => void (first(w, "splitter").turn = (first(w, "splitter").turn + 1) % 3),
      "a crate's contents": (w) => {
        const crate = first(w, "crate");
        crate.buf.stone = (crate.buf.stone ?? 0) + 1;
        crate.count++;
      },
      "a crate shut": (w) => {
        const i = w.cells.indexOf(first(w, "crate"));
        setOpen(w, i % w.land.w, Math.floor(i / w.land.w), false);
      },
      "a shut way": (w) => {
        const i = w.cells.indexOf(first(w, "splitter"));
        setWay(w, i % w.land.w, Math.floor(i / w.land.w), 1, false);
      },
      "a colour": (w) => void (belt(w).tint = 3),
      "a recipe set": (w) => void (first(w, "bench").recipe = "engine"),
      "what a machine is making, and has made": (w) => void (first(w, "mill").out = "brick"),
      "which way a piece faces": (w) => void (belt(w).dir = RIGHT[belt(w).dir]),
      "a piece taken away": (w) => void (w.cells[w.cells.indexOf(belt(w))] = null),
      "a piece of another kind": (w) => void (w.cells[w.cells.indexOf(belt(w))] = blank("joiner", 0)),
      "a piece that was to hand": (w) => void (belt(w).free = !belt(w).free),
      "what is under a tunnel": (w) => {
        const mouth = w.cells.find((c) => c?.kind === "tunnel" && c.span > 0);
        if (!mouth) throw new Error("no tunnel");
        mouth.under[0] = mouth.under[0] === null ? "ore" : null;
      },
      "the till": (w) => void (w.till += 0.01),
      "an order's filled count": (w) => {
        const order = w.board[0];
        if (!order) throw new Error("no board");
        order.filled.plank = (order.filled.plank ?? 0) + 1;
      },
      "an order on the board": (w) => void w.board.pop(),
      "the tick": (w) => void (w.tick += 1),
      "the Coins changes counted": (w) => void (w.bank += 1),
      "the story": (w) => void (w.filled.plank = (w.filled.plank ?? 0) + 1),
      "what the depot has taken in": (w) => void (w.depot.ore = (w.depot.ore ?? 0) + 1),
      "what has gone to orders": (w) => void (w.given.ore = (w.given.ore ?? 0) + 1),
      "the next free swap": (w) => void (w.swapAt += 1),
      "the owner's last command": (w) => void (w.seen = { ...w.seen, tick: w.seen.tick + 1 }),
      "a plot": (w) => void w.plots.push("meadow"),
      "a plan": (w) => void w.plans.pop(),
      "the pieces to hand": (w) => void (w.spare.belt = (w.spare.belt ?? 0) + 1),
      "the pace": (w) => void (w.pace.warm += 1),
      "a blueprint": (w) => void (w.blueprints[0] = null),
    };
    for (const [what, change] of Object.entries(changes)) {
      const w = again(yard);
      expect(check(w)).toBe(before);
      change(w);
      expect([what, check(w) === before]).toEqual([what, false]);
    }
  });

  test("leaves out an order Leaf has hung that does not count yet: a page told of it in time agrees, and one never told disagrees from the tick it counts", () => {
    let swapped = 0;
    for (const [name, leaf] of yards()) {
      const order = leaf.board.find((o) => !isFilled(o.want, o.filled));
      if (!order || swapRefusal(leaf, order.id) !== null) continue;
      // The page's copies have no seed: they take the order down and hang none.
      const told = read(save({ ...leaf, seed: null }));
      const never = read(save({ ...leaf, seed: null }));
      for (const w of [leaf, told, never]) expect(swap(w, order.id)).toBe(true);
      const hung = leaf.board.filter((o) => !told.board.some((t) => t.id === o.id));
      expect([name, hung.map((o) => counts(o, leaf.tick))]).toEqual([name, [false]]);
      expect([name, check(told), check(never)]).toEqual([name, check(leaf), check(leaf)]);
      told.board.push(...structuredClone(hung));
      for (const w of [leaf, told, never]) steps(w, ORDER_WAITS - 1);
      expect([name, check(told), check(never)]).toEqual([name, check(leaf), check(leaf)]);
      for (const w of [leaf, told, never]) steps(w, 1);
      expect([name, check(told) === check(leaf), check(never) === check(leaf)]).toEqual([name, true, false]);
      for (const w of [leaf, told]) steps(w, 1000);
      expect([name, check(told)]).toEqual([name, check(leaf)]);
      swapped++;
    }
    expect(swapped).toBeGreaterThan(2);
  });

  test("covers every field of a piece and of the yard but those it leaves out", () => {
    // A field added to a piece or the yard fails this until the check mixes it in, or says why not.
    const piece = Object.keys(blank("belt", 0)).filter((k) => !["kinds", "count", "idle", "via"].includes(k));
    expect(piece.toSorted()).toEqual([
      "buf",
      "dir",
      "free",
      "fuel",
      "item",
      "kind",
      "making",
      "open",
      "out",
      "prog",
      "recipe",
      "shut",
      "span",
      "tint",
      "turn",
      "under",
      "underProg",
      "work",
    ]);
    const leftOut = new Set([
      "land",
      "power",
      "seed",
      "serial",
      "at",
      "away",
      "rates",
      "open",
      "supply",
      "demand",
      "wire",
      "news",
    ]);
    expect(
      Object.keys(create())
        .filter((k) => !leftOut.has(k))
        .toSorted(),
    ).toEqual([
      "bank",
      "blueprints",
      "board",
      "cells",
      "depot",
      "done",
      "filled",
      "given",
      "pace",
      "paid",
      "plans",
      "plots",
      "seen",
      "sold",
      "spare",
      "story",
      "swapAt",
      "tick",
      "till",
      "told",
    ]);
  });
});
