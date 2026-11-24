import { describe, expect, test } from "bun:test";

import type { Pt } from "@sequoia-leaf/core";

import { ROUNDS } from "../clock.ts";
import { FOLK, PACE } from "../folk.ts";
import { CELL } from "./grid.ts";
import {
  blocksOf,
  BOUNDS,
  BUSY,
  ERRANDS,
  GLINTS,
  type Piece,
  PIECES,
  PLACES,
  pondD,
  RESTS,
  squaresOf,
  TOWN,
  TRAIL,
} from "./map.ts";
import { PLACE_IDS } from "./rows.ts";

// What follows from the table: where everything is, and the ground to walk on. The table as it is
// typed is held to its shape in `table.test.ts`.

/** The squares a piece blocks, as `x,y`. */
const squaresBlockedBy = (p: Piece): string[] =>
  blocksOf(p).flatMap((b) => {
    const s = squaresOf(b);
    const out: string[] = [];
    for (let y = s.y0; y <= s.y1; y++) for (let x = s.x0; x <= s.x1; x++) out.push(`${x},${y}`);
    return out;
  });

/** Whether somebody can stand at a point, and walk there from where somebody coming in off the trail appears. */
function reached(p: Pt): boolean {
  if (TOWN.footBlocked(p.x, p.y)) return false;
  const way = TOWN.findPath(TRAIL.out, p, false);
  return way.length > 0 && way.at(-1)?.x === p.x && way.at(-1)?.y === p.y;
}

/** How far somebody walks from one point to another, keeping to the squares as the town's own do. */
function walked(from: Pt, to: Pt): number {
  const way = [from, ...TOWN.findPath(from, to, false)];
  return way.slice(1).reduce((d, p, i) => d + Math.hypot(p.x - (way[i]?.x ?? p.x), p.y - (way[i]?.y ?? p.y)), 0);
}

describe("the town's map", () => {
  test("every piece stands inside the town, but the great trunks round it, which stand half outside", () => {
    const { x, y, w, h } = BOUNDS;
    const out = PIECES.filter((p) => p.kind !== "trunk" && (p.x < x || p.y < y || p.x >= x + w || p.y >= y + h));
    expect(out.map((p) => p.id)).toEqual([]);
  });

  test("no two pieces block the same square", () => {
    const by = new Map<string, string>();
    const both: string[] = [];
    for (const p of PIECES)
      for (const sq of squaresBlockedBy(p)) {
        const other = by.get(sq);
        if (other) both.push(`${sq}: ${other} and ${p.id}`);
        by.set(sq, p.id);
      }
    expect(both).toEqual([]);
  });

  test("the places are in the order they are listed", () => {
    expect(PLACES.map((p) => p.id)).toEqual([...PLACE_IDS]);
  });

  test("where somebody appears off the trail can be stood on, and from there every place, seat, busy spot and spot of the town's own can be reached", () => {
    expect(TOWN.footBlocked(TRAIL.out.x, TRAIL.out.y)).toBe(false);
    const spots: [string, Pt][] = [
      ...Object.entries(TRAIL).map(([k, p]): [string, Pt] => [`the trail's ${k}`, p]),
      ...PLACES.map((p): [string, Pt] => [`the place ${p.id}`, p.stand]),
      ...RESTS.map((r): [string, Pt] => [`the seat ${r.id}`, r.from]),
      ...Object.entries(BUSY).flatMap(([at, b]) => b.spots.map((s, i): [string, Pt] => [`busy at ${at} ${i}`, s])),
      ...Object.entries(ERRANDS).flatMap(([post, ss]) => ss.map((s, i): [string, Pt] => [`errand ${post} ${i}`, s])),
    ];
    expect(spots.filter(([, p]) => !reached(p)).map(([what, p]) => `${what} at ${p.x},${p.y}`)).toEqual([]);
  });

  test("nobody busy at a game stands on what a piece stands on, or on a seat or where it is stepped up to", () => {
    const boxes = PIECES.flatMap(blocksOf);
    const on = Object.entries(BUSY).flatMap(([at, b]) =>
      b.spots.flatMap((s, i) => {
        const inBox = boxes.some((r) => s.x >= r.x && s.x < r.x + r.w && s.y >= r.y && s.y < r.y + r.h);
        const onSeat = RESTS.some(
          (r) => Math.hypot(r.x - s.x, r.y - s.y) < CELL || Math.hypot(r.from.x - s.x, r.from.y - s.y) < CELL,
        );
        return inBox || onSeat ? [`busy at ${at} ${i}`] : [];
      }),
    );
    expect(on).toEqual([]);
  });

  test("each of the town's own has the seconds each walk of its round takes it, at its pace along the squares", () => {
    const short: string[] = [];
    for (const [job, { legs }] of Object.entries(ROUNDS)) {
      const paces = FOLK.filter((t) => t.job === job).map((t) => PACE[t.kind]);
      legs.forEach((leg, i) => {
        const before = legs[(i + legs.length - 1) % legs.length];
        if (!before) return;
        for (const from of ERRANDS[before.to])
          for (const to of ERRANDS[leg.to])
            for (const pace of paces) {
              const needs = walked(from, to) / pace;
              if (needs > leg.walk)
                short.push(`${job}: ${before.to} to ${leg.to} needs ${needs.toFixed(1)} s, has ${leg.walk}`);
            }
      });
    }
    expect(short).toEqual([]);
  });

  test("a quarter of the glint box at least is water 5 pixels in from its edge, where the page draws glints", () => {
    let deep = 0;
    let all = 0;
    for (let y = GLINTS.y; y < GLINTS.y + GLINTS.h; y += 2)
      for (let x = GLINTS.x; x < GLINTS.x + GLINTS.w; x += 2) {
        all++;
        if (pondD(x, y) < -5) deep++;
      }
    expect(deep / all).toBeGreaterThanOrEqual(0.25);
  });
});
