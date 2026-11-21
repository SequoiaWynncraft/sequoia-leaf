/**
 * The small things that make the table answer: sparks and motes, rings spreading, words that rise
 * and fade, things that fly from one place to another, and "do this in a moment". All of it runs
 * on the stage's clock and is measured from the board's corner, in art pixels.
 */
import { INK } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import { widthOf, write } from "@sequoia-leaf/kit/text.ts";
import { clamp, type Ctx, lerp } from "@sequoia-leaf/kit/util.ts";

import type { Pt } from "./geometry.ts";
import { V } from "./stage.ts";

// ---------- in a moment ----------

interface Due {
  at: number;
  fn: () => void;
}
let due: Due[] = [];
/** Does something after some seconds of the stage's clock. */
export function later(seconds: number, fn: () => void): void {
  due.push({ at: V.t + seconds, fn });
}
/** Forgets everything that was going to happen. */
export function forgetLater(): void {
  due = [];
}

// ---------- sparks ----------

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  ttl: number;
  col: string;
  size: number;
  grav: number;
  /** Drawn over the figures rather than under them. */
  above: boolean;
}
const bits: Bit[] = [];

export interface BurstLook {
  speed?: number;
  /** Which way they mostly go, as an angle, and how widely they spread round it. */
  toward?: number;
  spread?: number;
  ttl?: number;
  grav?: number;
  size?: number;
  above?: boolean;
  /** How far from the spot they may start. */
  scatter?: number;
}
/** A puff of pixels from a spot. */
export function burst(x: number, y: number, n: number, cols: readonly string[], o: BurstLook = {}): void {
  if (bits.length > 500) return;
  for (let i = 0; i < n; i++) {
    const a = (o.toward ?? 0) + (Math.random() - 0.5) * (o.spread ?? Math.PI * 2);
    const sp = (o.speed ?? 26) * (0.4 + Math.random() * 0.8);
    const sc = o.scatter ?? 0;
    bits.push({
      x: x + (Math.random() - 0.5) * sc,
      y: y + (Math.random() - 0.5) * sc,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 0,
      ttl: (o.ttl ?? 0.5) * (0.6 + Math.random() * 0.7),
      col: cols[Math.floor(Math.random() * cols.length)] ?? "#ffffff",
      size: o.size ?? 1,
      grav: o.grav ?? 60,
      above: o.above ?? true,
    });
  }
}
/** Motes that drift upward and go out: a heal, a blessing. */
export function motes(x: number, y: number, n: number, cols: readonly string[]): void {
  burst(x, y, n, cols, { toward: -Math.PI / 2, spread: 0.8, speed: 18, grav: -8, ttl: 0.8, scatter: 10 });
}

// ---------- rings ----------

interface Ring {
  x: number;
  y: number;
  r0: number;
  r1: number;
  life: number;
  ttl: number;
  col: string;
}
const rings: Ring[] = [];
/** A ring that spreads out across the board, lying flat on it. */
export function ring(x: number, y: number, r1: number, col: string, ttl = 0.4, r0 = 2): void {
  rings.push({ x, y, r0, r1, life: 0, ttl, col });
}

// ---------- words that rise ----------

interface Floater {
  x: number;
  y: number;
  text: string;
  col: string;
  life: number;
  ttl: number;
  big: boolean;
  rise: number;
}
const floaters: Floater[] = [];
/** A word or a number that rises from a spot and fades. */
export function say(
  x: number,
  y: number,
  text: string,
  col: string,
  o: { big?: boolean; ttl?: number; rise?: number } = {},
): void {
  if (floaters.length > 60) floaters.shift();
  floaters.push({ x, y, text, col, life: 0, ttl: o.ttl ?? 0.8, big: o.big === true, rise: o.rise ?? 12 });
}

// ---------- things that fly across the interface ----------

export interface Flyer {
  pic: HTMLCanvasElement;
  from: Pt;
  to: Pt;
  t0: number;
  dur: number;
  arc: number;
  land: (() => void) | null;
}
const flyers: Flyer[] = [];
/** Sends a small picture from one spot to another over everything, in an arc; `land` happens when it arrives. */
export function fly(
  pic: HTMLCanvasElement,
  from: Pt,
  to: Pt,
  o: { dur?: number; arc?: number; delay?: number; land?: () => void } = {},
): void {
  flyers.push({ pic, from, to, t0: V.t + (o.delay ?? 0), dur: o.dur ?? 0.45, arc: o.arc ?? 14, land: o.land ?? null });
}

// ---------- every moment ----------

export function stepFx(dt: number): void {
  if (due.length > 0) {
    const now = due.filter((d) => d.at <= V.t);
    if (now.length > 0) {
      due = due.filter((d) => d.at > V.t);
      for (const d of now) d.fn();
    }
  }
  for (let i = bits.length - 1; i >= 0; i--) {
    const b = bits[i];
    if (!b) continue;
    b.life += dt;
    if (b.life >= b.ttl) {
      bits.splice(i, 1);
      continue;
    }
    b.vy += b.grav * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    if (!r) continue;
    r.life += dt;
    if (r.life >= r.ttl) rings.splice(i, 1);
  }
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    if (!f) continue;
    f.life += dt;
    if (f.life >= f.ttl) floaters.splice(i, 1);
  }
  for (let i = flyers.length - 1; i >= 0; i--) {
    const f = flyers[i];
    if (!f || V.t < f.t0 + f.dur) continue;
    flyers.splice(i, 1);
    f.land?.();
  }
}

function pixelRing(g: Ctx, x: number, y: number, rx: number, ry: number, col: string): void {
  const n = Math.max(10, Math.round(rx * 4));
  g.fillStyle = col;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    g.fillRect(Math.round(x + Math.cos(a) * rx), Math.round(y + Math.sin(a) * ry), 1, 1);
  }
}

/** Rings, and the sparks that lie under the figures. */
export function drawFxUnder(g: Ctx): void {
  for (const r of rings) {
    const k = r.life / r.ttl;
    const rad = lerp(r.r0, r.r1, 1 - (1 - k) * (1 - k));
    g.globalAlpha = clamp((1 - k) * 1.6, 0, 1);
    pixelRing(g, V.bx + r.x, V.by + r.y, rad, rad * 0.72, r.col);
    if (rad > 6) pixelRing(g, V.bx + r.x, V.by + r.y, rad - 1.5, (rad - 1.5) * 0.72, r.col);
  }
  g.globalAlpha = 1;
  drawBits(g, false);
}
/** The sparks over the figures. */
export function drawFxOver(g: Ctx): void {
  drawBits(g, true);
}
function drawBits(g: Ctx, above: boolean): void {
  for (const b of bits) {
    if (b.above !== above) continue;
    g.globalAlpha = clamp((b.ttl - b.life) / (b.ttl * 0.5), 0, 1);
    R(g, Math.round(V.bx + b.x), Math.round(V.by + b.y), b.size, b.size, b.col);
  }
  g.globalAlpha = 1;
}

/** Words over the enlarged picture. */
export function wordsFx(ctx: Ctx, px: number): void {
  for (const f of floaters) {
    const k = f.life / f.ttl;
    const size = f.big ? px + 1 : px;
    const half = Math.round(widthOf(ctx, f.text, size, true) / 2) + 2 * size;
    const x = clamp(Math.round((V.bx + f.x) * V.z), half, Math.max(half, ctx.canvas.width - half));
    const y = Math.round((V.by + f.y - f.rise * (1 - (1 - k) * (1 - k))) * V.z) - 8 * size;
    ctx.globalAlpha = clamp((1 - k) * 2.2, 0, 1);
    write(ctx, f.text, x, y, { px: size, bold: true, colour: f.col, align: "center", edge: INK });
  }
  ctx.globalAlpha = 1;
}

/** The things in flight, drawn over the interface. Says whether there were any. */
export function drawFlyers(g: Ctx): boolean {
  let any = false;
  for (const f of flyers) {
    if (V.t < f.t0) {
      any = true;
      continue;
    }
    const k = clamp((V.t - f.t0) / f.dur, 0, 1);
    const e = k * k * (3 - 2 * k);
    const x = lerp(f.from.x, f.to.x, e);
    const y = lerp(f.from.y, f.to.y, e) - Math.sin(k * Math.PI) * f.arc;
    g.drawImage(f.pic, Math.round(V.bx + x - f.pic.width / 2), Math.round(V.by + y - f.pic.height / 2));
    any = true;
  }
  return any;
}

/** Clears everything away, as when a run is put down. */
export function clearFx(): void {
  bits.length = 0;
  rings.length = 0;
  floaters.length = 0;
  flyers.length = 0;
  due = [];
}
