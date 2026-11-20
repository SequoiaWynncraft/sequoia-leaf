/**
 * The Forest's live moments and its ambient life, drawn over the bundle's layers in the welcome's
 * vocabulary (`../../bundle/vocabulary.ts`): firefly motes, falling leaves, sparkles, pools of
 * lantern light, snowflakes, and the props' lantern, sky lantern and pennant. Each moment is a
 * function of the seconds since it began (`e`), so a still at any moment is exact. Places are on
 * the ground (valley x, picture row) unless they say otherwise; `Stage.at` puts them in the picture.
 *
 * - A raid: the party's four trees light up, a light rises from each and drifts to the Great
 *   Sequoia, and the four become one lantern hanging in its canopy, glowing warm.
 * - A war win: the gold pennant rises on the far ridge (in the far layer's parallax) while falling
 *   leaves spell S E Q.
 * - A guild level-up: sky lanterns lift from the Great Sequoia and the trees into the sky.
 * - The anniversary: the crabs rave at the pond under coloured lights.
 */

import type { Pixels } from "../../bundle/art.ts";
import { mixColour } from "../../bundle/palette.ts";
import {
  leaf,
  mote,
  type Paint,
  pool,
  propFrame,
  type Sheets,
  snowflake,
  sparkleStage,
} from "../../bundle/vocabulary.ts";
import { hash3 } from "../../engine/rng.ts";

export const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
export const ease = (v: number): number => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** 0 before `a`, rising to 1 at `b`, holding, falling back to 0 from `c` to `d`. */
export const env = (e: number, a: number, b: number, c: number, d: number): number =>
  e < a || e > d ? 0 : e < b ? (e - a) / (b - a) : e > c ? 1 - (e - c) / (d - c) : 1;

export const LENGTH = { raid: 11, war: 9.5, levelup: 11 } as const;

/** What the forest's moments draw with: the picture, the palette in its light, the sheets, the camera. */
export interface Stage extends Paint, Sheets {
  /** A ground x's column in the picture, or a layer's at its depth. */
  at(x: number, depth?: number): number;
  /** The picture's width and the visible columns' middle. */
  view: number;
  mid: number;
}

export interface Point {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------------------------
// Lanterns in the Great Sequoia.

/** Where a lantern hangs: a column under the Great Sequoia's canopy, the canopy's underside there, and its cord. */
export interface Hook {
  x: number;
  y: number;
  cord: number;
}

/**
 * The places a lantern can hang in the Great Sequoia, read from the ground layer: columns where
 * its canopy (opaque from the picture's top) has open air under it rather than the trunk, nearest
 * the heart first, alternating sides, a little apart.
 */
export function lanternHooks(ground: Pixels, great: { x: number; w: number }, heart: number): Hook[] {
  const solid = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < ground.w && y < ground.h && (ground.data[y * ground.w + x] ?? 0) >>> 24 >= 128;
  const trunkRow = Math.round(ground.h * 0.42);
  const open: { x: number; y: number }[] = [];
  for (let x = great.x + 6; x < great.x + great.w - 6; x++) {
    if (!solid(x, 0) || solid(x, trunkRow) || solid(x - 5, trunkRow) || solid(x + 5, trunkRow)) continue;
    let y = 0;
    while (y < 40 && solid(x, y)) y++;
    if (y >= 5 && y < 40) open.push({ x, y });
  }
  const picked: Hook[] = [];
  for (const c of open.toSorted((a, b) => Math.abs(a.x - heart) - Math.abs(b.x - heart))) {
    if (picked.some((h) => Math.abs(h.x - c.x) < 9)) continue;
    picked.push({ x: c.x, y: c.y, cord: 3 + Math.floor(hash3(c.x, 5, 61) * 7) });
  }
  return picked;
}

/** Where a hook's lantern hangs: its foot (the prop's bottom) and the middle of its glass. */
export const lanternAt = (h: Hook): { foot: Point; glass: Point } => ({
  foot: { x: h.x, y: h.y + h.cord + 8 },
  glass: { x: h.x, y: h.y + h.cord + 4 },
});

/** A lantern hanging on its cord from the canopy, glowing; `k` (0 to 1) brings it in. */
export function drawLantern(s: Stage, h: Hook, t: number, k = 1): void {
  if (k <= 0) return;
  const x = s.at(h.x);
  if (x < -12 || x > s.view + 12) return;
  const { foot, glass } = lanternAt(h);
  const cord = s.ink.c("panda_outline");
  for (let y = h.y; y < h.y + h.cord; y++) s.pic.set(x, y, cord);
  const f = propFrame(s, "lantern", "glow", t * 1000 + h.x * 37);
  const night = s.ambiance === "night";
  pool(s, x, glass.y, (night ? 13 : 9) * k, s.ink.c("lantern_light"), (night ? 0.5 : 0.3) * k);
  if (f) s.pic.sprite(f, x, foot.y);
  else mote(s, x, glass.y, k);
}

// ---------------------------------------------------------------------------------------------
// A raid.

export interface RaidSetup {
  /** Each party tree: its crown's middle and its top row. */
  party: readonly { x: number; top: number }[];
  /** Where their lantern hangs. */
  hook: Hook;
}

/** The camera's ground x through a raid: to the party, then with their lights to the Great Sequoia. */
export function raidCamera(r: RaidSetup, e: number, from: number): number {
  const partyX = r.party.reduce((a, p) => a + p.x, 0) / Math.max(1, r.party.length);
  if (e < 3.0) return lerp(from, partyX, ease(e / 1.6));
  return lerp(partyX, r.hook.x, ease((e - 3.0) / 2.6));
}

/** How strongly the party's trees are lit now (0 to 1). */
export const raidShimmer = (e: number): number => env(e, 0.4, 0.9, 3.6, 4.6);

/** When the lights merge and the lantern is hung. */
const MERGE = 5.8;
const HUNG = 6.5;

/** One party light on the ground plane at `e`, or null before it rises or after the lantern is hung. */
function raidLight(r: RaidSetup, i: number, e: number): Point | null {
  const p = r.party[i];
  if (!p) return null;
  const rise0 = 1.3 + i * 0.14;
  if (e < rise0 || e >= HUNG) return null;
  const k = ease((e - rise0) / 1.1);
  const riseY = p.top - 3 - 12 * k;
  const go0 = 2.6 + i * 0.16;
  if (e < go0) return { x: p.x + Math.sin(e * 5 + i) * 1.5 * k, y: riseY };
  const end = lanternAt(r.hook).glass;
  if (e < MERGE) {
    const u = ease((e - go0) / (MERGE - go0));
    const start = { x: p.x, y: p.top - 15 };
    const ctrl = { x: (start.x + end.x) / 2, y: Math.min(start.y, end.y) - 24 - i * 5 };
    const y = (1 - u) * (1 - u) * start.y + 2 * (1 - u) * u * ctrl.y + u * u * end.y;
    const x = (1 - u) * (1 - u) * start.x + 2 * (1 - u) * u * ctrl.x + u * u * end.x;
    return { x: x + Math.sin(u * Math.PI * 2 + i * 1.7) * 6 * u * (1 - u), y };
  }
  // Merging: the four circle the lantern's place, closing in.
  const m = clamp01((e - MERGE) / (HUNG - MERGE));
  const a = i * (Math.PI / 2) + m * 7;
  const rad = 9 * (1 - m);
  return { x: end.x + Math.cos(a) * rad, y: end.y + Math.sin(a) * rad * 0.6 };
}

/** A light on its way: a bright mote with its warm pool and a short fading trail. */
function wisp(s: Stage, x: number, y: number, k: number): void {
  pool(s, x, y, 6, s.ink.c("lantern_light"), 0.35 * k);
  mote(s, Math.round(x), Math.round(y), k);
}

/**
 * The raid's lights and its lantern; returns where the lantern is in the picture and how open its
 * label should be, for the HUD.
 */
export function drawRaid(s: Stage, r: RaidSetup, e: number, t: number): { lantern: Point | null; labelA: number } {
  for (let i = 0; i < r.party.length; i++) {
    for (let trail = 3; trail >= 0; trail--) {
      const p = raidLight(r, i, e - trail * 0.07);
      if (!p) continue;
      if (trail === 0) wisp(s, s.at(p.x), p.y, 1);
      else mote(s, Math.round(s.at(p.x)), Math.round(p.y), 0.5 - trail * 0.12);
    }
  }
  const hook = r.hook;
  const glass = lanternAt(hook).glass;
  if (e >= HUNG - 0.15) drawLantern(s, hook, t, clamp01((e - HUNG + 0.15) / 0.3));
  // The merge's burst: the welcome's sparkles thrown round the new lantern.
  const since = e - (HUNG - 0.1);
  if (since >= 0 && since < 0.9)
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.3;
      const rr = 4 + since * 22;
      const u = since / 0.9;
      s.pic.sparkle(
        s.at(glass.x) + Math.cos(a) * rr,
        glass.y + Math.sin(a) * rr * 0.6,
        sparkleStage(u),
        s.ink.c("star"),
        s.ink.c("lantern_glass_bright"),
      );
    }
  return { lantern: e >= HUNG ? { x: s.at(glass.x), y: glass.y - 6 } : null, labelA: env(e, 6.8, 7.2, 9.8, 10.6) };
}

// ---------------------------------------------------------------------------------------------
// A war win.

/**
 * Where the pennant stands on the far ridge, in the far layer's own pixels: the top of the far
 * mountains in the stretch over the heart (measured from the bundle's far layer, the same shape in
 * every season and light). The bundle does not mark it yet.
 */
export const RIDGE: Point = { x: 230, y: 81 };

/** The war's camera: to where the ridge's pennant stands in the middle of the picture. */
export function warCamera(e: number, from: number, ridgeCx: number): number {
  return lerp(from, ridgeCx, ease(e / 1.8));
}

/** The gold pennant rising on the far ridge (drawn in the far layer's parallax), then flying. */
export function drawPennant(s: Stage, e: number, t: number, farDepth: number): void {
  const x = s.at(RIDGE.x, farDepth);
  if (x < -12 || x > s.view + 2) return;
  const rise = ease((e - 0.5) / 2);
  if (rise <= 0) return;
  const f = propFrame(s, "pennant", "wave", t * 1000);
  if (!f) return;
  const foot = RIDGE.y + Math.round((1 - rise) * (f.h + 1));
  // Only what has risen above the ridge shows: the rest is still behind it.
  const ox = Math.round(x) - f.foot.x;
  const oy = foot - f.foot.y;
  for (let yy = 0; yy < f.h; yy++) {
    const ty = oy + yy;
    if (ty >= RIDGE.y || ty < 0) continue;
    for (let xx = 0; xx < f.w; xx++) {
      const v = f.strip.data[yy * f.strip.w + f.index * f.w + xx] ?? 0;
      if (v >>> 24 >= 128) s.pic.set(ox + xx, ty, (v | 0xff000000) >>> 0);
    }
  }
  const since = e - 2.5;
  if (since > 0 && since < 0.9)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const rr = 3 + since * 12;
      s.pic.sparkle(
        x + 5 + Math.cos(a) * rr,
        RIDGE.y - 9 + Math.sin(a) * rr * 0.7,
        sparkleStage(since / 0.9, false),
        s.ink.c("star"),
        s.ink.c("ring_gold_light"),
      );
    }
}

/** S, E and Q, a leaf to a cell, as members spell SEQ in reactions under every win. */
const LETTERS: readonly (readonly string[])[] = [
  ["###", "#..", "###", "..#", "###"],
  ["###", "#..", "###", "#..", "###"],
  [".##.", "#..#", "#..#", "#.#.", ".#.#"],
];

/** Where each leaf of S E Q settles, round (0, 0), in picture pixels. */
function seqCells(): Point[] {
  const out: Point[] = [];
  const cell = 3;
  const widths = LETTERS.map((l) => (l[0]?.length ?? 3) * cell);
  const total = widths.reduce((a, w) => a + w, 0) + 2 * 5;
  let left = -total / 2;
  LETTERS.forEach((rows, li) => {
    rows.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) if (row[c] === "#") out.push({ x: left + c * cell, y: r * cell - 10 });
    });
    left += (widths[li] ?? 9) + 5;
  });
  return out;
}
const SEQ = seqCells();

/** Falling leaves that gather into S E Q over the middle of the screen, hold, and fall on. */
export function drawSeq(s: Stage, e: number): void {
  const [light, dark] = [s.ink.c("falling_leaf"), s.ink.c("falling_leaf_dark")];
  const cy = 40;
  SEQ.forEach((cell, i) => {
    const land = 0.9 + hash3(i, 1, 71) * 1.4;
    const from = { x: cell.x + (hash3(i, 2, 71) - 0.5) * 40, y: -8 - hash3(i, 3, 71) * 24 };
    const release = 5.6 + hash3(i, 4, 71) * 0.6;
    let x: number;
    let y: number;
    let tilt = 0;
    if (e < land) {
      const u = clamp01(e / land);
      if (u <= 0) return;
      x = lerp(from.x, cell.x, ease(u)) + Math.sin(u * 9 + i) * 3 * (1 - u);
      y = lerp(from.y, cell.y + cy, u);
      tilt = Math.floor(e * 6 + i);
    } else if (e < release) {
      // Held flat, so the strokes read; now and then one flickers in the breeze.
      x = cell.x;
      y = cell.y + cy;
      tilt = hash3(i, Math.floor(e * 3), 74) < 0.08 ? 1 : 0;
    } else {
      const u = e - release;
      x = cell.x + Math.sin(u * 3 + i) * 5 + u * 4;
      y = cell.y + cy + u * u * 16 + u * 6;
      tilt = Math.floor(e * 6 + i);
      if (y > s.pic.H + 4) return;
    }
    leaf(s, Math.round(s.mid + x), Math.round(y), tilt, light, dark);
  });
  // While the word holds, a few of the welcome's sparkles over it.
  if (e > 2.4 && e < 6)
    for (let i = 0; i < 4; i++) {
      const u = (((e * 0.9 + i * 0.27) % 1) + 1) % 1;
      const c = SEQ[Math.floor(hash3(i, Math.floor(e * 0.9 + i * 0.27), 73) * SEQ.length)];
      if (c)
        s.pic.sparkle(
          s.mid + c.x + 1,
          cy + c.y - 2,
          sparkleStage(u, false),
          s.ink.c("star"),
          s.ink.c("ring_gold_light"),
        );
    }
}

// ---------------------------------------------------------------------------------------------
// A guild level-up.

/** Sky lanterns lifting from the given places into the sky, swaying, each glowing as it goes. */
export function drawSkyLanterns(s: Stage, sources: readonly Point[], e: number, t: number): void {
  if (sources.length === 0) return;
  for (let i = 0; i < 16; i++) {
    const born = 0.6 + i * 0.32;
    const age = e - born;
    if (age < 0) continue;
    const src = sources[i % sources.length];
    if (!src) continue;
    const speed = 8 + hash3(i, 1, 81) * 6;
    const y = src.y - age * speed - age * age * 0.6;
    if (y < -10) continue;
    const x = s.at(src.x + (hash3(i, 2, 81) - 0.5) * 16) + Math.sin(age * 1.3 + i) * (2 + age * 0.6);
    const k = clamp01(age / 0.6);
    pool(s, x, y - 3, 6, s.ink.c("lantern_light"), (s.ambiance === "night" ? 0.45 : 0.28) * k);
    const f = propFrame(s, "sky-lantern", "rise", t * 1000 + i * 90);
    if (f) s.pic.sprite(f, x, y);
    else mote(s, Math.round(x), Math.round(y), k);
  }
}

// ---------------------------------------------------------------------------------------------
// The crabs.

export interface Crab {
  /** Where it ambles round, on the ground. */
  x: number;
  foot: number;
  phase: number;
  /** No. 08. */
  numbered: boolean;
}

/** The pond's crabs on its near bank, and No. 08 off by the gate's sign. */
export function placeCrabs(pond: number, gate: number): Crab[] {
  return [
    { x: pond - 64, foot: 132, phase: 0.4, numbered: false },
    { x: pond - 30, foot: 134, phase: 2.1, numbered: false },
    { x: pond + 8, foot: 131, phase: 3.7, numbered: false },
    { x: pond + 44, foot: 133, phase: 5.2, numbered: false },
    { x: gate + 14, foot: 131, phase: 1.3, numbered: true },
  ];
}

export interface CrabPose {
  x: number;
  anim: "idle" | "walk" | "happy";
  flip: boolean;
  ms: number;
}

/** A crab now: ambling sideways along the bank, or dancing at a rave, or happy for `hop` seconds after a tap. */
export function crabPose(c: Crab, t: number, rave: boolean, hop: number): CrabPose {
  if (hop >= 0 && hop < 1) return { x: c.x, anim: "happy", flip: false, ms: hop * 1000 };
  if (rave)
    return {
      x: c.x + Math.round(Math.sin(t * 2 + c.phase) * 3),
      anim: "happy",
      flip: Math.sin(t + c.phase) < 0,
      ms: t * 1000 + c.phase * 300,
    };
  const u = t * 0.32 + c.phase;
  const v = Math.cos(u);
  return {
    x: c.x + Math.round(Math.sin(u) * 7),
    anim: Math.abs(v) > 0.35 ? "walk" : "idle",
    flip: v < 0,
    ms: t * 1000 + c.phase * 400,
  };
}

/**
 * The rave's lights: fairy lights strung along the pond's far bank blinking on the beat, coloured
 * pools sweeping the bank where the crabs dance, and sparkles in the lights' colours.
 */
export function drawRave(s: Stage, pond: number, t: number): void {
  // The welcome's own lights: magic, firefly, ice, ember and new leaf.
  const colours = ["#d9b6ff", "#ffe58a", "#b2cfe9", "#e0603e", "#b8d24a"].map((h) => s.ink.any(h, true));
  const beat = Math.floor(t * 2.2);
  // The string: three spans sagging between the reeds of the far bank.
  const posts = [pond - 92, pond - 38, pond + 18, pond + 72];
  for (let k = 0; k + 1 < posts.length; k++) {
    const a = posts[k] ?? 0;
    const b = posts[k + 1] ?? 0;
    for (let x = a; x <= b; x++) {
      const u = (x - a) / (b - a);
      const y = Math.round(97 + Math.sin(u * Math.PI) * 5);
      const px = s.at(x);
      if (px < -1 || px > s.view + 1) continue;
      if ((x - a) % 5 === 2) {
        const c = colours[(Math.floor((x - a) / 5) + k + beat) % colours.length] ?? colours[0] ?? 0;
        const on = hash3(x, beat, 93) < 0.75;
        if (on)
          for (const [dx, dy] of [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
          ] as const)
            s.pic.blend(px + dx, y + 1 + dy, c, 0.4);
        s.pic.set(px, y + 1, on ? c : s.ink.c("panda_outline"));
      } else s.pic.set(px, y, s.ink.c("panda_outline"));
    }
  }
  colours.forEach((c, i) => {
    const x = s.at(pond + Math.sin(t * (0.9 + i * 0.23) + i * 1.7) * 70);
    const y = 128 + Math.sin(t * (1.3 + i * 0.17) + i) * 4;
    pool(s, x, y, 9, c, 0.6);
  });
  for (let i = 0; i < 6; i++) {
    const u = (t * 2.2) % 1;
    const x = s.at(pond + (hash3(i, beat, 91) - 0.5) * 140);
    const y = 104 + hash3(i, beat, 92) * 22;
    s.pic.sparkle(x, y, sparkleStage(u), s.ink.c("star"), colours[(i + beat) % colours.length] ?? s.ink.c("star_arm"));
  }
}

// ---------------------------------------------------------------------------------------------
// Ambient life.

export interface Firefly {
  x: number;
  y: number;
  phase: number;
  speed: number;
}

/** Fireflies over the valley's floor and among the trees, the same every visit. */
export function placeFireflies(valley: number, count: number): Firefly[] {
  return Array.from({ length: count }, (_, i) => ({
    x: 20 + hash3(i, 1, 101) * (valley - 40),
    y: 64 + hash3(i, 2, 101) * 64,
    phase: hash3(i, 3, 101) * 10,
    speed: 0.6 + hash3(i, 4, 101) * 0.8,
  }));
}

/** The fireflies, drifting and blinking as the welcome's do. */
export function drawFireflies(s: Stage, flies: readonly Firefly[], t: number): void {
  for (const f of flies) {
    const x = s.at(f.x + Math.sin(t * 0.21 * f.speed + f.phase) * 9);
    if (x < -2 || x > s.view + 2) continue;
    const y = f.y + Math.sin(t * 0.37 * f.speed + f.phase * 1.3) * 5;
    const pulse = Math.sin(t * 1.7 * f.speed + f.phase * 2);
    mote(s, Math.round(x), Math.round(y), pulse > 0.2 ? pulse : pulse > -0.4 ? 0.15 : 0);
  }
}

/** Leaves drifting down out of the canopies, a few in view at a time, on the ground plane. */
export function drawFallingLeaves(s: Stage, count: number, t: number): void {
  const [light, dark] = [s.ink.c("falling_leaf"), s.ink.c("falling_leaf_dark")];
  const span = s.view + 12;
  for (let i = 0; i < count; i++) {
    const period = 9 + hash3(i, 1, 111) * 6;
    const clock = t + hash3(i, 2, 111) * period;
    const u = (((clock / period) % 1) + 1) % 1;
    const cycle = Math.floor(clock / period);
    const x0 = s.at(hash3(i, cycle, 112) * span) + Math.sin(u * 8 + i) * 6 + u * 12;
    const x = (((Math.round(x0) % span) + span) % span) - 6;
    const y = -4 + u * (s.pic.H + 8);
    leaf(s, x, Math.round(y), Math.floor(u * 14 + i), light, dark);
  }
}

/** Snow at two depths: dim specks far off, bright flakes near, drifting with the wind. */
export function drawSnow(s: Stage, t: number): void {
  for (const near of [false, true]) {
    const depth = near ? 1.15 : 0.6;
    const count = near ? 70 : 90;
    for (let i = 0; i < count; i++) {
      const speed = (near ? 11 : 6) * (0.8 + hash3(i, 1, near ? 121 : 122) * 0.5);
      const fall = (s.pic.H + 6) / speed;
      const u = ((((t + hash3(i, 2, 123) * fall) / fall) % 1) + 1) % 1;
      const span = s.view + 8;
      const x0 = s.at(hash3(i, near ? 3 : 4, 124) * span, depth) + Math.sin(u * 6 + i) * 2 + u * 8;
      const x = (((Math.round(x0) % span) + span) % span) - 4;
      const y = Math.round(-3 + u * (s.pic.H + 6));
      snowflake(s, x, y, near);
    }
  }
}

/** Raid water falling on a friend's crown you just watered, then dew that stays as it waits for them. */
export function drawWatering(s: Stage, crown: { x: number; top: number; w: number }, age: number, t: number): void {
  const x0 = s.at(crown.x);
  for (let k = 0; k < 9; k++) {
    const u = age * 1.4 - k * 0.09;
    if (u < 0 || u > 1) continue;
    const x = x0 + (hash3(k, 1, 131) - 0.5) * crown.w * 0.7;
    const y = crown.top - 12 + u * 18;
    const f = propFrame(s, "drop", u < 0.85 ? "fall" : "splash", t * 1000 + k * 40);
    if (f) s.pic.sprite(f, x, y);
    else s.pic.set(x, y, s.ink.c("ice_body"));
  }
  if (age > 0.6) drawDew(s, crown, t, Math.min(1, (age - 0.6) * 2) * 6);
}

/** Dew on a crown: the welcome's sparkle in frost tones, a few at a time. */
export function drawDew(s: Stage, crown: { x: number; top: number; w: number }, t: number, count = 2): void {
  const x0 = s.at(crown.x);
  for (let i = 0; i < count; i++) {
    const b = 0.5 + 0.5 * Math.sin(t * 2.3 + i * 2.1 + crown.x);
    if (b < 0.7) continue;
    const x = x0 + (hash3(i, Math.round(crown.x), 141) - 0.5) * crown.w * 0.6;
    const y = crown.top + 3 + hash3(i, Math.round(crown.x), 142) * 8;
    s.pic.sparkle(x, y, b > 0.92 ? 1 : 0, s.ink.c("ice_hi"), s.ink.c("frost"));
  }
}

/** A tree's light: lantern light over its own pixels (the atlas box at dx, dy), with a band climbing it. */
export function lightTree(
  s: Paint,
  atlas: Pixels,
  box: { x: number; y: number; w: number; h: number },
  dx: number,
  dy: number,
  k: number,
  band: number | null,
): void {
  const lit = s.ink.c("lantern_light");
  const bright = mixColour(lit, s.ink.c("lantern_core"), 0.5);
  for (let y = 0; y < box.h; y++) {
    const py = dy + y;
    if (py < 0 || py >= s.pic.H) continue;
    const inBand = band !== null && Math.abs(y - band) < 2.5;
    for (let x = 0; x < box.w; x++) {
      const v = atlas.data[(box.y + y) * atlas.w + box.x + x] ?? 0;
      if (v >>> 24 < 128) continue;
      s.pic.light(dx + x, py, inBand ? bright : lit, inBand ? k * 0.55 : k * 0.2);
    }
  }
}
