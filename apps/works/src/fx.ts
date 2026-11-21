/** The small reactions, as the town does them: sparks, leaves, dust, smoke, rings on the ground, and words that rise and fade. */

import { CREAM, GOLD } from "@sequoia-leaf/kit/palette.ts";

export interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Pull downwards (or up, for smoke), and how quickly it slows. */
  pull: number;
  drag: number;
  life: number;
  ttl: number;
  col: string;
  size: number;
  /** Drawn after dusk falls on the picture, so it shines. */
  glow: boolean;
  /** Leaves flutter from side to side as they fall. */
  flutter: number;
}

export interface Floater {
  x: number;
  y: number;
  text: string;
  col: string;
  life: number;
  ttl: number;
}

export interface Ring {
  x: number;
  y: number;
  life: number;
  ttl: number;
  r: number;
  col: string;
  /** Rings on water lie flat. */
  flat: boolean;
}

export const bits: Bit[] = [];
export const floaters: Floater[] = [];
export const rings: Ring[] = [];

const MAX_BITS = 420;

export function bit(b: Partial<Bit> & { x: number; y: number }): void {
  if (bits.length >= MAX_BITS) bits.shift();
  bits.push({
    vx: 0,
    vy: 0,
    pull: 0,
    drag: 0,
    life: 0,
    ttl: 0.8,
    col: CREAM,
    size: 1,
    glow: false,
    flutter: 0,
    ...b,
  });
}

/** Sparks flying out from a point. */
export function burst(x: number, y: number, count: number, cols: readonly string[], speed = 40, glow = true): void {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = speed * (0.35 + Math.random() * 0.65);
    bit({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - speed * 0.4,
      pull: 90,
      drag: 1.6,
      ttl: 0.45 + Math.random() * 0.4,
      col: cols[i % cols.length] ?? CREAM,
      glow,
    });
  }
}

/** Gold motes drifting upwards. */
export function sparkle(x: number, y: number, count: number, spread = 8): void {
  for (let i = 0; i < count; i++)
    bit({
      x: x + (Math.random() - 0.5) * spread * 2,
      y: y + (Math.random() - 0.5) * spread,
      vx: (Math.random() - 0.5) * 8,
      vy: -14 - Math.random() * 22,
      ttl: 0.6 + Math.random() * 0.7,
      col: i % 3 === 0 ? CREAM : (GOLD[1 + (i % 2)] ?? CREAM),
      glow: true,
    });
}

/** Leaves, petals or scraps of paper, fluttering down. */
export function flutter(x: number, y: number, count: number, cols: readonly string[], spread = 10, up = 20): void {
  for (let i = 0; i < count; i++)
    bit({
      x: x + (Math.random() - 0.5) * spread * 2,
      y: y + (Math.random() - 0.5) * 6,
      vx: (Math.random() - 0.5) * 26,
      vy: -Math.random() * up,
      pull: 46,
      drag: 2.2,
      ttl: 0.9 + Math.random() * 0.9,
      col: cols[i % cols.length] ?? CREAM,
      flutter: 3 + Math.random() * 4,
    });
}

/** A soft puff of dust or smoke. */
export function puff(x: number, y: number, count: number, col: string, rise = 8): void {
  for (let i = 0; i < count; i++)
    bit({
      x: x + (Math.random() - 0.5) * 5,
      y: y + (Math.random() - 0.5) * 2,
      vx: (Math.random() - 0.5) * 16,
      vy: -rise * (0.4 + Math.random()),
      drag: 2.5,
      ttl: 0.35 + Math.random() * 0.35,
      col,
      size: Math.random() < 0.4 ? 2 : 1,
    });
}

export function float(x: number, y: number, text: string, col: string = CREAM, ttl = 1.5): void {
  floaters.push({ x, y, text, col, life: 0, ttl });
}

export function ring(x: number, y: number, col: string, r = 7, flat = false): void {
  rings.push({ x, y, life: 0, ttl: flat ? 0.9 : 0.45, r, col, flat });
}

export function updateFx(dt: number): void {
  for (let i = bits.length - 1; i >= 0; i--) {
    const b = bits[i];
    if (!b) continue;
    b.life += dt;
    if (b.life >= b.ttl) {
      bits.splice(i, 1);
      continue;
    }
    b.vy += b.pull * dt;
    const k = Math.max(0, 1 - b.drag * dt);
    b.vx *= k;
    b.vy *= k;
    b.x += (b.vx + (b.flutter ? Math.sin(b.life * 7 + b.flutter * 3) * b.flutter * 4 : 0)) * dt;
    b.y += b.vy * dt;
  }
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    if (!f) continue;
    f.life += dt;
    f.y -= dt * 9;
    if (f.life >= f.ttl) floaters.splice(i, 1);
  }
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    if (!r) continue;
    r.life += dt;
    if (r.life >= r.ttl) rings.splice(i, 1);
  }
}

/** Every spark, word and ring is gone: another place is about to be shown. */
export function clearFx(): void {
  bits.length = 0;
  floaters.length = 0;
  rings.length = 0;
}

/** Smoke from a chimney: a few soft grey puffs that rise, drift and thin. */
export function smoke(x: number, y: number, col: string, count = 1): void {
  for (let i = 0; i < count; i++)
    bit({
      x: x + (Math.random() - 0.5) * 2,
      y,
      vx: 2 + Math.random() * 4,
      vy: -9 - Math.random() * 6,
      drag: 0.5,
      ttl: 1.2 + Math.random() * 0.8,
      col,
      size: Math.random() < 0.5 ? 2 : 1,
    });
}
