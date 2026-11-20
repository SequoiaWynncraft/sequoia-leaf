/**
 * What moves in the forest, as functions of time so a still is exact: fireflies, needles from the
 * Great Sequoia, mist drifting over the Swamp and down the valley, birds crossing the dusk, snow,
 * the pennants on the Fruma ridge, the guild's lanterns, and the cast going about their lives.
 */

import { ix, R } from "../../engine/palette.ts";
import type { Light, Sprite, Surface } from "../../engine/raster.ts";
import { hash3, noise1, Rng } from "../../engine/rng.ts";
import {
  CAT,
  cinfyFrame,
  crabFrames,
  DUCK,
  DUCKLING,
  FIRESIDE_GLORPS,
  type Frame,
  frameAt,
  once,
  OWL,
  SLEEPING_FOX,
} from "./cast.ts";
import type { Hook } from "./great.ts";
import { ridgeCrest } from "./scenery.ts";
import { BANNERS, type Layer, WORLD_W } from "./world.ts";

const frac = (v: number): number => v - Math.floor(v);
/** Pixel animation steps at ten frames a second, as the welcome loops do. */
export const step = (t: number): number => Math.floor(t * 10) / 10;

/** Where a layer sits on screen this frame. */
export interface Place {
  /** Layer x at the screen's left edge, and world row at its top. */
  ox: number;
  oy: number;
}

/** Blits a sprite whose bottom-left is at layer (x, foot). */
export function put(s: Surface, sp: Sprite, x: number, foot: number, p: Place, flip = false): void {
  s.blit(sp, Math.round(x - p.ox), Math.round(foot - sp.h + 1 - p.oy), flip ? { flip } : {});
}

// ---------------------------------------------------------------------------------------------
// Fireflies.

export interface Mote {
  x: number;
  y: number;
  ax: number;
  ay: number;
  px: number;
  py: number;
  pulse: number;
  phase: number;
}

export function placeFireflies(layer: Layer, night: boolean, seed: number): Mote[] {
  const rng = new Rng(seed);
  const n = Math.round((WORLD_W / 360) * (night ? 26 : 16));
  const out: Mote[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      x: layer.lx(((i + rng.range(0.1, 0.9)) / n) * WORLD_W),
      y: rng.range(150, 236),
      ax: rng.range(4, 10),
      ay: rng.range(3, 7),
      px: rng.range(7, 13),
      py: rng.range(5, 11),
      pulse: rng.range(2.2, 4.2),
      phase: rng.next() * 10,
    });
  }
  return out;
}

export function drawFireflies(s: Surface, light: Light, motes: readonly Mote[], t: number, p: Place): void {
  for (const m of motes) {
    const x = Math.round(m.x + Math.sin((t / m.px) * Math.PI * 2 + m.phase) * m.ax - p.ox);
    if (x < -2 || x > s.w + 2) continue;
    const y = Math.round(m.y + Math.sin((t / m.py) * Math.PI * 2 + m.phase * 1.7) * m.ay - p.oy);
    const b = 0.5 + 0.5 * Math.sin((t / m.pulse) * Math.PI * 2 + m.phase);
    if (b < 0.3) continue;
    s.set(x, y, ix(R.GLOW, b > 0.8 ? 7 : b > 0.55 ? 6 : 2));
    if (b > 0.75) light.pool(x, y, 5, 1.6, 1);
  }
}

// ---------------------------------------------------------------------------------------------
// Needles drifting down from the Great Sequoia's crown.

export interface Needle {
  x: number;
  top: number;
  bottom: number;
  period: number;
  phase: number;
}

export function placeNeedles(x0: number, x1: number, seed: number, count: number): Needle[] {
  const rng = new Rng(seed);
  return Array.from({ length: count }, (_, i) => ({
    x: x0 + ((i + rng.range(0.2, 0.8)) / count) * (x1 - x0),
    top: rng.range(60, 120),
    bottom: rng.range(222, 244),
    period: rng.range(10, 17),
    phase: rng.next(),
  }));
}

export function drawNeedles(s: Surface, needles: readonly Needle[], t: number, p: Place): void {
  for (const n of needles) {
    const u = frac(t / n.period + n.phase);
    const y = n.top + (n.bottom - n.top) * u - p.oy;
    const x = n.x + Math.sin(u * 9 + n.phase * 6) * 5 - p.ox;
    if (x < -2 || x > s.w + 2) continue;
    const tumble = Math.floor(t * 3 + n.phase * 5) % 2;
    s.set(x, y, ix(R.BARK, u > 0.9 ? 4 : 6));
    s.set(x + (tumble ? 1 : -1), y + 1, ix(R.OLIVE, 6));
  }
}

// ---------------------------------------------------------------------------------------------
// Mist: teal, as the members' favourite painting has it, drifting slowly in long banks.

export interface Mist {
  X0: number;
  X1: number;
  y: number;
  thick: number;
  density: number;
  speed: number;
  seed: number;
  /** Teal (the members' "Fogbound Sequoias"), or the valley's own lavender haze. */
  teal?: boolean;
}

/** The mist's colour: the palette's spare ramp, loaded with teal for this forest (see `forest.ts`). */
const MIST = R.RARITY;

/**
 * Mist as the welcome scenes draw it: long horizontal streaks, one row high, thickest at the bank's
 * middle and fraying at its top and bottom. Each row drifts at its own pace, so the bank shears
 * slowly as it moves.
 */
export function drawMist(s: Surface, layer: Layer, banks: readonly Mist[], t: number, p: Place): void {
  for (const b of banks) {
    const fx0 = Math.max(0, layer.lx(b.X0 - 60) - p.ox);
    const fx1 = Math.min(s.w, layer.lx(b.X1 + 60) - p.ox);
    if (fx1 <= fx0) continue;
    const y0 = Math.max(0, Math.floor(b.y - b.thick - p.oy));
    const y1 = Math.min(s.h - 1, Math.ceil(b.y + b.thick - p.oy));
    for (let y = y0; y <= y1; y++) {
      const wy = y + p.oy;
      const v = 1 - Math.abs(wy - b.y) / b.thick;
      if (v <= 0) continue;
      const row = hash3(wy, b.seed, 1);
      const speed = b.speed * (0.7 + row * 0.6);
      // Sparser toward the bank's edges: streaks there are short and few.
      const need = 1 - b.density * (0.35 + 0.65 * v) * 0.62;
      for (let x = fx0; x < fx1; x++) {
        const lx = x + p.ox;
        const X = layer.X(lx);
        const edge = Math.min(1, (X - b.X0 + 60) / 120, (b.X1 + 60 - X) / 120);
        if (edge <= 0) continue;
        const drift = lx - t * speed;
        const n =
          noise1(drift / (14 + row * 16) + wy * 3.17, b.seed) * 0.75 + noise1(drift / 5 + wy * 1.3, b.seed + 3) * 0.25;
        if (n * edge < need) continue;
        const bright = v > 0.6 && n > need + 0.12;
        s.set(x, y, b.teal ? ix(MIST, bright ? 3 : 2) : ix(R.HAZE, bright ? 7 : 6));
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Birds: a little flock crossing the evening sky now and then.

const BIRD = [
  [
    [-2, -1],
    [-1, 0],
    [1, 0],
    [2, -1],
    [0, 0],
  ],
  [
    [-2, 0],
    [-1, 0],
    [1, 0],
    [2, 0],
    [0, 0],
  ],
  [
    [-2, 1],
    [-1, 0],
    [1, 0],
    [2, 1],
    [0, 0],
  ],
] as const;

export function drawBirds(s: Surface, layer: Layer, t: number, p: Place, colour: number): void {
  const period = 48;
  const u = frac(t / period + 0.62);
  if (u > 0.7) return;
  const lead = layer.lx(-200 + (u / 0.7) * (WORLD_W + 400));
  const flock = [
    [0, 0],
    [-7, 3],
    [-13, 6],
    [-6, -4],
    [-15, -1],
  ];
  flock.forEach(([dx, dy], i) => {
    const x = Math.round(lead + (dx ?? 0) - p.ox);
    if (x < -4 || x > s.w + 4) return;
    const y = Math.round(84 + (dy ?? 0) + Math.sin(t * 0.8 + i) * 1.5 - p.oy);
    const frame = BIRD[Math.floor(t * 6 + i * 1.3) % 3] ?? BIRD[0];
    for (const [bx, by] of frame) s.set(x + bx, y + by, colour);
  });
}

// ---------------------------------------------------------------------------------------------
// Snow, falling through the near plane so it pans with the forest.

export function drawSnow(s: Surface, t: number, p: Place, seed: number): void {
  const span = s.h + 20;
  const n = Math.round((s.w * s.h) / 700);
  const wide = s.w + 40;
  for (let i = 0; i < n; i++) {
    const near = hash3(i, seed, 1) < 0.2;
    const speed = near ? 14 : 7 + hash3(i, seed, 2) * 4;
    const y = frac((t * speed) / span + hash3(i, seed, 3)) * span - 10;
    const x0 = hash3(i, seed, 4) * wide - ((p.ox * (near ? 1.1 : 1)) % wide);
    const x = (((x0 % wide) + wide) % wide) - 20 + Math.sin(t * 0.6 + i) * (near ? 5 : 3);
    s.set(x, y, ix(R.SNOW, near ? 7 : 6));
    if (near) s.set(x + 1, y, ix(R.SNOW, 5));
  }
}

// ---------------------------------------------------------------------------------------------
// The guild's pennants on the Fruma ridge: gold, an orange sun, each on its own slow flutter.

const PENNANT = [
  ["Pgggg..", "PgoGgg.", "Pgggg..", "P......", "P......", "P......", "P......"],
  ["Pggg...", "PgoGgg.", "Pggggg.", "P......", "P......", "P......", "P......"],
  ["Pgggg..", "PgoGggg", "Pggg...", "P......", "P......", "P......", "P......"],
];

export function drawPennant(s: Surface, x: number, foot: number, t: number, phase: number, raise = 1): void {
  const frame = PENNANT[Math.floor(t * 4 + phase * 3) % 3] ?? PENNANT[0];
  if (!frame) return;
  const h = frame.length;
  const shown = Math.round(h * raise);
  for (let y = 0; y < h; y++) {
    const row = frame[y] ?? "";
    const yy = foot - h + y + (h - shown);
    if (yy > foot) continue;
    for (let k = 0; k < row.length; k++) {
      const c = row[k];
      if (c === "P") s.set(x + k, yy, ix(R.WOOD, 1));
      else if (raise >= 1 || y >= h - shown) {
        if (c === "g") s.set(x + k, yy, ix(R.SHROOM, 4));
        else if (c === "G") s.set(x + k, yy, ix(R.SHROOM, 5));
        else if (c === "o") s.set(x + k, yy, ix(R.CRAB, 5));
      }
    }
  }
}

export function drawBanners(s: Surface, ridge: Layer, t: number, p: Place): void {
  BANNERS.forEach((X, i) => {
    const x = ridge.lx(X) - p.ox;
    if (x < -8 || x > s.w + 2) return;
    drawPennant(s, x, ridgeCrest(X) - p.oy, t, i * 0.37);
  });
}

// ---------------------------------------------------------------------------------------------
// The guild's lanterns in the Great Sequoia: small iron lanterns on cords, each on its own beat.

const LANTERN = [".K.", "KMK", "GCG", "GCG", "KMK"];

export function drawHanging(s: Surface, light: Light, h: Hook, t: number, i: number, p: Place, night: boolean): void {
  const x = h.x - p.ox;
  if (x < -12 || x > s.w + 12) return;
  const y = h.y - p.oy;
  const sway = Math.sin(t * 0.9 + i * 1.7) > 0.7 ? 1 : 0;
  for (let k = 0; k < h.cord; k++) s.set(x + (k > h.cord / 2 ? sway : 0), y + k, ix(R.METAL, 1));
  const b = 0.75 + 0.25 * Math.sin(t * 1.3 + i * 2.1);
  drawLanternAt(s, light, x + sway, y + h.cord, b, night);
}

/** One lantern, its top-centre at (x, y), glowing at brightness `b` (0 to 1). */
export function drawLanternAt(s: Surface, light: Light, x: number, y: number, b: number, night: boolean): void {
  LANTERN.forEach((row, ry) => {
    for (let k = 0; k < row.length; k++) {
      const c = row[k];
      const v =
        c === "K"
          ? ix(R.METAL, 1)
          : c === "M"
            ? ix(R.METAL, 4)
            : c === "G"
              ? ix(R.GLOW, b > 0.85 ? 5 : 4)
              : c === "C"
                ? ix(R.GLOW, 7)
                : 0;
      if (v) s.set(x - 1 + k, y + ry, v);
    }
  });
  light.pool(x, y + 3, (night ? 14 : 10) * b, night ? 2.4 : 2, 1);
}

// ---------------------------------------------------------------------------------------------
// The crab colony.

export interface Crab {
  /** The crab's ground point, its middle. */
  x: number;
  foot: number;
  phase: number;
  /** How far it scuttles each way. */
  roam: number;
}

export function placeCrabs(x0: number, x1: number, shore: number, back: number): Crab[] {
  const rng = new Rng(0xc2ab);
  // Two sunning on the left rock, one on the right, one at the water's edge, one across the water
  // on the far bank, one wandering off toward the path. Never in a row.
  const spots: [number, number][] = [
    [0.17, shore - 3],
    [0.3, shore],
    [0.63, shore - 4],
    [0.46, back + 1],
    [0.83, shore + 1],
    [1.04, shore + 4],
  ];
  return spots.map(([u, foot]) => ({
    x: Math.round(x0 + u * (x1 - x0)),
    foot,
    phase: rng.range(0, 7),
    roam: rng.int(1, 4),
  }));
}

/** A crab's frame and offset: its idle loop, now and then a sideways scuttle; at a rave, dancing on the beat. */
export function crabPose(c: Crab, t: number, rave: boolean, numbered = false): { f: Frame; dx: number; dy: number } {
  const frames = crabFrames(numbered);
  if (rave) {
    const beat = Math.floor((t + c.phase * 0.02) / 0.234);
    const sway = [0, 1, 0, -1][beat % 4] ?? 0;
    return { f: frameAt(frames.rave, (t + c.phase * 0.02) * 1000), dx: sway, dy: 0 };
  }
  const ms = (t + c.phase) * 1000;
  const u = frac((t + c.phase) / 8) * 8;
  if (u > 2 && u < 3.6) {
    const k = Math.floor((u - 2) * 6);
    const off = [0, 1, 2, 3, 3, 2, 1, 0, 0, -1][k % 10] ?? 0;
    return { f: frameAt(frames.idle, ms), dx: Math.max(-c.roam, Math.min(c.roam, off)), dy: 0 };
  }
  return { f: frameAt(frames.idle, ms), dx: 0, dy: 0 };
}

/** A tapped crab explodes affectionately into confetti, once. */
export const crabHappy = (numbered: boolean, ms: number): Frame => once(crabFrames(numbered).happy, ms);

/** Draws a frame with its ground point at layer (x, foot). */
export function putFrame(s: Surface, f: Frame, x: number, foot: number, p: Place, flip = false): void {
  const ax = flip ? f.sprite.w - 1 - f.ax : f.ax;
  s.blit(f.sprite, Math.round(x - ax - p.ox), Math.round(foot - f.ay - p.oy), flip ? { flip } : {});
}

// ---------------------------------------------------------------------------------------------
// Cinfy, behind the counter: a bead of sweat now and then.

/** Draws Cinfy from the chest up, hidden below the counter's top. */
export function drawCinfy(s: Surface, x: number, counter: number, t: number, p: Place): void {
  const u = frac(t / 7.3) * 7.3;
  const f = cinfyFrame(t * 1000, u > 3.4 && u < 5.2);
  const sp = f.sprite;
  const x0 = Math.round(x - f.ax - p.ox);
  const y0 = Math.round(counter - sp.h + 6 - p.oy);
  const clip = counter - p.oy;
  for (let y = 0; y < sp.h; y++) {
    if (y0 + y >= clip) break;
    for (let k = 0; k < sp.w; k++) {
      const v = sp.data[y * sp.w + k] ?? 0;
      if (v) s.set(x0 + k, y0 + y, v);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The Swamp's duck family, paddling slowly up and down their pool.

export function drawDucks(s: Surface, x0: number, x1: number, y: number, t: number, p: Place): void {
  const span = x1 - x0 - 34;
  const u = frac(t / 46);
  const dir = u < 0.5 ? 1 : -1;
  const pos = u < 0.5 ? u * 2 : 2 - u * 2;
  const lead = x0 + 6 + pos * span;
  const flip = dir < 0;
  const bob = (i: number): number => (Math.floor(t * 2 + i) % 2 === 0 ? 0 : 1);
  put(s, DUCK, lead, y + bob(0), p, flip);
  for (let i = 0; i < 3; i++) put(s, DUCKLING, lead - dir * (9 + i * 7), y + bob(i + 1), p, flip);
}

// ---------------------------------------------------------------------------------------------
// The campfire's company: two glorps on the left bench, a third on the right, the White Fox asleep
// in the firelight, and the cat.

/** Where the cat loafs, from the fire. */
export const CAT_SEAT = { dx: 44, dy: 6 };

export function drawFireside(s: Surface, fireX: number, fireY: number, t: number, p: Place, catBlink: boolean): void {
  const seats: [number, number][] = [
    [fireX - 36, fireY - 2],
    [fireX - 22, fireY - 1],
    [fireX + 28, fireY],
  ];
  seats.forEach(([x, y], i) => {
    const g = FIRESIDE_GLORPS[i];
    if (g) putFrame(s, frameAt(g, t * 1000 + i * 700), x, y, p);
  });
  putFrame(s, frameAt(SLEEPING_FOX, t * 1000), fireX - 13, fireY + 13, p);
  put(s, catBlink ? CAT.blink : CAT.loaf, fireX + CAT_SEAT.dx - 5, fireY + CAT_SEAT.dy, p);
}

export function drawOwl(s: Surface, x: number, y: number, t: number, p: Place): void {
  putFrame(s, frameAt(OWL, t * 1000), x + 6, y, p);
}
