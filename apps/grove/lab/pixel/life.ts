/**
 * Everything that moves on its own, as functions of time: the campfire and its embers and smoke,
 * fireflies, drifting needles, falling snow, twinkling stars, the lantern, fairy lights and the
 * two companions' idle loops. Every motion is periodic and calm, and the same `t` always draws
 * the same frame, so a still is exact.
 */

import { isSky } from "./backdrop.ts";
import type { Layout, Point } from "./layout.ts";
import { ix, R, rampOf, type Season, type Time } from "./palette.ts";
import { bayer, fromRows, type Light, type Sprite, type Surface } from "./raster.ts";
import { hash3, Rng } from "./rng.ts";
import { CRAB, LANTERN, SQUIRREL } from "./sprites.ts";

const frac = (v: number): number => v - Math.floor(v);
/** Pixel animation runs at ten frames a second, as the welcome loops do. */
const step = (t: number): number => Math.floor(t * 10) / 10;

// ---------------------------------------------------------------------------------------------
// The campfire.

const ROCK = fromRows([".abb.", "abccb", "bccdb", ".bbd."], {
  a: ix(R.STONE, 6),
  b: ix(R.STONE, 4),
  c: ix(R.STONE, 3),
  d: ix(R.STONE, 2),
});

export interface FireState {
  /** Extra height while a cone is warming in it. */
  flare: number;
}

export function drawFireBack(s: Surface, L: Layout): void {
  const { x, y } = L.fire;
  // The ring's back stones, the ember bed and the logs.
  for (const a of [-2.7, -2.15, -1.55, -0.95, -0.4]) {
    s.blit(ROCK, Math.round(x + Math.cos(a) * 13) - 2, Math.round(y + Math.sin(a) * 4) - 3);
  }
  for (let dx = -8; dx <= 8; dx++) {
    s.set(x + dx, y, ix(R.FIRE, Math.abs(dx) < 3 ? 2 : 1));
    s.set(x + dx, y - 1, ix(R.INK, 2));
  }
  log(s, x - 10, y - 1, x + 7, y - 5);
  log(s, x + 10, y - 1, x - 6, y - 6);
}

function log(s: Surface, x0: number, y0: number, x1: number, y1: number): void {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const x = Math.round(x0 + (x1 - x0) * u);
    const y = Math.round(y0 + (y1 - y0) * u);
    const charred = u > 0.55;
    s.set(x, y - 1, ix(R.WOOD, charred ? 1 : 5));
    s.set(x, y, ix(R.WOOD, charred ? 0 : 3));
    s.set(x, y + 1, ix(R.WOOD, charred ? 0 : 2));
  }
  // The cut end, pale with a ring.
  s.set(x0, y0 - 1, ix(R.WOOD, 7));
  s.set(x0, y0, ix(R.WOOD, 6));
  s.set(x0, y0 + 1, ix(R.WOOD, 5));
}

const TONGUES = [
  { dx: 0, h: 19, w: 4.2, w1: 4.1, p: 0 },
  { dx: -4, h: 13, w: 3, w1: 5.3, p: 1.7 },
  { dx: 4, h: 14, w: 3, w1: 4.6, p: 3.1 },
  { dx: -1, h: 9, w: 2.2, w1: 6.2, p: 4.4 },
  { dx: 2, h: 8, w: 2, w1: 7.1, p: 2.2 },
  { dx: -6, h: 6, w: 1.6, w1: 5.8, p: 0.9 },
  { dx: 6, h: 6, w: 1.6, w1: 6.6, p: 3.7 },
];

export function drawFlames(s: Surface, L: Layout, t: number, fire: FireState): void {
  const ts = step(t);
  const { x, y } = L.fire;
  const base = y - 3;
  for (let pass = 0; pass < 3; pass++) {
    for (const tg of TONGUES) {
      const h =
        tg.h *
        (0.82 + 0.16 * Math.sin(ts * tg.w1 + tg.p) + 0.08 * Math.sin(ts * tg.w1 * 2.3 + tg.p)) *
        (1 + fire.flare);
      const sway = Math.sin(ts * 2.1 + tg.p) * 1.3;
      for (let k = 0; k <= h; k++) {
        const u = k / h;
        const hw =
          tg.w * Math.pow(1 - u, 0.75) * (u < 0.15 ? 0.7 + u * 2 : 1) * (pass === 0 ? 1 : pass === 1 ? 0.62 : 0.3);
        if (hw < 0.3) continue;
        const cx = x + tg.dx + sway * u * u;
        const level = pass === 0 ? (u > 0.75 ? 2 : 3) : pass === 1 ? (u > 0.6 ? 4 : 5) : u > 0.45 ? 6 : 7;
        for (let px = Math.round(cx - hw); px <= Math.round(cx + hw); px++) s.set(px, base - k, ix(R.FIRE, level));
      }
    }
  }
  // Licks that break away from the tips and rise.
  for (let i = 0; i < 3; i++) {
    const u = frac(ts * 1.6 + i / 3);
    const lx = Math.round(x + (i - 1) * 2 + Math.sin(ts * 3 + i) * 1.5);
    const ly = Math.round(base - 11 * (1 + fire.flare) - u * 7);
    if (u < 0.75) s.set(lx, ly, ix(R.FIRE, u < 0.4 ? 4 : 3));
  }
  // The ember bed flickers.
  for (let dx = -4; dx <= 4; dx++) {
    if (hash3(dx, Math.floor(ts * 10), 3) < 0.4) s.set(x + dx, y, ix(R.FIRE, 4));
  }
}

export function drawFireFront(s: Surface, L: Layout): void {
  const { x, y } = L.fire;
  for (const a of [0.15, 0.75, 1.35, 1.95, 2.55, 3.1]) {
    s.blit(ROCK, Math.round(x + Math.cos(a) * 14) - 2, Math.round(y + Math.sin(a) * 4.4) - 2);
  }
}

export function fireLight(light: Light, L: Layout, t: number, time: Time, fire: FireState): void {
  const ts = step(t);
  const flicker = 0.88 + 0.08 * Math.sin(ts * 7.1) + 0.06 * Math.sin(ts * 12.7 + 1);
  const reach = time === "night" ? 52 : time === "day" ? 26 : 54;
  const r = reach * flicker * (1 + fire.flare * 0.5);
  light.pool(L.fire.x, L.fire.y - 6, r * 0.42, 3.4, 1);
  light.pool(L.fire.x, L.fire.y - 2, r, time === "day" ? 1.2 : 2.6, 1.9);
}

// ---------------------------------------------------------------------------------------------
// Embers and smoke.

export function drawEmbers(s: Surface, L: Layout, t: number, boost = 0): void {
  const n = 7 + Math.round(boost * 10);
  for (let i = 0; i < n; i++) {
    const period = 1.7 + hash3(i, 1, 1) * 1.4;
    const u = frac(t / period + hash3(i, 2, 2));
    const x = L.fire.x + (hash3(i, 3, 3) - 0.5) * 8 + Math.sin(u * 7 + i) * 3 * u;
    const y = L.fire.y - 8 - u * (30 + hash3(i, 4, 4) * 16);
    if (u > 0.85 && hash3(i, Math.floor(t * 10), 5) < 0.5) continue;
    s.set(x, y, ix(R.FIRE, u < 0.3 ? 7 : u < 0.6 ? 6 : 5));
  }
}

export function drawSmoke(s: Surface, L: Layout, t: number): void {
  for (let i = 0; i < 5; i++) {
    const u = frac(t / 5.2 + i / 5);
    const cx = L.fire.x + 1 + u * 12 + Math.sin(u * 5 + i) * 2.5;
    const cy = L.fire.y - 18 - u * 46;
    const r = 1.6 + u * 5;
    const density = 0.6 * (1 - u) * Math.min(1, u * 6);
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const d = ((x - cx) ** 2 + (y - cy) ** 2) / (r * r);
        if (d > 1) continue;
        if (bayer(x, y) > density * (1 - d * 0.6)) continue;
        s.set(x, y, ix(R.SMOKE, u < 0.4 ? 5 : 4));
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Fireflies, needles, snow, stars.

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

export function placeFireflies(L: Layout, time: Time, seed: number): Mote[] {
  if (time === "day") return [];
  const rng = new Rng(seed ^ 0xf1ef);
  const n = Math.round((L.W / 360) * (time === "night" ? 22 : 14));
  const out: Mote[] = [];
  for (let i = 0; i < n; i++) {
    // Spread evenly across the glade's width, at varied heights over the undergrowth.
    const x = ((i + rng.range(0.2, 0.8)) / n) * L.W;
    const y = rng.range(L.horizon - 10, L.hudTop - 6);
    out.push({
      x,
      y,
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

export function drawFireflies(s: Surface, light: Light, motes: Mote[], t: number): void {
  for (const m of motes) {
    const x = Math.round(m.x + Math.sin((t / m.px) * Math.PI * 2 + m.phase) * m.ax);
    const y = Math.round(m.y + Math.sin((t / m.py) * Math.PI * 2 + m.phase * 1.7) * m.ay);
    const b = 0.5 + 0.5 * Math.sin((t / m.pulse) * Math.PI * 2 + m.phase);
    if (b < 0.3) continue;
    s.set(x, y, ix(R.GLOW, b > 0.8 ? 7 : b > 0.55 ? 6 : 2));
    if (b > 0.75) light.pool(x, y, 5, 1.6, 1);
  }
}

export interface Needle {
  x: number;
  top: number;
  bottom: number;
  period: number;
  phase: number;
}

export function placeNeedles(
  crown: { x0: number; y0: number; x1: number; y1: number },
  ground: number,
  seed: number,
  count: number,
): Needle[] {
  const rng = new Rng(seed ^ 0x4e3d);
  const out: Needle[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      x: crown.x0 + ((i + rng.range(0.2, 0.8)) / count) * (crown.x1 - crown.x0),
      top: rng.range(crown.y0 + 10, Math.max(crown.y0 + 12, ground - 40)),
      bottom: ground + rng.range(0, 14),
      period: rng.range(9, 15),
      phase: rng.next(),
    });
  }
  return out;
}

export function drawNeedles(s: Surface, needles: Needle[], t: number): void {
  for (const n of needles) {
    const u = frac(t / n.period + n.phase);
    const y = n.top + (n.bottom - n.top) * u;
    const x = n.x + Math.sin(u * 9 + n.phase * 6) * 4;
    const tumble = Math.floor(t * 3 + n.phase * 5) % 2;
    const c = ix(R.BARK, u > 0.9 ? 4 : 6);
    s.set(x, y, c);
    s.set(x + (tumble ? 1 : -1), y + 1, ix(R.OLIVE, 5));
  }
}

export function drawSnow(s: Surface, L: Layout, t: number, seed: number): void {
  const n = Math.round((L.W * L.H) / 900);
  for (let i = 0; i < n; i++) {
    const near = hash3(i, seed, 1) < 0.2;
    const speed = near ? 14 : 7 + hash3(i, seed, 2) * 4;
    const span = L.H + 20;
    const y = frac((t * speed) / span + hash3(i, seed, 3)) * span - 10;
    const x = hash3(i, seed, 4) * (L.W + 20) - 10 + Math.sin(t * 0.6 + i) * (near ? 5 : 3) + (y / span) * 6;
    s.set(x, y, ix(R.SNOW, near ? 7 : 6));
    if (near) s.set(x + 1, y, ix(R.SNOW, 5));
  }
}

export function drawStars(
  s: Surface,
  stars: { x: number; y: number; big: boolean; phase: number; period: number }[],
  t: number,
): void {
  for (const st of stars) {
    const b = 0.5 + 0.5 * Math.sin((t / st.period + st.phase) * Math.PI * 2);
    if (b < 0.2) continue;
    const core = ix(R.STAR, b > 0.7 ? 7 : 5);
    s.setWhere(st.x, st.y, core, isSky);
    if (st.big && b > 0.6) {
      const arm = ix(R.STAR, 4);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const)
        s.setWhere(st.x + dx, st.y + dy, arm, isSky);
      if (b > 0.9)
        for (const [dx, dy] of [
          [2, 0],
          [-2, 0],
          [0, 2],
          [0, -2],
        ] as const)
          s.setWhere(st.x + dx, st.y + dy, ix(R.STAR, 2), isSky);
    }
  }
}

const onLake = (v: number): boolean => rampOf(v) === R.SKY2;

/**
 * The lake's glints: short runs of the sunset's gold on the water, each coming and going on its
 * own slow beat. Drawn only on the lake itself, never on what stands in front of it.
 */
export function drawLakeGlints(
  s: Surface,
  lake: { x: number; y: number; rx: number; ry: number },
  t: number,
  time: Time,
): void {
  const n = Math.max(3, Math.round(lake.rx / 4));
  for (let i = 0; i < n; i++) {
    const row = lake.y - lake.ry + 1 + (i % Math.max(1, lake.ry * 2 - 1));
    const across = 1 - Math.abs(row - lake.y) / (lake.ry + 1);
    const x = Math.round(lake.x + (hash3(i, 1, 31) - 0.5) * 1.7 * lake.rx * across);
    const b = 0.5 + 0.5 * Math.sin(t * (0.7 + hash3(i, 2, 31) * 0.7) + i * 2.1);
    if (b < 0.45) continue;
    const len = b > 0.85 ? 3 : 2;
    const c = time === "night" ? ix(R.STAR, b > 0.85 ? 7 : 5) : ix(R.SKY2, b > 0.85 ? 7 : 6);
    for (let k = 0; k < len; k++) s.setWhere(x + k, row, c, onLake);
  }
}

/** The Great Sequoia's lanterns: warm specks that come and go, one per contribution. */
export function drawGuildLanterns(s: Surface, lanterns: Point[], t: number): void {
  lanterns.forEach((p, i) => {
    const b = 0.5 + 0.5 * Math.sin(t * 1.3 + i * 2.1);
    if (b < 0.25) return;
    s.setWhere(p.x, p.y, ix(R.GLOW, b > 0.7 ? 6 : 3), (v) => rampOf(v) === R.HAZE);
  });
}

// ---------------------------------------------------------------------------------------------
// The lantern on its crook.

export function drawLantern(s: Surface, light: Light, L: Layout, t: number, time: Time): void {
  const { x, y } = L.lantern;
  const top = y - 30;
  for (let py = top; py <= y; py++) {
    s.set(x, py, ix(R.WOOD, 4));
    s.set(x + 1, py, ix(R.WOOD, py < top + 3 ? 5 : 2));
  }
  // The crook: an arm out to the right with a hook.
  for (let k = 0; k < 6; k++) s.set(x + 1 + k, top - (k < 2 ? 1 : 0), ix(R.WOOD, k < 2 ? 5 : 4));
  s.set(x + 1, top - 1, ix(R.WOOD, 6));
  s.set(x + 6, top + 1, ix(R.METAL, 1));
  const swing = Math.sin((t / 5.5) * Math.PI * 2) > 0.55 ? 1 : 0;
  s.blit(LANTERN, x + 3 + swing, top + 2);
  light.pool(x + 6 + swing, top + 8, time === "night" ? 30 : time === "day" ? 8 : 24, time === "day" ? 1 : 2.4, 1.15);
  // Its pool on the ground.
  light.pool(x + 5, y + 2, time === "night" ? 22 : 16, time === "day" ? 0.6 : 1.5, 3);
}

// ---------------------------------------------------------------------------------------------
// Fairy lights, in winter: festoons from cluster to cluster with a bulb every seven pixels.

export function drawFestoon(s: Surface, light: Light, points: Point[], t: number, maxSpan = 64): void {
  let bulb = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) continue;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    if (dist > maxSpan || dist < 6) continue;
    const sag = Math.min(8, dist * 0.2);
    const n = Math.ceil(dist);
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      const x = Math.round(a.x + (b.x - a.x) * u);
      const y = Math.round(a.y + (b.y - a.y) * u + Math.sin(u * Math.PI) * sag);
      s.set(x, y, ix(R.LIGHTS, 0));
      if (k % 7 !== 3) continue;
      bulb++;
      const kind = bulb % 7 === 3 ? "red" : bulb % 9 === 5 ? "blue" : "warm";
      // Each bulb breathes on its own slow beat, through off, dim and bright.
      const b2 = 0.5 + 0.5 * Math.sin(t * (0.7 + (bulb % 5) * 0.13) + bulb * 1.7);
      const bright = b2 > 0.62;
      const dim = b2 < 0.22;
      const core = kind === "red" ? (dim ? 4 : 5) : kind === "blue" ? (dim ? 6 : 7) : dim ? 1 : bright ? 3 : 2;
      s.set(x, y + 1, ix(R.LIGHTS, core));
      s.set(x, y + 2, ix(R.LIGHTS, kind === "red" ? 4 : kind === "blue" ? 6 : 1));
      if (bright) {
        s.set(x - 1, y + 1, ix(R.LIGHTS, kind === "red" ? 4 : kind === "blue" ? 6 : 2));
        s.set(x + 1, y + 1, ix(R.LIGHTS, kind === "red" ? 4 : kind === "blue" ? 6 : 2));
        light.pool(x, y + 1, 8, 2.2, 1);
      } else if (!dim) light.pool(x, y + 1, 5, 1.6, 1);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The companions' idle loops.

export interface Critters {
  squirrelHop: number;
  crabParty: number;
}

export function squirrelFrame(t: number, hopAt: number): { sprite: Sprite; dy: number } {
  const since = t - hopAt;
  if (since >= 0 && since < 1.2) {
    const nib = Math.floor(since * 6) % 2 === 0;
    return { sprite: nib ? SQUIRREL.nibble : SQUIRREL.idle, dy: since < 0.3 ? -2 : since < 0.4 ? -1 : 0 };
  }
  const u = frac(t / 8) * 8;
  if ((u > 2.0 && u < 2.15) || (u > 7.3 && u < 7.45)) return { sprite: SQUIRREL.blink, dy: 0 };
  if (u > 3.5 && u < 4.7)
    return { sprite: Math.floor((u - 3.5) * 4) % 2 === 0 ? SQUIRREL.nibble : SQUIRREL.idle, dy: 0 };
  if (u > 6.0 && u < 6.5) return { sprite: SQUIRREL.flick, dy: 0 };
  return { sprite: SQUIRREL.idle, dy: 0 };
}

export function crabFrame(t: number, partyAt: number): { sprite: Sprite; dx: number; dy: number } {
  const since = t - partyAt;
  if (since >= 0 && since < 2.4) {
    // A little crab rave: claws up on the beat, a hop, a shuffle.
    const beat = Math.floor(since * 5);
    return { sprite: beat % 2 === 0 ? CRAB.wave : CRAB.idle, dx: beat % 4 < 2 ? 0 : 1, dy: beat % 2 === 0 ? -1 : 0 };
  }
  const u = frac(t / 7) * 7;
  if ((u > 1.4 && u < 1.6) || (u > 1.8 && u < 2.0)) return { sprite: CRAB.snap, dx: 0, dy: 0 };
  if (u > 3.0 && u < 3.15) return { sprite: CRAB.blink, dx: 0, dy: 0 };
  if (u > 3.5 && u < 4.8) {
    const k = Math.floor((u - 3.5) * 4);
    return { sprite: CRAB.idle, dx: [0, 1, 2, 2, 1][k] ?? 0, dy: 0 };
  }
  if (u > 4.8 && u < 5.6) return { sprite: CRAB.wave, dx: 0, dy: Math.floor((u - 4.8) * 5) % 2 === 0 ? -1 : 0 };
  return { sprite: CRAB.idle, dx: 0, dy: 0 };
}

export const seasonHasSnow = (season: Season): boolean => season === "winter";

/**
 * A shaft of evening light through the gap in the canopy onto a young tree, with dust drifting in
 * it, so the eye finds a seedling first. Warm light only: the sky behind it is untouched.
 */
export function lightShaft(s: Surface, light: Light, foot: Point, top: number, t: number, H: number): void {
  const x0 = foot.x + 30;
  const y0 = 0;
  const y1 = foot.y + 4;
  for (let y = y0; y <= y1; y++) {
    const u = (y - y0) / (y1 - y0);
    const cx = x0 + (foot.x - x0) * u;
    const hw = 3 + u * 9;
    for (let x = Math.floor(cx - hw - 1); x <= cx + hw + 1; x++) {
      if (x < 0 || x >= light.w || y < 0 || y >= light.h) continue;
      const d = Math.abs(x - cx) / hw;
      if (d > 1) continue;
      // One step of light across the beam, a second down its heart near the ground; only the
      // beam's very edge is broken, with a one-pixel checker.
      if (d > 0.82 && (x + y) % 2 === 0) continue;
      const level = d < 0.55 && u > 0.4 ? (u > 0.8 && d < 0.35 ? 3 : 2) : 1;
      const i = y * light.w + x;
      if ((light.data[i] ?? 0) < level) light.data[i] = level;
    }
  }
  // Dust in the beam.
  for (let i = 0; i < 9; i++) {
    const u = (((t / (7 + hash3(i, 1, 41) * 5) + hash3(i, 2, 41)) % 1) + 1) % 1;
    const y = Math.round(Math.max(top - 30, 4) + u * (y1 - Math.max(top - 30, 4)));
    const v = (y - y0) / (y1 - y0);
    const cx = x0 + (foot.x - x0) * v;
    const x = Math.round(cx + (hash3(i, 3, 41) - 0.5) * (6 + v * 10) + Math.sin(t * 0.8 + i) * 1.5);
    const b = 0.5 + 0.5 * Math.sin(t * 1.7 + i * 2.3);
    if (b < 0.4 || y > H) continue;
    s.set(x, y, ix(R.GLOW, b > 0.8 ? 6 : 4));
  }
}

/** Day: soft shafts of sun slanting through the canopy, drifting slowly. */
export function sunbeams(light: Light, L: Layout, t: number): void {
  const drift = t * 1.5;
  for (let y = Math.max(0, L.horizon - 30); y < L.H; y++) {
    for (let x = 0; x < L.W; x++) {
      const u = (((x + y * 0.55 + drift) % 58) + 58) % 58;
      const inBeam = u < 11 ? 1 - Math.abs(u - 5.5) / 5.5 : 0;
      if (inBeam <= 0) continue;
      if (bayer(x, y) > inBeam * 0.9) continue;
      const i = y * L.W + x;
      if ((light.data[i] ?? 0) < 1) light.data[i] = 1;
    }
  }
}
