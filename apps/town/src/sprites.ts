/** Everything in the town that is drawn once and kept: the shops, the stalls, the small things, the icons. */

import { BARK, CREAM, GOLD, GREEN, INK, PAPER, SKY, STONE, WATER } from "@sequoia-leaf/kit/palette.ts";
import { bitmap, ell, outlined, paint, R } from "@sequoia-leaf/kit/pix.ts";
import { clamp, type Ctx, hash, makeCanvas, vnoise } from "@sequoia-leaf/kit/util.ts";

import { drawFern } from "./ground.ts";
import type { PlaceId } from "./world.ts";

export interface Sprite {
  c: HTMLCanvasElement;
  /** The pixel of the picture that goes on the thing's spot in the world. */
  ax: number;
  ay: number;
}

const spr = (c: HTMLCanvasElement, ax: number, ay: number): Sprite => ({ c: outlined(c, INK), ax: ax + 1, ay: ay + 1 });
const at = (ramp: readonly string[], i: number): string => ramp[clamp(Math.round(i), 0, ramp.length - 1)] ?? "#000000";

/** Letters for pictures typed out in rows. */
const PAL: Readonly<Record<string, string>> = {
  k: INK,
  w: CREAM,
  y: GOLD[1],
  Y: GOLD[2],
  o: GOLD[0],
  r: SKY[5],
  R: "#b0483a",
  p: SKY[4],
  v: SKY[3],
  V: SKY[2],
  g: GREEN[2],
  G: GREEN[3],
  l: GREEN[4],
  d: GREEN[0],
  b: BARK[1],
  B: BARK[2],
  n: BARK[3],
  N: BARK[4],
  s: STONE[1],
  S: STONE[2],
  t: STONE[3],
  c: "#e9d8b8",
  C: "#cbb894",
  u: WATER[2],
  U: WATER[3],
};

// ---------- surfaces ----------

function stones(g: Ctx, x: number, y: number, w: number, h: number, seed: number): void {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  R(g, x, y, w, h, STONE[0]);
  for (let r = 0; r * 6 < h; r++) {
    let bx = x - Math.floor(hash(r, 1, seed) * 8);
    while (bx < x + w) {
      const bw = 7 + Math.floor(hash(bx, r, seed) * 6);
      const v = hash(bx, r, seed + 1);
      R(g, bx, y + r * 6, bw - 1, 5, v > 0.7 ? STONE[2] : STONE[1]);
      if (v > 0.45) R(g, bx, y + r * 6, bw - 1, 1, v > 0.7 ? STONE[3] : STONE[2]);
      bx += bw;
    }
  }
  g.restore();
}

function planks(g: Ctx, x: number, y: number, w: number, h: number, seed: number): void {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  planksIn(g, x, y, w, h, seed);
  g.restore();
}

function planksIn(g: Ctx, x: number, y: number, w: number, h: number, seed: number): void {
  for (let bx = x; bx < x + w; bx += 5) {
    const v = hash(bx, 7, seed);
    R(g, bx, y, 4, h, v > 0.55 ? BARK[3] : BARK[2]);
    R(g, bx + 4, y, 1, h, BARK[1]);
    if (v > 0.6) R(g, bx + 1, y + 5 + Math.floor(v * (h - 10)), 2, 1, BARK[1]);
  }
}

/** Rows of shingles on a roof that narrows towards its ridge. `cols`: shadow, two body tones, light. */
function shingles(
  g: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  inset: (row: number) => number,
  cols: readonly [string, string, string, string],
  seed: number,
): void {
  for (let r = 0; r * 4 < h; r++) {
    const by = y + r * 4;
    const bh = Math.min(4, y + h - by);
    const ins = inset(by - y);
    const bx = x + ins;
    const bw = w - ins * 2;
    R(g, bx, by, bw, bh, r % 2 ? cols[1] : cols[2]);
    R(g, bx, by + bh - 1, bw, 1, cols[0]);
    for (let sx = bx + (r % 2 ? 3 : 0); sx < bx + bw - 1; sx += 6) {
      R(g, sx, by, 1, bh - 1, cols[0]);
      if (hash(sx, r, seed) > 0.55 && sx + 4 < bx + bw) R(g, sx + 1, by, 3, 1, cols[3]);
    }
  }
}

function windowLit(g: Ctx, x: number, y: number, w: number, h: number): void {
  R(g, x - 1, y - 1, w + 2, h + 2, BARK[0]);
  R(g, x, y, w, h, GOLD[1]);
  R(g, x, y, w, Math.floor(h / 2), GOLD[2]);
  R(g, x + 1, y + 1, Math.floor(w / 2) - 1, 2, CREAM);
  R(g, x + Math.floor(w / 2), y, 1, h, BARK[1]);
  R(g, x, y + Math.floor(h / 2), w, 1, BARK[1]);
  R(g, x - 2, y + h + 1, w + 4, 1, STONE[3]);
}

/** A doorway with a rounded head. */
function arch(g: Ctx, x: number, y: number, w: number, h: number, col: string): void {
  R(g, x + 5, y, w - 10, 1, col);
  R(g, x + 3, y + 1, w - 6, 1, col);
  R(g, x + 2, y + 2, w - 4, 1, col);
  R(g, x + 1, y + 3, w - 2, 2, col);
  R(g, x, y + 5, w, h - 5, col);
}

/** The guild's sun, in gold: a disc and eight short rays, six pixels across at its heart. */
function sun(g: Ctx, x: number, y: number): void {
  R(g, x + 1, y, 4, 6, GOLD[1]);
  R(g, x, y + 1, 6, 4, GOLD[1]);
  R(g, x + 1, y + 1, 4, 4, GOLD[2]);
  R(g, x + 2, y + 2, 2, 2, CREAM);
  R(g, x + 2, y - 4, 2, 2, GOLD[1]);
  R(g, x + 2, y + 8, 2, 2, GOLD[1]);
  R(g, x - 4, y + 2, 2, 2, GOLD[1]);
  R(g, x + 8, y + 2, 2, 2, GOLD[1]);
  for (const [dx, dy] of [
    [-2, -2],
    [7, -2],
    [-2, 7],
    [7, 7],
  ] as const)
    R(g, x + dx, y + dy, 1, 1, GOLD[1]);
}

function gear(g: Ctx, cx: number, cy: number, r: number, body: string, shade: string): void {
  for (let dy = -r - 2; dy <= r + 2; dy++) {
    for (let dx = -r - 2; dx <= r + 2; dx++) {
      const d = Math.hypot(dx + 0.5, dy + 0.5);
      const tooth = Math.cos(Math.atan2(dy + 0.5, dx + 0.5) * 8) > 0.25;
      if (d < r * 0.36 || !(d <= r - 0.4 || (d <= r + 1.7 && tooth))) continue;
      R(g, cx + dx, cy + dy, 1, 1, dx + dy > 1 ? shade : body);
    }
  }
}

function lantern(g: Ctx, x: number, y: number): void {
  R(g, x + 2, y, 1, 1, BARK[0]);
  R(g, x, y + 1, 5, 1, BARK[0]);
  R(g, x, y + 2, 5, 5, BARK[0]);
  R(g, x + 1, y + 2, 3, 5, GOLD[2]);
  R(g, x + 1, y + 3, 3, 3, CREAM);
  R(g, x, y + 7, 5, 1, BARK[0]);
}

// ---------- the Treasury ----------

function treasury(): { body: Sprite; counter: Sprite } {
  const { c, g } = makeCanvas(96, 92);
  stones(g, 4, 46, 88, 46, 11);
  R(g, 4, 46, 88, 3, STONE[0]);
  for (const x of [4, 89]) {
    R(g, x, 46, 3, 46, BARK[1]);
    R(g, x, 46, 1, 46, BARK[2]);
  }
  windowLit(g, 11, 60, 9, 13);
  windowLit(g, 76, 60, 9, 13);

  // The shop front: an arch of pale stone, and the warm dark inside it.
  arch(g, 24, 50, 48, 42, STONE[3]);
  for (let i = 0; i < 7; i++) {
    R(g, 24, 57 + i * 6, 3, 1, STONE[1]);
    R(g, 69, 57 + i * 6, 3, 1, STONE[1]);
  }
  for (let i = 0; i < 6; i++) R(g, 31 + i * 7, 50, 1, 3, STONE[1]);
  arch(g, 27, 53, 42, 39, "#2b141d");
  R(g, 27, 58, 42, 34, "#3a1a1f");
  for (const y of [61, 69]) R(g, 28, y, 40, 1, BARK[2]);
  for (const [x, y, h] of [
    [30, 61, 3],
    [34, 61, 5],
    [38, 61, 2],
    [56, 61, 4],
    [60, 61, 3],
    [64, 61, 5],
    [31, 69, 4],
    [36, 69, 2],
    [58, 69, 3],
    [63, 69, 4],
  ] as const) {
    R(g, x, y - h, 3, h, GOLD[0]);
    R(g, x, y - h, 3, 1, GOLD[2]);
  }
  R(g, 22, 90, 52, 2, STONE[2]);

  shingles(g, 0, 8, 96, 38, (r) => Math.round((38 - r) * 0.27), [SKY[0], SKY[1], SKY[2], SKY[3]], 5);
  R(g, 9, 5, 78, 3, BARK[1]);
  R(g, 9, 5, 78, 1, BARK[3]);
  R(g, 0, 45, 96, 1, SKY[0]);

  // The gable over the arch, timbered, where the sun banner hangs.
  for (let y = 4; y <= 48; y++) {
    const half = Math.round((y - 4) * 0.6);
    R(g, 48 - half - 3, y, half * 2 + 6, 1, y % 4 === 0 ? SKY[2] : SKY[3]);
  }
  for (let y = 8; y <= 46; y++) {
    const half = Math.round((y - 8) * 0.6);
    R(g, 48 - half, y, half * 2, 1, BARK[1]);
    if (half > 2) R(g, 48 - half + 2, y, half * 2 - 4, 1, y > 30 ? "#cfa57c" : "#e3c59b");
  }
  R(g, 25, 44, 46, 3, BARK[1]);
  R(g, 25, 44, 46, 1, BARK[3]);
  R(g, 36, 12, 24, 2, GOLD[0]);
  R(g, 35, 11, 2, 4, GOLD[1]);
  R(g, 59, 11, 2, 4, GOLD[1]);
  R(g, 40, 14, 16, 25, SKY[4]);
  for (let k = 0; k < 5; k++) {
    R(g, 40, 39 + k, 7 - k, 1, SKY[4]);
    R(g, 49 + k, 39 + k, 7 - k, 1, SKY[4]);
  }
  R(g, 40, 14, 1, 30, GOLD[0]);
  R(g, 55, 14, 1, 30, GOLD[0]);
  R(g, 53, 15, 1, 24, "#9c3f73");
  sun(g, 45, 23);

  // The counter is its own piece, so that Cinfy can stand behind it.
  const k = makeCanvas(46, 20);
  R(k.g, 1, 10, 44, 10, BARK[2]);
  for (let i = 0; i < 7; i++) R(k.g, 1 + i * 7, 10, 1, 10, BARK[1]);
  R(k.g, 1, 10, 44, 1, BARK[1]);
  R(k.g, 1, 19, 44, 1, BARK[0]);
  R(k.g, 0, 6, 46, 4, BARK[4]);
  R(k.g, 0, 6, 46, 1, GOLD[0]);
  R(k.g, 20, 12, 6, 6, BARK[1]);
  R(k.g, 21, 13, 4, 4, GOLD[1]);
  R(k.g, 22, 14, 2, 2, CREAM);
  for (const [x, h] of [
    [3, 5],
    [7, 3],
    [11, 4],
  ] as const) {
    R(k.g, x, 6 - h, 3, h, GOLD[1]);
    for (let y = 6 - h + 1; y < 6; y += 2) R(k.g, x, y, 3, 1, GOLD[0]);
    R(k.g, x, 6 - h, 3, 1, CREAM);
  }
  R(k.g, 37, 2, 4, 3, GOLD[1]);
  R(k.g, 36, 5, 6, 1, GOLD[0]);
  R(k.g, 38, 1, 2, 1, GOLD[2]);
  R(k.g, 37, 2, 1, 2, CREAM);
  return { body: spr(c, 0, 92), counter: spr(k.c, 0, 20) };
}

// ---------- the Works ----------

function works(): Sprite {
  const { c, g } = makeCanvas(104, 98);
  planks(g, 4, 50, 96, 38, 17);
  stones(g, 4, 86, 96, 12, 19);
  R(g, 4, 50, 96, 3, BARK[0]);
  R(g, 4, 84, 96, 2, BARK[1]);
  for (const x of [4, 97]) {
    R(g, x, 50, 3, 36, BARK[1]);
    R(g, x, 50, 1, 36, BARK[3]);
  }

  // The forge door, with the hearth alight inside.
  arch(g, 13, 60, 32, 38, STONE[2]);
  for (let i = 0; i < 6; i++) {
    R(g, 13, 67 + i * 6, 3, 1, STONE[0]);
    R(g, 42, 67 + i * 6, 3, 1, STONE[0]);
  }
  arch(g, 16, 63, 26, 35, "#24121a");
  R(g, 19, 76, 20, 16, STONE[0]);
  R(g, 19, 76, 20, 1, STONE[2]);
  R(g, 22, 80, 14, 11, BARK[0]);
  R(g, 23, 83, 12, 8, SKY[5]);
  R(g, 24, 85, 10, 6, GOLD[1]);
  R(g, 26, 87, 6, 4, CREAM);
  R(g, 33, 92, 7, 2, STONE[1]);
  R(g, 35, 94, 3, 2, STONE[0]);
  R(g, 33, 96, 7, 2, STONE[0]);

  // The hatch the belt comes out of.
  R(g, 55, 82, 18, 16, STONE[0]);
  R(g, 55, 82, 18, 1, STONE[2]);
  R(g, 57, 84, 14, 14, "#24121a");
  for (let i = 0; i < 4; i++) R(g, 57 + i * 4, 84, 3, 5, SKY[1]);
  windowLit(g, 81, 62, 10, 12);

  shingles(g, 0, 16, 104, 34, (r) => Math.round((34 - r) * 0.28), [BARK[0], BARK[2], BARK[3], BARK[4]], 9);
  R(g, 9, 13, 86, 3, BARK[1]);
  R(g, 9, 13, 86, 1, BARK[3]);
  R(g, 0, 49, 104, 1, BARK[0]);

  stones(g, 76, 3, 13, 36, 23);
  R(g, 87, 3, 2, 36, STONE[0]);
  R(g, 74, 0, 17, 4, STONE[0]);
  R(g, 74, 0, 17, 1, STONE[2]);
  R(g, 77, 1, 11, 1, "#24121a");
  R(g, 75, 38, 15, 2, BARK[0]);

  ell(g, 44, 43, 11, 11, BARK[0]);
  ell(g, 44, 43, 9.5, 9.5, BARK[2]);
  gear(g, 44, 43, 6, GOLD[1], GOLD[0]);
  return spr(c, 0, 98);
}

// ---------- the gate, the board, the stalls ----------

function gate(): Sprite {
  const { c, g } = makeCanvas(64, 58);
  for (const x of [3, 55]) {
    R(g, x, 12, 6, 46, BARK[2]);
    R(g, x, 12, 1, 46, BARK[3]);
    R(g, x + 4, 12, 2, 46, BARK[1]);
    R(g, x - 1, 54, 8, 4, STONE[1]);
    R(g, x - 1, 54, 8, 1, STONE[3]);
  }
  for (let i = 0; i < 6; i++) {
    R(g, 9 + i, 24 - i, 1, 2, BARK[1]);
    R(g, 54 - i, 24 - i, 1, 2, BARK[1]);
  }
  R(g, 0, 12, 64, 7, BARK[1]);
  R(g, 0, 12, 64, 1, BARK[3]);
  R(g, 0, 18, 64, 1, BARK[0]);
  shingles(g, 0, 2, 64, 10, (r) => Math.round((10 - r) * 0.6), [SKY[0], SKY[1], SKY[2], SKY[3]], 3);
  R(g, 6, 0, 52, 2, BARK[1]);
  R(g, 6, 0, 52, 1, BARK[3]);
  // The hanging sign, with a leaf on it.
  R(g, 24, 19, 1, 3, BARK[0]);
  R(g, 39, 19, 1, 3, BARK[0]);
  R(g, 20, 22, 24, 9, BARK[1]);
  R(g, 21, 23, 22, 7, BARK[3]);
  R(g, 21, 23, 22, 1, BARK[4]);
  g.drawImage(bitmap(["...ll", ".lllG", "lllG.", "llG..", "G...."], PAL), 29, 24);
  lantern(g, 11, 20);
  lantern(g, 48, 20);
  return spr(c, 32, 58);
}

function signpost(): Sprite {
  const { c, g } = makeCanvas(18, 26);
  R(g, 8, 4, 3, 22, BARK[1]);
  R(g, 8, 4, 1, 22, BARK[3]);
  R(g, 7, 24, 5, 2, STONE[1]);
  // "Your camp", pointing through the gate; and the way back to town.
  for (let i = 0; i < 4; i++) R(g, i, 6 - i + 1, 1, i * 2 + 1, BARK[3]);
  R(g, 4, 3, 13, 8, BARK[3]);
  R(g, 4, 3, 13, 1, BARK[4]);
  R(g, 4, 10, 13, 1, BARK[1]);
  R(g, 6, 5, 7, 1, CREAM);
  R(g, 6, 7, 9, 1, CREAM);
  R(g, 2, 14, 12, 6, BARK[2]);
  for (let i = 0; i < 3; i++) R(g, 14 + i, 14 + i, 1, 6 - i * 2, BARK[2]);
  R(g, 4, 16, 6, 1, GOLD[2]);
  return spr(c, 9, 26);
}

function board(): Sprite {
  const { c, g } = makeCanvas(44, 42);
  for (const x of [3, 38]) {
    R(g, x, 8, 3, 34, BARK[1]);
    R(g, x, 8, 1, 34, BARK[3]);
  }
  R(g, 1, 10, 42, 22, BARK[1]);
  R(g, 3, 12, 38, 18, BARK[3]);
  for (const y of [17, 23]) R(g, 3, y, 38, 1, BARK[2]);
  for (const [x, y, w, h, tint] of [
    [5, 13, 9, 11, 0],
    [16, 13, 11, 8, 1],
    [29, 13, 9, 12, 0],
    [17, 22, 9, 8, 0],
  ] as const) {
    R(g, x, y, w, h, tint ? GOLD[2] : CREAM);
    R(g, x, y + h - 1, w, 1, "#cbb894");
    for (let k = 0; k * 2 + 3 < h - 1; k++) R(g, x + 1, y + 3 + k * 2, w - 3 - ((k * 3) % 4), 1, BARK[4]);
    R(g, x + Math.floor(w / 2), y, 1, 1, SKY[5]);
  }
  R(g, 20, 14, 2, 4, SKY[5]);
  R(g, 20, 19, 2, 1, SKY[5]);
  R(g, 34, 21, 3, 3, SKY[5]);
  shingles(g, 0, 0, 44, 8, (r) => Math.round((8 - r) * 0.4), [SKY[0], SKY[1], SKY[2], SKY[3]], 7);
  return spr(c, 0, 42);
}

const AWNINGS: readonly (readonly [string, string, string, string])[] = [
  [SKY[3], "#ecdcb8", SKY[2], "#d0bb93"],
  [SKY[5], "#ecdcb8", "#bf584f", "#d0bb93"],
  [GREEN[3], "#ecdcb8", GREEN[2], "#d0bb93"],
];

function stall(kind: number): Sprite {
  const { c, g } = makeCanvas(40, 46);
  const [a, b, a2, b2] = AWNINGS[kind % 3] ?? ["#000", "#000", "#000", "#000"];
  for (const x of [1, 37]) {
    R(g, x, 10, 2, 36, BARK[2]);
    R(g, x + 1, 10, 1, 36, BARK[1]);
  }
  for (let x = 0; x < 40; x++) {
    const stripe = Math.floor(x / 5) % 2 === 0;
    const top = x < 2 || x > 37 ? 2 : x < 4 || x > 35 ? 1 : 0;
    R(g, x, top, 1, 8 - top, stripe ? a : b);
    const m = x % 5;
    R(g, x, 8, 1, m === 2 ? 6 : m === 1 || m === 3 ? 5 : 4, stripe ? a2 : b2);
  }
  R(g, 2, 0, 36, 1, CREAM);
  // The counter, with a runner in the stall's colour.
  R(g, 0, 34, 40, 12, BARK[2]);
  for (let i = 0; i < 6; i++) R(g, i * 7 + 3, 34, 1, 12, BARK[1]);
  R(g, 0, 34, 40, 1, BARK[1]);
  R(g, 0, 45, 40, 1, BARK[0]);
  R(g, 0, 30, 40, 4, BARK[4]);
  R(g, 0, 30, 40, 1, GOLD[0]);
  R(g, 15, 30, 10, 13, a);
  R(g, 17, 30, 2, 13, b);
  R(g, 15, 42, 10, 1, a2);
  if (kind === 0) {
    // Bottles of something.
    [SKY[4], WATER[2], GREEN[4], SKY[3], GOLD[1]].forEach((col, i) => {
      const x = [3, 8, 27, 32, 13][i] ?? 0;
      R(g, x + 1, 23, 1, 2, CREAM);
      R(g, x, 25, 3, 5, col);
      R(g, x, 25, 1, 2, CREAM);
    });
  } else if (kind === 1) {
    // Bread, a cheese, a basket.
    ell(g, 7, 28, 4.5, 2.5, GOLD[0]);
    R(g, 5, 26, 1, 1, CREAM);
    R(g, 8, 26, 1, 1, CREAM);
    ell(g, 31, 27.5, 4, 3, BARK[4]);
    R(g, 29, 26, 5, 1, GOLD[0]);
    R(g, 26, 26, 1, 4, BARK[3]);
    g.drawImage(bitmap(["..yy", ".yYy", "yYYo", "yoYy"], PAL), 10, 26);
  } else {
    // Pots in flower.
    [SKY[4], GOLD[1], CREAM, SKY[5]].forEach((col, i) => {
      const x = [3, 9, 27, 33][i] ?? 0;
      R(g, x, 27, 4, 3, "#b0483a");
      R(g, x, 27, 4, 1, SKY[5]);
      R(g, x + 1, 24, 2, 3, GREEN[3]);
      R(g, x, 23, 2, 2, col);
      R(g, x + 2, 22, 2, 2, col);
    });
  }
  lantern(g, 4, 11);
  return spr(c, 0, 46);
}

// ---------- posts, poles and trees ----------

function post(): Sprite {
  const { c, g } = makeCanvas(18, 38);
  R(g, 4, 35, 6, 3, STONE[1]);
  R(g, 4, 35, 6, 1, STONE[3]);
  R(g, 5, 4, 3, 32, BARK[1]);
  R(g, 5, 4, 1, 32, BARK[3]);
  R(g, 4, 2, 5, 2, BARK[2]);
  R(g, 5, 5, 11, 2, BARK[1]);
  R(g, 5, 5, 11, 1, BARK[3]);
  for (let i = 0; i < 4; i++) R(g, 8 + i, 10 - i, 1, 1, BARK[1]);
  R(g, 14, 7, 1, 2, BARK[0]);
  lantern(g, 12, 9);
  return spr(c, 6, 38);
}

function pole(): Sprite {
  const { c, g } = makeCanvas(11, 74);
  R(g, 2, 68, 7, 6, STONE[1]);
  R(g, 2, 68, 7, 1, STONE[3]);
  R(g, 4, 4, 3, 66, BARK[3]);
  R(g, 4, 4, 1, 66, BARK[4]);
  R(g, 6, 4, 1, 66, BARK[1]);
  R(g, 3, 1, 5, 4, GOLD[1]);
  R(g, 4, 0, 3, 6, GOLD[1]);
  R(g, 4, 1, 2, 2, CREAM);
  R(g, 7, 52, 2, 1, BARK[0]);
  return spr(c, 5, 74);
}

const AMBER = ["#7a3b22", BARK[4], GOLD[0], GOLD[1], GOLD[2]];

/** The lantern tree: a young maple gone gold, with room under it to hang a light for every raid. */
function lanternTree(): Sprite {
  const { c, g } = makeCanvas(64, 80);
  R(g, 29, 44, 6, 36, BARK[1]);
  R(g, 29, 44, 2, 36, BARK[3]);
  R(g, 27, 77, 10, 3, BARK[1]);
  for (let i = 0; i < 12; i++) {
    R(g, 28 - i, 54 - i, 2, 1, BARK[1]);
    R(g, 35 + i, 56 - i, 2, 1, BARK[1]);
  }
  const lobes: readonly (readonly [number, number, number])[] = [
    [32, 25, 21],
    [16, 34, 14],
    [48, 34, 14],
    [25, 15, 13],
    [41, 16, 12],
  ];
  g.drawImage(
    paint(64, 56, (x, y) => {
      let lit = -9;
      for (const [cx, cy, r] of lobes) {
        const d = Math.hypot(x - cx, (y - cy) * 1.15);
        const rr = r + (vnoise(x / 4, y / 4, 91) - 0.5) * 6;
        if (d < rr) lit = Math.max(lit, (-(x - cx) * 0.6 - (y - cy) * 0.8) / r + (1 - d / rr) * 0.3);
      }
      if (lit < -8) return null;
      return at(AMBER, 1.7 + lit * 2.1 + (vnoise(x / 5, y / 3.5, 92) - 0.5) * 2);
    }),
    0,
    0,
  );
  return spr(c, 32, 80);
}

function bush(w: number, h: number, seed: number): Sprite {
  const c = paint(w, h, (x, y) => {
    const cx = w / 2;
    const d = Math.hypot((x - cx) / (w / 2), (y - h * 0.62) / (h * 0.62));
    if (d > 0.94 + (vnoise(x / 3, y / 3, seed) - 0.5) * 0.3 || y >= h - 1 + (x % 3 === 0 ? 0 : 1)) return null;
    const lit = (-(x - cx) / w - (y - h * 0.6) / h) * 1.5;
    return at(GREEN, 2 + lit * 1.6 + (vnoise(x / 4, y / 3, seed + 1) - 0.5) * 1.8);
  });
  return spr(c, Math.round(w / 2), h);
}

function rock(w: number, h: number, seed: number): Sprite {
  const c = paint(w, h, (x, y) => {
    const d = Math.hypot((x + 0.5 - w / 2) / (w / 2), (y + 0.5 - h * 0.55) / (h * 0.6));
    if (d > 1 + (vnoise(x / 3, y / 3, seed) - 0.5) * 0.25 || y >= h) return null;
    const lit = (-(x - w / 2) / w - (y - h / 2) / h) * 1.6;
    return at(STONE, 1.4 + lit * 2 + (hash(x >> 1, y >> 1, seed) - 0.5) * 0.9);
  });
  return spr(c, Math.round(w / 2), h);
}

function fern(size: number, seed: number): Sprite {
  const { c, g } = makeCanvas(size * 2 + 6, size + 6);
  drawFern(g, size + 3, size + 4, size, [GREEN[3], GREEN[4], GREEN[3]], seed);
  R(g, size + 2, size + 4, 3, 1, GREEN[0]);
  return { c, ax: size + 3, ay: size + 5 };
}

// ---------- seats, boxes and the fire ----------

function log(): Sprite {
  const { c, g } = makeCanvas(36, 11);
  R(g, 2, 5, 33, 5, BARK[2]);
  R(g, 3, 10, 31, 1, BARK[0]);
  R(g, 2, 0, 33, 5, BARK[3]);
  for (let i = 0; i < 7; i++) {
    R(g, 5 + i * 4 + (i % 2), 1 + (i % 3), 3, 1, BARK[4]);
    R(g, 6 + i * 4, 6 + ((i * 2) % 3), 2, 1, BARK[1]);
  }
  R(g, 34, 1, 1, 8, BARK[1]);
  ell(g, 3, 5, 3, 5, GOLD[0]);
  ell(g, 3, 5, 1.6, 3, BARK[4]);
  R(g, 2, 5, 1, 1, BARK[2]);
  return spr(c, 18, 11);
}

function stump(): Sprite {
  const { c, g } = makeCanvas(12, 11);
  R(g, 1, 4, 10, 6, BARK[2]);
  R(g, 0, 9, 12, 2, BARK[1]);
  for (const x of [3, 6, 9]) R(g, x, 6, 1, 4, BARK[1]);
  ell(g, 6, 3.5, 5.6, 3.6, BARK[4]);
  ell(g, 6, 3.5, 3.6, 2.2, GOLD[0]);
  R(g, 5, 3, 2, 1, BARK[3]);
  return spr(c, 6, 11);
}

/** A short log to sit on, for one. */
function shortLog(): Sprite {
  const { c, g } = makeCanvas(15, 10);
  R(g, 2, 4, 12, 5, BARK[2]);
  R(g, 3, 9, 10, 1, BARK[0]);
  R(g, 2, 0, 12, 4, BARK[3]);
  for (let i = 0; i < 3; i++) {
    R(g, 5 + i * 3, 1 + (i % 2), 2, 1, BARK[4]);
    R(g, 6 + i * 3, 5 + (i % 2), 2, 1, BARK[1]);
  }
  R(g, 13, 1, 1, 7, BARK[1]);
  ell(g, 2.5, 4.5, 2.5, 4.5, GOLD[0]);
  ell(g, 2.5, 4.5, 1.2, 2.6, BARK[4]);
  return spr(c, 7, 10);
}

/** Where the hexes of the stump's board are, in the stump's own pixels: a row of five, four, five. */
export const BOARD: readonly (readonly [number, number])[] = [
  [12, 7],
  [18, 7],
  [24, 7],
  [30, 7],
  [36, 7],
  [15, 11],
  [21, 11],
  [27, 11],
  [33, 11],
  [12, 15],
  [18, 15],
  [24, 15],
  [30, 15],
  [36, 15],
];

/**
 * The great stump at the edge of town: wide enough to play on, its rings showing, a board of
 * hexes cut into the top. The carved figures are drawn on it afresh each frame, because they move.
 */
function greatStump(): Sprite {
  const W = 48;
  const cx = W / 2;
  const top = { y: 11, rx: 22.6, ry: 10.6 };
  const c = paint(W, 34, (x, y) => {
    const u = (x + 0.5 - cx) / top.rx;
    if (Math.abs(u) >= 1) return null;
    const lip = Math.sqrt(1 - u * u) * top.ry;
    const d = Math.hypot(u, (y + 0.5 - top.y) / top.ry);
    if (d < 1) {
      // The cut top: bark round the rim, then the rings.
      if (d > 0.9) return BARK[3];
      const ring = (d * 6.2 + vnoise(x / 5, y / 3, 401) * 0.5) % 1;
      return ring < 0.24 ? BARK[4] : d < 0.14 ? BARK[4] : GOLD[0];
    }
    if (y < top.y) return null;
    // The side: furrowed bark down to a foot that spreads into roots.
    const foot = top.y + 11 + lip + (hash(x >> 2, 1, 402) > 0.5 ? 1 : 0);
    if (y > foot) return null;
    const furrow = hash(x, 3, 403);
    let idx = 2.4 - u * 1.3 + (furrow > 0.72 ? -1.2 : furrow < 0.2 ? 0.8 : 0);
    if (y < top.y + lip + 2) idx -= 1;
    if (y > foot - 2) idx -= 0.8;
    return at(BARK, idx);
  });
  const g = must2d(c);
  // The board: grooves first, then each hex standing a little proud of them.
  for (const [hx, hy] of BOARD) {
    R(g, hx - 2, hy - 2, 5, 5, BARK[1]);
    R(g, hx - 3, hy - 1, 7, 3, BARK[1]);
  }
  BOARD.forEach(([hx, hy], i) => {
    const pale = (i + (hy === 11 ? 1 : 0)) % 2 === 0;
    R(g, hx - 1, hy - 1, 3, 3, pale ? PAPER[1] : PAPER[0]);
    R(g, hx - 2, hy, 5, 1, pale ? PAPER[1] : PAPER[0]);
    R(g, hx - 1, hy - 1, 3, 1, pale ? CREAM : PAPER[1]);
  });
  // Moss on the shaded side, and a mushroom that has moved in.
  for (const [x, y, w] of [
    [36, 24, 5],
    [38, 25, 4],
    [8, 27, 3],
  ] as const)
    R(g, x, y, w, 1, GREEN[3]);
  R(g, 37, 23, 2, 1, GREEN[4]);
  R(g, 5, 23, 3, 1, SKY[5]);
  R(g, 4, 24, 5, 1, "#b0483a");
  R(g, 6, 25, 1, 2, "#e9d8b8");
  return spr(c, 24, 32);
}

function must2d(c: HTMLCanvasElement): Ctx {
  const g = c.getContext("2d");
  if (!g) throw new Error("no 2d context");
  return g;
}

/** A carved figure for the board: a head, a body, and the dark of its foot. */
function piece(light: string, body: string, shade: string): HTMLCanvasElement {
  const { c, g } = makeCanvas(3, 6);
  R(g, 1, 0, 1, 1, light);
  R(g, 0, 1, 3, 2, body);
  R(g, 0, 1, 1, 1, light);
  R(g, 0, 3, 3, 2, shade);
  R(g, 0, 5, 3, 1, BARK[0]);
  return c;
}

function bench(): Sprite {
  const { c, g } = makeCanvas(28, 14);
  R(g, 1, 0, 26, 5, BARK[2]);
  R(g, 1, 2, 26, 1, BARK[1]);
  R(g, 1, 0, 26, 1, BARK[3]);
  R(g, 1, 0, 2, 8, BARK[1]);
  R(g, 25, 0, 2, 8, BARK[1]);
  R(g, 0, 6, 28, 4, BARK[3]);
  R(g, 0, 6, 28, 1, BARK[4]);
  R(g, 0, 9, 28, 1, BARK[1]);
  R(g, 2, 10, 2, 4, BARK[1]);
  R(g, 24, 10, 2, 4, BARK[1]);
  return spr(c, 14, 14);
}

function fireRing(): Sprite {
  const { c, g } = makeCanvas(24, 14);
  ell(g, 12, 7, 11.6, 6.6, STONE[1]);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    R(g, Math.round(12 + Math.cos(a) * 10 - 0.5), Math.round(7 + Math.sin(a) * 5.4 - 0.5), 1, 2, STONE[0]);
    R(
      g,
      Math.round(12 + Math.cos(a + 0.26) * 10 - 0.5),
      Math.round(6 + Math.sin(a + 0.26) * 5.2 - 0.5),
      2,
      1,
      STONE[3],
    );
  }
  ell(g, 12, 7, 7.6, 3.8, "#2b161a");
  for (let i = 0; i < 9; i++) {
    R(g, 8 + i, 5 + Math.round(i * 0.4), 1, 2, BARK[1]);
    R(g, 16 - i, 5 + Math.round(i * 0.4), 1, 2, BARK[0]);
  }
  R(g, 11, 7, 1, 1, SKY[5]);
  R(g, 13, 6, 1, 1, GOLD[1]);
  R(g, 12, 8, 1, 1, SKY[5]);
  return spr(c, 12, 11);
}

function barrel(): Sprite {
  const { c, g } = makeCanvas(10, 13);
  R(g, 1, 2, 8, 11, BARK[2]);
  R(g, 0, 5, 10, 6, BARK[2]);
  for (const x of [3, 6]) R(g, x, 3, 1, 10, BARK[1]);
  R(g, 0, 4, 10, 1, STONE[1]);
  R(g, 0, 10, 10, 1, STONE[1]);
  R(g, 2, 0, 6, 1, BARK[3]);
  R(g, 1, 1, 8, 2, BARK[3]);
  R(g, 2, 1, 6, 1, BARK[1]);
  return spr(c, 5, 13);
}

function crate(size: number): Sprite {
  const { c, g } = makeCanvas(size, size);
  const lid = Math.max(2, Math.round(size * 0.3));
  R(g, 0, 0, size, size, BARK[3]);
  R(g, 0, 0, size, lid, BARK[4]);
  R(g, 0, lid, size, 1, BARK[1]);
  R(g, 0, 0, 1, size, BARK[1]);
  R(g, size - 1, 0, 1, size, BARK[1]);
  R(g, 0, size - 1, size, 1, BARK[1]);
  if (size > 7) for (let i = 1; i < size - lid - 1; i++) R(g, i, lid + i, 1, 1, BARK[1]);
  return spr(c, Math.round(size / 2), size);
}

function chest(isOpen: boolean): Sprite {
  const { c, g } = makeCanvas(14, 13);
  R(g, 0, 7, 14, 6, BARK[1]);
  R(g, 0, 7, 14, 1, BARK[0]);
  for (const x of [2, 11]) R(g, x, isOpen ? 7 : 2, 1, isOpen ? 6 : 11, GOLD[0]);
  if (isOpen) {
    R(g, 1, 0, 12, 4, BARK[2]);
    R(g, 1, 0, 12, 1, BARK[3]);
    R(g, 1, 4, 12, 3, GOLD[1]);
    R(g, 2, 4, 3, 1, CREAM);
    R(g, 7, 5, 3, 1, CREAM);
    R(g, 5, 3, 3, 1, GOLD[2]);
  } else {
    R(g, 0, 3, 14, 4, BARK[2]);
    R(g, 1, 2, 12, 1, BARK[2]);
    R(g, 1, 2, 12, 1, BARK[3]);
    for (const x of [2, 11]) R(g, x, 2, 1, 5, GOLD[0]);
    R(g, 6, 6, 2, 3, GOLD[1]);
  }
  return spr(c, 7, 13);
}

function pile(): Sprite {
  const { c, g } = makeCanvas(20, 19);
  const big = crate(10).c;
  g.drawImage(big, -1, 8);
  g.drawImage(big, 9, 8);
  g.drawImage(big, 4, -1);
  return { c, ax: 0, ay: 19 };
}

// ---------- small things, typed out ----------

const bm = (rows: readonly string[], ax: number, ay: number): Sprite => spr(bitmap(rows, PAL), ax, ay);

const MUSHROOM = [
  "...rrrrr...",
  ".rrwrrrrrr.",
  "rrrrrrwwrrr",
  "rwwrrrwwrrr",
  "rwwrrrrrrwr",
  "RRRRRRRRRRR",
  "..CcCcCcC..",
  "....ccc....",
  "....ccC....",
  "....ccC....",
  "...cccCC...",
];
const MUSHLET = [".rrrr.", "rwrrrr", "RRRRRR", "..cC..", "..cC..", ".ccCC."];
const FLOWERS = [
  ["..p..", ".pyp.", "..p..", "..G..", ".GG..", "..G.."],
  ["..w..", ".wyw.", "..w..", "..G..", "..GG.", "..G.."],
  [".y.y.", "..r..", ".y.y.", "..G..", ".GG..", "..G.."],
];
const REEDS = [
  ".n.....",
  ".n...n.",
  ".n...n.",
  ".l.n.n.",
  ".l.n.l.",
  ".l.n.l.",
  ".G.l.G.",
  "lG.l.G.",
  ".GlG.Gl",
  ".GlG.G.",
  ".G.GlG.",
  ".G.G.G.",
];
const LILY = [".GGGG..", "GGlGGG.", "GGGG.GG", ".GGGGG."];
const LILY_BLOOM = [".GGpG..", "GGpwpG.", "GGGp.GG", ".GGGGG."];
const CRAB_A = ["rr.....rr", "r.w...w.r", ".rrrrrrr.", "rrrrrrrrr", ".RrrrrrR.", "R.R...R.R"];
const CRAB_B = [".........", "rrw...wrr", "rrrrrrrrr", "rrrrrrrrr", ".RrrrrrR.", ".R.R.R.R."];
const BANG = ["yy", "yy", "yy", "yy", "yy", "..", "yy", "yy"];
const CROWN = ["..l..l..", ".lylyyl.", "yyoyyoyy"];
const MUG = ["www.", "wNww", "wNNw", "www."];
const JAR = ["..nnnn..", ".UUUUUU.", "U......U", "U..Y...U", "U.....YU", "U.Y....U", "U...Y..U", ".UUUUUU."];

function paperLantern(col: string, core: string): Sprite {
  const { c, g } = makeCanvas(5, 9);
  R(g, 2, 0, 1, 2, BARK[0]);
  R(g, 1, 2, 3, 1, BARK[1]);
  R(g, 0, 3, 5, 4, col);
  R(g, 1, 3, 3, 4, core);
  R(g, 2, 4, 1, 2, CREAM);
  R(g, 1, 7, 3, 1, BARK[1]);
  R(g, 2, 8, 1, 1, col);
  return spr(c, 2, 0);
}

// ---------- icons for the buttons ----------

const ICON_ROWS: Readonly<Record<PlaceId, readonly string[]>> = {
  treasury: [
    ".....yy.....",
    ".y...yy...y.",
    "..y......y..",
    "....yyyy....",
    "...yYYYYy...",
    "yy.yYwwYy.yy",
    "yy.yYwwYy.yy",
    "...yYYYYy...",
    "....yyyy....",
    "..y......y..",
    ".y...yy...y.",
    ".....yy.....",
  ],
  quests: [
    ".oooooooooo.",
    "owwwwwwwwwwo",
    ".owwwrrwwwo.",
    "..wwwrrwww..",
    "..wwwrrwww..",
    "..wwwrrwww..",
    "..wwwrrwww..",
    "..wwwwwwww..",
    "..wwwrrwww..",
    ".owwwwwwwwo.",
    "owwwwwwwwwwo",
    ".oooooooooo.",
  ],
  market: [
    ".nnnnnnnnnn.",
    "rrwwrrwwrrww",
    "rrwwrrwwrrww",
    "rrwwrrwwrrww",
    ".r.ww.rr.ww.",
    ".n........n.",
    ".n..y.p...n.",
    ".nNNNNNNNNn.",
    ".nBBBBBBBBn.",
    ".nBBBBBBBBn.",
    ".nBBBBBBBBn.",
    ".n........n.",
  ],
  works: [
    "....yyyy....",
    ".yy.yyyy.yy.",
    ".yyyyyyyyyy.",
    "..yyyooyyy..",
    "yyyyo..oyyyy",
    "yyyo....oyyy",
    "yyyo....oyyy",
    "yyyyo..oyyyy",
    "..yyyooyyy..",
    ".yyyyyyyyyy.",
    ".yy.yyyy.yy.",
    "....yyyy....",
  ],
  table: [
    "...nnnnnn...",
    "..nccccccn..",
    ".ncccrrcccn.",
    "ncccrrrrcccn",
    "ncccrwwrcccn",
    "ncccrrrrcccn",
    "nccCRRRRCccn",
    "ncccccccyycn",
    ".ncGGccyyYn.",
    "..nGGccyyn..",
    "...nnnnnn...",
    "....bbbb....",
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
  pond: [
    "............",
    "rr........rr",
    "r.r......r.r",
    ".rr.w..w.rr.",
    "..rrrrrrrr..",
    ".rrrrrrrrrr.",
    ".rrrrrrrrrr.",
    "..RrrrrrrR..",
    ".R.R....R.R.",
    "R..R....R..R",
    "............",
    ".uuUuu.uuUu.",
  ],
  camp: [
    ".....nn.....",
    "....nccn....",
    "....cccc....",
    "...cccccc...",
    "...ccbbcc...",
    "..cccbbccc..",
    "..ccbbbbcc..",
    ".cccbbbbccc.",
    ".ccbbbbbbcc.",
    "cccbbbbbbccc",
    "GGGGGGGGGGGG",
    ".GG.GGGG.GG.",
  ],
};

const icons = new Map<PlaceId, HTMLCanvasElement>();
/** A place's own picture, for its dock button and the head of its panel. Each call gives a new copy. */
export function icon(name: PlaceId): HTMLCanvasElement {
  let c = icons.get(name);
  if (!c) {
    c = outlined(bitmap(ICON_ROWS[name], PAL), INK);
    icons.set(name, c);
  }
  const copy = makeCanvas(c.width, c.height);
  copy.g.drawImage(c, 0, 0);
  return copy.c;
}

// ---------- the set ----------

export interface Sprites {
  treasury: Sprite;
  counter: Sprite;
  works: Sprite;
  gate: Sprite;
  signpost: Sprite;
  board: Sprite;
  stalls: Sprite[];
  post: Sprite;
  pole: Sprite;
  tree: Sprite;
  bushes: Sprite[];
  rocks: Sprite[];
  ferns: Sprite[];
  log: Sprite;
  stump: Sprite;
  shortLog: Sprite;
  greatStump: Sprite;
  /** The carved figures on the stump's board. */
  pieces: HTMLCanvasElement[];
  bench: Sprite;
  fireRing: Sprite;
  barrel: Sprite;
  crate: Sprite;
  box: Sprite;
  chest: Sprite;
  chestOpen: Sprite;
  pile: Sprite;
  mushroom: Sprite;
  mushlet: Sprite;
  flowers: Sprite[];
  reeds: Sprite;
  lily: Sprite;
  lilyBloom: Sprite;
  crab: Sprite[];
  bang: Sprite;
  crown: HTMLCanvasElement;
  mug: HTMLCanvasElement;
  jar: HTMLCanvasElement;
  lanterns: Sprite[];
}

export function makeSprites(): Sprites {
  const t = treasury();
  return {
    treasury: t.body,
    counter: t.counter,
    works: works(),
    gate: gate(),
    signpost: signpost(),
    board: board(),
    stalls: [stall(0), stall(1), stall(2)],
    post: post(),
    pole: pole(),
    tree: lanternTree(),
    bushes: [bush(18, 12, 301), bush(24, 15, 302), bush(14, 10, 303)],
    rocks: [rock(13, 9, 311), rock(8, 6, 312), rock(17, 11, 313)],
    ferns: [fern(8, 321), fern(10, 322), fern(7, 323)],
    log: log(),
    stump: stump(),
    shortLog: shortLog(),
    greatStump: greatStump(),
    pieces: [
      piece("#f4a08c", SKY[5], "#b0483a"),
      piece(GOLD[2], GOLD[1], GOLD[0]),
      piece(GREEN[4], GREEN[3], GREEN[1]),
      piece(SKY[4], SKY[3], SKY[2]),
      piece("#ffffff", CREAM, "#cbb894"),
    ],
    bench: bench(),
    fireRing: fireRing(),
    barrel: barrel(),
    crate: crate(10),
    box: crate(6),
    chest: chest(false),
    chestOpen: chest(true),
    pile: pile(),
    mushroom: bm(MUSHROOM, 5, 11),
    mushlet: bm(MUSHLET, 3, 6),
    flowers: FLOWERS.map((rows) => ({ c: bitmap(rows, PAL), ax: 2, ay: 6 })),
    reeds: { c: bitmap(REEDS, PAL), ax: 3, ay: 12 },
    lily: { c: bitmap(LILY, PAL), ax: 3, ay: 2 },
    lilyBloom: { c: bitmap(LILY_BLOOM, PAL), ax: 3, ay: 2 },
    crab: [bm(CRAB_A, 4, 6), bm(CRAB_B, 4, 6)],
    bang: bm(BANG, 1, 8),
    crown: bitmap(CROWN, PAL),
    mug: bitmap(MUG, PAL),
    jar: bitmap(JAR, PAL),
    lanterns: [paperLantern(GOLD[1], GOLD[2]), paperLantern(SKY[5], GOLD[1]), paperLantern(SKY[4], GOLD[2])],
  };
}
