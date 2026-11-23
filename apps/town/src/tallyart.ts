/**
 * The Tally's pictures: the carved post in town where the town keeps count, and the three plinths
 * of a board's podium. Drawn once, in the town's own timber, brass and shingles.
 */

import { BARK, CREAM, GOLD, INK, SKY, STONE } from "@sequoia-leaf/kit/palette.ts";
import { bitmap, outlined, R } from "@sequoia-leaf/kit/pix.ts";
import { type Ctx, makeCanvas } from "@sequoia-leaf/kit/util.ts";

import { PAL, shingles, spr, type Sprite } from "./sprites.ts";

/** Five carved into wood the old way: four strokes and one across them. A group that is not finished has its strokes alone. */
function notches(g: Ctx, x: number, y: number, strokes: number): void {
  for (let i = 0; i < Math.min(4, strokes); i++) {
    R(g, x + i * 2, y, 1, 6, BARK[0]);
    R(g, x + i * 2 + 1, y + 1, 1, 5, BARK[4]);
  }
  if (strokes < 5) return;
  for (let i = 0; i < 8; i++) R(g, x - 1 + i, y + 5 - Math.floor(i * 0.75), 1, 1, BARK[0]);
}

/**
 * The Tally: a squared timber post under a shingle cap, on a footing of stones, with the town's
 * count carved down its face (three fives and a five still being cut) and a tag on a peg.
 */
export function tallyPost(): Sprite {
  const { c, g } = makeCanvas(26, 52);
  // The footing.
  R(g, 4, 46, 18, 6, STONE[1]);
  R(g, 4, 46, 18, 1, STONE[3]);
  R(g, 5, 49, 7, 1, STONE[0]);
  R(g, 14, 48, 6, 1, STONE[0]);
  // The post: a lit edge, its face, a shadowed side.
  R(g, 7, 9, 12, 38, BARK[1]);
  R(g, 7, 9, 1, 38, BARK[3]);
  R(g, 8, 12, 9, 33, BARK[2]);
  R(g, 17, 9, 2, 38, BARK[0]);
  notches(g, 9, 15, 5);
  notches(g, 9, 23, 5);
  notches(g, 9, 31, 5);
  notches(g, 9, 39, 2);
  // A brass band under the cap.
  R(g, 6, 10, 14, 2, GOLD[0]);
  R(g, 6, 10, 14, 1, GOLD[1]);
  // The cap, as the quest board's roof.
  shingles(g, 1, 1, 24, 9, (r) => Math.round((9 - r) * 0.35), [SKY[0], SKY[1], SKY[2], SKY[3]], 11);
  R(g, 4, 0, 18, 1, BARK[3]);
  // A peg and the tag hung on it, with the town's gold dot.
  R(g, 19, 19, 3, 1, BARK[3]);
  R(g, 21, 20, 1, 2, BARK[0]);
  R(g, 19, 22, 6, 7, BARK[3]);
  R(g, 19, 22, 6, 1, BARK[4]);
  R(g, 21, 24, 2, 2, GOLD[1]);
  R(g, 19, 28, 6, 1, BARK[1]);
  return spr(c, 13, 52);
}

/** The figures 1 to 3, carved into a plinth's plate. */
const FIGURES: Readonly<Record<number, readonly string[]>> = {
  1: [".k.", "kk.", ".k.", ".k.", "kkk"],
  2: ["kk.", "..k", ".k.", "k..", "kkk"],
  3: ["kk.", "..k", ".k.", "..k", "kk."],
};

/** How tall each place's plinth stands, in pixels: the first highest. */
const HEIGHT: Readonly<Record<number, number>> = { 1: 29, 2: 22, 3: 16 };

/** A plinth of the podium for a place, 1 to 3: a block of timber, and on its brass plate the place. The first's has a gold edge. */
export function plinth(place: 1 | 2 | 3): HTMLCanvasElement {
  const h = HEIGHT[place] ?? 16;
  const { c, g } = makeCanvas(40, h);
  R(g, 0, 0, 40, h, BARK[1]);
  R(g, 0, 0, 40, 3, place === 1 ? GOLD[1] : BARK[3]);
  R(g, 0, 3, 40, 1, BARK[0]);
  for (const x of [9, 30]) R(g, x, 4, 1, h - 4, BARK[0]);
  R(g, 0, h - 1, 40, 1, BARK[0]);
  // The plate, with its two nails.
  R(g, 14, 5, 12, 8, place === 1 ? GOLD[2] : GOLD[1]);
  R(g, 14, 12, 12, 1, GOLD[0]);
  R(g, 15, 6, 1, 1, CREAM);
  R(g, 24, 6, 1, 1, CREAM);
  g.drawImage(bitmap(FIGURES[place] ?? [], PAL), 19, 7);
  return outlined(c, INK);
}
