/**
 * Belts. A belt tile is a wooden bed of slats between two rails, made of arms: one from the middle
 * of the tile out to each side it joins. Slats march along every arm the way things travel on it,
 * and a chevron rides the main run, so a belt says which way it goes even when it is empty. A line
 * a player has coloured wears the paint on its rails and along the edge of its bed, where nothing
 * else is said. A way out that a player has shut has no arm, and a bar across that side of the tile.
 * Each tile is drawn once for every step of the march and kept.
 */

import type { Dir } from "@sequoia-leaf/factory";
import { BARK, CREAM, GOLD, INK, SKY, WATER } from "@sequoia-leaf/kit/palette.ts";
import { paint } from "@sequoia-leaf/kit/pix.ts";
import { clamp } from "@sequoia-leaf/kit/util.ts";

import { CLAY, IRON } from "./pal.ts";

export const TILE = 16;
/** How many steps the march has before it comes round: a chevron every tile, a slat every four pixels. */
export const STEPS = 16;

/** For each side of a tile (east, south, west, north): no arm, an arm things come in along, one they leave by, or a way out that is shut. */
export type Arm = 0 | 1 | 2 | 3;
/** A tile's four arms in one number, two bits a side, east lowest: 0 for a tile with none (`arms`). */
export type Arms = number;
/** The arms of the four sides, east, south, west and north, as one number. */
export const arms = (e: Arm, s: Arm, w: Arm, n: Arm): Arms => e | (s << 2) | (w << 4) | (n << 6);
/** The arm on one side. */
export const armAt = (a: Arms, side: number): Arm => {
  const v = (a >> ((side & 3) * 2)) & 3;
  return v === 1 ? 1 : v === 2 ? 2 : v === 3 ? 3 : 0;
};
/** The arms with one side's set. */
export const withArm = (a: Arms, side: number, arm: Arm): Arms =>
  (a & ~(3 << ((side & 3) * 2))) | (arm << ((side & 3) * 2));

interface Wood {
  bed: string;
  slat: string;
  mark: string;
  rail: string;
  railLit: string;
}
/**
 * Plain slats, as a belt of the first grade lies in the yard; the lighter slats its picture has on a
 * button; iron rollers on an iron bed between brass rails, the third grade; and waxed boards, pale,
 * with a bright edge to the bed, the second.
 */
const WOODS: readonly Wood[] = [
  { bed: BARK[0], slat: BARK[1], mark: BARK[3], rail: BARK[2], railLit: BARK[3] },
  { bed: BARK[0], slat: BARK[2], mark: GOLD[0], rail: BARK[3], railLit: BARK[4] },
  { bed: IRON[1], slat: IRON[3], mark: GOLD[1], rail: GOLD[0], railLit: GOLD[1] },
  { bed: BARK[1], slat: BARK[3], mark: GOLD[1], rail: BARK[4], railLit: GOLD[0] },
];
/** What a belt, splitter, joiner or sorter of a grade is drawn in, in the yard: `tier` for `beltTile`. */
export const woodOf = (grade: number): number => (grade >= 3 ? 2 : grade >= 2 ? 3 : 0);
/** How many of the grade's marks a belt of a grade wears in the corner of its tile: one for the second, two for the third. */
export const marksOf = (grade: number): number => Math.max(0, Math.min(2, grade - 1));
/** The mark of a grade above the first: a stud of muted brass with a dark edge, as every graded piece wears (`machines.ts`, `PIP`). */
const STUD = [
  [INK, INK, INK, INK],
  [INK, GOLD[1], GOLD[0], INK],
  [INK, GOLD[0], GOLD[0], INK],
  [INK, INK, INK, INK],
] as const;
/** How far apart two studs stand. */
const STUD_STEP = 3;

/**
 * The paint a player can give a line, by its `tint`, 1 to 6: where the yard's light falls on it and
 * out of the light. Each is lighter or darker than the others as well as another colour, and the
 * green is bluer and darker than the grass's, so that an eye that cannot tell red from green still
 * tells it from the red and from bare wood.
 */
export const PAINTS = [
  { name: "Red", lit: CLAY[3], dim: CLAY[2] },
  { name: "Yellow", lit: GOLD[2], dim: GOLD[1] },
  { name: "Green", lit: "#5fb890", dim: "#2a6a50" },
  { name: "Blue", lit: WATER[3], dim: WATER[2] },
  { name: "Purple", lit: "#a565b8", dim: SKY[3] },
  { name: "White", lit: CREAM, dim: "#e9d8b8" },
] as const;

const HALF = 5;

/** How far along its own run a pixel is, counted the way things travel there. */
const along = (x: number, y: number, way: number): number =>
  way === 0 ? x : way === 1 ? y : way === 2 ? 15 - x : 15 - y;
/** How far a point `k` of the way out to a side is from the middle of the tile, across and down. */
const edge = (side: number, k: number): number => (side === 0 ? 8 * k : side === 2 ? -8 * k : 0);
const edgeY = (side: number, k: number): number => (side === 1 ? 8 * k : side === 3 ? -8 * k : 0);
const cache = new Map<number, HTMLCanvasElement>();

/**
 * A belt tile. `main` is the way the middle of the tile carries things; `step` is how far the
 * march has come, 0 to 15; `tier` is the wood it is drawn in (`WOODS`, `woodOf`); `tint` is the
 * line's colour, or 0; `marks` is how many of the grade's studs it wears in its top-left corner. The
 * tiles kept are at most seven times those of a yard with no colour in it, and a splitter's are at
 * most eight times those of one with no way shut.
 */
export function beltTile(a: Arms, main: Dir, step: number, tier: number, tint = 0, marks = 0): HTMLCanvasElement {
  const key = ((((a * 4 + main) * STEPS + step) * WOODS.length + tier) * 7 + tint) * 3 + marks;
  const had = cache.get(key);
  if (had) return had;
  const wood = WOODS[tier] ?? WOODS[0];
  if (!wood) throw new Error("no belt wood");
  const hue = PAINTS[tint - 1];
  const arm = (side: number): boolean => armAt(a, side) === 1 || armAt(a, side) === 2;
  // Which arm, if any, a pixel's bed belongs to: 0 to 3 for a side, 4 for the middle, -1 for none.
  const part = (x: number, y: number): number => {
    const u = x - 7.5;
    const v = y - 7.5;
    if (Math.abs(u) <= HALF && Math.abs(v) <= HALF) return 4;
    if (Math.abs(v) <= HALF) return u > 0 ? (arm(0) ? 0 : -1) : arm(2) ? 2 : -1;
    if (Math.abs(u) <= HALF) return v > 0 ? (arm(1) ? 1 : -1) : arm(3) ? 3 : -1;
    return -1;
  };
  /**
   * The bar across a side that is shut: as long as the bed is wide, two pixels thick, inked all
   * round, with red ends and a pale middle so that no paint on the rails beside it is its colour.
   */
  const bar = (x: number, y: number): string | null => {
    for (let side = 0; side < 4; side++) {
      if (armAt(a, side) !== 3) continue;
      const depth = side === 0 ? 15 - x : side === 1 ? 15 - y : side === 2 ? x : y;
      const across = Math.abs((side % 2 === 0 ? y : x) - 7.5);
      if (depth > 3 || across > HALF) continue;
      if (depth === 0 || depth === 3 || across > HALF - 1) return INK;
      return across > 2 ? CLAY[2] : CREAM;
    }
    return null;
  };
  const bed = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < TILE && y < TILE && part(x, y) >= 0;
  const near = (x: number, y: number, r: number): boolean => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (bed(x + dx, y + dy)) return true;
    return false;
  };
  /** Whether a pixel of the bed lies along its edge. An arm runs on past the side of the tile it goes out by. */
  const brim = (x: number, y: number): boolean => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) if (part(clamp(x + dx, 0, 15), clamp(y + dy, 0, 15)) < 0) return true;
    return false;
  };
  const tile = paint(TILE, TILE, (x, y) => {
    // The grade's studs, in the corner: over the rail there, whichever way the belt runs.
    if (y < STUD.length && x < STUD.length + (marks - 1) * STUD_STEP && marks > 0) {
      const col = STUD[y]?.[x < STUD.length ? x : x - (marks - 1) * STUD_STEP];
      if (col !== undefined) return col;
    }
    const shut = bar(x, y);
    if (shut) return shut;
    const p = part(x, y);
    if (p < 0) {
      if (near(x, y, 1)) {
        // Paint is lit along the top and the left of the bed, whichever way the belt runs.
        if (hue) return bed(x + 1, y) || bed(x, y + 1) || bed(x + 1, y + 1) ? hue.lit : hue.dim;
        return x + y < 15 ? wood.railLit : wood.rail;
      }
      return near(x, y, 2) ? INK : null;
    }
    if (hue && brim(x, y)) return hue.dim;
    // An arm that things come in along runs the other way from the side it is on.
    const way = p === 4 ? main : armAt(a, p) === 1 ? (p + 2) % 4 : p;
    const s = along(x, y, way);
    if (p === 4 || way === main) {
      // The chevron: a small arrowhead, one to a tile, pointing the way of the run.
      const across = Math.abs((way === 0 || way === 2 ? y : x) - 7.5);
      const k = (((s - step) % STEPS) + STEPS) % STEPS;
      if (across < 3 && (k === 2 - Math.floor(across) || (across < 1 && k === 3))) return wood.mark;
    }
    return (((s - step) % 4) + 4) % 4 === 0 ? wood.slat : wood.bed;
  });
  cache.set(key, tile);
  return tile;
}

/**
 * Where on a tile a carried thing is, in the tile's own pixels: in from one side to the middle,
 * then out by another. It says how far across the tile, or with `down` how far down it.
 */
export function ride(from: number, to: number, prog: number, down: boolean): number {
  const p = prog < 0 ? 0 : prog > 1 ? 1 : prog;
  const side = p < 0.5 ? from : to;
  const k = p < 0.5 ? 1 - p * 2 : (p - 0.5) * 2;
  return 8 + (down ? edgeY(side, k) : edge(side, k));
}
