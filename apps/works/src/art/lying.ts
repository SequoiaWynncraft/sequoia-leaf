/**
 * What lies in the ground, as the floor draws it (`ground.ts`): the six things gathered from the
 * start, tier 5's salvage and tier 6's tar. Each is drawn over the floor on its tile, never in ranks, by its own
 * painter; and the floor round each tile that holds one is a soft-edged patch of its own colours.
 */
import { isItem, itemName, type Land, RAW } from "@sequoia-leaf/factory";
import { BARK, CREAM, EARTH, GOLD, GREEN, INK, PAPER, STONE } from "@sequoia-leaf/kit/palette.ts";
import { ell, outlined, R } from "@sequoia-leaf/kit/pix.ts";
import { type Ctx, hash, vnoise } from "@sequoia-leaf/kit/util.ts";

import { TILE } from "./belts.ts";
import { rock, stump } from "./nature.ts";
import { CLAY, IRON } from "./pal.ts";

/** What lies in the ground and is drawn there: the six, tier 5's salvage and tier 6's tar, in the things' order. */
export const LYING = [...RAW, "salvage", "tar"] as const;
export type Lying = (typeof LYING)[number];
/** What lies in the ground on a tile of a land, by name, or nothing. */
export const rawAt = (land: Land, i: number): Lying | null => {
  const n = land.deposit[i] ?? -1;
  const name = isItem(n) ? itemName(n) : null;
  return LYING.find((r) => r === name) ?? null;
};

function line(g: Ctx, x0: number, y0: number, x1: number, y1: number, col: string): void {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let k = 0; k <= n; k++)
    R(g, Math.round(x0 + ((x1 - x0) * k) / n), Math.round(y0 + ((y1 - y0) * k) / n), 1, 1, col);
}

/** A fallen bough: pale where the light catches it, dark under, a twig or two, sometimes still in leaf. */
function branch(g: Ctx, x: number, y: number, seed: number): void {
  const len = 7 + Math.floor(hash(seed, 1, 61) * 6);
  const lean = Math.round((hash(seed, 2, 61) - 0.5) * 6);
  const x1 = x + len;
  const y1 = y + lean;
  line(g, x, y + 2, x1, y1 + 2, BARK[0]);
  line(g, x, y + 1, x1, y1 + 1, BARK[2]);
  line(g, x, y, x1, y1, hash(seed, 3, 61) > 0.5 ? BARK[4] : BARK[3]);
  R(g, x, y, 1, 2, PAPER[0]);
  R(g, x1, y1, 1, 2, GOLD[0]);
  const mid = Math.floor(len / 2);
  const my = y + Math.round((lean * mid) / len);
  const up = hash(seed, 4, 61) > 0.5 ? -1 : 1;
  line(g, x + mid, my + (up > 0 ? 2 : 0), x + mid + 3, my + up * 4, BARK[3]);
  if (hash(seed, 5, 61) > 0.45) {
    R(g, x + mid + 3, my + up * 4 - 1, 2, 2, GREEN[3]);
    R(g, x + mid + 4, my + up * 4 - 2, 1, 1, GREEN[4]);
  }
}

const ORE_ROCK = [BARK[0], STONE[0], STONE[1], STONE[2]];

/** A tile's corner in the yard's pixels, and the numbers its drawing is varied by: a seed and two in 0 to 1. */
interface At {
  readonly ox: number;
  readonly oy: number;
  readonly seed: number;
  readonly a: number;
  readonly b: number;
}

/** A rock, and for ore its glints of gold; now and then a small one beside it. */
function rocks(g: Ctx, { ox, oy, seed, a, b }: At, ore: boolean): void {
  const ramp = ore ? ORE_ROCK : STONE;
  const big = outlined(rock(9 + Math.floor(a * 4), 7 + Math.floor(b * 3), seed, ramp), INK);
  const bx = ox + Math.floor(a * (TILE - big.width));
  const by = oy + 1 + Math.floor(b * (TILE - big.height - 3));
  g.drawImage(big, bx, by);
  if (ore)
    for (let k = 0; k < 4; k++) {
      const fx = bx + 2 + Math.floor(hash(seed, k, 93) * (big.width - 5));
      const fy = by + 2 + Math.floor(hash(seed, k, 94) * (big.height - 5));
      R(g, fx, fy, k % 2 ? 1 : 2, 1, k === 0 ? GOLD[2] : GOLD[1]);
      R(g, fx, fy + 1, 1, 1, GOLD[0]);
    }
  if (b > 0.45) g.drawImage(outlined(rock(5, 4, seed + 3, ramp), INK), ox + Math.floor((1 - a) * 9), oy + 10);
}

/** Salvage in the old workings: turned earth with a bent rail half out of it, a shard of glass and a scrap of copper. */
function salvage(g: Ctx, { ox, oy, a, b }: At): void {
  const cx = ox + 5 + Math.floor(a * 6);
  const cy = oy + 7 + Math.floor(b * 4);
  ell(g, cx, cy + 1, 6.5, 3.4, EARTH[0]);
  ell(g, cx, cy, 6, 3, "#7a6a5c");
  // The rail: a run along the ground, then bent up out of it.
  R(g, cx - 5, cy, 5, 1, IRON[4]);
  R(g, cx - 5, cy + 1, 5, 1, IRON[1]);
  for (let k = 0; k < 3; k++) {
    R(g, cx + k, cy - 1 - k, 1, 1, IRON[4]);
    R(g, cx + k + 1, cy - 1 - k, 1, 1, IRON[1]);
  }
  R(g, cx + 2 - Math.floor(b * 5), cy + 2, 1, 1, CREAM);
  if (a > 0.35) R(g, cx - 3, cy - 2, 2, 1, CLAY[1]);
  if (b > 0.55) R(g, cx + 4, cy + 2, 2, 1, IRON[3]);
}

/** Tar's own colour, the darkest thing in the yard. */
const TAR = "#1f1b24";

/** Tar seeping up: a dark pool soaked into the earth, a sheen across it and a smaller seep beside it. */
function tar(g: Ctx, { ox, oy, a, b }: At): void {
  const cx = ox + 5 + Math.floor(a * 6);
  const cy = oy + 7 + Math.floor(b * 4);
  ell(g, cx, cy + 1, 6.4, 3.6, BARK[0]);
  ell(g, cx, cy, 5.6, 3, TAR);
  ell(g, cx + 1, cy + 1, 3, 1.4, IRON[0]);
  // The sheen: a short pale streak where the light lies on it, and a glint.
  R(g, cx - 3, cy - 1, 3, 1, IRON[3]);
  R(g, cx - 1, cy - 2, 2, 1, IRON[4]);
  if (a > 0.4) {
    ell(g, cx + 5 - Math.floor(b * 10), cy + 4, 2, 1.2, TAR);
    R(g, cx + 4 - Math.floor(b * 10), cy + 4, 1, 1, IRON[3]);
  }
}
/** How each thing lying in the ground is drawn on its tile. */
const PAINT: Readonly<Record<Lying, (g: Ctx, at: At) => void>> = {
  deadfall(g, { ox, oy, seed, a, b }) {
    branch(g, ox + 1 + Math.floor(a * 4), oy + 4 + Math.floor(b * 3), seed);
    branch(g, ox + 3 + Math.floor(b * 4), oy + 10 + Math.floor(a * 3), seed + 7);
    if (a > 0.6) branch(g, ox + Math.floor(b * 6), oy + 7, seed + 13);
  },
  stone: (g, at) => rocks(g, at, false),
  ore: (g, at) => rocks(g, at, true),
  clay(g, { ox, oy, a, b }) {
    const cx = ox + 5 + Math.floor(a * 6);
    const cy = oy + 6 + Math.floor(b * 5);
    ell(g, cx, cy + 1, 6, 3.4, CLAY[0]);
    ell(g, cx, cy, 6, 3.2, CLAY[1]);
    ell(g, cx - 1, cy - 1, 3.6, 1.6, CLAY[2]);
    R(g, cx - 3, cy - 2, 2, 1, CLAY[3]);
  },
  sand(g, { ox, oy, a, b }) {
    const cx = ox + 5 + Math.floor(a * 6);
    const cy = oy + 7 + Math.floor(b * 5);
    ell(g, cx, cy + 1, 6, 2.6, PAPER[0]);
    ell(g, cx, cy, 5.4, 2.2, PAPER[1]);
    R(g, cx - 3, cy - 1, 4, 1, CREAM);
    if (a > 0.7) R(g, cx + 5, cy + 3, 1, 1, CREAM);
  },
  resin(g, { ox, oy, seed, a, b }) {
    g.drawImage(stump(seed, true), ox + Math.floor(a * 3), oy + 1 + Math.floor(b * 3));
    R(g, ox + 12 + Math.floor(a * 2), oy + 12 - Math.floor(b * 3), 2, 1, GOLD[1]);
  },
  salvage,
  tar,
};

/** Draws what lies in the ground on the tile (`tx`, `ty`). */
export function lie(g: Ctx, d: Lying, tx: number, ty: number): void {
  PAINT[d](g, {
    ox: tx * TILE,
    oy: ty * TILE,
    seed: Math.floor(hash(tx, ty, 90) * 9973),
    a: hash(tx, ty, 91),
    b: hash(tx, ty, 92),
  });
}

/**
 * The floor's patch round a tile something lies on, by its place in `LYING` and one: at its rim, by
 * two hashes of the pixel (`f`, and `g2` by twos), and for clay's bands where the pixel is.
 */
type Patch = (rim: boolean, f: number, g2: number, x: number, y: number, jy: number) => string;
const PATCHES: readonly Patch[] = [
  // Deadfall: leaf litter over the grass, dark and soft.
  (rim, f, g2) => (rim ? GREEN[0] : g2 > 0.55 ? EARTH[0] : f > 0.9 ? BARK[1] : f < 0.08 ? GREEN[1] : GREEN[0]),
  // Stone: bare rock showing through.
  (rim, f, g2) => (rim ? EARTH[0] : g2 > 0.8 ? STONE[1] : f > 0.95 ? STONE[2] : STONE[0]),
  // Ore: dark red earth, with a glint in it.
  (rim, f, g2) => (rim ? BARK[0] : f > 0.965 ? GOLD[0] : g2 > 0.8 ? BARK[2] : BARK[1]),
  // Clay: a red bank, laid down in bands.
  (rim, _f, g2, x, y, jy) =>
    rim || Math.floor(jy + vnoise(x / 9, y / 30, 47) * 6) % 5 === 0 ? CLAY[0] : g2 > 0.84 ? CLAY[2] : CLAY[1],
  // Sand: pale, and brighter where it is dry.
  (rim, f, g2) => (rim ? EARTH[2] : g2 > 0.7 ? PAPER[1] : f > 0.95 ? CREAM : PAPER[0]),
  // Resin: the litter under old stumps, spotted with amber.
  (rim, f, g2) => (rim ? GREEN[0] : f > 0.975 ? GOLD[0] : g2 > 0.6 ? EARTH[0] : GREEN[0]),
  // Salvage: turned earth, grey with old scrap, a glint of glass in it.
  (rim, f, g2) => (rim ? EARTH[0] : f > 0.98 ? PAPER[1] : g2 > 0.62 ? "#7a6a5c" : EARTH[0]),
  // Tar: earth soaked dark round the seep, black where it is wettest, a dull sheen here and there.
  (rim, f, g2) => (rim ? EARTH[0] : f > 0.975 ? IRON[3] : g2 > 0.6 ? TAR : BARK[0]),
];
export const patchOf = (d: number, rim: boolean, f: number, g2: number, x: number, y: number, jy: number): string =>
  PATCHES[d - 1]?.(rim, f, g2, x, y, jy) ?? EARTH[0];
