/**
 * Live guild moments, each a function of the seconds since it began, so a still at any moment is
 * exact. The camera glides to where each happens; lights travel through the world (between the
 * depth layers, at their parallax), never over the HUD.
 *
 * - Raid: the party's four trees shimmer, a light rises from each and crosses the forest to the
 *   campfire, the four merge into one lantern with their names, and it is hung in the Great Sequoia.
 * - War: a pennant rises on the Fruma ridge, and the falling leaves spell S E Q for a moment.
 * - Level up: gnome heralds sound their trumpets and lanterns lift from the Great Sequoia into the sky.
 * - Anniversary: the crabs throw a rave.
 */

import { drawFestoon } from "../pixel/life.ts";
import { ix, R } from "../pixel/palette.ts";
import type { Light, Surface } from "../pixel/raster.ts";
import { hash3 } from "../pixel/rng.ts";
import { GNOME } from "./cast.ts";
import { tinyText, tinyWidth } from "./font3.ts";
import type { Hook } from "./great.ts";
import type { Planted } from "./grove.ts";
import { type Place, put } from "./life.ts";
import { ridgeCrest } from "./scenery.ts";
import { HEART_X, type Layer, NEW_BANNER, screenX } from "./world.ts";

export const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
export const ease = (v: number): number => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** 0 before `a`, rising to 1 at `b`, holding, falling back to 0 from `c` to `d`. */
const env = (e: number, a: number, b: number, c: number, d: number): number =>
  e < a || e > d ? 0 : e < b ? (e - a) / (b - a) : e > c ? 1 - (e - c) / (d - c) : 1;

export const LENGTH = { raid: 11, war: 9.5, levelup: 11 } as const;

export interface View {
  W: number;
  H: number;
  cx: number;
  /** The world row at the screen's top. */
  top: number;
  place: (layer: Layer) => Place;
}

// ---------------------------------------------------------------------------------------------
// Raid.

export interface RaidSetup {
  party: readonly Planted[];
  layers: readonly Layer[];
  front: Layer;
  fire: { x: number; y: number };
  hook: Hook;
}

/** Nominal x of a front-layer x. */
const nominal = (front: Layer, lx: number): number => front.X(lx);

export function raidCamera(r: RaidSetup, e: number, from: number, W: number): number {
  const partyX = r.party.reduce((a, p) => a + p.X, 0) / Math.max(1, r.party.length);
  const fireX = nominal(r.front, r.fire.x);
  const hookX = nominal(r.front, r.hook.x);
  // At the end, frame the fire and the hook together if the screen allows.
  const endX = W > 2 * Math.abs(fireX - hookX) + 40 ? (fireX + hookX) / 2 : lerp(fireX, hookX, 0.5);
  if (e < 3.0) return lerp(from, partyX, ease(e / 1.6));
  if (e < 6.6) return lerp(partyX, fireX, ease((e - 3.0) / 2.4));
  return lerp(fireX, endX, ease((e - 6.8) / 2));
}

/** How strongly each party tree shimmers now (0 to 1). */
export const raidShimmer = (e: number): number => env(e, 0.4, 0.9, 3.6, 4.6);

interface Spot {
  x: number;
  y: number;
}

/** A party light's screen position at moment `e`, or null before it rises. */
function raidLight(r: RaidSetup, p: Planted, i: number, e: number, v: View): Spot | null {
  const layer = r.layers[p.rowIndex];
  if (!layer) return null;
  const rise0 = 1.3 + i * 0.14;
  if (e < rise0) return null;
  const crownY = p.box.y0 + 3;
  const startX = p.X;
  const f0 = layer.f;
  const fireX = nominal(r.front, r.fire.x);
  const k = ease((e - rise0) / 1.1);
  const riseY = crownY - 14 * k;
  const go0 = 2.6 + i * 0.16;
  if (e < go0) {
    const wob = Math.sin(e * 5 + i) * 1.5 * k;
    return { x: screenX(startX, f0, v.cx, v.W) + wob, y: riseY - v.top };
  }
  const u = ease((e - go0) / (5.8 - go0));
  const endY = r.fire.y - 30;
  const ctrlY = Math.min(riseY, endY) - 46 - i * 6;
  const y = (1 - u) * (1 - u) * (crownY - 14) + 2 * (1 - u) * u * ctrlY + u * u * endY;
  const X = lerp(startX, fireX, u) + Math.sin(u * Math.PI * 2 + i * 1.7) * 10 * u * (1 - u);
  const f = lerp(f0, 1, u);
  if (e < 5.8) return { x: screenX(X, f, v.cx, v.W), y: y - v.top };
  // Merging: the four circle the point above the fire, closing in.
  const m = clamp01((e - 5.8) / 0.75);
  const a = i * (Math.PI / 2) + m * 7;
  const rad = 9 * (1 - m);
  return { x: screenX(fireX, 1, v.cx, v.W) + Math.cos(a) * rad, y: endY - v.top + Math.sin(a) * rad * 0.6 };
}

/** A wisp of light: a white-hot core, a gold ring, a soft dithered halo, and the warm light it casts. */
export function wisp(s: Surface, light: Light, x: number, y: number, b: number, t: number): void {
  const cx = Math.round(x);
  const cy = Math.round(y);
  for (let dy = -3; dy <= 3; dy++)
    for (let dx = -3; dx <= 3; dx++) {
      const d = dx * dx + dy * dy;
      if (d > 10) continue;
      if (d >= 5) {
        if (((cx + dx + cy + dy + Math.floor(t * 12)) & 1) === 0) s.set(cx + dx, cy + dy, ix(R.GLOW, 3));
        continue;
      }
      s.set(cx + dx, cy + dy, d === 0 ? ix(R.GLOW, 7) : d <= 1 ? ix(R.GLOW, 6) : ix(R.GLOW, 5));
    }
  light.pool(cx, cy, 15 * b, 2.8 * b, 1);
}

export interface RaidOut {
  /** The new lantern's screen position, while the label shows. */
  lantern: Spot | null;
  labelA: number;
  /** The lantern has reached its hook and hangs there from now on. */
  hung: boolean;
}

export function drawRaid(s: Surface, light: Light, r: RaidSetup, e: number, v: View): RaidOut {
  // Sparkles over the shimmering trees.
  const sh = raidShimmer(e);
  if (sh > 0)
    r.party.forEach((p, i) => {
      const layer = r.layers[p.rowIndex];
      if (!layer) return;
      const off = layer.offset(v.cx, v.W);
      for (let k = 0; k < 7; k++) {
        const tw = Math.floor(e * 8 + k * 3 + i);
        if (hash3(k, tw, i) > sh * 0.8) continue;
        const x = p.box.x0 + hash3(k, tw, 1 + i) * (p.box.x1 - p.box.x0) - off;
        const y = p.box.y0 + hash3(k, tw, 2 + i) * (p.box.y1 - p.box.y0) * 0.8 - v.top;
        s.set(x, y, ix(R.GLOW, hash3(k, tw, 3) < 0.4 ? 7 : 6));
        if (hash3(k, tw, 4) < 0.3) {
          s.set(x + 1, y, ix(R.GLOW, 4));
          s.set(x - 1, y, ix(R.GLOW, 4));
        }
      }
    });
  // The four lights, each trailing a ribbon of sparks.
  if (e < 6.6)
    r.party.forEach((p, i) => {
      for (let k = 9; k >= 1; k--) {
        const at = raidLight(r, p, i, e - k * 0.04, v);
        if (!at) continue;
        const twinkle = hash3(k, Math.floor(e * 14), i) < 0.5;
        s.set(Math.round(at.x), Math.round(at.y), ix(R.GLOW, Math.max(2, 7 - Math.ceil(k * 0.6))));
        if (k > 3 && twinkle)
          s.set(Math.round(at.x) + (k % 2 ? 1 : -1), Math.round(at.y) + 1 + (k >> 2), ix(R.GLOW, 4));
      }
      const at = raidLight(r, p, i, e, v);
      if (at) wisp(s, light, at.x, at.y, 1, e);
    });
  const fireSX = r.fire.x - v.place(r.front).ox;
  const mergeY = r.fire.y - 30 - v.top;
  // The flash where they become one.
  const flash = env(e, 6.4, 6.55, 6.6, 7.2);
  if (flash > 0) {
    light.pool(fireSX, mergeY, 34 * flash, 3.2, 1);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const rr = 6 + (1 - flash) * 10;
      s.set(fireSX + Math.cos(a) * rr, mergeY + Math.sin(a) * rr * 0.7, ix(R.GLOW, 6));
    }
  }
  if (e < 6.45) return { lantern: null, labelA: 0, hung: false };
  // The lantern rises from the fire to its hook in the Great Sequoia.
  const hookSX = r.hook.x - v.place(r.front).ox;
  const hookSY = r.hook.y + r.hook.cord - v.top;
  const u = ease((e - 7.2) / 2.2);
  const lx = lerp(fireSX, hookSX, u) + Math.sin(u * Math.PI) * -8;
  const ly = lerp(mergeY, hookSY, u) - Math.sin(u * Math.PI) * 10;
  const hung = e >= 9.4;
  if (!hung) {
    raidLantern(s, light, Math.round(lx), Math.round(ly) - 4, 1, e);
    light.pool(Math.round(lx), Math.round(ly), 18, 2.8, 1);
  } else if (e < 10.4) {
    // A last sparkle as it settles on its hook.
    const k = 1 - (e - 9.4);
    for (let j = 0; j < 6; j++) {
      const a = (j / 6) * Math.PI * 2 + e;
      s.set(hookSX + Math.cos(a) * (4 + (1 - k) * 6), hookSY + 4 + Math.sin(a) * (3 + (1 - k) * 4), ix(R.GLOW, 6));
    }
  }
  return { lantern: { x: lx, y: ly }, labelA: env(e, 6.6, 7.0, 9.6, 10.6), hung };
}

/**
 * A raid's lantern: the guild's ordinary lantern dressed in gold, with a tassel, glowing a little
 * brighter than the rest. Drawn with its hook point at (x, y).
 */
const RAID_LANTERN = ["..K..", ".KgK.", "KgGgK", "KYCYK", "KCCCK", "KYCYK", "KgGgK", ".KoK.", "..o.."];

export function raidLantern(s: Surface, light: Light, x: number, y: number, b: number, t: number): void {
  RAID_LANTERN.forEach((row, ry) => {
    for (let k = 0; k < row.length; k++) {
      const c = row[k];
      const v =
        c === "K"
          ? ix(R.METAL, 1)
          : c === "g"
            ? ix(R.SHROOM, 4)
            : c === "G"
              ? ix(R.SHROOM, 6)
              : c === "Y"
                ? ix(R.GLOW, b > 0.85 ? 6 : 5)
                : c === "C"
                  ? ix(R.GLOW, 7)
                  : c === "o"
                    ? ix(R.CRAB, 5)
                    : 0;
      if (v) s.set(x - 2 + k, y + ry, v);
    }
  });
  const pulse = 0.85 + 0.15 * Math.sin(t * 2.2);
  light.pool(x, y + 4, 13 * b * pulse, 2.6, 1);
}

// ---------------------------------------------------------------------------------------------
// War.

export function warCamera(e: number, from: number): number {
  return lerp(from, NEW_BANNER, ease(e / 1.8));
}

/** How far the new pennant has risen (0 to 1). */
export const warRaise = (e: number): number => ease((e - 1.8) / 1.4);

/**
 * The newly won territory's banner: the guild's gold pennant with its orange sun, bigger than the
 * far ones (it is the moment's subject), on a pole that rises out of the ridge, unfurling as it goes.
 */
const BANNER = [
  "Pggggggggg.",
  "PgGGgggGGgg",
  "PgGgoooggGg",
  "Pggoyyyoggg",
  "PgGoyyyoGgg",
  "Pggoooogggg",
  "PgGGgggGGg.",
  "Pgggggggg..",
  "Pggg.gggg..",
  "Pg.....gg..",
];

function drawBanner(s: Surface, x: number, foot: number, e: number, t: number): void {
  const raise = warRaise(e);
  const pole = 26;
  const top = Math.round(foot - pole * raise);
  for (let y = top; y <= foot; y++) {
    s.set(x, y, ix(R.WOOD, 4));
    s.set(x + 1, y, ix(R.WOOD, 2));
  }
  s.set(x, top - 1, ix(R.SHROOM, 6));
  s.set(x + 1, top - 1, ix(R.SHROOM, 5));
  // Unfurls once the pole is up: the flag's width grows, then it ripples.
  const unfurl = ease((e - 2.6) / 0.9);
  if (unfurl <= 0) return;
  const ripple = Math.floor(t * 5) % 3;
  BANNER.forEach((row, ry) => {
    const cols = Math.ceil((row.length - 1) * unfurl);
    for (let k = 1; k <= cols; k++) {
      const c = row[k];
      const dy = k > 4 ? ((k + ripple) % 3 === 0 ? 1 : 0) : 0;
      const v =
        c === "g"
          ? ix(R.SHROOM, 4)
          : c === "G"
            ? ix(R.SHROOM, 5)
            : c === "o"
              ? ix(R.CRAB, 5)
              : c === "y"
                ? ix(R.FIRE, 6)
                : 0;
      if (v) s.set(x + 1 + k, top + 1 + ry + dy, v);
    }
  });
}

export function drawNewPennant(s: Surface, light: Light, ridge: Layer, e: number, t: number, v: View): void {
  const raise = warRaise(e);
  if (raise <= 0) return;
  const p = v.place(ridge);
  const x = ridge.lx(NEW_BANNER) - p.ox;
  const foot = ridgeCrest(NEW_BANNER) - p.oy;
  drawBanner(s, x, foot, e, t);
  // A pillar of light stands over it for a while, so the eye finds the new one among the others.
  const pillar = env(e, 3.0, 3.4, 6.5, 8.5);
  if (pillar > 0) {
    for (let y = foot - 70; y < foot - 30; y++) {
      const k = pillar * (1 - (foot - 30 - y) / 40);
      for (let dx = -1; dx <= 1; dx++) {
        if (((x + dx + y + Math.floor(t * 8)) & 1) === 0 && (dx === 0 || k > 0.5))
          s.set(x + dx, y, ix(R.GLOW, dx === 0 ? 5 : 3));
      }
    }
    light.pool(x + 6, foot - 22, 20 * pillar, 2.6, 0.8);
    for (let j = 0; j < 5; j++) {
      const u = (e * 0.7 + j / 5) % 1;
      s.set(x + 5 + Math.round(Math.sin(u * 9 + j) * 6), Math.round(foot - 26 - u * 36), ix(R.GLOW, 7));
    }
  }
  const burst = env(e, 3.1, 3.25, 3.4, 4.4);
  if (burst > 0) {
    light.pool(x + 6, foot - 20, 26 * burst, 3, 1);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + 0.3;
      const rr = 6 + (1 - burst) * 16;
      s.set(x + 6 + Math.cos(a) * rr, foot - 20 + Math.sin(a) * rr, ix(R.GLOW, burst > 0.5 ? 7 : 5));
    }
  }
}

const LETTERS: Record<string, readonly string[]> = {
  S: [".###.", "#...#", "#....", ".###.", "....#", "#...#", ".###."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
};

interface Leaf {
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  start: number;
  seed: number;
  /** Decoys never join a letter; they just fall. */
  decoy: boolean;
}

let leaves: { W: number; list: Leaf[] } | null = null;

function makeLeaves(W: number): Leaf[] {
  const cell = 3;
  const gap = W < 200 ? 6 : 8;
  const word = ["S", "E", "Q"];
  const lw = 5 * cell;
  const total = word.length * lw + (word.length - 1) * gap;
  const x0 = Math.round(W / 2 - total / 2);
  const y0 = 34;
  const out: Leaf[] = [];
  word.forEach((ch, li) => {
    const rows = LETTERS[ch] ?? [];
    rows.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        if (row[rx] !== "#") continue;
        const n = out.length;
        out.push({
          tx: x0 + li * (lw + gap) + rx * cell,
          ty: y0 + ry * cell + 1,
          sx: W / 2 + (hash3(n, 1, 1) - 0.5) * Math.min(W, 260),
          sy: -6 - hash3(n, 2, 2) * 46,
          start: 3.0 + hash3(n, 3, 3) * 0.9,
          seed: n,
          decoy: false,
        });
      }
    });
  });
  for (let k = 0; k < 26; k++)
    out.push({
      tx: 0,
      ty: 0,
      sx: hash3(k, 4, 4) * W,
      sy: -6 - hash3(k, 5, 5) * 60,
      start: 2.8 + hash3(k, 6, 6) * 3,
      seed: 500 + k,
      decoy: true,
    });
  return out;
}

/** Leaves drifting down the canopy, gathering into S E Q, holding, then let go. Screen space. */
export function drawWarLeaves(s: Surface, light: Light, e: number, W: number): void {
  if (!leaves || leaves.W !== W) leaves = { W, list: makeLeaves(W) };
  for (const l of leaves.list) {
    const age = e - l.start;
    if (age < 0) continue;
    const flutter = Math.sin(age * 3.1 + l.seed) * 3;
    const fallY = l.sy + age * 22;
    const fallX = l.sx + flutter + age * 2;
    let x: number;
    let y: number;
    if (l.decoy) {
      x = fallX;
      y = fallY;
    } else if (e < 4.4) {
      x = fallX;
      y = fallY;
    } else if (e < 5.7) {
      const k = ease((e - 4.4) / 1.3);
      const ax = l.sx + Math.sin((4.4 - l.start) * 3.1 + l.seed) * 3 + (4.4 - l.start) * 2;
      const ay = l.sy + (4.4 - l.start) * 22;
      x = lerp(ax, l.tx, k);
      y = lerp(ay, l.ty, k);
    } else if (e < 7.1) {
      x = l.tx;
      y = l.ty + (Math.floor(e * 4 + l.seed) % 7 === 0 ? 1 : 0);
    } else {
      const d = e - 7.1 - hash3(l.seed, 7, 7) * 0.5;
      x = l.tx + (d > 0 ? Math.sin(d * 3 + l.seed) * 3 * Math.min(1, d) + d * 4 : 0);
      y = l.ty + (d > 0 ? d * d * 9 + d * 8 : 0);
    }
    if (y > s.h + 2) continue;
    const held = !l.decoy && e > 5.4 && e < 7.3;
    const tumble = held ? 0 : Math.floor(e * 5 + l.seed) % 3;
    const twinkle = held && hash3(l.seed, Math.floor(e * 6), 2) < 0.18;
    const gold = twinkle ? ix(R.GLOW, 7) : l.seed % 4 === 0 ? ix(R.SHROOM, 6) : held ? ix(R.SHROOM, 5) : ix(R.OLIVE, 7);
    const px = Math.round(x);
    const py = Math.round(y);
    s.set(px, py, gold);
    s.set(
      px + (tumble === 0 ? 1 : tumble === 1 ? -1 : 0),
      py + (tumble === 2 ? 1 : 0),
      held ? ix(R.SHROOM, 5) : ix(R.OLIVE, 5),
    );
    if (held) {
      s.set(px, py + 1, ix(R.SHROOM, 4));
      s.set(px + 1, py + 1, ix(R.SHROOM, 3));
    }
  }
  // While the word holds, it glows.
  const glow = env(e, 5.2, 5.8, 6.9, 7.6);
  if (glow > 0) {
    const cx = Math.round(W / 2);
    for (const dx of [-30, 0, 30]) light.pool(cx + dx, 46, 26 * glow, 2.2 * glow, 1.4);
  }
}

// ---------------------------------------------------------------------------------------------
// Level up.

export function levelCamera(e: number, from: number): number {
  return lerp(from, HEART_X, ease(e / 1.4));
}

const SKY_LANTERN = {
  near: [".kkk.", "yYYYy", "yYCYy", "yYCYy", "yYYYy", ".yoy.", "..f.."],
  mid: [".kk.", "yYYy", "yYCy", "yYYy", ".of."],
  far: ["yYy", "yCy", ".o."],
};

function skyLantern(s: Surface, light: Light, x: number, y: number, size: "near" | "mid" | "far", b: number): void {
  const rows = SKY_LANTERN[size];
  const w = rows[0]?.length ?? 2;
  rows.forEach((row, ry) => {
    for (let k = 0; k < row.length; k++) {
      const c = row[k];
      const v =
        c === "y"
          ? ix(R.GLOW, 4)
          : c === "Y"
            ? ix(R.GLOW, 5)
            : c === "C"
              ? ix(R.GLOW, 7)
              : c === "o"
                ? ix(R.FIRE, 5)
                : c === "f"
                  ? ix(R.FIRE, 6)
                  : c === "k"
                    ? ix(R.GLOW, 1)
                    : 0;
      if (v) s.set(Math.round(x - w / 2 + k), Math.round(y + ry), v);
    }
  });
  light.pool(Math.round(x), Math.round(y + 3), (size === "near" ? 16 : size === "mid" ? 10 : 6) * b, 2.6, 1);
}

export function drawLevelUp(
  s: Surface,
  light: Light,
  front: Layer,
  hooks: readonly Hook[],
  e: number,
  t: number,
  v: View,
): void {
  const p = v.place(front);
  // Two gnome heralds pop up on the roots and sound their trumpets.
  const pop = ease((e - 0.9) / 0.4);
  if (e > 0.9 && e < 9.5) {
    const blowing = e > 1.4 && e < 4.8 && Math.floor(e * 4) % 2 === 0;
    const sp = blowing ? GNOME.blow : GNOME.rest;
    for (const side of [-1, 1] as const) {
      const x = front.lx(HEART_X + side * 58) - (side < 0 ? 8 : 4);
      const foot = 229 + Math.round((1 - pop) * 14);
      put(s, sp, x, foot, p, side > 0);
      light.pool(x - p.ox + 6, foot - p.oy - 6, 14 * pop, 2.2, 1);
      // Notes rising from the bell.
      if (e > 1.5 && e < 5.2)
        for (let k = 0; k < 3; k++) {
          const u = (((e * 0.8 + k / 3) % 1) + 1) % 1;
          const bell = side < 0 ? x + 11 : x + 2;
          const nx = Math.round(bell + side * u * 8 - p.ox + Math.sin(u * 6 + k) * 2);
          const ny = Math.round(foot - 12 - u * 22 - p.oy);
          if (u > 0.85) continue;
          s.set(nx, ny, ix(R.CREAM, 7));
          s.set(nx, ny + 1, ix(R.CREAM, 7));
          s.set(nx - 1, ny + 2, ix(R.CREAM, 6));
          s.set(nx + 1, ny - 1, ix(R.CREAM, 5));
        }
    }
  }
  // The lanterns lift from the branches, staggered, swaying, drifting out into the open sky on
  // either side of the crown and up out of sight.
  const trunk = front.lx(HEART_X);
  const starts = [...hooks].toSorted((a, b) => a.y - b.y || a.x - b.x).slice(0, 28);
  starts.forEach((h, i) => {
    const s0 = 1.9 + ((i * 7) % 28) * 0.22;
    const age = e - s0;
    if (age < 0) return;
    const side = h.x < trunk ? -1 : 1;
    // Out first, into the open sky beside the crown, then up: they linger where they can be seen.
    const rise = age * age * 0.9 + age * 4;
    const out = side * (age * (11 + (i % 4) * 3) + age * age * 1.1);
    const x = h.x - p.ox + out + Math.sin(age * 1.3 + i) * 3;
    const y = h.y + h.cord + 3 - rise - p.oy;
    if (y < -10 || x < -10 || x > v.W + 10) return;
    const size = age > 6 ? "far" : age > 3.2 ? "mid" : "near";
    const flick = 0.85 + 0.15 * Math.sin(t * 9 + i * 2);
    skyLantern(s, light, x, y, size, flick);
  });
}

// ---------------------------------------------------------------------------------------------
// The crab rave, on the guild's anniversary.

export interface RaveSetup {
  front: Layer;
  /** Where the string of lights hangs from, in front-layer coordinates. */
  from: { x: number; y: number };
  to: { x: number; y: number };
  shore: number;
}

export function drawRave(s: Surface, light: Light, r: RaveSetup, t: number, v: View): void {
  const p = v.place(r.front);
  const a = { x: r.from.x - p.ox, y: r.from.y - p.oy };
  const b = { x: r.to.x - p.ox, y: r.to.y - p.oy };
  const mid = { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) + 9 };
  drawFestoon(s, light, [a, mid, b], t * 3, 200);
  const beat = Math.floor(t / 0.468);
  const onBeat = t / 0.468 - beat < 0.35;
  const colours = [ix(R.LIGHTS, 5), ix(R.LIGHTS, 7), ix(R.ROSE, 5), ix(R.GLOW, 6)];
  // A little birthday banner pinned to the string.
  const bx0 = Math.round(a.x + (mid.x - a.x) * 0.35);
  const by0 = Math.round(a.y + (mid.y - a.y) * 0.35 + 2);
  const text = "SEQ IS 4!";
  const tw = tinyWidth(text);
  for (let y = 0; y < 8; y++)
    for (let x = -2; x < tw + 2; x++) {
      const tail = y === 7 && (x + 2) % 4 === 1;
      if (y === 7 && !tail) continue;
      s.set(bx0 + x, by0 + y, y === 0 ? ix(R.CREAM, 7) : ix(R.CREAM, 5));
    }
  tinyText(s, text, bx0, by0 + 1, ix(R.CRAB, 2));
  // The glitter ball, hung from the middle of the string, its facets turning.
  const gx = mid.x;
  const gy = mid.y + 9;
  for (let k = 1; k < 6; k++) s.set(gx, mid.y + k, ix(R.METAL, 1));
  for (let y = -3; y <= 3; y++)
    for (let x = -3; x <= 3; x++) {
      if (x * x + y * y > 10) continue;
      const facet = (x + y * 2 + Math.floor(t * 8)) % 4;
      s.set(
        gx + x,
        gy + y,
        facet === 0 ? ix(R.STAR, 7) : facet === 1 ? ix(R.STAR, 4) : facet === 2 ? ix(R.SNOW, 5) : ix(R.SNOW, 2),
      );
    }
  // Glints flashing off it.
  for (let k = 0; k < 4; k++) {
    if (hash3(k, Math.floor(t * 6), 3) < 0.5) continue;
    const ang = hash3(k, Math.floor(t * 6), 4) * Math.PI * 2;
    const gxk = Math.round(gx + Math.cos(ang) * 5);
    const gyk = Math.round(gy + Math.sin(ang) * 5);
    s.set(gxk, gyk, ix(R.STAR, 7));
    s.set(gxk + 1, gyk, ix(R.STAR, 4));
    s.set(gxk - 1, gyk, ix(R.STAR, 4));
    s.set(gxk, gyk - 1, ix(R.STAR, 4));
    s.set(gxk, gyk + 1, ix(R.STAR, 4));
  }
  light.pool(gx, gy, 12, 2.2, 1);
  // Beams: coloured shafts swinging down to the shore, dotted so the scene shows through.
  const ground = r.shore - p.oy;
  for (let k = 0; k < 4; k++) {
    const ang = Math.sin(t * 1.3 + k * 1.7) * 0.8 + (k - 1.5) * 0.45;
    const col = colours[(beat + k) % colours.length] ?? colours[0] ?? 0;
    const len = (ground - gy) / Math.max(0.3, Math.cos(ang));
    let endX = gx;
    for (let d = 4; d < len; d++) {
      const spread = 0.5 + d * 0.1;
      const y = Math.round(gy + Math.cos(ang) * d);
      if (y > ground) break;
      endX = gx + Math.sin(ang) * d;
      for (let w = -spread; w <= spread; w += 1) {
        const x = Math.round(endX + w);
        if (((x + y * 3 + Math.floor(t * 10)) & 3) !== 0) continue;
        s.set(x, y, col);
      }
    }
    // Where the beam lands, a splash of its colour on the ground.
    for (let j = 0; j < 14; j++) {
      const sx = Math.round(endX + (hash3(j, k, 1) - 0.5) * 14);
      const sy = Math.round(ground - 2 + (hash3(j, k, 2) - 0.5) * 5);
      if (((sx + sy + Math.floor(t * 8)) & 1) === 0) s.set(sx, sy, col);
    }
  }
  // Two searchlights from the shore, sweeping the sky in the guild's colours: seen across the valley.
  for (const [k, sx] of [
    [0, a.x + 16],
    [1, b.x - 16],
  ] as const) {
    const ang = Math.sin(t * 0.9 + k * 2.4) * 0.5 + (k ? 0.25 : -0.25);
    const col = k === 0 ? ix(R.STAR, 3) : ix(R.GLOW, 5);
    for (let d = 6; d < 220; d++) {
      const x = Math.round(sx + Math.sin(ang) * d);
      const y = Math.round(ground - 4 - Math.cos(ang) * d);
      if (y < 0) break;
      const spread = Math.floor(d / 40);
      for (let w = -spread; w <= spread; w++) {
        if (((x + w + y + Math.floor(t * 12)) & 3) !== 0) continue;
        s.setWhere(x + w, y, col, (c) => c >> 3 <= R.SKY2 || c >> 3 === R.HAZE);
      }
    }
  }
  // Confetti, now and then, in the air over the pond.
  for (let k = 0; k < 18; k++) {
    const u = (t * 0.35 + hash3(k, 1, 7)) % 1;
    const cx = Math.round(a.x + hash3(k, 2, 7) * (b.x - a.x) + Math.sin(u * 8 + k) * 4);
    const cy = Math.round(a.y - 30 + u * 60);
    if (cy > ground - 2) continue;
    s.set(cx, cy, colours[k % colours.length] ?? 0);
  }
  // Notes bobbing up from the dancers, on the beat.
  for (let k = 0; k < 5; k++) {
    const u = (t * 0.6 + k / 5) % 1;
    const nx = Math.round(a.x + 30 + ((k * 37) % Math.max(1, b.x - a.x - 60)) + Math.sin(u * 6 + k) * 3);
    const ny = Math.round(ground - 10 - u * 26);
    if (u > 0.8) continue;
    const c = colours[k % colours.length] ?? 0;
    s.set(nx, ny, c);
    s.set(nx, ny + 1, c);
    s.set(nx - 1, ny + 2, c);
    s.set(nx + 1, ny - 1, onBeat ? ix(R.CREAM, 7) : c);
  }
}
