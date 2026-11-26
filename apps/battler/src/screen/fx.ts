/**
 * The small things that make the table answer: sparks and motes, light gathering in, rings
 * spreading, small pictures that pop up, streaks, words that rise and fade, things that fly from
 * one place to another, and "do this in a moment". All of it is measured from the board's corner,
 * in art pixels. It runs on the stage's clock, at the fight's pace while a fight is played
 * (`pace`), so that a fight at 4x speeds its sparks up with it and a hit-stop holds them.
 */
import { CREAM, INK } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import { widthOf, write } from "@sequoia-leaf/kit/text.ts";
import { clamp, type Ctx, lerp } from "@sequoia-leaf/kit/util.ts";

import type { Pt } from "./geometry.ts";
import { keepNewest, sparksFor } from "./playback.ts";
import { V } from "./stage.ts";

/** How fast sparks, rings, pictures and words go by against the stage's clock: the fight's speed while one is played, 0 while it is held. */
export const pace = { k: 1 };

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
/** A puff of pixels from a spot. The oldest go when there are more than the screen keeps. */
export function burst(x: number, y: number, n: number, cols: readonly string[], o: BurstLook = {}): void {
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
      col: cols[Math.floor(Math.random() * cols.length)] ?? CREAM,
      size: o.size ?? 1,
      grav: o.grav ?? 60,
      above: o.above ?? true,
    });
  }
  keepNewest(bits, sparksFor((V.w * V.z) / V.dpr, (V.h * V.z) / V.dpr));
}
/** Bits drawn in to a spot from all round it, arriving in `ttl` seconds: an ability gathering. */
export function gather(x: number, y: number, n: number, cols: readonly string[], ttl: number): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
    const r = 9 + Math.random() * 4;
    const t = ttl * (0.7 + Math.random() * 0.3);
    bits.push({
      x: x + Math.cos(a) * r,
      y: y + Math.sin(a) * r * 0.8,
      vx: (-Math.cos(a) * r) / t,
      vy: (-Math.sin(a) * r * 0.8) / t,
      life: 0,
      ttl: t,
      col: cols[i % cols.length] ?? CREAM,
      size: 1,
      grav: 0,
      above: true,
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
  /** Drawn over the figures, as a ring in the air is, rather than lying under them. */
  above: boolean;
}
const rings: Ring[] = [];
/** A ring that spreads out across the board, lying flat on it. */
export function ring(x: number, y: number, r1: number, col: string, ttl = 0.4, r0 = 2, above = false): void {
  rings.push({ x, y, r0, r1, life: 0, ttl, col, above });
}

// ---------- small pictures, and streaks ----------

/** How a small picture behaves: plumping up and settling, rising, staying put, or bouncing up and away. */
export type PopHow = "plump" | "rise" | "stick" | "bounce";
interface Pic {
  pic: HTMLCanvasElement;
  x: number;
  y: number;
  how: PopHow;
  life: number;
  ttl: number;
}
const pics: Pic[] = [];
/** A small picture over the board, its middle at a spot, for `ttl` seconds. */
export function pop(pic: HTMLCanvasElement, x: number, y: number, how: PopHow, ttl = 0.5): void {
  pics.push({ pic, x, y, how, life: 0, ttl });
}

interface Streak {
  from: Pt;
  to: Pt;
  head: string;
  tail: string;
  life: number;
  ttl: number;
}
const streaks: Streak[] = [];
/** A line drawn fast from one spot to another, which then fades from its far end back: a stab, a spark jumping. */
export function streak(from: Pt, to: Pt, head: string, tail: string, ttl = 0.3): void {
  streaks.push({ from, to, head, tail, life: 0, ttl });
}

// ---------- words that rise ----------

interface Floater {
  x: number;
  y: number;
  text: string;
  col: string;
  life: number;
  ttl: number;
  /** Written a size larger, or a size smaller. */
  size: -1 | 0 | 1;
  rise: number;
}
const floaters: Floater[] = [];
/** A word or a number that rises from a spot and fades. */
export function say(
  x: number,
  y: number,
  text: string,
  col: string,
  o: { big?: boolean; small?: boolean; ttl?: number; rise?: number } = {},
): void {
  if (floaters.length > 60) floaters.shift();
  floaters.push({
    x,
    y,
    text,
    col,
    life: 0,
    ttl: o.ttl ?? 0.8,
    size: o.big ? 1 : o.small ? -1 : 0,
    rise: o.rise ?? 12,
  });
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

/** Ages everything in a list by `dt`, dropping what has had its time. */
function age(list: { life: number; ttl: number }[], dt: number): void {
  for (const x of list) x.life += dt;
  const kept = list.filter((x) => x.life < x.ttl);
  if (kept.length < list.length) list.splice(0, list.length, ...kept);
}

export function stepFx(real: number): void {
  if (due.length > 0) {
    const now = due.filter((d) => d.at <= V.t);
    if (now.length > 0) {
      due = due.filter((d) => d.at > V.t);
      for (const d of now) d.fn();
    }
  }
  const dt = real * pace.k;
  for (const b of bits) {
    b.vy += b.grav * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }
  for (const list of [bits, rings, floaters, pics, streaks]) age(list, dt);
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
  drawRings(g, false);
  drawBits(g, false);
}
/** The sparks, pictures and streaks over the figures. */
export function drawFxOver(g: Ctx): void {
  drawRings(g, true);
  drawBits(g, true);
  for (const p of pics) drawPic(g, p);
  for (const s of streaks) drawStreak(g, s);
  g.globalAlpha = 1;
}
function drawRings(g: Ctx, above: boolean): void {
  for (const r of rings) {
    if (r.above !== above) continue;
    const k = r.life / r.ttl;
    const rad = lerp(r.r0, r.r1, 1 - (1 - k) * (1 - k));
    g.globalAlpha = clamp((1 - k) * 1.6, 0, 1);
    pixelRing(g, V.bx + r.x, V.by + r.y, rad, rad * 0.72, r.col);
    if (rad > 6) pixelRing(g, V.bx + r.x, V.by + r.y, rad - 1.5, (rad - 1.5) * 0.72, r.col);
  }
  g.globalAlpha = 1;
}
function drawPic(g: Ctx, p: Pic): void {
  const k = p.life / p.ttl;
  let w = p.pic.width;
  let h = p.pic.height;
  let dy = 0;
  if (p.how === "plump") {
    // Wide, then tall, then itself.
    const s = k < 0.15 ? 2 : k < 0.3 ? -1 : 0;
    w += s;
    h -= s;
  } else if (p.how === "rise") dy = -Math.round(8 * (1 - (1 - k) * (1 - k)));
  else if (p.how === "bounce") dy = Math.round(-Math.sin(Math.min(1, k * 1.4) * Math.PI) * 8 + k * 6);
  g.globalAlpha = clamp((1 - k) * 4, 0, 1);
  g.drawImage(p.pic, Math.round(V.bx + p.x - w / 2), Math.round(V.by + p.y - h / 2 + dy), w, h);
}
function drawStreak(g: Ctx, s: Streak): void {
  const k = s.life / s.ttl;
  const head = Math.min(1, k / 0.35);
  const tail = Math.max(0, (k - 0.35) / 0.65);
  const len = Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y);
  g.globalAlpha = 1;
  for (let d = tail * len; d <= head * len; d += 1) {
    const t = d / Math.max(1, len);
    const x = Math.round(V.bx + lerp(s.from.x, s.to.x, t));
    const y = Math.round(V.by + lerp(s.from.y, s.to.y, t));
    if (head * len - d < 2) R(g, x, y - 1, 2, 2, s.head);
    else R(g, x, y, 1, 1, s.tail);
  }
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
    const size = Math.max(1, px + f.size);
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
  pics.length = 0;
  streaks.length = 0;
  floaters.length = 0;
  flyers.length = 0;
  due = [];
  pace.k = 1;
}
