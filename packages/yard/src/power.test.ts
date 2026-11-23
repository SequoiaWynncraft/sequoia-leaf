import { describe, expect, spyOn, test } from "bun:test";

import { paint, remove } from "./build.ts";
import { REACH } from "./content/machines.ts";
import { bare, belts, put, workingYard } from "./fixtures.ts";
import type { Land } from "./land.ts";
import { boxOf, clear, move, piecesAt, stand, within } from "./pieces.ts";
import * as power from "./power.ts";
import { load, save } from "./save.ts";
import { status } from "./status.ts";
import { step } from "./step.ts";
import { at, reopen, type World } from "./world.ts";
import large from "./yards/large.json";
import mid from "./yards/mid.json";
import short from "./yards/short.json";
import small from "./yards/small.json";

const YARDS = { small, short, mid, large } as const;

/** Whether a whole-tile offset is within `r` tiles, as the rules take it. */
const near = (dx: number, dy: number, r: number): boolean => dx * dx + dy * dy <= r * r;
/** FNV-1a over which tiles have power. */
const hash = (lit: Uint8Array): number => lit.reduce((h, p) => Math.imul(h ^ p, 16777619), 2166136261) >>> 0;

/**
 * Where power reached by the rule before it was worked out once a change: every tile asked about
 * every live pylon. Kept here only to hold `repower` to it.
 */
function today(w: World): Uint8Array {
  const { land } = w;
  const [cx, cy] = land.depot;
  const reach = REACH.pylon * w.rates.reach;
  const link = REACH.link * w.rates.reach;
  const pylons: { x: number; y: number; live: boolean }[] = [];
  w.cells.forEach((b, i) => {
    if (b?.kind === "pylon") pylons.push({ x: i % land.w, y: Math.floor(i / land.w), live: false });
  });
  for (let grew = true; grew;) {
    grew = false;
    for (const p of pylons) {
      if (p.live) continue;
      p.live = near(p.x - cx, p.y - cy, link) || pylons.some((q) => q.live && near(p.x - q.x, p.y - q.y, link));
      if (p.live) grew = true;
    }
  }
  const live = pylons.filter((p) => p.live);
  const lit = new Uint8Array(land.w * land.h);
  for (let y = 0; y < land.h; y++)
    for (let x = 0; x < land.w; x++)
      if (near(x - cx, y - cy, REACH.depot) || live.some((p) => near(x - p.x, y - p.y, reach))) lit[y * land.w + x] = 1;
  return lit;
}

/** The tiles with power, as a list, so that a difference reads as tiles. */
const tiles = (lit: Uint8Array): number[] => [...lit].flatMap((v, i) => (v === 1 ? [i] : []));

/** Expects a yard's power to be what today's rule gives, and gives the number of tiles lit. */
function asToday(w: World): number {
  const lit = tiles(w.power ?? power.repower(w));
  expect(lit).toEqual(tiles(today(w)));
  return lit.length;
}

/** The same yard with taller pylons, whether or not the story has opened them yet. */
function tall(w: World): World {
  w.plans.push("tallpylons");
  reopen(w);
  return w;
}

const read = (text: string, land?: Land): World => {
  const w = load(text, land);
  if (!w) throw new Error("the yard does not read");
  return w;
};

/** Expects a yard to read back from its save the same to the byte, and its power to be today's. */
function same(w: World): void {
  const text = save(w);
  expect(save(read(text, w.land))).toBe(text);
  asToday(w);
}

/** Every piece in a yard's tiles, the depot left out. */
const everything = (w: World): number[] => within(w, 0, 0, w.land.w - 1, w.land.h - 1);

/**
 * A bare yard 64 tiles by 40, the depot at (32, 20): nine rows of belt west of it, each its own
 * colour, with a grid of pylons among them joined to the depot only by the two nearest it; a column
 * of pylons far to the east, out of reach; and one 9 tiles east of the depot, joined only once
 * pylons are taller.
 */
function busy(): World {
  const w = bare({}, { w: 64, h: 40 });
  for (let y = 2; y < 38; y += 4) {
    belts(w, 2, y, 26, y);
    paint(w, 2, y, 1 + ((y >> 2) % 6));
  }
  for (let x = 4; x <= 25; x += 7) for (let y = 5; y < 40; y += 6) put(w, "pylon", x, y);
  for (let y = 5; y < 32; y += 6) put(w, "pylon", 61, y);
  put(w, "pylon", 41, 20);
  return w;
}

describe("where power reaches", () => {
  // Measured when distances were still taken with Math.hypot, before they were compared as squares.
  test("each fixture yard's power map is as it was, with and without taller pylons", () => {
    expect([bare, workingYard].map((make) => [hash(power.repower(make())), hash(power.repower(tall(make())))])).toEqual(
      [
        [1074620613, 1074620613],
        [1159396729, 1927558942],
      ],
    );
  });
  test("each reference yard lights the tiles today's rule does, with and without taller pylons", () => {
    for (const yard of Object.values(YARDS)) {
      const w = read(JSON.stringify(yard));
      expect(w.cells.some((b) => b?.kind === "pylon")).toBe(true);
      asToday(w);
      asToday(tall(w));
    }
  });
  test("pylons in chains, out of reach and taken away again light the tiles today's rule does", () => {
    const w = busy();
    const lit = (x: number, y: number): number => (w.power ?? power.repower(w))[at(w, x, y)] ?? -1;
    const all = asToday(w);
    // The grid is joined, the column far to the east is not, nor is the pylon 9 tiles from the depot.
    expect([lit(4, 5), lit(61, 5), lit(41, 20)]).toEqual([1, 0, 0]);
    // Taking away the two pylons that join the grid to the depot cuts off the whole grid.
    remove(w, 25, 17);
    remove(w, 25, 23);
    expect(lit(4, 5)).toBe(0);
    expect(asToday(w)).toBeLessThan(all);
    // One set down again joins it back, and one standing alone lights nothing.
    put(w, "pylon", 25, 17);
    put(w, "pylon", 58, 38);
    expect([lit(4, 5), lit(58, 38)]).toEqual([1, 0]);
    asToday(w);
    // Taller pylons reach and join further: the pylon east of the depot joins, the column still does not.
    tall(w);
    expect([lit(41, 20), lit(61, 5)]).toEqual([1, 0]);
    asToday(w);
    for (const [x, y] of [
      [11, 11],
      [18, 29],
      [61, 17],
    ] as const)
      remove(w, x, y);
    asToday(w);
  });
});

describe("power worked out once", () => {
  test("a yard reads back the same to the byte: each reference yard, and after large sets are cleared, stood and moved", () => {
    for (const yard of Object.values(YARDS)) {
      const w = read(JSON.stringify(yard));
      same(w);
      const set = piecesAt(w, everything(w));
      expect(clear(w, everything(w)).ok).toBe(true);
      same(w);
      expect(stand(w, set, Infinity).ok).toBe(true);
      same(w);
    }
    const w = busy();
    const west = within(w, 0, 0, 30, 39);
    const set = piecesAt(w, west);
    expect(set.length).toBeGreaterThan(200);
    expect(clear(w, west).ok).toBe(true);
    same(w);
    expect(stand(w, set, Infinity).ok).toBe(true);
    same(w);
    const box = boxOf(set);
    expect(move(w, within(w, 0, 0, 30, 39), 0, box.x + 1, box.y + 1)).toBeNull();
    same(w);
  });
  test("once for a load, a clear, a stand and a move of many pieces, when next it is needed", () => {
    const yard = busy();
    const text = save(yard);
    const worked = spyOn(power, "repower");
    const once = (change: (w: World) => unknown, w: World): void => {
      worked.mockClear();
      change(w);
      step(w);
      status(w, at(w, 4, 4));
      step(w);
      expect(worked).toHaveBeenCalledTimes(1);
    };
    worked.mockClear();
    const w = read(text, yard.land);
    step(w);
    status(w, at(w, 4, 4));
    expect(worked).toHaveBeenCalledTimes(1);
    const west = within(w, 0, 0, 30, 39);
    const set = piecesAt(w, west);
    // Coloured belts with pylons between them: the hardest set to stand once.
    expect([set.filter((p) => p.kind === "pylon").length, set.filter((p) => (p.tint ?? 0) > 0).length]).toEqual([
      24, 225,
    ]);
    once((y) => clear(y, west), w);
    once((y) => stand(y, set, Infinity), w);
    once((y) => move(y, within(y, 0, 0, 30, 39), 0, 3, 3), w);
    worked.mockRestore();
  });
});
