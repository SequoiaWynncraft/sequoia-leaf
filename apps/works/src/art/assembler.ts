/**
 * The assembler's picture: a crafting hall over its nine tiles, in the Spark look. A brick foot and
 * brick piers, walls of tarred timber, the town's slate roof with a strip of glass along its ridge, a
 * copper gear in the gable and a copper hood and stack. While it works its doors stand open on a bench
 * where a hammer comes down, and its windows, its ridge glass and a string of lamps under the eaves burn
 * a cold cream; at rest the doors are shut and the glass is dark. Its way out has a copper chute where
 * it can be seen (its left or right wall; its doors, facing the viewer). Grade II wears a brass band
 * and grade III is iron where the timber was, as every machine.
 */
import { BARK, CREAM, GOLD, INK, PAPER, SKY, STONE } from "@sequoia-leaf/kit/palette.ts";
import { R, shingles } from "@sequoia-leaf/kit/pix.ts";
import { type Ctx, hash, makeCanvas } from "@sequoia-leaf/kit/util.ts";

import { arch, fitted, gear, ironClad, PURPLE } from "./machines.ts";
import { CLAY, DARK, IRON, spr, type Sprite } from "./pal.ts";

/** The picture's size: three tiles across, rising a little over half a tile above its box. */
const W = 48;
const H = 58;
/** Where its walls, its foot and its doors are. */
const WALL = 27;
const FOOT = 50;
const DOOR = { x: 17, w: 14 } as const;

/** Tar on timber, darkest first: the darkest things in the yard but pitch. */
const TAR = [DARK, BARK[0], BARK[1]] as const;
/** The cold cream light of the Spark machines, in two strengths; and their glass unlit. */
const LIGHT = [PAPER[2], CREAM] as const;
const UNLIT = [IRON[1], IRON[2]] as const;

/** Courses of brick, three pixels a course, offset every other, the mortar dark. */
function bricks(g: Ctx, x: number, y: number, w: number, h: number, seed: number): void {
  R(g, x, y, w, h, BARK[0]);
  for (let r = 0; r * 3 < h; r++) {
    const by = y + r * 3;
    const bh = Math.min(2, y + h - by);
    for (let bx = x - (r % 2 ? 3 : 0); bx < x + w; bx += 6) {
      const x0 = Math.max(x, bx);
      const x1 = Math.min(x + w, bx + 5);
      if (x1 <= x0) continue;
      R(g, x0, by, x1 - x0, bh, hash(bx, r, seed) > 0.7 ? CLAY[1] : CLAY[0]);
    }
  }
}

/** Upright boards of tarred timber, a seam of tar between each. */
function tarred(g: Ctx, x: number, y: number, w: number, h: number, seed: number): void {
  for (let bx = x; bx < x + w; bx += 4) {
    R(g, bx, y, Math.min(3, x + w - bx), h, hash(bx, 3, seed) > 0.6 ? TAR[2] : TAR[1]);
    if (bx + 3 < x + w) R(g, bx + 3, y, 1, h, TAR[0]);
  }
}

/** A tall window of small panes: lit cream while it works, dark glass at rest. */
function window(g: Ctx, x: number, y: number, lit: boolean): void {
  R(g, x - 1, y - 1, 8, 12, TAR[0]);
  const [glass, shine] = lit ? LIGHT : UNLIT;
  R(g, x, y, 6, 10, glass);
  R(g, x, y, 6, 2, shine);
  R(g, x + 2, y, 1, 10, TAR[0]);
  R(g, x, y + 4, 6, 1, TAR[0]);
  R(g, x - 1, y + 10, 8, 1, STONE[2]);
}

/** Inside the open doors: a bench in the light, the hammer up, coming down or struck (`step` 0 to 2). */
function inside(g: Ctx, x: number, y: number, w: number, h: number, step: number): void {
  R(g, x, y, w, h, LIGHT[0]);
  R(g, x, y + h - 4, w, 4, PAPER[1]);
  R(g, x + 1, y + 1, w - 2, 1, LIGHT[1]);
  // The bench, seen end on in the light.
  R(g, x + 2, y + h - 8, w - 4, 2, BARK[3]);
  R(g, x + 3, y + h - 6, 1, 4, BARK[1]);
  R(g, x + w - 4, y + h - 6, 1, 4, BARK[1]);
  const head = [y + h - 15, y + h - 12, y + h - 10][step] ?? y + h - 15;
  R(g, x + 8, head + 2, 1, y + h - 8 - head - 2, BARK[1]);
  R(g, x + 6, head, 5, 3, STONE[1]);
  R(g, x + 6, head, 5, 1, STONE[3]);
  if (step === 2) {
    R(g, x + 4, y + h - 10, 1, 1, CREAM);
    R(g, x + 12, y + h - 11, 1, 1, GOLD[2]);
  }
}

/** The doors: open on the bench while it works, shut on copper hinges at rest. */
function doors(g: Ctx, working: boolean, step: number): void {
  const { x, w } = DOOR;
  const top = WALL + 5;
  arch(g, x - 1, top - 1, w + 2, FOOT - top + 1, CLAY[0]);
  if (working) {
    arch(g, x, top, w, FOOT - top, LIGHT[0]);
    inside(g, x, top + 3, w, FOOT - top - 3, step);
    // The leaves folded back against the wall.
    R(g, x - 3, top + 2, 2, FOOT - top - 2, TAR[1]);
    R(g, x + w + 1, top + 2, 2, FOOT - top - 2, TAR[1]);
    return;
  }
  arch(g, x, top, w, FOOT - top, TAR[1]);
  for (let bx = x + 2; bx < x + w - 1; bx += 3) R(g, bx, top + 2, 1, FOOT - top - 2, TAR[0]);
  R(g, x + w / 2 - 1, top + 1, 1, FOOT - top - 1, TAR[0]);
  for (const hy of [top + 5, FOOT - 5]) {
    R(g, x + 1, hy, 4, 1, CLAY[1]);
    R(g, x + w - 5, hy, 4, 1, CLAY[1]);
  }
}

/** The roof: the town's slate, a copper ridge with its strip of glass, a gear in the gable, and the hood and stack. */
function roof(g: Ctx, working: boolean, step: number): void {
  // The stack behind the roof, brick with a copper cowl.
  bricks(g, 37, 1, 5, 14, 61);
  R(g, 36, 0, 7, 2, CLAY[1]);
  R(g, 36, 0, 7, 1, CLAY[2]);
  shingles(g, 0, 8, W, WALL - 8, (r) => Math.round((WALL - 8 - r) * 0.22), PURPLE, 62);
  // The ridge: copper capping over a strip of glass that is lit while it works.
  R(g, 5, 5, W - 10, 3, CLAY[0]);
  R(g, 5, 5, W - 10, 1, CLAY[1]);
  const [glass, shine] = working ? LIGHT : UNLIT;
  R(g, 7, 8, W - 14, 2, glass);
  for (let gx = 10; gx < W - 8; gx += 5) R(g, gx, 8, 1, 2, TAR[0]);
  if (working) R(g, 7, 8, W - 14, 1, shine);
  // The gable's copper gear, turning while it works.
  R(g, 20, 12, 8, 8, TAR[0]);
  gear(g, 24, 16, 3, 7, working ? step / 4 : 0, CLAY[1], CLAY[0]);
  // The eaves: a copper gutter, and under it a string of lamps lit while it works.
  R(g, 0, WALL - 1, W, 1, CLAY[0]);
  R(g, 0, WALL - 1, W, 1, CLAY[1]);
  for (let lx = 3; lx < W - 2; lx += 6) R(g, lx, WALL + 1, 1, 1, working ? LIGHT[1] : UNLIT[1]);
}

/** A copper chute for its way out, on its right wall (`side` 1) or its left (-1). */
function chute(g: Ctx, side: number): void {
  const x = side > 0 ? W - 5 : 0;
  R(g, x, 38, 5, 6, CLAY[0]);
  R(g, x + (side > 0 ? 0 : 1), 39, 4, 4, DARK);
  R(g, x, 38, 5, 1, CLAY[2]);
}

/**
 * The hall facing `d` (east 0, south 1, west 2, north 3) at a grade, at rest or at work in a step of
 * four: its foot on the foot of its box, its middle on the box's middle.
 */
export function hall(d: number, grade: number, working: boolean, step: number): Sprite {
  const { c, g } = makeCanvas(W, H);
  roof(g, working, step);
  tarred(g, 1, WALL, W - 2, FOOT - WALL, 63);
  bricks(g, 0, WALL, 4, FOOT - WALL, 65);
  bricks(g, W - 4, WALL, 4, FOOT - WALL, 66);
  window(g, 6, WALL + 6, working);
  window(g, W - 12, WALL + 6, working);
  doors(g, working, step % 3);
  // The brick foot, its top course lit.
  bricks(g, 0, FOOT, W, H - FOOT, 67);
  R(g, 0, FOOT, W, 1, CLAY[1]);
  if (d === 0) chute(g, 1);
  if (d === 2) chute(g, -1);
  // The band runs above the foot; the plate is the doors' keystone.
  fitted(g, grade, 1, FOOT - 3, W - 2, DOOR.x + DOOR.w / 2 - 1, WALL + 2);
  ironClad(g, grade);
  // A line of ink where the roof meets the walls, so the two read apart at a distance.
  R(g, 0, WALL - 2, W, 1, INK);
  R(g, 2, WALL - 2, W - 4, 1, SKY[0]);
  return spr(c, W / 2, H);
}

/** Every picture of the hall, made once each when first asked for: by way, grade, rest or work, and step. */
const MADE = new Map<string, Sprite>();
export function hallOf(d: number, grade: number, working: boolean, step: number): Sprite {
  const key = `${d & 3}:${grade}:${working ? step & 3 : -1}`;
  const had = MADE.get(key);
  if (had) return had;
  const made = hall(d & 3, grade, working, working ? step & 3 : 0);
  MADE.set(key, made);
  return made;
}
