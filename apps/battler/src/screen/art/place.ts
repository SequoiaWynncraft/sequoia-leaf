import { PAL } from "@sequoia-leaf/figures/pal.ts";
import { drawFigure } from "@sequoia-leaf/figures/sprites.ts";
/**
 * The second place the table may stand: the guild's hall, late at night. A long oak table lies
 * where the stump does in the clearing, and is the same size, so the board, the bench, the lanterns
 * and whoever sits round it are where they were. Under it are stone flags and a blue runner; on the
 * far wall the hearth is lit to the left and the moon comes through a window to the right; the
 * guild's banners hang on the wall and the pillars; the lantern owned hangs from an iron stand at
 * each far corner of the table.
 *
 * `paintPlace` and `paintLook` choose between the hall and the clearing (`table.ts`); `drawLife` is
 * what moves in the hall.
 */
import { BARK, CORAL, CREAM, EARTH, GOLD, GREEN, INK, PAPER, SKY, STONE, WATER } from "@sequoia-leaf/kit/palette.ts";
import { bitmap, outlined, paint, R } from "@sequoia-leaf/kit/pix.ts";
import { type Ctx, hash, makeCanvas, vnoise } from "@sequoia-leaf/kit/util.ts";
import type { ClothId, LanternId, Looks, PlaceId } from "@sequoia-leaf/raid";

import {
  clothAt,
  drawBench,
  drawPost,
  lampsOf,
  lightHole,
  paintSwatch,
  paintTable,
  type Place,
  postsOf,
  type PostTones,
  stumpOf,
  warmGlow,
} from "./table.ts";

/** The iron of the lanterns' stands, darkest first. */
const IRON: PostTones = [INK, SKY[0], STONE[0], STONE[0]];
const GROUT = SKY[0];
/** How far the runner reaches past each end of the table, and how much of each side a pillar takes. */
const RUG = 46;
const PILLAR = 20;
/** How far apart the windows are. */
const WINDOWS = 62;

/** Where the hall's things are, from where the stump would be: the table's top, the wall's foot, the hearth, the window. */
function hallOf(p: Place) {
  const { cx, cy, rx, ry } = stumpOf(p);
  return {
    cx,
    cy,
    x0: cx - rx,
    x1: cx + rx,
    y0: cy - ry,
    y1: cy + ry - 2,
    wall: cy - ry - 16,
    hearth: cx - rx - 58,
    window: cx + rx + 58,
    /** One window, and a second where there is wall for it before the pillar. */
    windows: p.w - PILLAR - 18 - (cx + rx + 58) >= WINDOWS ? 2 : 1,
    candle: { x: cx - 92, y: cy + 38 },
    /** Whether the window has room at the table's sides for what stands there. */
    wide: p.w > 330,
  };
}
type Hall = ReturnType<typeof hallOf>;

// ---------- what it is made of ----------

/** The oak of the table at a point of its top: boards laid lengthwise, their seams and ends, and the grain along them. */
function oak(x: number, y: number): string {
  const board = Math.floor(y / 19);
  const v = y - board * 19;
  if (v === 0 || (x + Math.floor(hash(board, 1, 701) * 170)) % 173 === 0) return EARTH[0];
  const grain = vnoise(x / 34, board * 7.3 + v / 1.6, 703);
  if (grain > 0.76) return EARTH[2];
  return grain < 0.17 ? EARTH[0] : EARTH[1];
}

/** The table's near side, `below` pixels under its top and `dx` in from an end, and a leg at each end; null under them. */
function sideAt(below: number, dx: number): string | null {
  if (below < 10) return below === 9 || dx === 0 ? INK : below === 0 ? BARK[0] : EARTH[0];
  if (below >= 34 || dx < 4 || dx > 11) return null;
  return dx === 4 || dx === 11 ? INK : EARTH[0];
}

/** The table at a pixel: its top, and the side under it; null where it is not. */
function tableAt(h: Hall, x: number, y: number, cloth: ClothId, p: Place): string | null {
  const dx = Math.min(x - h.x0, h.x1 - 1 - x);
  if (dx < 0 || y < h.y0) return null;
  if (y >= h.y1) return sideAt(y - h.y1, dx);
  const dy = Math.min(y - h.y0, h.y1 - 1 - y);
  if (dx + dy < 2) return null;
  if (Math.min(dx, dy) === 0 || dx + dy === 2) return BARK[0];
  if (y - h.y0 === 1) return EARTH[2];
  return clothAt(cloth, x, y, p) ?? oak(x - h.x0, y - h.y0);
}

/** A stone flag of the floor at a point: courses of flags of uneven widths, a few of them darker. */
function flagAt(x: number, y: number): string {
  const row = Math.floor(y / 14);
  const sx = x + 4096 + Math.floor(hash(row, 1, 711) * 24);
  const col = Math.floor(sx / 24);
  const edge = (c: number): number => c * 24 + Math.floor(hash(c, row, 712) * 9);
  const flag = sx >= edge(col) ? col : col - 1;
  if (y % 14 === 0 || sx === edge(flag)) return GROUT;
  const tone = hash(flag, row, 713);
  if (y % 14 === 1 && tone > 0.5) return STONE[2];
  return tone > 0.28 ? STONE[1] : STONE[0];
}

/** The runner at a point measured from its corner: a pale band inside its edge, and woven diamonds. */
function rugAt(u: number, v: number, w: number, h: number): string {
  const edge = Math.min(u, v, w - 1 - u, h - 1 - v);
  if (edge === 0) return GROUT;
  if (edge === 2) return PAPER[0];
  const du = Math.abs(((u + (Math.floor(v / 10) % 2) * 8) % 16) - 8);
  return edge > 5 && du + Math.abs((v % 10) - 5) === 2 ? WATER[1] : WATER[0];
}

/** Whether the moon through the window falls on a point of the floor (`y` down from the wall's foot). */
function moonlit(h: Hall, x: number, y: number): boolean {
  if (!h.wide || y < 5 || y > 86) return false;
  const across = x - (h.window - 12 - Math.round(y * 0.3));
  const u = across % WINDOWS;
  return across >= 0 && across < h.windows * WINDOWS && u < 24 && u !== 11 && u !== 12 && y % 27 < 25;
}
/** What the floor's tones are in the moon. */
const MOONLIT: ReadonlyMap<string, string> = new Map([
  [GROUT, STONE[0]],
  [STONE[0], STONE[2]],
  [STONE[1], STONE[3]],
  [STONE[2], STONE[3]],
  [WATER[0], WATER[1]],
  [WATER[1], WATER[2]],
  [PAPER[0], PAPER[1]],
]);

/** The floor at a pixel: flags, the runner under the table with a fringe at each end, the moon across both. */
function floorAt(h: Hall, x: number, y: number): string {
  const u = x - (h.x0 - RUG);
  const v = y - (h.y0 + 30);
  const w = h.x1 - h.x0 + RUG * 2;
  const tall = h.y1 - h.y0 - 8;
  let col = flagAt(x, y - h.wall);
  if (v >= 0 && v < tall) {
    if (u >= 0 && u < w) col = rugAt(u, v, w, tall);
    else if (u >= -2 && u < w + 2 && v % 2 === 1) col = PAPER[0];
  }
  return moonlit(h, x, y - h.wall) ? (MOONLIT.get(col) ?? col) : col;
}

/** The far wall at a pixel: dark boards upright, and a skirting at its foot. */
function wallAt(x: number, y: number, wall: number): string {
  if (y >= wall - 2) return BARK[0];
  if (y === wall - 3) return BARK[2];
  if (x % 11 === 0) return BARK[0];
  return vnoise(x * 0.9, y / 14, 721) > 0.72 ? BARK[2] : BARK[1];
}

/** A pillar at the picture's side, `off` pixels in from the edge: a squared trunk, banded with iron. */
function pillarAt(off: number, y: number): string {
  if (off === PILLAR - 1) return INK;
  if (y % 96 > 92) return GROUT;
  const streak = hash(off, y >> 5, 731);
  return off > PILLAR - 5 ? BARK[0] : streak > 0.7 ? BARK[2] : streak < 0.2 ? BARK[0] : BARK[1];
}

// ---------- what stands in it ----------

/** A flat block under a dark edge. */
function box(g: Ctx, x: number, y: number, w: number, h: number, col: string): void {
  R(g, x - 1, y - 1, w + 2, h + 2, INK);
  R(g, x, y, w, h, col);
}

/** The hearth in the far wall: a stone surround under an oak mantel, two logs, and its stone on the floor. The fire is `drawLife`'s. */
function drawHearth(g: Ctx, x: number, wall: number): void {
  box(g, x - 23, wall - 34, 46, 34, STONE[1]);
  for (let i = 0; i < 4; i++) {
    R(g, x - 23, wall - 27 + i * 8, 46, 1, STONE[0]);
    for (let k = 0; k < 4; k++) R(g, x - 19 + k * 13 + (i % 2) * 6, wall - 34 + i * 8, 1, 7, STONE[0]);
  }
  R(g, x - 23, wall - 34, 46, 1, STONE[2]);
  box(g, x - 13, wall - 23, 26, 23, SKY[0]);
  R(g, x - 11, wall - 26, 22, 3, INK);
  R(g, x - 10, wall - 25, 20, 2, SKY[0]);
  box(g, x - 26, wall - 38, 52, 3, BARK[3]);
  R(g, x - 26, wall - 38, 52, 1, BARK[4]);
  box(g, x - 28, wall + 1, 56, 6, STONE[1]);
  R(g, x - 28, wall + 1, 56, 1, STONE[2]);
  box(g, x - 10, wall - 5, 20, 3, BARK[2]);
  R(g, x - 10, wall - 5, 20, 1, BARK[3]);
  R(g, x - 7, wall - 7, 13, 2, BARK[1]);
}

/** The window: a stone frame, the night in four panes, the moon and a few stars. */
function drawWindow(g: Ctx, x: number, wall: number): void {
  box(g, x - 14, wall - 38, 28, 30, STONE[1]);
  R(g, x - 14, wall - 38, 28, 1, STONE[2]);
  R(g, x - 11, wall - 35, 22, 24, WATER[0]);
  R(g, x + 3, wall - 32, 4, 4, CREAM);
  R(g, x + 5, wall - 33, 3, 3, WATER[0]);
  for (const [sx, sy] of [
    [-8, -31],
    [-4, -19],
    [7, -16],
    [-9, -15],
  ] as const) {
    R(g, x + sx, wall + sy, 1, 1, WATER[3]);
  }
  R(g, x - 1, wall - 35, 2, 24, STONE[0]);
  R(g, x - 11, wall - 24, 22, 2, STONE[0]);
  box(g, x - 16, wall - 9, 32, 2, STONE[2]);
}

/** One of the guild's banners, `len` long: green, a gold sequoia low on it, cut to two tails. */
function banner(len: number): HTMLCanvasElement {
  const { c, g } = makeCanvas(14, len);
  R(g, 1, 1, 12, len - 1, GREEN[1]);
  R(g, 12, 1, 1, len - 1, GREEN[0]);
  R(g, 1, 3, 12, 1, GOLD[0]);
  R(g, 1, len - 9, 12, 1, GOLD[0]);
  const top = len - 22;
  [2, 4, 4, 6, 6, 8, 8].forEach((w, i) => R(g, 7 - w / 2, top + i, w, 1, GOLD[1]));
  R(g, 6, top + 7, 2, 3, GOLD[0]);
  for (let i = 0; i < 5; i++) g.clearRect(6 - i, len - 5 + i, 2 + 2 * i, 1);
  R(g, 0, 0, 14, 1, BARK[0]);
  return outlined(c, INK);
}

/** A short bench to sit and watch from. */
function drawSeat(g: Ctx, x: number, y: number): void {
  const { c, g: s } = makeCanvas(28, 9);
  R(s, 0, 0, 28, 1, BARK[4]);
  R(s, 0, 1, 28, 2, BARK[3]);
  R(s, 0, 3, 28, 1, BARK[1]);
  R(s, 2, 4, 3, 5, BARK[1]);
  R(s, 23, 4, 3, 5, BARK[1]);
  R(s, 5, 6, 18, 1, BARK[0]);
  g.drawImage(outlined(c, INK), Math.round(x) - 15, y - 11);
}

const LEDGER = ["bcccccbcccccb", "bcCCCcbcCCccb", "bcccccbcccccb", "bcCCccbcCCCcb", "bcccccbcCCccb", "bbbbbbbbbbbbb"];
const COINS = [".YY....", "yYYy.YY", "oyyoyYY", "oyyooyy", ".oo..oo"];
const BOWL = ["..nb.nb...", ".bonbonbo.", "feeeeeeeef", ".eEEEEEEe.", "..eeeeee.."];
const TANKARD = [".wwww...", "wwwwwTT.", "nNNNn.T.", "TTTTT.T.", "nNNNnTT.", "nNNNn...", "TTTTT..."];
const CANDLE = ["..c..", "..c..", ".sCs.", "sssss"];
/** The hearth's cat, asleep: ginger, striped, its tail round its feet. */
const CAT = [
  "...........o...o",
  "...oooooo..ooooo",
  ".oonoonoooooonon",
  "oonoonooooooowoo",
  "oonoonooooo.ooo.",
  ".ooooooooon.....",
];

/** Everything in the hall that stands still: on the wall, on the floor at the table's sides, and on the table. */
function furnish(g: Ctx, h: Hall, p: Place): void {
  const put = (rows: readonly string[], x: number, y: number): void => {
    const pic = outlined(bitmap(rows, PAL), INK);
    g.drawImage(pic, Math.round(x - pic.width / 2), y - pic.height);
  };
  put(LEDGER, h.cx - 89, h.cy - 30);
  put(COINS, h.cx - 86, h.cy - 20);
  put(CANDLE, h.candle.x, h.candle.y + 4);
  put(BOWL, h.cx + 87, h.cy - 22);
  put(TANKARD, h.cx + 89, h.cy + 38);
  if (!h.wide) return;
  drawHearth(g, h.hearth, h.wall);
  for (let i = 0; i < h.windows; i++) drawWindow(g, h.window + i * WINDOWS, h.wall);
  put(CAT, h.hearth + 40, h.wall + 24);
  // The crab nobody has counted, out in the moon.
  drawFigure(g, "uncounted", h.window + (h.windows - 1) * WINDOWS - 20, h.wall + 68, { left: true });
  if (h.wall > 34) {
    const hung = banner(Math.min(50, h.wall - 8));
    g.drawImage(hung, h.cx - 104, h.wall - 8 - hung.height);
    g.drawImage(hung, h.cx + 92, h.wall - 8 - hung.height);
  }
  const long = banner(46);
  g.drawImage(long, 2, h.cy + 34);
  g.drawImage(long, p.w - 18, h.cy - 62);
  drawSeat(g, h.x0 - 34, h.cy + 6);
  drawSeat(g, h.x1 + 34, h.cy + 12);
}

/** Night over the hall, and the light cut out of it: the board, the lanterns and the candle, the hearth's side, the moon on the floor. */
function light(g: Ctx, h: Hall, p: Place): void {
  const dark = makeCanvas(p.w, p.h);
  const d = dark.g;
  d.fillStyle = "rgba(12,14,40,0.58)";
  d.fillRect(0, 0, p.w, p.h);
  d.globalCompositeOperation = "destination-out";
  d.drawImage(lightHole(), h.cx - 152, h.cy - 131, 304, 262);
  const lamps = lampsOf(p);
  for (const l of lamps) d.drawImage(lightHole(), l.x - 44, l.y - 40, 88, 88);
  d.drawImage(lightHole(), h.candle.x - 22, h.candle.y - 22, 44, 44);
  // The hearth is to the left: its light reaches along that side of the table, and the right is left darker.
  d.drawImage(lightHole(), h.hearth - 120, h.wall - 80, 240, 250);
  d.globalAlpha = 0.5;
  for (let i = 0; h.wide && i < h.windows; i++) {
    for (let y = 5; y <= 86; y++) d.fillRect(h.window + i * WINDOWS - 12 - Math.round(y * 0.3), h.wall + y, 24, 1);
  }
  g.drawImage(dark.c, 0, 0);
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = 0.16;
  for (const l of lamps) g.drawImage(warmGlow(), l.x - 40, l.y - 38, 80, 80);
  g.globalAlpha = 0.17;
  g.drawImage(warmGlow(), h.hearth - 130, h.wall - 80, 260, 240);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
}

function paintHall(p: Place, cloth: ClothId, lantern: LanternId): HTMLCanvasElement {
  const h = hallOf(p);
  const c = paint(p.w, p.h, (x, y) => {
    const off = Math.min(x, p.w - 1 - x);
    if (h.wide && off < PILLAR) return pillarAt(off, y);
    return tableAt(h, x, y, cloth, p) ?? (y < h.wall ? wallAt(x, y, h.wall) : floorAt(h, x, y));
  });
  const g = c.getContext("2d");
  if (!g) return c;
  g.imageSmoothingEnabled = false;
  furnish(g, h, p);
  for (const post of postsOf(p)) drawPost(g, post.x, post.foot, post.side, lantern, IRON);
  drawBench(g, p);
  light(g, h, p);
  return c;
}

// ---------- choosing a place ----------

type Dressed = Pick<Looks, "place" | "cloth" | "lantern">;

/** The table and everything round it that never moves, in the place it stands, for a window this size. */
export const paintPlace = (p: Place, looks: Dressed): HTMLCanvasElement =>
  looks.place === "hall" ? paintHall(p, looks.cloth, looks.lantern) : paintTable(p, looks.cloth, looks.lantern);

/** A corner of the hall's table for the swatch: its top, its near side, and the runner and flags beyond it. */
function hallCorner(x: number, y: number): string {
  if (x < 76 && y < 52) return x === 75 || y === 51 ? BARK[0] : oak(x + 60, y + 30);
  if (x < 76 && y < 59) return EARTH[0];
  return x < 88 && y > 16 ? rugAt(87 - x, y - 17, 400, 400) : flagAt(x, y);
}
/** A corner of the table as it would look with these looks, for trying one on before it is bought. */
export const paintLook = (looks: Looks): HTMLCanvasElement =>
  looks.place === "hall" ? paintSwatch(looks, hallCorner, IRON) : paintSwatch(looks);

// ---------- what moves ----------

/** The fire in the hearth, in steps as a drawn fire burns, and the sparks it spits onto its stone. */
function drawFire(g: Ctx, x: number, wall: number, t: number): void {
  const ft = Math.floor(t * 9) / 9;
  for (let i = 0; i < 9; i++) {
    const tall =
      6 + Math.round(4 * Math.abs(Math.sin(ft * 6.1 + i * 1.9)) + 2 * Math.sin(ft * 2.3 + i * 0.7)) - Math.abs(i - 4);
    const core = Math.round(tall * 0.6);
    R(g, x - 9 + i * 2, wall - 6 - tall, 2, tall, CORAL);
    R(g, x - 9 + i * 2, wall - 6 - core, 2, core, GOLD[1]);
    if (tall > 5) R(g, x - 9 + i * 2, wall - 8, 2, 2, GOLD[2]);
  }
  for (let i = 0; i < 4; i++) {
    const turn = t / (2.6 + i * 0.9) + hash(i, 1, 741);
    const u = (turn % 1) / 0.3;
    if (u >= 1) continue;
    const reach = (hash(i, Math.floor(turn), 742) - 0.5) * 44;
    R(
      g,
      Math.round(x + reach * u),
      Math.round(wall + 2 + u * 7 - Math.sin(u * Math.PI) * 10),
      1,
      1,
      u < 0.6 ? GOLD[2] : CORAL,
    );
  }
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = 0.06 + 0.03 * Math.sin(ft * 5.3) + 0.02 * Math.sin(ft * 13);
  g.drawImage(warmGlow(), x - 70, wall - 60, 140, 130);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
}

/** The candle on the table, and a moth about the right-hand lantern. */
function drawTableLife(g: Ctx, h: Hall, lamp: { x: number; y: number } | undefined, t: number): void {
  const lean = Math.floor(t * 6) % 5 === 0 ? 1 : 0;
  R(g, h.candle.x, h.candle.y - 3, 1, 2, GOLD[1]);
  R(g, h.candle.x + lean, h.candle.y - 4 - (Math.floor(t * 4) % 3 === 0 ? 1 : 0), 1, 2, GOLD[2]);
  if (!lamp) return;
  const x = Math.round(lamp.x + Math.cos(t * 1.7) * 8 + Math.sin(t * 5.3) * 2);
  const y = Math.round(lamp.y + 2 + Math.sin(t * 2.3) * 6);
  R(g, x, y, 1, 1, PAPER[2]);
  R(g, x - 1, y - (Math.floor(t * 12) % 2), 3, 1, PAPER[0]);
}

/** Dust turning over in the moon from each window. */
function drawDust(g: Ctx, h: Hall, t: number): void {
  for (let i = 0; i < 6; i++) {
    const k = (t / (11 + i * 2.3) + hash(i, 2, 751)) % 1;
    const y = 80 - k * 72;
    const from = h.window + (i % h.windows) * WINDOWS - 12 - y * 0.3;
    g.globalAlpha = Math.sin(k * Math.PI) * 0.8;
    R(
      g,
      Math.round(from + 3 + hash(i, 3, 752) * 18 + Math.sin(t * 0.6 + i * 2) * 2),
      Math.round(h.wall + y),
      1,
      1,
      WATER[3],
    );
  }
  g.globalAlpha = 1;
}

/**
 * What moves in the hall: the candle on the table and a moth at the right-hand lantern, and where
 * the window is wide enough for the table's sides, the fire and its sparks, the cat asleep by it
 * breathing, and dust turning over in the moon. Nothing of it crosses the board.
 */
export function drawLife(g: Ctx, p: Place, t: number, where: PlaceId): void {
  if (where !== "hall") return;
  const h = hallOf(p);
  drawTableLife(g, h, lampsOf(p)[1], t);
  if (!h.wide) return;
  drawFire(g, h.hearth, h.wall, t);
  drawDust(g, h, t);
  if (Math.floor(t / 1.7) % 2 === 1) return;
  R(g, h.hearth + 36, h.wall + 15, 4, 1, INK);
  R(g, h.hearth + 36, h.wall + 16, 4, 1, GOLD[0]);
}
