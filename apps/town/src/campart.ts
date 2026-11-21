/**
 * Everything in a camp that is drawn once and kept: the cabin, every thing in the catalogue each
 * way round it can stand, the pets, and the small pictures for the camp's buttons. Drawn in the
 * town's way: from the kit's colours, lit from the upper left, with a dark edge.
 */

import { BARK, CREAM, EARTH, GOLD, GREEN, INK, PAPER, SKY, STONE, WATER } from "@sequoia-leaf/kit/palette.ts";
import { bitmap, ell, flipped, outlined, R } from "@sequoia-leaf/kit/pix.ts";
import { type Ctx, hash, makeCanvas, must } from "@sequoia-leaf/kit/util.ts";

import type { PetId } from "./camp.ts";
import { drawFern } from "./ground.ts";
import {
  bush,
  lantern,
  PAL,
  rock,
  shingles,
  spr,
  type Sprite,
  type Sprites,
  stall,
  stones,
  windowLit,
} from "./sprites.ts";
import { THINGS } from "./things.ts";

/** The town's letters, and a few more the camp's things want. */
const P: Readonly<Record<string, string>> = {
  ...PAL,
  z: BARK[0],
  x: STONE[0],
  e: EARTH[1],
  E: EARTH[2],
  f: EARTH[0],
  q: WATER[1],
  Q: WATER[0],
  h: SKY[1],
  H: SKY[0],
  i: "#ffffff",
  j: "#f3ede0",
  J: "#cfc6d6",
  a: "#ef9a3c",
  A: "#c76e2a",
  m: "#f4a08c",
  M: "#e88fb4",
  D: "#7d3340",
  L: "#c9ef9a",
};

const g2 = (c: HTMLCanvasElement): Ctx => must(c.getContext("2d"), "2d context");

/** A picture with its dark edge, standing on the middle of its bottom row. */
const stood = (c: HTMLCanvasElement): Sprite => spr(c, Math.floor(c.width / 2), c.height);
/** The same with no edge, for what is painted on the ground. */
const laid = (c: HTMLCanvasElement): Sprite => ({ c, ax: Math.floor(c.width / 2), ay: c.height });
const rows = (lines: readonly string[]): Sprite => stood(bitmap(lines, P));
const mirror = (s: Sprite): Sprite => ({ c: flipped(s.c), ax: s.c.width - s.ax, ay: s.ay });
const both = (s: Sprite): Sprite[][] => [[s], [mirror(s)]];

/** A picture turned a quarter, for things that lie flat. */
function quarter(src: HTMLCanvasElement): HTMLCanvasElement {
  const { c, g } = makeCanvas(src.height, src.width);
  g.translate(src.height, 0);
  g.rotate(Math.PI / 2);
  g.drawImage(src, 0, 0);
  return c;
}

// ---------- the cabin ----------

/** Roofs a cabin may have: shadow, two body tones, light. Somebody else's is chosen by their camp. */
const ROOFS: readonly (readonly [string, string, string, string])[] = [
  [GREEN[0], GREEN[1], GREEN[2], GREEN[3]],
  [SKY[0], SKY[1], SKY[2], SKY[3]],
  [BARK[0], BARK[2], BARK[3], BARK[4]],
  ["#7d3340", "#b0483a", SKY[5], "#f4a08c"],
];

function cabin(roof: number): Sprite {
  const { c, g } = makeCanvas(80, 76);
  // Walls of whole logs, lying on a footing of stone.
  for (let i = 0; i < 6; i++) {
    const y = 40 + i * 5;
    R(g, 4, y, 72, 5, i % 2 ? BARK[2] : BARK[3]);
    R(g, 4, y, 72, 1, BARK[4]);
    R(g, 4, y + 4, 72, 1, BARK[1]);
    for (let k = 0; k < 6; k++) {
      const x = 8 + Math.floor(hash(i, k, 71) * 62);
      R(g, x, y + 2, 3, 1, BARK[1]);
    }
    // The log ends at the corners.
    for (const x of [2, 74]) {
      R(g, x, y, 4, 5, BARK[1]);
      R(g, x, y + 1, 4, 3, GOLD[0]);
      R(g, x + 1, y + 2, 2, 1, BARK[4]);
    }
  }
  stones(g, 3, 70, 74, 6, 31);
  R(g, 3, 70, 74, 1, STONE[3]);

  // The window, lit, with a box of flowers under it.
  windowLit(g, 16, 49, 13, 12);
  R(g, 14, 63, 17, 3, BARK[1]);
  R(g, 14, 63, 17, 1, BARK[3]);
  for (let i = 0; i < 5; i++) {
    R(g, 15 + i * 3, 61, 2, 2, GREEN[3]);
    R(g, 15 + i * 3, 60, 2, 1, i % 2 ? SKY[4] : CREAM);
  }

  // The door, a little to the right, with a step and a lantern by it.
  R(g, 49, 46, 14, 30, BARK[0]);
  R(g, 50, 47, 12, 29, BARK[3]);
  for (const x of [53, 57]) R(g, x, 47, 1, 29, BARK[1]);
  R(g, 50, 47, 12, 1, BARK[4]);
  R(g, 53, 51, 6, 6, BARK[0]);
  R(g, 54, 52, 4, 4, GOLD[1]);
  R(g, 54, 52, 2, 2, GOLD[2]);
  R(g, 59, 63, 2, 2, GOLD[2]);
  R(g, 47, 74, 18, 2, STONE[3]);
  R(g, 47, 75, 18, 1, STONE[1]);
  lantern(g, 42, 51);
  R(g, 68, 52, 5, 6, BARK[0]);
  R(g, 69, 53, 3, 4, GOLD[1]);

  // The chimney behind the roof, and the roof.
  stones(g, 12, 2, 11, 16, 33);
  R(g, 10, 0, 15, 3, STONE[0]);
  R(g, 10, 0, 15, 1, STONE[2]);
  const cols = ROOFS[roof % ROOFS.length] ?? ROOFS[0];
  if (cols) shingles(g, 0, 10, 80, 30, (r) => Math.round((30 - r) * 0.3), cols, 5 + roof);
  R(g, 9, 7, 62, 3, BARK[1]);
  R(g, 9, 7, 62, 1, BARK[3]);
  R(g, 0, 39, 80, 1, cols?.[0] ?? INK);
  R(g, 4, 40, 72, 1, BARK[0]);
  // A leaf over the door.
  g.drawImage(bitmap(["...ll", ".lllG", "lllG.", "llG..", "G...."], PAL), 54, 41);
  return stood(c);
}

// ---------- what a camp starts with ----------

const MAILBOX = [
  ".RRRRRR.",
  "RrrrrrrR",
  "RrwwwwrR",
  "RrrrrrrR",
  "RRRRRRRD",
  "...nb...",
  "...nb...",
  "...nb...",
  "...nb...",
  "...nb...",
  "..snbs..",
];

function shelf(): Sprite {
  const { c, g } = makeCanvas(24, 27);
  R(g, 0, 2, 24, 25, BARK[1]);
  R(g, 2, 4, 20, 21, "#2b141d");
  R(g, 0, 0, 24, 3, BARK[3]);
  R(g, 0, 0, 24, 1, BARK[4]);
  for (const y of [13, 24]) {
    R(g, 1, y, 22, 2, BARK[3]);
    R(g, 1, y, 22, 1, BARK[4]);
  }
  R(g, 0, 2, 2, 25, BARK[2]);
  R(g, 22, 2, 2, 25, BARK[0]);
  return stood(c);
}

/** Where a trophy stands on the shelf, from the shelf's foot: five on the upper board, five on the lower. */
export const SHELF_SLOTS: readonly (readonly [number, number])[] = [
  [-10, -14],
  [-5, -14],
  [0, -14],
  [5, -14],
  [-8, -3],
  [-2, -3],
  [4, -3],
];

function logSeat(): Sprite[][] {
  const h = makeCanvas(32, 10);
  R(h.g, 2, 4, 29, 5, BARK[2]);
  R(h.g, 3, 9, 27, 1, BARK[0]);
  R(h.g, 2, 0, 29, 4, BARK[3]);
  for (let i = 0; i < 6; i++) {
    R(h.g, 6 + i * 4 + (i % 2), 1 + (i % 3), 3, 1, BARK[4]);
    R(h.g, 7 + i * 4, 5 + ((i * 2) % 3), 2, 1, BARK[1]);
  }
  R(h.g, 30, 1, 1, 7, BARK[1]);
  ell(h.g, 3, 4.5, 3, 4.5, GOLD[0]);
  ell(h.g, 3, 4.5, 1.6, 2.6, BARK[4]);
  const v = makeCanvas(10, 34);
  R(v.g, 1, 1, 8, 29, BARK[3]);
  R(v.g, 1, 1, 2, 29, BARK[4]);
  R(v.g, 7, 1, 2, 29, BARK[2]);
  R(v.g, 2, 0, 6, 1, BARK[2]);
  for (let i = 0; i < 6; i++) {
    R(v.g, 3 + (i % 3), 4 + i * 4, 1, 3, BARK[1]);
    R(v.g, 5 + (i % 2), 3 + i * 4, 1, 2, BARK[4]);
  }
  ell(v.g, 5, 30.5, 4.4, 3.4, GOLD[0]);
  ell(v.g, 5, 30.5, 2.4, 1.6, BARK[4]);
  R(v.g, 4, 30, 2, 1, BARK[2]);
  return [[stood(h.c)], [stood(v.c)]];
}

// ---------- seats ----------

function hammock(): Sprite {
  const { c, g } = makeCanvas(32, 17);
  for (const x of [1, 28]) {
    R(g, x, 0, 3, 17, BARK[2]);
    R(g, x, 0, 1, 17, BARK[4]);
    R(g, x + 2, 0, 1, 17, BARK[1]);
  }
  for (let x = 4; x < 28; x++) {
    const k = (x - 16) / 12;
    const y = Math.round(10 - k * k * 6);
    R(g, x, y, 1, 4, Math.floor(x / 3) % 2 ? CREAM : SKY[5]);
    R(g, x, y + 3, 1, 1, Math.floor(x / 3) % 2 ? "#cbb894" : "#b0483a");
  }
  return stood(c);
}

const CUSHION = [".ppppyyy.", "pppppyyyy", "ppMppyYyy", "vvvvvrrrr", "vvVvvrmrr", ".vvvvrrr."];

const ROCKER = [
  ".b.........",
  ".bn........",
  ".bNNNn.....",
  ".bnnnn.....",
  ".bNNNn.....",
  ".bnnnn.....",
  ".bnnnnnnnn.",
  ".bBBBBBBBB.",
  ".b.......b.",
  ".b.......b.",
  "b.........b",
  "bb.......bb",
  "..bbbbbbb..",
];

function picnic(): Sprite {
  const { c, g } = makeCanvas(26, 18);
  for (const x of [3, 21]) R(g, x, 9, 2, 8, BARK[1]);
  R(g, 1, 3, 24, 7, BARK[3]);
  R(g, 1, 3, 24, 1, BARK[4]);
  R(g, 1, 9, 24, 1, BARK[1]);
  for (const x of [7, 13, 19]) R(g, x, 4, 1, 5, BARK[2]);
  // The near bench.
  R(g, 0, 13, 26, 3, BARK[3]);
  R(g, 0, 13, 26, 1, BARK[4]);
  R(g, 0, 15, 26, 1, BARK[1]);
  for (const x of [2, 22]) R(g, x, 16, 2, 2, BARK[1]);
  // A plate, a pie, and the crumb.
  ell(g, 7, 6, 3, 1.6, CREAM);
  ell(g, 17, 5.5, 3.4, 2, GOLD[0]);
  R(g, 15, 4, 4, 1, GOLD[2]);
  R(g, 11, 7, 1, 1, GOLD[2]);
  return stood(c);
}

function throne(): Sprite {
  const { c, g } = makeCanvas(18, 20);
  // The back is the crab itself, with its eyes on stalks.
  R(g, 5, 0, 1, 3, "#b0483a");
  R(g, 12, 0, 1, 3, "#b0483a");
  R(g, 4, 0, 2, 2, CREAM);
  R(g, 12, 0, 2, 2, CREAM);
  R(g, 5, 0, 1, 1, INK);
  R(g, 12, 0, 1, 1, INK);
  ell(g, 9, 8, 6.5, 5.5, SKY[5]);
  ell(g, 9, 9, 6.5, 4.5, "#b0483a");
  ell(g, 8, 7, 4.6, 3.4, SKY[5]);
  R(g, 5, 5, 3, 1, "#f4a08c");
  // The claws are its arms.
  for (const [x, flip] of [
    [0, 1],
    [14, -1],
  ] as const) {
    R(g, x, 9, 4, 5, SKY[5]);
    R(g, x + (flip > 0 ? 0 : 3), 8, 1, 2, SKY[5]);
    R(g, x + (flip > 0 ? 3 : 0), 8, 1, 2, SKY[5]);
    R(g, x + 1, 9, 2, 2, "#2b141d");
    R(g, x, 13, 4, 1, "#b0483a");
  }
  // The seat, and the legs.
  R(g, 3, 13, 12, 3, GOLD[1]);
  R(g, 3, 13, 12, 1, GOLD[2]);
  R(g, 3, 15, 12, 1, GOLD[0]);
  for (const x of [3, 7, 10, 14]) R(g, x, 16, 1, 4, "#b0483a");
  return stood(c);
}

// ---------- lights ----------

/** The colours a paper lantern, a pennant or a pane of glass can be asked to be: body, then heart. */
export const HUES: readonly (readonly [string, string])[] = [
  [GOLD[1], GOLD[2]],
  [SKY[5], GOLD[1]],
  [SKY[4], "#f4a08c"],
  [WATER[2], WATER[3]],
  [GREEN[4], "#c9ef9a"],
];

function paperLantern(col: string, core: string): Sprite {
  const { c, g } = makeCanvas(10, 19);
  R(g, 1, 2, 1, 16, BARK[2]);
  R(g, 1, 2, 6, 1, BARK[2]);
  R(g, 0, 18, 3, 1, STONE[1]);
  R(g, 6, 3, 1, 1, BARK[0]);
  R(g, 4, 4, 5, 1, BARK[1]);
  R(g, 3, 5, 7, 6, col);
  R(g, 4, 5, 5, 6, core);
  R(g, 5, 6, 2, 4, CREAM);
  R(g, 4, 11, 5, 1, BARK[1]);
  R(g, 6, 12, 1, 2, col);
  return stood(c);
}

function candles(): Sprite {
  const { c, g } = makeCanvas(12, 16);
  R(g, 1, 9, 10, 6, BARK[2]);
  R(g, 0, 14, 12, 2, BARK[1]);
  for (const x of [3, 6, 9]) R(g, x, 11, 1, 4, BARK[1]);
  ell(g, 6, 8.5, 5.6, 3.6, BARK[4]);
  ell(g, 6, 8.5, 3.6, 2.2, GOLD[0]);
  // Three candles; one is always shorter.
  for (const [x, h] of [
    [3, 6],
    [6, 4],
    [8, 5],
  ] as const) {
    R(g, x, 9 - h, 2, h, CREAM);
    R(g, x + 1, 9 - h, 1, h, "#cbb894");
  }
  return stood(c);
}
/** Where each candle's wick is, from the stump's foot. */
export const WICKS: readonly (readonly [number, number])[] = [
  [-3, -14],
  [0, -12],
  [2, -13],
];

const FIREFLY_LAMP = [
  "..nnnnn..",
  ".UQQQQQU.",
  "UQQQQQQQU",
  "UQQQQQQQU",
  "UQQQQQQQU",
  "UQQQQQQQU",
  ".UUUUUUU.",
  "...bnb...",
  "....n....",
  "....n....",
  "....n....",
  "....n....",
  "....n....",
  "...snb...",
];

const BRAZIER = [
  ".x.......x.",
  "xsrryYyrrsx",
  "xsSrryrrSsx",
  ".xsSSSSSsx.",
  "..xsssssx..",
  "....zbz....",
  "...z.b.z...",
  "..z..b..z..",
  "..z..b..z..",
];

const GLOWCAP = [
  "...UUUUU...",
  ".UUiUUUUUU.",
  "UUUUUUiiUUU",
  "UiiUUUUUUUU",
  "UUUUUUUUiUu",
  "uuuuuuuuuuu",
  "..qcCcCcq..",
  "....ccc....",
  "....ccC....",
  "....ccC....",
  "...cccCC...",
];

function hookLantern(): Sprite {
  const { c, g } = makeCanvas(11, 21);
  R(g, 2, 2, 1, 18, BARK[1]);
  R(g, 2, 1, 7, 1, BARK[1]);
  R(g, 8, 2, 1, 2, BARK[0]);
  R(g, 1, 20, 3, 1, STONE[1]);
  lantern(g, 6, 4);
  return stood(c);
}

function glassLantern(a: string, b: string): Sprite {
  const { c, g } = makeCanvas(9, 21);
  R(g, 4, 11, 1, 9, STONE[0]);
  R(g, 2, 20, 5, 1, STONE[1]);
  R(g, 3, 10, 3, 1, STONE[1]);
  R(g, 3, 0, 3, 1, STONE[0]);
  R(g, 1, 1, 7, 1, STONE[0]);
  R(g, 1, 2, 7, 7, STONE[0]);
  R(g, 2, 2, 2, 6, a);
  R(g, 5, 2, 2, 6, b);
  R(g, 2, 2, 1, 2, CREAM);
  R(g, 1, 9, 7, 1, STONE[1]);
  return stood(c);
}

/** Two poles for a line to hang between: across, or one behind the other. */
function poles(tall: number, span: number): Sprite[][] {
  const h = makeCanvas(span, tall);
  for (const x of [1, span - 3]) {
    R(h.g, x, 0, 2, tall, BARK[2]);
    R(h.g, x, 0, 1, tall, BARK[4]);
    R(h.g, x - 1, tall - 1, 4, 1, STONE[1]);
  }
  const v = makeCanvas(4, span + tall - 8);
  for (const y of [0, span - 8]) {
    R(v.g, 1, y, 2, tall, BARK[2]);
    R(v.g, 1, y, 1, tall, BARK[4]);
    R(v.g, 0, y + tall - 1, 4, 1, STONE[1]);
  }
  return [[stood(h.c)], [stood(v.c)]];
}

// ---------- flags ----------

function pennant(col: string, dark: string): Sprite {
  const { c, g } = makeCanvas(13, 25);
  R(g, 1, 1, 2, 23, BARK[3]);
  R(g, 1, 1, 1, 23, BARK[4]);
  R(g, 0, 24, 4, 1, STONE[1]);
  R(g, 0, 0, 4, 1, GOLD[1]);
  for (let i = 0; i < 7; i++) {
    const w = 10 - Math.abs(3 - i) * 3;
    R(g, 3, 2 + i, w, 1, i > 3 ? dark : col);
  }
  return stood(c);
}

function banner(tall: boolean): Sprite {
  const h = tall ? 34 : 26;
  const { c, g } = makeCanvas(14, h);
  const cloth = tall ? SKY[2] : SKY[4];
  const shade = tall ? SKY[1] : "#9c3f73";
  R(g, 6, 1, 2, h - 2, BARK[2]);
  R(g, 6, 1, 1, h - 2, BARK[4]);
  R(g, 4, h - 1, 6, 1, STONE[1]);
  R(g, 5, 0, 4, 2, GOLD[1]);
  R(g, 1, 3, 12, 1, GOLD[0]);
  const drop = tall ? 20 : 13;
  R(g, 2, 4, 10, drop, cloth);
  R(g, 10, 4, 2, drop, shade);
  for (let k = 0; k < 3; k++) {
    R(g, 2, 4 + drop + k, 4 - k, 1, cloth);
    R(g, 8 + k, 4 + drop + k, 4 - k, 1, shade);
  }
  R(g, 2, 4, 1, drop + 3, GOLD[0]);
  R(g, 11, 4, 1, drop + 3, GOLD[0]);
  // The guild's sun.
  const sy = tall ? 10 : 8;
  R(g, 5, sy, 4, 4, GOLD[1]);
  R(g, 6, sy + 1, 2, 2, CREAM);
  for (const [dx, dy] of [
    [1, -2],
    [1, 5],
    [-2, 1],
    [5, 1],
  ] as const)
    R(g, 5 + dx, sy + dy, 2, 1, GOLD[1]);
  if (tall) for (let y = 17; y < 23; y += 2) R(g, 4, y, 6, 1, GOLD[0]);
  return stood(c);
}

function windsock(): Sprite {
  const { c, g } = makeCanvas(14, 23);
  R(g, 1, 1, 2, 21, BARK[3]);
  R(g, 1, 1, 1, 21, BARK[4]);
  R(g, 0, 22, 4, 1, STONE[1]);
  for (let x = 0; x < 11; x++) {
    const tall = 6 - Math.floor(x / 3);
    const y = 2 + Math.floor(x / 4);
    R(g, 3 + x, y, 1, tall, Math.floor(x / 2) % 2 ? CREAM : SKY[5]);
    R(g, 3 + x, y + tall - 1, 1, 1, Math.floor(x / 2) % 2 ? "#cbb894" : "#b0483a");
  }
  return stood(c);
}

/** The vane as it is seen while it turns: face on, and edge on. */
function vane(edge: boolean): Sprite {
  const { c, g } = makeCanvas(13, 23);
  R(g, 6, 8, 1, 14, STONE[0]);
  R(g, 4, 22, 5, 1, STONE[1]);
  R(g, 5, 12, 3, 1, STONE[1]);
  if (edge) {
    R(g, 6, 1, 1, 8, GOLD[0]);
    R(g, 5, 3, 3, 3, GOLD[1]);
  } else {
    R(g, 0, 8, 13, 1, STONE[1]);
    R(g, 11, 7, 2, 3, STONE[2]);
    g.drawImage(bitmap(["yy.....yy", "y.Y...Y.y", ".yyyyyyy.", "yyyyyyyyy", ".oyyyyyo.", "o.o...o.o"], P), 2, 1);
  }
  return stood(c);
}

// ---------- plants ----------

const FLOWER_POT = [
  ".p...p..",
  "pyp.pwp.",
  ".p.G.p..",
  "..GGGG..",
  ".RRRRRR.",
  ".rrrrrR.",
  ".rrrrrR.",
  "..rrrR..",
  "..rrrR..",
];

function pottedFern(): Sprite {
  const { c, g } = makeCanvas(16, 15);
  drawFern(g, 8, 9, 9, [GREEN[3], GREEN[4], GREEN[3]], 78);
  drawFern(g, 8, 10, 6, [GREEN[4], GREEN[3]], 77);
  R(g, 4, 9, 8, 1, "#b0483a");
  R(g, 4, 10, 8, 3, SKY[5]);
  R(g, 5, 13, 6, 2, SKY[5]);
  R(g, 10, 10, 2, 3, "#b0483a");
  R(g, 10, 13, 1, 2, "#b0483a");
  return stood(c);
}

const TOADSTOOL = [
  "....rrrrr....",
  "..rrrwwrrrr..",
  ".rrrrwwrrrrr.",
  "rrwrrrrrrwwrr",
  "rrrrrrrrrwwrr",
  "rwwrrrrrrrrrr",
  "RRRRRRRRRRRRR",
  "...CcCcCcC...",
  ".....ccc.....",
  ".....ccC.....",
  ".....ccC.....",
  ".....ccC.....",
  "....cccCC....",
];
const MUSHLET = [".rrrr.", "rwrrrr", "RRRRRR", "..cC..", "..cC..", ".ccCC."];

function fairyRing(): Sprite {
  const { c, g } = makeCanvas(24, 16);
  const small = outlined(bitmap(MUSHLET, P), INK);
  const at: readonly (readonly [number, number])[] = [
    [8, 0],
    [15, 1],
    [0, 4],
    [17, 6],
    [3, 9],
    [11, 9],
  ];
  for (const [x, y] of at) g.drawImage(small, x, y - 1);
  return laid(c);
}

const SUNFLOWER = [
  "..yyyyy..",
  ".yYbbbYy.",
  "yYbBnBbYy",
  "yYbnBnbYy",
  "yYbBnBbYy",
  ".yYbbbYy.",
  "..yyGyy..",
  "....G....",
  "....G.ll.",
  ".ll.Glll.",
  ".lllGl...",
  "...lG....",
  "....G....",
  "....G....",
  "....G....",
  "....G....",
];

function berryBush(): Sprite {
  const b = bush(18, 12, 307);
  const g = g2(b.c);
  for (const [x, y] of [
    [5, 5],
    [12, 4],
    [14, 8],
    [8, 9],
  ] as const) {
    R(g, x, y, 2, 2, SKY[5]);
    R(g, x, y, 1, 1, "#f4a08c");
  }
  return b;
}

function sapling(): Sprite {
  const { c, g } = makeCanvas(13, 27);
  R(g, 6, 14, 1, 8, BARK[1]);
  for (let tier = 0; tier < 4; tier++) {
    const top = 1 + tier * 4;
    for (let r = 0; r < 6; r++) {
      const half = Math.round((r + 1) * (0.55 + tier * 0.17));
      R(g, 6 - half, top + r, half * 2 + 1, 1, r > 3 ? GREEN[1] : GREEN[2]);
      R(g, 6 - half, top + r, Math.max(1, half - 1), 1, r > 3 ? GREEN[2] : GREEN[3]);
    }
  }
  R(g, 6, 0, 1, 2, GREEN[3]);
  // The tub.
  R(g, 2, 21, 9, 6, BARK[3]);
  R(g, 2, 21, 9, 1, BARK[4]);
  R(g, 2, 23, 9, 1, STONE[1]);
  R(g, 9, 21, 2, 6, BARK[1]);
  R(g, 3, 26, 7, 1, BARK[1]);
  return stood(c);
}

const PUMPKIN = [
  "....GG....",
  "...lG.....",
  ".AaaaaaaA.",
  "AaaYaaaaAA",
  "AaYYaaaaaA",
  "AaaYaaaaAA",
  "AAaaaaaaAA",
  ".AAaaAaAA.",
];

function flowerBed(): Sprite {
  const { c, g } = makeCanvas(18, 11);
  R(g, 0, 5, 18, 6, BARK[3]);
  R(g, 0, 5, 18, 1, BARK[4]);
  R(g, 0, 10, 18, 1, BARK[1]);
  for (const x of [5, 11]) R(g, x, 6, 1, 4, BARK[1]);
  R(g, 1, 4, 16, 1, EARTH[0]);
  const petals = [SKY[4], CREAM, GOLD[1], SKY[5], CREAM, SKY[4]];
  petals.forEach((col, i) => {
    const x = 1 + i * 3;
    R(g, x, 2 + (i % 2), 2, 3 - (i % 2), GREEN[3]);
    R(g, x, i % 2, 2, 2, col);
  });
  return stood(c);
}

const WORM_POT = [
  "........",
  "........",
  "........",
  ".ffffff.",
  ".RRRRRR.",
  ".rrrrrR.",
  ".rrrrrR.",
  "..rrrR..",
  "..rrrR..",
];
const WORM_OUT = [
  "...MM...",
  "..MkMM..",
  "..MMM...",
  ".ffMMff.",
  ".RRRRRR.",
  ".rrrrrR.",
  ".rrrrrR.",
  "..rrrR..",
  "..rrrR..",
];

// ---------- fences and paths ----------

function picket(): Sprite[][] {
  const h = bitmap(
    [
      ".c...c...c...c..",
      "ccc.ccc.ccc.ccc.",
      "cwc.cwc.cwc.cwc.",
      "CCCCCCCCCCCCCCCC",
      "cwc.cwc.cwc.cwc.",
      "cwc.cwc.cwc.cwc.",
      "CCCCCCCCCCCCCCCC",
      "cwc.cwc.cwc.cwc.",
      "ccC.ccC.ccC.ccC.",
    ],
    P,
  );
  const v = makeCanvas(5, 25);
  R(v.g, 2, 3, 1, 19, "#cbb894");
  for (const y of [0, 8, 16]) {
    R(v.g, 1, y + 1, 3, 8, "#e9d8b8");
    R(v.g, 2, y, 1, 1, "#e9d8b8");
    R(v.g, 2, y + 1, 1, 7, CREAM);
    R(v.g, 3, y + 2, 1, 7, "#cbb894");
  }
  return [[stood(h)], [stood(v.c)]];
}

function railFence(): Sprite[][] {
  const h = makeCanvas(16, 10);
  for (const y of [2, 5]) {
    R(h.g, 0, y, 16, 2, BARK[3]);
    R(h.g, 0, y, 16, 1, BARK[4]);
  }
  for (const x of [1, 12]) {
    R(h.g, x, 0, 3, 10, BARK[2]);
    R(h.g, x, 0, 3, 1, BARK[4]);
    R(h.g, x + 2, 1, 1, 9, BARK[1]);
  }
  const v = makeCanvas(5, 25);
  R(v.g, 1, 4, 1, 14, BARK[4]);
  R(v.g, 3, 5, 1, 14, BARK[3]);
  for (const y of [0, 15]) {
    R(v.g, 1, y, 3, 10, BARK[2]);
    R(v.g, 1, y, 3, 1, BARK[4]);
    R(v.g, 3, y + 1, 1, 9, BARK[1]);
  }
  return [[stood(h.c)], [stood(v.c)]];
}

function wall(): Sprite[][] {
  const h = makeCanvas(16, 9);
  stones(h.g, 0, 0, 16, 9, 41);
  R(h.g, 0, 0, 16, 1, STONE[3]);
  const v = makeCanvas(7, 23);
  stones(v.g, 0, 0, 7, 23, 43);
  R(v.g, 0, 0, 7, 1, STONE[3]);
  R(v.g, 0, 0, 1, 23, STONE[3]);
  return [[stood(h.c)], [stood(v.c)]];
}

function arch(): Sprite {
  const { c, g } = makeCanvas(26, 31);
  for (const x of [1, 22]) {
    R(g, x, 9, 3, 22, BARK[2]);
    R(g, x, 9, 1, 22, BARK[4]);
    R(g, x + 2, 9, 1, 22, BARK[1]);
    R(g, x - 1, 29, 5, 2, STONE[1]);
  }
  for (let i = 0; i < 4; i++) {
    R(g, 4 + i, 13 - i, 1, 2, BARK[1]);
    R(g, 21 - i, 13 - i, 1, 2, BARK[1]);
  }
  R(g, 0, 7, 26, 3, BARK[1]);
  R(g, 0, 7, 26, 1, BARK[3]);
  shingles(g, 0, 1, 26, 6, (r) => Math.round((6 - r) * 0.7), [SKY[0], SKY[1], SKY[2], SKY[3]], 13);
  R(g, 4, 0, 18, 1, BARK[3]);
  R(g, 12, 10, 1, 2, BARK[0]);
  R(g, 11, 12, 3, 3, GOLD[1]);
  R(g, 12, 15, 1, 1, GOLD[0]);
  return stood(c);
}

function steppingStones(): Sprite[][] {
  const { c, g } = makeCanvas(16, 8);
  for (const [x, y, rx, ry] of [
    [3, 4, 2.8, 2.2],
    [8, 3, 2.4, 1.9],
    [13, 5, 2.6, 2.1],
  ] as const) {
    ell(g, x, y + 0.6, rx, ry, STONE[0]);
    ell(g, x, y, rx, ry, STONE[2]);
    R(g, x - 1, y - 1, 2, 1, STONE[3]);
  }
  return [[laid(c)], [laid(quarter(c))]];
}

function plankPath(): Sprite[][] {
  const { c, g } = makeCanvas(16, 8);
  R(g, 0, 1, 16, 7, BARK[1]);
  for (let i = 0; i < 4; i++) {
    const short = i % 2;
    R(g, i * 4, short, 3, 8 - short, i % 2 ? BARK[3] : BARK[4]);
    R(g, i * 4, 7, 3, 1, BARK[2]);
    R(g, i * 4 + 1, 2 + short, 1, 1, BARK[1]);
    R(g, i * 4 + 1, 5, 1, 1, BARK[1]);
  }
  return [[laid(c)], [laid(quarter(c))]];
}

function doormat(): Sprite {
  const { c, g } = makeCanvas(16, 8);
  R(g, 0, 0, 16, 8, EARTH[2]);
  R(g, 1, 1, 14, 6, EARTH[1]);
  for (let x = 0; x < 16; x += 2) {
    R(g, x, 0, 1, 1, EARTH[0]);
    R(g, x + 1, 7, 1, 1, EARTH[0]);
  }
  g.drawImage(bitmap(["r.....r", "r.r.r.r", ".rrrrr.", "rrrrrrr", ".r...r."], P), 4, 1);
  return stood(c);
}

// ---------- oddments ----------

function well(): Sprite {
  const { c, g } = makeCanvas(18, 29);
  for (const x of [1, 15]) {
    R(g, x, 6, 2, 14, BARK[2]);
    R(g, x, 6, 1, 14, BARK[4]);
  }
  R(g, 2, 9, 14, 1, BARK[1]);
  R(g, 9, 10, 1, 6, EARTH[2]);
  R(g, 7, 15, 5, 4, BARK[3]);
  R(g, 7, 15, 5, 1, BARK[4]);
  R(g, 7, 17, 5, 1, STONE[1]);
  shingles(g, 0, 0, 18, 7, (r) => Math.round((7 - r) * 0.5), [SKY[0], SKY[1], SKY[2], SKY[3]], 17);
  ell(g, 9, 19, 8.6, 4.2, STONE[1]);
  stones(g, 1, 19, 16, 9, 47);
  R(g, 0, 26, 1, 3, INK);
  ell(g, 9, 19, 8.6, 4.2, STONE[3]);
  ell(g, 9, 19.4, 6.4, 2.8, WATER[0]);
  R(g, 6, 19, 3, 1, WATER[2]);
  // Round the foot off.
  for (const x of [0, 17]) g.clearRect(x, 27, 1, 2);
  return stood(c);
}

function telescope(): Sprite {
  const { c, g } = makeCanvas(13, 17);
  for (let i = 0; i < 8; i++) {
    R(g, 6 - Math.round(i * 0.5), 9 + i, 1, 1, BARK[1]);
    R(g, 6 + Math.round(i * 0.5), 9 + i, 1, 1, BARK[1]);
    R(g, 6, 9 + i, 1, 1, BARK[2]);
  }
  for (let i = 0; i < 11; i++) {
    const y = 8 - Math.round(i * 0.6);
    R(g, 1 + i, y, 1, 3, i > 7 ? GOLD[0] : GOLD[1]);
    R(g, 1 + i, y, 1, 1, GOLD[2]);
  }
  R(g, 11, 1, 2, 4, CREAM);
  R(g, 0, 8, 1, 3, BARK[1]);
  return stood(c);
}

const GNOME = [
  "...R...",
  "..RRR..",
  "..RrR..",
  ".RRrRR.",
  ".ccccc.",
  ".ckckc.",
  ".wwwww.",
  ".wwwww.",
  ".uwwwu.",
  ".uuuuu.",
  ".uu.uu.",
  ".bb.bb.",
];
const GNOME_FISHING = [
  "...R......n.",
  "..RRR....n.k",
  "..RrR...n..k",
  ".RRrRR.n...k",
  ".ccccc.n...k",
  ".ckckcn....k",
  ".wwwwwn....k",
  ".wwwwcc....k",
  ".GwwwG.....r",
  ".GGGGG......",
  ".GG.GG......",
  ".bb.bb......",
];
const GNOME_NAPPING = [".R...........", "RRr..........", "RRRccc.......", ".RRckcwwuuubb", "..RcccwwuuuBb"];
const GNOME_TRAVELLER = [
  "...G......",
  "..GGG.....",
  "..GlG.....",
  ".GGlGG....",
  ".ccccc....",
  ".ckckc....",
  ".wwwww....",
  ".wwwww.nn.",
  ".ywwwynNNn",
  ".yyyyynNNn",
  ".yy.yynnnn",
  ".bb.bb....",
];

const CRAB_STATUE = [
  "tt.....tt",
  "t.t...t.t",
  ".SSSSSSS.",
  "SStSSStSS",
  ".sSSSSSs.",
  "s.s...s.s",
  ".ttttttt.",
  ".SSSSSSs.",
  "tSSSSSSSs",
];

function barrelOpen(base: Sprite): Sprite {
  const { c, g } = makeCanvas(12, 19);
  g.drawImage(base.c, 0, 4);
  // The lid, tipped back, and somebody looking out from under it.
  R(g, 1, 4, 10, 3, INK);
  R(g, 2, 5, 8, 2, "#2b141d");
  R(g, 3, 5, 2, 2, CREAM);
  R(g, 7, 5, 2, 2, CREAM);
  R(g, 4, 6, 1, 1, INK);
  R(g, 8, 6, 1, 1, INK);
  R(g, 1, 0, 10, 1, INK);
  R(g, 0, 1, 12, 3, INK);
  R(g, 1, 1, 10, 2, BARK[3]);
  R(g, 1, 1, 10, 1, BARK[4]);
  R(g, 10, 3, 2, 2, SKY[5]);
  return { c, ax: 6, ay: 19 };
}

function windChime(): Sprite {
  const { c, g } = makeCanvas(10, 21);
  R(g, 1, 2, 1, 18, BARK[1]);
  R(g, 1, 1, 6, 1, BARK[1]);
  R(g, 0, 20, 3, 1, STONE[1]);
  R(g, 6, 2, 1, 1, BARK[0]);
  R(g, 4, 3, 6, 1, GOLD[0]);
  return stood(c);
}
/** The chime's tubes, from its foot: how far along, and how long each hangs. */
export const TUBES: readonly (readonly [number, number])[] = [
  [-1, 6],
  [0, 8],
  [2, 5],
  [3, 7],
  [4, 4],
];

function musicBox(): Sprite {
  const { c, g } = makeCanvas(9, 14);
  R(g, 3, 9, 3, 4, BARK[1]);
  R(g, 1, 13, 7, 1, BARK[1]);
  R(g, 0, 5, 9, 4, BARK[3]);
  R(g, 0, 5, 9, 1, GOLD[1]);
  R(g, 0, 8, 9, 1, BARK[1]);
  R(g, 4, 6, 1, 2, GOLD[2]);
  R(g, 0, 0, 9, 5, BARK[2]);
  R(g, 1, 1, 7, 4, SKY[4]);
  R(g, 1, 1, 7, 1, "#9c3f73");
  // The dancer.
  R(g, 4, 2, 1, 1, CREAM);
  R(g, 3, 3, 3, 1, CREAM);
  R(g, 4, 4, 1, 1, GOLD[2]);
  return stood(c);
}

function birdBath(wren: boolean): Sprite {
  const { c, g } = makeCanvas(13, 15);
  R(g, 5, 6, 3, 7, STONE[2]);
  R(g, 5, 6, 1, 7, STONE[3]);
  R(g, 3, 13, 7, 2, STONE[1]);
  R(g, 3, 13, 7, 1, STONE[3]);
  ell(g, 6.5, 5, 6, 2.4, STONE[1]);
  ell(g, 6.5, 4.4, 6, 2.2, STONE[3]);
  ell(g, 6.5, 4.6, 4.4, 1.3, WATER[2]);
  R(g, 5, 4, 2, 1, WATER[3]);
  if (wren) g.drawImage(bitmap([".nn.", "nknc", "nnnc", ".o.."], P), 0, 0);
  return stood(c);
}

function rugWoven(): Sprite[][] {
  const { c, g } = makeCanvas(24, 16);
  R(g, 1, 1, 22, 14, "#b0483a");
  R(g, 2, 2, 20, 12, SKY[5]);
  R(g, 3, 3, 18, 10, "#b0483a");
  for (let i = 0; i < 4; i++) {
    const cx = 5 + i * 5;
    R(g, cx - 1, 7, 3, 2, GOLD[1]);
    R(g, cx, 6, 1, 4, GOLD[1]);
    R(g, cx, 7, 1, 2, CREAM);
  }
  R(g, 3, 4, 18, 1, GOLD[0]);
  R(g, 3, 11, 18, 1, GOLD[0]);
  for (let y = 1; y < 15; y += 2) {
    R(g, 0, y, 1, 1, CREAM);
    R(g, 23, y, 1, 1, CREAM);
  }
  return [[stood(c)], [stood(quarter(c))]];
}

function rugMoss(): Sprite {
  const { c, g } = makeCanvas(16, 16);
  ell(g, 8, 8, 7.6, 7.2, GREEN[2]);
  ell(g, 7.5, 7.5, 6.4, 6, GREEN[3]);
  for (let i = 0; i < 16; i++) {
    const x = 3 + Math.floor(hash(i, 1, 55) * 10);
    const y = 3 + Math.floor(hash(i, 2, 55) * 10);
    R(g, x, y, 1, 1, i % 3 ? GREEN[4] : GREEN[2]);
  }
  return stood(c);
}

/** Rock. */
function rockFriend(): Sprite {
  const r = rock(13, 9, 311);
  const g = g2(r.c);
  for (const x of [4, 9]) {
    R(g, x, 4, 2, 2, CREAM);
    R(g, x + 1, 5, 1, 1, INK);
  }
  return r;
}

function birdhouse(): Sprite {
  const { c, g } = makeCanvas(9, 23);
  R(g, 4, 10, 1, 12, BARK[1]);
  R(g, 3, 22, 3, 1, STONE[1]);
  R(g, 1, 4, 7, 6, "#e9d8b8");
  R(g, 6, 4, 2, 6, "#cbb894");
  R(g, 3, 5, 2, 2, BARK[0]);
  R(g, 3, 8, 2, 1, BARK[2]);
  R(g, 0, 10, 9, 1, BARK[2]);
  for (let i = 0; i < 4; i++) R(g, 4 - i - (i === 3 ? 1 : 0), i, i * 2 + (i === 3 ? 3 : 1), 1, i % 2 ? SKY[2] : SKY[3]);
  return stood(c);
}

function cookPot(): Sprite {
  const { c, g } = makeCanvas(13, 15);
  for (let i = 0; i < 14; i++) {
    R(g, 6 - Math.round(i * 0.4), i, 1, 1, BARK[1]);
    R(g, 6 + Math.round(i * 0.4), i, 1, 1, BARK[1]);
  }
  R(g, 6, 1, 1, 4, STONE[1]);
  ell(g, 6.5, 8, 4, 3.4, STONE[0]);
  R(g, 3, 5, 7, 1, STONE[1]);
  R(g, 4, 6, 5, 1, GOLD[0]);
  R(g, 4, 7, 1, 2, STONE[1]);
  for (const [x, col] of [
    [4, SKY[5]],
    [6, GOLD[1]],
    [8, SKY[5]],
  ] as const)
    R(g, x, 13, 2, 1, col);
  return stood(c);
}

function woodpile(): Sprite {
  const { c, g } = makeCanvas(17, 11);
  const end = (x: number, y: number): void => {
    R(g, x, y, 4, 4, BARK[2]);
    R(g, x, y, 4, 1, BARK[4]);
    R(g, x + 1, y + 1, 2, 2, GOLD[0]);
    R(g, x + 1, y + 1, 1, 1, GOLD[1]);
  };
  for (let i = 0; i < 4; i++) end(i * 4 + (i ? 1 : 0), 7);
  for (let i = 0; i < 3; i++) end(2 + i * 4 + (i ? 1 : 0), 3.5);
  for (let i = 0; i < 2; i++) end(4 + i * 5, 0);
  return stood(c);
}

const FOX_STATUE = [
  "..y....y....",
  "...y..y.....",
  "..yY..Yy....",
  "...j..j.....",
  "...jjjj.....",
  "..jjkjj.....",
  ".jjjjjj.....",
  "..Jjjjjj....",
  "...jjjjjj...",
  "...jjjjjjj..",
  "...jjjJjjjj.",
  "...jjJJjjJj.",
  "...jj.jj.JJ.",
  "..tttttttt..",
  ".tSSSSSSSSs.",
  ".SSSSSSSSss.",
];

function fountain(): Sprite {
  const { c, g } = makeCanvas(18, 22);
  ell(g, 9, 16, 8.6, 5, STONE[1]);
  stones(g, 1, 15, 16, 6, 53);
  for (const x of [0, 17]) g.clearRect(x, 19, 1, 3);
  ell(g, 9, 14, 8.6, 4.6, STONE[3]);
  ell(g, 9, 14.3, 6.8, 3.2, WATER[1]);
  ell(g, 8, 13.8, 4, 1.6, WATER[2]);
  R(g, 8, 6, 2, 8, STONE[2]);
  R(g, 8, 6, 1, 8, STONE[3]);
  ell(g, 9, 6, 3.6, 1.6, STONE[3]);
  R(g, 7, 6, 4, 1, WATER[2]);
  R(g, 8, 3, 2, 3, STONE[2]);
  return stood(c);
}

// ---------- small presents ----------

const PINECONE = ["..nn..", ".nBNn.", "nBNnBn", "nNnBNn", "nBNnBn", ".nNBn.", "..nn.."];
const PEBBLE = [".tttttt.", "ttrtrttS", "ttrrrtSS", "tStRtSSs", ".SSSSss."];
const ACORN_JAR = [".bnnnb.", ".UUUUU.", "UQQQQQU", "UQoQnQU", "UnQoQQU", "UQoQnQU", "UonQoQU", ".UUUUU."];
const CAIRN = [
  "...tt...",
  "..tSSs..",
  "........",
  "..tttS..",
  ".tSSSSs.",
  "........",
  ".tttttS.",
  "tSSSSSSs",
  "tSSSSSss",
];
const CAIRN_DOWN = [
  "........",
  "........",
  "........",
  "........",
  "........",
  "........",
  ".tt.ttt.",
  "tSSstSSs",
  "tSssSSss",
];
const CRAB_DRAWING = [
  ".wwwwwww.",
  ".wrwwwrw.",
  ".wwrrrww.",
  ".wrrrrrw.",
  ".wwrwrww.",
  ".wwwwwww.",
  ".CCCCCCC.",
  "..n.n.n..",
  "..n.n.n..",
  ".n..n..n.",
  ".n..n..n.",
  "n...n...n",
];

// ---------- trophies ----------

const PLINTH = [".ttttttt.", "tSSSSSSSs", "SSSSSSSss"];
const FIGURES: Readonly<Record<string, readonly string[]>> = {
  "trophy-oldbramble": [".d.g.d.", "dgGgGgd", "gGYgYGg", "dGgggGd", "gdGGGdg", ".dgdgd."],
  "trophy-hoardmagpie": ["..HHH..", ".HHkHy.", "HHHHHyY", "wwHHH..", "wwwHH..", ".HHH...", "..o.o.."],
  "trophy-bigcrab": ["yy...yy", "y.w.w.y", ".yYYYy.", "yYYYYYy", ".oyyyo.", "o.o.o.o"],
  "model-crab": [".t.....", "ttt.o.o", ".toYYYo", ".oYYoYY", "..oyyyo", ".o.o.o."],
  "model-beacon": ["..YYY..", ".YwwwY.", "..yyy..", "..sSs..", "..SSs..", ".sSSSs.", ".SSSSs."],
};

function trophy(id: string): { whole: Sprite; small: HTMLCanvasElement } {
  const fig = bitmap(FIGURES[id] ?? [], P);
  const base = bitmap(PLINTH, P);
  const { c, g } = makeCanvas(9, fig.height + 3);
  g.drawImage(base, 0, fig.height);
  g.drawImage(fig, 1, 0);
  return { whole: stood(c), small: outlined(fig, INK) };
}

// ---------- pets ----------

export interface PetArt {
  /** Sitting still; a second picture, where there is one, for a blink. */
  sit: readonly Sprite[];
  /** Walking, two steps, facing left; `walkR` is the same facing right. */
  walk: readonly Sprite[];
  walkR: readonly Sprite[];
  /** Asleep, for those that sleep; pleased, for those that stretch. */
  sleep: Sprite | null;
  glad: Sprite | null;
}

const GLORP = [
  ["..CCCCC..", ".CFFCCCC.", "CCFCCCCCC", "CCBCCCBCC", "CMBCCCBMC", "CCCCECCCE", ".EEEEEEE."],
  ["..CCCCC..", ".CFFCCCC.", "CCFCCCCCC", "CCCCCCCCC", "CMBBCBBMC", "CCCCECCCE", ".EEEEEEE."],
  ["...CCCCCCC...", ".CCFFCCCCCCC.", "CCBCCCCCCCBCC", "CMBCCCECCCBMC", ".EEEEEEEEEEE."],
  ["..CCC..", ".CFFCC.", ".CFCCC.", "CCCCCCC", "CBCCCBC", "CBCCCBC", "CMCECMC", "CCCCCCE", ".EEEEE."],
] as const;
/** The colours a glorp comes in: body, shade, shine, cheek. */
const GLORP_HUES: readonly (readonly [string, string, string, string])[] = [
  ["#6fb0e8", "#4a7fc0", "#b6e2f7", "#e88fb4"],
  ["#e67fb0", "#b84d84", "#f7b6d2", SKY[5]],
  [GREEN[4], GREEN[2], "#c9ef9a", GOLD[1]],
  [GOLD[1], GOLD[0], CREAM, SKY[5]],
  ["#9a55b0", SKY[2], "#d39be0", "#e67fb0"],
];

const CAT_SIT = ["a.....a", "aa...aa", "aaaaaaa", "aBaaaBa", "aaaMaaa", ".acccA.", ".acccA.", "aaaaaaA"];
const CAT_WALK = [
  ["........a.a", "A.......aaa", "A.......aBa", ".AaaaaaaaaM", "..aaAaaAaa.", "..aaaaaaa..", "..a.a..a.a."],
  ["........a.a", ".A......aaa", ".A......aBa", ".AaaaaaaaaM", "..aaAaaAaa.", "..aaaaaaa..", "...aa...aa."],
] as const;
const CAT_SLEEP = [".a.a.....", "aaaaaaa..", "aaAaAaaa.", "aMaaaaaaA", ".caaaaAA."];
/** The coats a cat comes in: fur, stripe. */
const CAT_HUES: readonly (readonly [string, string])[] = [
  ["#ef9a3c", "#c76e2a"],
  ["#3a3340", "#2b2530"],
  [STONE[3], STONE[1]],
  ["#f3ede0", "#cfc6d6"],
];

const FOX_SIT = [
  ".y...y...",
  "..y.y....",
  ".jj.jj...",
  ".jjjjj...",
  "jBjjjj...",
  "Mjjjjj..j",
  ".Jjjjj.jj",
  "..jjjjjjj",
  "..jjjjjj.",
  "..jJjjJ..",
  "..jj.jj..",
];
const FOX_WALK = [
  [
    "y..y.........",
    ".yy..........",
    ".jjj.......jj",
    "jBjjj....jjjj",
    "Mjjjjjjjjjjj.",
    ".JjjjjjjjjJ..",
    "..jjJJJJjj...",
    "..j.j...j.j..",
  ],
  [
    "y..y.........",
    ".yy.......jj.",
    ".jjj.....jjjj",
    "jBjjj...jjjj.",
    "Mjjjjjjjjjj..",
    ".JjjjjjjjjJ..",
    "..jjJJJJjj...",
    "...jj....jj..",
  ],
] as const;

function pet(kind: PetId, hue: number): PetArt {
  if (kind === "glorp") {
    const [body, shade, shine, cheek] = GLORP_HUES[hue % GLORP_HUES.length] ?? GLORP_HUES[0] ?? ["", "", "", ""];
    const pal = { C: body, E: shade, F: shine, M: cheek, B: INK };
    const [idle, blink, squash, stretch] = GLORP.map((r) => stood(bitmap(r, pal)));
    const still = idle && blink ? [idle, blink] : [];
    return {
      sit: still,
      walk: squash ? [squash] : still,
      walkR: squash ? [squash] : still,
      sleep: null,
      glad: stretch ?? null,
    };
  }
  if (kind === "cat") {
    const [fur, stripe] = CAT_HUES[hue % CAT_HUES.length] ?? CAT_HUES[0] ?? ["", ""];
    const pal = {
      ...P,
      a: fur,
      A: stripe,
      B: INK,
      M: "#e88fb4",
      c: hue % CAT_HUES.length === 1 ? "#55495c" : "#fff3cf",
    };
    const walk = CAT_WALK.map((r) => stood(bitmap(r, pal)));
    return {
      sit: [stood(bitmap(CAT_SIT, pal))],
      walk: walk.map(mirror),
      walkR: walk,
      sleep: stood(bitmap(CAT_SLEEP, pal)),
      glad: null,
    };
  }
  const pal = { ...P, B: INK, M: INK };
  const walk = FOX_WALK.map((r) => stood(bitmap(r, pal)));
  return { sit: [stood(bitmap(FOX_SIT, pal))], walk, walkR: walk.map(mirror), sleep: null, glad: null };
}

// ---------- pictures for the camp's buttons ----------

const ICON_ROWS = {
  cabin: [
    "..ss........",
    "..ss.gggg...",
    "..sgggggggg.",
    ".gggggggggg.",
    "gggggggggggg",
    ".nNNNNNNNNn.",
    ".nNyyNNbbNn.",
    ".nNyyNNbbNn.",
    ".nNNNNNbbNn.",
    ".nNNNNNbYNn.",
    ".nNNNNNbbNn.",
    ".ssssssssss.",
  ],
  mailbox: [
    "............",
    ".RRRRRRRR.y.",
    "RrrrrrrrrRy.",
    "RrwwwwwwrRy.",
    "RrrrrrrrrR..",
    "RRRRRRRRRR..",
    "....nb......",
    "....nb......",
    "....nb......",
    "....nb......",
    "...snbs.....",
    "............",
  ],
  signpost: [
    ".....nn.....",
    "..NNNnnNNN..",
    ".NNwwwwwNNN.",
    "..NNNnnNNN..",
    ".....nn.....",
    ".BBBBnnBBB..",
    "BBByyyyBBB..",
    ".BBBBnnBBB..",
    ".....nn.....",
    ".....nn.....",
    ".....nn.....",
    "....snns....",
  ],
  town: [
    "...VVVVVV...",
    "..VvvvvvvV..",
    ".VvvvvvvvvV.",
    "bbbbbbbbbbbb",
    ".nb......bn.",
    ".nb.yyyy.bn.",
    ".nb.yYYy.bn.",
    ".nb.yYYy.bn.",
    ".nb.EEEE.bn.",
    ".nb.EEEE.bn.",
    ".nb.EEEE.bn.",
    ".ss.EEEE.ss.",
  ],
  fire: [
    ".....r......",
    "....rr......",
    "....rrr..r..",
    "...rrrr.rr..",
    "..rryrrrrr..",
    "..ryyyrrrr..",
    ".rryyyyyrr..",
    ".rryywyyrrr.",
    ".rryywwyyrr.",
    "..rywwwyyr..",
    ".bbbbbbbbbb.",
    "bbnnbbbnnbbb",
  ],
  home: [
    ".....ll.....",
    "....llll....",
    "...llGGll...",
    "..llGGGGll..",
    ".llGGGGGGll.",
    "llGGGGGGGGll",
    ".nNNNNNNNNn.",
    ".nNNNbbNNNn.",
    ".nNNNbbNNNn.",
    ".nNNNbYNNNn.",
    ".nNNNbbNNNn.",
    ".ssssssssss.",
  ],
} as const;
export type CampIcon = keyof typeof ICON_ROWS;

const icons = new Map<CampIcon, HTMLCanvasElement>();
/** A picture for one of the camp's buttons or the head of its panel. Each call gives a new copy. */
export function campIcon(name: CampIcon): HTMLCanvasElement {
  let c = icons.get(name);
  if (!c) {
    c = outlined(bitmap(ICON_ROWS[name], P), INK);
    icons.set(name, c);
  }
  const copy = makeCanvas(c.width, c.height);
  copy.g.drawImage(c, 0, 0);
  return copy.c;
}

// ---------- the set ----------

export interface CampArt {
  /** A thing's pictures: first by which way round it is, then by its state (lit, coloured, looking out). */
  things: Readonly<Record<string, readonly (readonly Sprite[])[]>>;
  /** The cabin under each roof it may have. */
  cabins: readonly Sprite[];
  /** Each trophy small enough to stand on the shelf. */
  small: Readonly<Record<string, HTMLCanvasElement>>;
  pets: (kind: PetId, hue: number) => PetArt;
  /** Things in the catalogue that have no picture of their own yet. */
  undrawn: readonly string[];
  /** A parcel waiting to be opened, and the posts either side of the trail. */
  parcel: Sprite;
  gatepost: readonly Sprite[];
}

function parcel(crate: Sprite): Sprite {
  const { c, g } = makeCanvas(crate.c.width, crate.c.height);
  g.drawImage(crate.c, 0, 0);
  R(g, 5, 1, 2, c.height - 2, GOLD[0]);
  R(g, 1, 6, c.width - 2, 1, GOLD[0]);
  R(g, 4, 5, 4, 3, PAPER[2]);
  return { c, ax: crate.ax, ay: crate.ay };
}

const one = (sprite: Sprite): Sprite[][] => [[sprite]];

export function makeCampArt(s: Sprites): CampArt {
  const cabins = ROOFS.map((_r, i) => cabin(i));
  const trophies = Object.keys(FIGURES).map((id) => [id, trophy(id)] as const);
  const mine = stall(3);
  const things: Record<string, readonly (readonly Sprite[])[]> = {
    cabin: one(cabins[0] ?? s.treasury),
    "fire-ring": one({ c: s.fireRing.c, ax: s.fireRing.ax, ay: s.fireRing.c.height - 1 }),
    mailbox: one(rows(MAILBOX)),
    signpost: one(s.signpost),
    "trophy-shelf": one(shelf()),

    "log-seat": logSeat(),
    stump: one(s.stump),
    bench: one(s.bench),
    hammock: one(hammock()),
    cushion: one(rows(CUSHION)),
    rocker: both(rows(ROCKER)),
    picnic: one(picnic()),
    "crab-throne": one(throne()),

    "lantern-post": both(s.post),
    "paper-lantern": [HUES.map(([a, b]) => paperLantern(a, b))],
    "candle-stump": one(candles()),
    "firefly-lamp": one(rows(FIREFLY_LAMP)),
    brazier: one(rows(BRAZIER)),
    glowcap: one(rows(GLOWCAP)),
    "fairy-lights": poles(18, 40),
    "moth-lantern": one(hookLantern()),
    "glass-lantern": [HUES.map(([a], i) => glassLantern(a, HUES[(i + 2) % HUES.length]?.[0] ?? a))],

    pennant: ((): Sprite[][] => {
      const all = HUES.map(([a], i) => pennant(a, ["#d49045", "#b0483a", "#9c3f73", WATER[1], GREEN[2]][i] ?? a));
      return [all, all.map(mirror)];
    })(),
    "guild-banner": one(banner(false)),
    "sun-banner": one(banner(true)),
    bunting: poles(13, 40),
    windsock: both(windsock()),
    weathervane: [[vane(false), vane(true)]],

    "flower-pot": one(rows(FLOWER_POT)),
    "potted-fern": one(pottedFern()),
    toadstool: one(rows(TOADSTOOL)),
    "fairy-ring": one(fairyRing()),
    sunflower: one(rows(SUNFLOWER)),
    "berry-bush": one(berryBush()),
    sapling: one(sapling()),
    pumpkin: one(rows(PUMPKIN)),
    "flower-bed": one(flowerBed()),
    "worm-pot": [[rows(WORM_POT), rows(WORM_OUT)]],

    picket: picket(),
    "log-fence": railFence(),
    "stone-wall": wall(),
    arch: one(arch()),
    "stepping-stones": steppingStones(),
    "plank-path": plankPath(),
    doormat: one(doormat()),

    well: one(well()),
    telescope: both(telescope()),
    "my-stall": one({ c: mine.c, ax: Math.floor(mine.c.width / 2), ay: mine.c.height - 1 }),
    gnome: both(rows(GNOME)),
    "gnome-fishing": both(rows(GNOME_FISHING)),
    "gnome-napping": one(rows(GNOME_NAPPING)),
    "gnome-traveller": both(rows(GNOME_TRAVELLER)),
    "crab-statue": one(rows(CRAB_STATUE)),
    barrel: [[s.barrel, barrelOpen(s.barrel)]],
    "wind-chime": one(windChime()),
    "music-box": one(musicBox()),
    "bird-bath": [[birdBath(true), birdBath(false)]],
    "rug-woven": rugWoven(),
    "rug-moss": one(rugMoss()),
    rock: one(rockFriend()),
    birdhouse: one(birdhouse()),
    "cook-pot": one(cookPot()),
    woodpile: one(woodpile()),
    "fox-statue": both(rows(FOX_STATUE)),
    fountain: one(fountain()),

    pinecone: one(rows(PINECONE)),
    "painted-pebble": one(rows(PEBBLE)),
    "acorn-jar": one(rows(ACORN_JAR)),
    "tiny-cairn": [[rows(CAIRN), rows(CAIRN_DOWN)]],
    "crab-drawing": one(rows(CRAB_DRAWING)),
  };
  for (const [id, t] of trophies) things[id] = one(t.whole);
  // Anything the catalogue has that has no picture yet stands in as a crate, so nothing is ever unseen.
  const undrawn = THINGS.filter((t) => !things[t.id]).map((t) => t.id);
  for (const id of undrawn) things[id] = one(s.crate);

  const pets = new Map<string, PetArt>();
  return {
    things,
    undrawn,
    cabins,
    small: Object.fromEntries(trophies.map(([id, t]) => [id, t.small])),
    pets(kind, hue) {
      const key = `${kind}/${hue}`;
      let art = pets.get(key);
      if (!art) {
        art = pet(kind, hue);
        pets.set(key, art);
      }
      return art;
    },
    parcel: parcel(s.crate),
    gatepost: [s.post, mirror(s.post)],
  };
}

/** The picture of a thing as it stands: this way round, in this state. */
export function pictureOf(art: CampArt, id: string, turn: number, state: number): Sprite | null {
  const ways = art.things[id];
  const way = ways?.[turn % Math.max(1, ways.length)];
  return way?.[state % Math.max(1, way.length)] ?? null;
}
