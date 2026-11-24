/**
 * The Tally's pictures: its board in town, built as the quest board is, and the three plinths of a
 * board's podium in its panel. Drawn once, in the town's own timber, brass and shingles.
 */

import { BARK, CREAM, GOLD, INK, SKY, STONE } from "@sequoia-leaf/kit/palette.ts";
import { bitmap, outlined, R } from "@sequoia-leaf/kit/pix.ts";
import { makeCanvas } from "@sequoia-leaf/kit/util.ts";

import { BOARD_H, BOARD_W, noticeBoard, PAL, PAPER_EDGE, spr, type Sprite } from "./sprites.ts";

/** A medal's rim and face, by place. */
const MEDALS: Readonly<Record<1 | 2 | 3, readonly [string, string]>> = {
  1: [GOLD[0], GOLD[2]],
  2: [STONE[1], STONE[3]],
  3: [BARK[3], GOLD[0]],
};

/** The top three's papers, left to right, standing on one line as a podium: where each begins and its place. */
const PAPERS: readonly { place: 1 | 2 | 3; x: number; y: number }[] = [
  { place: 2, x: 5, y: 16 },
  { place: 1, x: 17, y: 13 },
  { place: 3, x: 29, y: 19 },
];
const PAPER_W = 10;
/** The row under the papers' lower edges. */
const PAPERS_FOOT = 29;

/**
 * The Tally: a notice board like the quest board, with the top three pinned to it as a podium,
 * the first in the middle and tallest. Each paper has its medal (gold, silver, bronze) and a name.
 */
export function tallyBoard(): Sprite {
  const { c, g } = makeCanvas(BOARD_W, BOARD_H);
  noticeBoard(g, 11);
  for (const { place, x, y } of PAPERS) {
    R(g, x, y, PAPER_W, PAPERS_FOOT - y, CREAM);
    R(g, x, PAPERS_FOOT - 1, PAPER_W, 1, PAPER_EDGE);
    R(g, x + PAPER_W / 2, y, 1, 1, SKY[5]);
    const [rim, face] = MEDALS[place];
    const mx = x + 3;
    const my = y + 2;
    R(g, mx + 1, my, 2, 4, rim);
    R(g, mx, my + 1, 4, 2, rim);
    R(g, mx + 1, my + 1, 2, 2, face);
    for (let k = 0; my + 5 + k * 2 < PAPERS_FOOT - 2; k++)
      R(g, x + 2, my + 5 + k * 2, PAPER_W - 4 - (k % 2) * 2, 1, BARK[4]);
  }
  return spr(c, BOARD_W / 2, BOARD_H);
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
