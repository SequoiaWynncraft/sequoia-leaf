import { PAL } from "@sequoia-leaf/figures/pal.ts";
import { type BaseLook, drawStanding } from "@sequoia-leaf/figures/sprites.ts";
/**
 * The table, painted once for the size of the window and kept: the top of the great stump with its
 * rings, the clearing and the far trunks behind it, the cloth, the bench along its near edge, the
 * lantern posts, moss and ferns at its rim, and dusk over all of it with the lanterns' light cut
 * out. The two halves of the board are pictures of their own, because the far one slides.
 *
 * It is the stump the town shows from outside, seen close: the same wood, moss and lanterns.
 */
import { BARK, CREAM, GOLD, GREEN, INK, PAPER, SKY, STONE } from "@sequoia-leaf/kit/palette.ts";
import { bitmap, ell, outlined, paint, R } from "@sequoia-leaf/kit/pix.ts";
import { clamp, type Ctx, hash, makeCanvas, vnoise } from "@sequoia-leaf/kit/util.ts";
import type { ClothId, LanternId } from "@sequoia-leaf/raid";
import type { UnitKind } from "@sequoia-leaf/raid/content/figures.ts";
import { COLS, HOME_ROWS } from "@sequoia-leaf/raid/hex.ts";

import {
  BENCH_H,
  BENCH_SLOTS,
  BENCH_W,
  BENCH_X,
  BENCH_Y,
  BOARD_H,
  BOARD_W,
  cellXY,
  GAP,
  HEX_H,
  HEX_W,
  ROW,
  SLOPE,
  SLOT_W,
} from "../geometry.ts";

const at = (ramp: readonly string[], i: number): string => ramp[clamp(Math.round(i), 0, ramp.length - 1)] ?? "#000000";
const DEEP = ["#141f1c", "#19291f", "#1e3324"] as const;
const TRUNK_RAMP = ["#1c1019", "#2a1519", ...BARK];

/** Where the table sits in the picture: the picture's size, and the board's top-left corner in it. */
export interface Place {
  w: number;
  h: number;
  bx: number;
  by: number;
}

/** The middle of the stump's top, and how far it reaches. */
export const stumpOf = (p: Place): { cx: number; cy: number; rx: number; ry: number } => ({
  cx: p.bx + BOARD_W / 2,
  cy: p.by + 71,
  rx: 122,
  ry: 89,
});
/** Where the far rim of the stump is, straight across from the member. */
export const rimTop = (p: Place): number => stumpOf(p).cy - stumpOf(p).ry;
/** How far down the stump's far edge is at a distance to one side of its middle. */
function edgeY(p: Place, dx: number): number {
  const { cy, rx, ry } = stumpOf(p);
  const u = Math.min(0.999, Math.abs(dx) / rx);
  return cy - (1 - u ** 2.5) ** (1 / 2.5) * ry;
}
/** The two lantern posts: where each stands, just behind the stump's edge, and which way its arm reaches. */
export function postsOf(p: Place): { x: number; foot: number; side: 1 | -1 }[] {
  const { cx } = stumpOf(p);
  const dx = Math.min(110, Math.floor(p.w / 2) - 12);
  const foot = Math.round(edgeY(p, dx)) - 3;
  return [
    { x: cx - dx, foot, side: 1 },
    { x: cx + dx, foot, side: -1 },
  ];
}
/** Where each lantern hangs: the flame itself. */
export const lampsOf = (p: Place): { x: number; y: number }[] =>
  postsOf(p).map((post) => ({ x: post.x + post.side * 9, y: post.foot - 27 }));

// ---------- the two halves of the board ----------

/** Half the width of a hex at one of its rows, counted from its top point. */
function halfWidth(row: number): number {
  if (row < 0 || row >= HEX_H) return 0;
  const steep = HEX_W / 2 / SLOPE;
  if (row < SLOPE) return (row + 1) * steep;
  if (row >= HEX_H - SLOPE) return (HEX_H - row) * steep;
  return HEX_W / 2;
}
/** The same, one pixel in from the edge all round. */
function insetWidth(row: number): number {
  return Math.min(halfWidth(row - 1), halfWidth(row), halfWidth(row + 1)) - 1;
}

/** One hex, cut into the wood: a dark groove round it and a pale face catching the lantern. */
function drawHex(g: Ctx, cx: number, cy: number, tones: readonly [string, string, string], groove: string): void {
  const top = cy - HEX_H / 2;
  for (let r = 0; r < HEX_H; r++) R(g, cx - halfWidth(r), top + r, halfWidth(r) * 2, 1, groove);
  for (let r = 1; r < HEX_H - 1; r++) {
    const hw = insetWidth(r);
    if (hw <= 0) continue;
    const upper = r < HEX_H / 2;
    R(g, cx - hw, top + r, hw * 2, 1, r <= 2 ? tones[0] : r >= HEX_H - 3 ? tones[2] : tones[1]);
    if (upper && r > 2) R(g, cx - hw, top + r, 1, 1, tones[0]);
    if (!upper && r < HEX_H - 3) R(g, cx + hw - 1, top + r, 1, 1, tones[2]);
  }
}

export const HALF_H = (HOME_ROWS - 1) * ROW + HEX_H;
const NEAR_TONES = [CREAM, PAPER[1], PAPER[0]] as const;
const FAR_TONES = [PAPER[1], PAPER[0], "#a98a5a"] as const;

/**
 * One half of the board as a picture `BOARD_W` wide. The far half is the darker wood; the near
 * half's top row is the member's front line.
 */
export function paintHalf(far: boolean): HTMLCanvasElement {
  const { c, g } = makeCanvas(BOARD_W, HALF_H);
  const first = far ? 0 : HOME_ROWS * COLS;
  const lift = far ? 0 : HOME_ROWS * ROW;
  for (let i = 0; i < HOME_ROWS * COLS; i++) {
    const { x, y } = cellXY(first + i);
    drawHex(g, x, y - lift, far ? FAR_TONES : NEAR_TONES, BARK[1]);
  }
  return outlined(c, BARK[0]);
}

/** A hex-shaped mark laid over one hex of the board, for lighting it. */
export function hexMark(colour: string, rim: string): HTMLCanvasElement {
  const { c, g } = makeCanvas(HEX_W, HEX_H);
  for (let r = 1; r < HEX_H - 1; r++) {
    const hw = insetWidth(r);
    if (hw <= 0) continue;
    R(g, HEX_W / 2 - hw, r, hw * 2, 1, colour);
    R(g, HEX_W / 2 - hw, r, 1, 1, rim);
    R(g, HEX_W / 2 + hw - 1, r, 1, 1, rim);
    if (r <= 2 || r >= HEX_H - 3 || r < SLOPE || r >= HEX_H - SLOPE) {
      const edge = r <= 1 || r >= HEX_H - 2 ? hw * 2 : 2;
      R(g, HEX_W / 2 - hw, r, edge, 1, rim);
      R(g, HEX_W / 2 + hw - edge, r, edge, 1, rim);
    }
  }
  return c;
}

// ---------- small things at the table's edge ----------

/** A fern: fronds arching out from one foot, each with its rows of leaflets (as in the town). */
function drawFern(g: Ctx, bx: number, by: number, size: number, cols: readonly string[], seed: number): void {
  const n = 5 + Math.floor(hash(seed, 1, 81) * 3);
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + ((i - (n - 1) / 2) * 2.3) / n + (hash(seed, i, 82) - 0.5) * 0.25;
    const len = size * (0.72 + hash(seed, i, 83) * 0.4);
    let x = bx;
    let y = by;
    const vx = Math.cos(a);
    let vy = Math.sin(a);
    const col = cols[i % cols.length] ?? "#000000";
    for (let s = 0; s < len; s++) {
      x += vx;
      y += vy;
      vy += (0.9 / size) * (1 + Math.abs(vx));
      R(g, Math.round(x), Math.round(y), 1, 1, col);
      if (s % 2 === 1 && s > 1) {
        const reach = Math.max(1, Math.round((1 - s / len) * size * 0.24));
        const k = Math.hypot(vx, vy) || 1;
        for (let q = 1; q <= reach; q++) {
          R(g, Math.round(x - (vy / k) * q), Math.round(y + (vx / k) * q), 1, 1, col);
          R(g, Math.round(x + (vy / k) * q), Math.round(y - (vx / k) * q), 1, 1, col);
        }
      }
    }
  }
}

const MUSHLET = [".rrrr.", "rwrrrr", "RRRRRR", "..cC..", "..cC..", ".ccCC."];
const FLOWERS = [
  ["..p..", ".pyp.", "..p..", "..G..", ".GG..", "..G.."],
  ["..w..", ".wyw.", "..w..", "..G..", "..GG.", "..G.."],
  [".y.y.", "..r..", ".y.y.", "..G..", ".GG..", "..G.."],
];

/** A log to sit on, lying across. */
function drawLog(g: Ctx, x: number, y: number, w: number): void {
  const { c, g: lg } = makeCanvas(w, 11);
  R(lg, 2, 5, w - 3, 5, BARK[2]);
  R(lg, 3, 10, w - 5, 1, BARK[0]);
  R(lg, 2, 0, w - 3, 5, BARK[3]);
  for (let i = 0; i * 4 + 8 < w; i++) {
    R(lg, 5 + i * 4 + (i % 2), 1 + (i % 3), 3, 1, BARK[4]);
    R(lg, 6 + i * 4, 6 + ((i * 2) % 3), 2, 1, BARK[1]);
  }
  R(lg, w - 2, 1, 1, 8, BARK[1]);
  ell(lg, 3, 5, 3, 5, GOLD[0]);
  ell(lg, 3, 5, 1.6, 3, BARK[4]);
  const pic = outlined(c, INK);
  g.drawImage(pic, Math.round(x - w / 2) - 1, y - 12);
}

/** A redwood trunk from its foot upward, furrowed, spreading into roots (as in the town). */
function paintTrunk(hw: number, height: number, seed: number): HTMLCanvasElement {
  const flare = Math.round(hw * 0.5);
  const rootH = hw * 1.5;
  const w = (hw + flare) * 2 + 4;
  const cx = w / 2;
  const half = (y: number): number =>
    hw + flare * clamp((y - (height - rootH)) / rootH, 0, 1) ** 2.6 + Math.sin(y * 0.021 + seed) * 1.4;
  return paint(w, height, (x, y) => {
    const hf = half(y);
    const off = Math.abs(x + 0.5 - cx);
    if (off >= hf) return null;
    const u = (x + 0.5 - cx) / hf;
    let idx = 4.9 - 2.5 * Math.abs(u + 0.28) ** 1.4;
    const stripe = (u * hf) / 6.5 + 0.7 * vnoise(x * 0.09, y * 0.014, seed) + 0.3 * Math.sin(y * 0.03 + seed);
    const f = stripe - Math.floor(stripe);
    if (f < 0.24) idx -= 1.5;
    else if (f > 0.66 && f < 0.86) idx += 0.8;
    idx += (hash(x, y >> 1, seed) - 0.5) * 0.7;
    if (off > hf - 1.3) idx = Math.min(idx, 1.4);
    return at(TRUNK_RAMP, idx);
  });
}

/** A lantern post with its arm reaching `side` (1 right, -1 left), and whichever lantern is hung. */
function drawPost(g: Ctx, x: number, foot: number, side: 1 | -1, lantern: LanternId): void {
  const { c, g: pg } = makeCanvas(20, 40);
  R(pg, 4, 37, 6, 3, STONE[1]);
  R(pg, 4, 37, 6, 1, STONE[3]);
  R(pg, 5, 4, 3, 34, BARK[1]);
  R(pg, 5, 4, 1, 34, BARK[3]);
  R(pg, 4, 2, 5, 2, BARK[2]);
  R(pg, 5, 5, 12, 2, BARK[1]);
  R(pg, 5, 5, 12, 1, BARK[3]);
  for (let i = 0; i < 4; i++) R(pg, 8 + i, 10 - i, 1, 1, BARK[1]);
  R(pg, 15, 7, 1, 2, BARK[0]);
  if (lantern === "paper") {
    R(pg, 14, 9, 3, 1, BARK[1]);
    R(pg, 13, 10, 5, 5, SKY[4]);
    R(pg, 14, 10, 3, 5, SKY[5]);
    R(pg, 15, 11, 1, 3, CREAM);
    R(pg, 14, 15, 3, 1, BARK[1]);
    R(pg, 15, 16, 1, 1, SKY[4]);
  } else if (lantern === "jar") {
    R(pg, 14, 9, 3, 1, BARK[3]);
    R(pg, 13, 10, 5, 6, PAL.U ?? CREAM);
    R(pg, 14, 11, 3, 4, "#2f5884");
    R(pg, 14, 12, 1, 1, GOLD[2]);
    R(pg, 16, 13, 1, 1, GOLD[2]);
    R(pg, 15, 11, 1, 1, CREAM);
  } else {
    R(pg, 15, 9, 1, 1, BARK[0]);
    R(pg, 13, 10, 5, 1, BARK[0]);
    R(pg, 13, 11, 5, 5, BARK[0]);
    R(pg, 14, 11, 3, 5, GOLD[2]);
    R(pg, 14, 12, 3, 3, CREAM);
    R(pg, 13, 16, 5, 1, BARK[0]);
  }
  const pic = outlined(c, INK);
  if (side === 1) g.drawImage(pic, x - 7, foot - 41);
  else {
    g.save();
    g.translate(x + 8, foot - 41);
    g.scale(-1, 1);
    g.drawImage(pic, 0, 0);
    g.restore();
  }
}

function radial(stops: readonly (readonly [number, string])[]): HTMLCanvasElement {
  const { c, g } = makeCanvas(64, 64);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [stop, col] of stops) gr.addColorStop(stop, col);
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return c;
}
let hole: HTMLCanvasElement | null = null;
let warm: HTMLCanvasElement | null = null;
/** A soft warm glow, for adding light to the picture. */
export function warmGlow(): HTMLCanvasElement {
  warm ??= radial([
    [0, "rgba(255,196,120,1)"],
    [0.4, "rgba(255,160,90,0.5)"],
    [1, "rgba(255,140,80,0)"],
  ]);
  return warm;
}
function lightHole(): HTMLCanvasElement {
  hole ??= radial([
    [0, "rgba(0,0,0,1)"],
    [0.45, "rgba(0,0,0,0.9)"],
    [0.75, "rgba(0,0,0,0.4)"],
    [1, "rgba(0,0,0,0)"],
  ]);
  return hole;
}

// ---------- the whole table ----------

const CLOTH: Readonly<Record<ClothId, readonly [string, string, string] | null>> = {
  bare: null,
  baize: [GREEN[2], GREEN[1], GREEN[0]],
  plum: [SKY[2], SKY[1], SKY[0]],
  gingham: [CREAM, SKY[5], "#b0483a"],
};

/** The cloth under the board, if there is one: its colour at a pixel, or null where it does not reach. */
function clothAt(cloth: ClothId, x: number, y: number, p: Place): string | null {
  const tones = CLOTH[cloth];
  if (!tones) return null;
  const x0 = p.bx - 9;
  const x1 = p.bx + BOARD_W + 9;
  const y0 = p.by - GAP - 8;
  const y1 = p.by + BOARD_H + 6;
  if (x < x0 || x >= x1 || y < y0 || y >= y1) return null;
  const dx = Math.min(x - x0, x1 - 1 - x);
  const dy = Math.min(y - y0, y1 - 1 - y);
  if (dx + dy < 3) return null;
  const edge = Math.min(dx, dy);
  if (cloth === "gingham") {
    if (edge < 1) return tones[2];
    const a = Math.floor((x - x0) / 4) % 2;
    const b = Math.floor((y - y0) / 4) % 2;
    return a + b === 2 ? tones[2] : a + b === 1 ? tones[1] : tones[0];
  }
  if (edge < 1) return tones[2];
  if (edge === 2) return cloth === "plum" ? GOLD[1] : tones[0];
  // A little nap in the cloth, and a fold where it has been kept.
  if (hash(x >> 1, y >> 1, 611) > 0.9) return tones[0];
  if ((x - x0) % 56 === 55) return tones[2];
  return tones[1];
}

/** The table and everything round it that never moves, lit, for a window this size. */
export function paintTable(p: Place, cloth: ClothId, lantern: LanternId): HTMLCanvasElement {
  const { cx, cy, rx, ry } = stumpOf(p);
  const rim = cy - ry;
  const horizon = rim - 20;
  // The stump's top is not quite round: fatter at the corners, with a wobble in its edge.
  const inTop = (x: number, y: number): number => {
    const u = Math.abs((x + 0.5 - cx) / rx);
    const v = Math.abs((y + 0.5 - cy) / ry);
    return (u ** 2.5 + v ** 2.5) ** (1 / 2.5) + (vnoise(x / 9, y / 9, 501) - 0.5) * 0.035;
  };
  const c = paint(p.w, p.h, (x, y) => {
    const d = inTop(x, y);
    if (d < 1) {
      if (d > 0.985) return BARK[0];
      if (d > 0.95) return hash(x >> 1, y >> 1, 502) > 0.7 ? BARK[2] : BARK[3];
      const laid = clothAt(cloth, x, y, p);
      if (laid) return laid;
      // The rings, counted from a heart a little off the middle.
      const hx = (x - (cx + 14)) / rx;
      const hy = (y - (cy - 6)) / ry;
      const ring = Math.hypot(hx, hy) * 13 + vnoise(x / 22, y / 22, 503) * 1.1;
      const f = ring - Math.floor(ring);
      if (f < 0.16) return BARK[4];
      if (f > 0.9 && hash(x, y, 504) > 0.5) return GOLD[1];
      // A crack or two running out from the heart.
      if (Math.abs(hy * 3 - hx) < 0.012 && hx > 0.05 && hx < 0.5) return BARK[3];
      return GOLD[0];
    }
    // The side of the stump below its top: furrowed bark down to the roots.
    const wall = inTop(x, y - 14);
    if (wall < 1 && y > cy) {
      const furrow = hash(x, 3, 505);
      let idx = 2.6 - ((x - cx) / rx) * 1.2 + (furrow > 0.72 ? -1.2 : furrow < 0.2 ? 0.8 : 0);
      if (inTop(x, y - 2) < 1) idx -= 1;
      return at(BARK, idx);
    }
    if (y < horizon) {
      // The last of the sunset between the far trunks.
      const band = y / Math.max(1, horizon);
      const sky = at(SKY, 2 + band * 4 + (hash(x, y, 506) - 0.5) * 0.6);
      for (let k = Math.floor(x / 41) - 1; k <= Math.floor(x / 41) + 1; k++) {
        if (hash(k, 7, 507) < 0.2) continue;
        const tx = k * 41 + hash(k, 8, 508) * 26;
        const half = 5 + hash(k, 9, 509) * 9 + Math.max(0, y - (horizon - 9)) * 0.5;
        if (Math.abs(x - tx) < half) return hash(k, 4, 510) > 0.5 ? SKY[0] : SKY[1];
      }
      if (y > horizon - 4 - vnoise(x / 30, 3, 511) * 5) return SKY[1];
      return sky;
    }
    if (y < horizon + 4) return at(DEEP, (y - horizon) / 2 + hash(x >> 1, y, 512) * 0.8);
    // Grass: one green with lighter and darker drifts, shaded toward the trees and the picture's edge.
    const n = vnoise(x / 34, y / 13, 513);
    let idx = n > 0.7 ? 3 : n < 0.27 ? 1 : 2;
    const edge = Math.min(x + 6, p.w + 6 - x, (y - horizon) * 1.6);
    if (edge < 8 + vnoise(x / 26, y / 20, 514) * 30) idx -= 1;
    if (d < 1.06) idx -= 1;
    idx = clamp(idx, 0, 3);
    const gx = Math.floor(x / 13);
    const gy = Math.floor(y / 9);
    if (hash(gx, gy, 515) > 0.62) {
      const dx = x - (gx * 13 + 1 + Math.floor(hash(gx, gy, 516) * 9));
      const dy = y - (gy * 9 + 3 + Math.floor(hash(gx, gy, 517) * 5));
      if ((dx === 0 && dy === 0) || (dx === 2 && dy === 0)) return at(GREEN, idx - 1);
      if (dx === 1 && dy === -1) return at(GREEN, idx + 1);
    }
    return at(GREEN, idx);
  });
  const g = c.getContext("2d");
  if (!g) return c;
  g.imageSmoothingEnabled = false;

  // Great trunks at the picture's sides, where there is room for them.
  if (p.w > 330) {
    const left = paintTrunk(30, p.h, 3);
    g.drawImage(left, -Math.round(left.width * 0.45), 0);
    const right = paintTrunk(36, p.h, 5);
    g.drawImage(right, p.w - Math.round(right.width * 0.5), 0);
  }

  // Moss creeping over the rim, heaviest on the shaded side.
  for (let i = 0; i < 260; i++) {
    const a = hash(i, 1, 520) * Math.PI * 2;
    const heavy = Math.cos(a - 0.6) > 0.2 ? 1 : 0.45;
    if (hash(i, 2, 521) > heavy) continue;
    const r = 0.94 + hash(i, 3, 522) * 0.07;
    const sx = Math.sign(Math.cos(a)) * Math.abs(Math.cos(a)) ** 0.8;
    const sy = Math.sign(Math.sin(a)) * Math.abs(Math.sin(a)) ** 0.8;
    const x = Math.round(cx + sx * rx * r);
    const y = Math.round(cy + sy * ry * r);
    const wide = 2 + Math.floor(hash(i, 4, 523) * 4);
    R(g, x, y, wide, 1, GREEN[3]);
    if (hash(i, 5, 524) > 0.5) R(g, x + 1, y - 1, Math.max(1, wide - 2), 1, GREEN[4]);
    if (hash(i, 6, 525) > 0.75) R(g, x, y + 1, wide - 1, 1, GREEN[2]);
  }
  // Flowers in the grass, mushrooms that have moved in, ferns at the foot.
  const mush = outlined(bitmap(MUSHLET, PAL), INK);
  for (let i = 0; i < 22; i++) {
    const x = Math.round(hash(i, 1, 530) * p.w);
    const y = Math.round(horizon + 8 + hash(i, 2, 531) * (p.h - horizon - 8));
    if (inTop(x, y) < 1.08 || inTop(x, y - 14) < 1.05) continue;
    const kind = Math.floor(hash(i, 3, 532) * 4);
    if (kind === 3) g.drawImage(mush, x, y - 6);
    else g.drawImage(bitmap(FLOWERS[kind] ?? [], PAL), x, y - 6);
  }
  for (const [fx, fy, size, seed] of [
    [cx - rx - 4, cy - 30, 9, 541],
    [cx + rx + 5, cy - 22, 10, 542],
    [cx - rx + 4, cy + 34, 11, 543],
    [cx + rx - 3, cy + 40, 9, 544],
    [cx - rx * 0.72, cy - ry * 0.86, 7, 545],
    [cx + rx * 0.74, cy - ry * 0.84, 8, 546],
  ] as const) {
    drawFern(g, Math.round(fx), Math.round(fy), size, [GREEN[3], GREEN[4], GREEN[3]], seed);
  }
  g.drawImage(mush, Math.round(cx - rx * 0.86), Math.round(cy - ry * 0.52));
  g.drawImage(mush, Math.round(cx + rx * 0.8), Math.round(cy + ry * 0.2));

  // Somewhere to sit and watch, where the window is wide enough to have sides.
  if (p.w > 330) {
    drawLog(g, cx - rx - 34, cy + 6, 30);
    drawLog(g, cx + rx + 34, cy + 12, 30);
  }
  for (const post of postsOf(p)) drawPost(g, post.x, post.foot, post.side, lantern);

  // The bench: a plank along the near edge with nine hollows cut in it.
  const px = p.bx + BENCH_X - 4;
  const py = p.by + BENCH_Y - 2;
  const pw = BENCH_W + 8;
  const ph = BENCH_H + 3;
  R(g, px, py - 1, pw, ph + 2, INK);
  R(g, px - 1, py, pw + 2, ph, INK);
  R(g, px, py, pw, ph, BARK[3]);
  R(g, px, py, pw, 1, BARK[4]);
  R(g, px, py + ph - 2, pw, 2, BARK[1]);
  for (let i = 0; i < 9; i++) R(g, px + 6 + i * 21, py + 1, 9, 1, BARK[2]);
  for (const nx of [px + 1, px + pw - 3]) {
    R(g, nx, py + 3, 2, 2, GOLD[1]);
    R(g, nx, py + ph - 6, 2, 2, GOLD[1]);
  }
  for (let i = 0; i < BENCH_SLOTS; i++) {
    const sx = p.bx + BENCH_X + i * SLOT_W + 1;
    const sy = py + 3;
    R(g, sx, sy, SLOT_W - 2, BENCH_H - 5, INK);
    R(g, sx + 1, sy + 1, SLOT_W - 3, BENCH_H - 6, "#211228");
    R(g, sx + 1, sy + BENCH_H - 6, SLOT_W - 3, 1, SKY[1]);
    R(g, sx + SLOT_W - 3, sy + 1, 1, BENCH_H - 6, SKY[1]);
  }

  // Dusk over everything, with the lanterns' light and the pool it throws on the board cut out.
  const dusk = makeCanvas(p.w, p.h);
  const d = dusk.g;
  const fall = d.createLinearGradient(0, 0, 0, p.h);
  fall.addColorStop(0, "rgba(32,14,50,0.30)");
  fall.addColorStop(1, "rgba(32,14,50,0.58)");
  d.fillStyle = fall;
  d.fillRect(0, 0, p.w, p.h);
  d.globalCompositeOperation = "destination-out";
  const pool = Math.max(rx, ry) * 1.25;
  d.drawImage(lightHole(), cx - pool, cy - pool * 0.86, pool * 2, pool * 1.72);
  const lamps = lampsOf(p);
  for (const l of lamps) d.drawImage(lightHole(), l.x - 44, l.y - 40, 88, 88);
  g.drawImage(dusk.c, 0, 0);
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = 0.16;
  for (const l of lamps) g.drawImage(warmGlow(), l.x - 40, l.y - 38, 80, 80);
  g.globalAlpha = 0.07;
  g.drawImage(warmGlow(), cx - pool, cy - pool * 0.8, pool * 2, pool * 1.6);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  if (lantern === "jar") {
    // The fireflies that did not stay in the jar.
    for (let i = 0; i < 9; i++) {
      const l = lamps[i % lamps.length];
      if (!l) continue;
      R(
        g,
        Math.round(l.x + (hash(i, 1, 550) - 0.5) * 50),
        Math.round(l.y + (hash(i, 2, 551) - 0.3) * 36),
        1,
        1,
        GOLD[2],
      );
    }
  }
  return c;
}

/**
 * A corner of the table as it would look dressed a certain way, for trying a look on before it is
 * bought: a patch of cloth with a few hexes on it, the lantern lit, and three figures on their bases.
 */
export function paintSwatch(cloth: ClothId, lantern: LanternId, bases: BaseLook): HTMLCanvasElement {
  const w = 92;
  const h = 62;
  const p: Place = { w, h, bx: 20, by: 24 };
  const c = paint(w, h, (x, y) => {
    const laid = clothAt(cloth, x, y, p);
    if (laid && x < w - 4 && y < h - 4) return laid;
    const ring = Math.hypot(x - 80, (y - 8) * 1.3) / 9 + vnoise(x / 22, y / 22, 503) * 1.1;
    const f = ring - Math.floor(ring);
    return f < 0.16 ? BARK[4] : GOLD[0];
  });
  const g = c.getContext("2d");
  if (!g) return c;
  const spots: (readonly [number, number])[] = [
    [36, 42],
    [56, 42],
    [76, 42],
    [46, 27],
    [66, 27],
  ];
  const hexes = makeCanvas(w, h);
  for (const [x, y] of spots) drawHex(hexes.g, x, y, NEAR_TONES, BARK[1]);
  g.drawImage(outlined(hexes.c, BARK[0]), -1, -1);
  const stand: (readonly [UnitKind, number, number])[] = [
    ["mossmote", 36, 45],
    ["crab7", 56, 45],
    ["glorp", 76, 45],
  ];
  for (const [kind, x, y] of stand) {
    drawStanding(g, kind, x, y, bases);
  }
  drawPost(g, 9, 56, 1, lantern);
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = 0.2;
  g.drawImage(warmGlow(), 18 - 30, 29 - 30, 60, 60);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  return c;
}
