/**
 * Things that last a moment: sparks, leaves, dust, rings, words that rise and fade, and small
 * pictures that fly from one spot to another. Positions are on the map unless said otherwise.
 */
import { P } from "./palette.ts";

export type Part = {
  /** `spark` twinkles, `leaf` drifts and sways, `dust` swells and fades, `bit` tumbles and falls. */
  kind: "spark" | "leaf" | "dust" | "bit";
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  t: number;
  life: number;
  col: string;
  size: number;
};
export type Ring = { x: number; y: number; t: number; life: number; r: number; col: string; water: boolean };
export type Float = {
  x: number;
  y: number;
  text: string;
  col: string;
  t: number;
  life: number;
  icon: HTMLCanvasElement | null;
};
export type Flight = {
  icon: HTMLCanvasElement;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
  dur: number;
  arc: number;
  scale: number;
  done: (() => void) | null;
};

export const parts: Part[] = [];
export const rings: Ring[] = [];
export const floats: Float[] = [];
/** Flights across the map (a lantern to the rope), and across the screen, over the interface (Leaf to the purse). */
export const flights: Flight[] = [];
export const topFlights: Flight[] = [];
/** Bright bits strewn over the whole screen for a celebration, in screen pixels. */
export const confetti: Part[] = [];

const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const CAP = 420;

export function sparks(x: number, y: number, cols: readonly string[], n = 12, speed = 26): void {
  for (let i = 0; i < n && parts.length < CAP; i++) {
    const a = rand(0, 6.283);
    const v = rand(speed * 0.3, speed);
    parts.push({
      kind: "spark",
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - speed * 0.4,
      g: 30,
      t: 0,
      life: rand(0.5, 1.1),
      col: cols[i % cols.length] as string,
      size: 1,
    });
  }
}

export function leaves(x: number, y: number, n = 6, cols: readonly string[] = [P.g3, P.g4, P.g2]): void {
  for (let i = 0; i < n && parts.length < CAP; i++)
    parts.push({
      kind: "leaf",
      x: x + rand(-5, 5),
      y: y + rand(-9, -2),
      vx: rand(-8, 8),
      vy: rand(-14, -4),
      g: 22,
      t: 0,
      life: rand(1, 1.8),
      col: cols[i % cols.length] as string,
      size: 1,
    });
}

export function dust(x: number, y: number, n = 3, col = "#c9a984"): void {
  for (let i = 0; i < n && parts.length < CAP; i++)
    parts.push({
      kind: "dust",
      x: x + rand(-1.5, 1.5),
      y,
      vx: rand(-6, 6),
      vy: rand(-7, -2),
      g: 0,
      t: 0,
      life: rand(0.35, 0.6),
      col,
      size: 1,
    });
}

export function smoke(x: number, y: number, col = "#b9a6c4"): void {
  if (parts.length >= CAP) return;
  parts.push({ kind: "dust", x, y, vx: rand(2, 6), vy: rand(-11, -7), g: 0, t: 0, life: rand(2.2, 3.4), col, size: 2 });
}

export function bits(x: number, y: number, cols: readonly string[], n = 14): void {
  for (let i = 0; i < n && parts.length < CAP; i++) {
    const a = rand(-2.6, -0.5);
    const v = rand(18, 46);
    parts.push({
      kind: "bit",
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      g: 70,
      t: 0,
      life: rand(0.8, 1.4),
      col: cols[i % cols.length] as string,
      size: 1,
    });
  }
}

export function ring(x: number, y: number, col: string, r = 16, life = 0.7, water = false): void {
  rings.push({ x, y, t: 0, life, r, col, water });
}

export function float(
  x: number,
  y: number,
  text: string,
  col: string = P.cream,
  icon: HTMLCanvasElement | null = null,
  life = 1.7,
): void {
  floats.push({ x, y, text, col, t: 0, life, icon });
}

export function fly(list: Flight[], f: Omit<Flight, "t">, delay = 0): void {
  list.push({ ...f, t: -delay });
}

/** A shower over the whole screen. */
export function celebrate(w: number, cols: readonly string[], n = 60): void {
  for (let i = 0; i < n; i++)
    confetti.push({
      kind: "bit",
      x: rand(0, w),
      y: rand(-80, -10),
      vx: rand(-30, 30),
      vy: rand(60, 160),
      g: 60,
      t: 0,
      life: rand(1.6, 2.8),
      col: cols[i % cols.length] as string,
      size: rand(4, 7),
    });
}

export function update(dt: number): void {
  for (const list of [parts, confetti]) {
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i] as Part;
      p.t += dt;
      if (p.t >= p.life) {
        list[i] = list[list.length - 1] as Part;
        list.pop();
        continue;
      }
      p.vy += p.g * dt;
      if (p.kind === "leaf") p.vx += Math.sin(p.t * 7 + p.x) * 30 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i] as Ring;
    r.t += dt;
    if (r.t >= r.life) rings.splice(i, 1);
  }
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i] as Float;
    f.t += dt;
    if (f.t >= f.life) floats.splice(i, 1);
  }
  for (const list of [flights, topFlights]) {
    for (let i = list.length - 1; i >= 0; i--) {
      const f = list[i] as Flight;
      f.t += dt;
      if (f.t >= f.dur) {
        list.splice(i, 1);
        f.done?.();
      }
    }
  }
}

/** Where a flight is now, and how big: it rises in an arc and lands with a little overshoot in size. */
export function flightAt(f: Flight): { x: number; y: number; s: number; a: number } | null {
  if (f.t < 0) return null;
  const t = Math.min(1, f.t / f.dur);
  const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  return {
    x: f.x0 + (f.x1 - f.x0) * e,
    y: f.y0 + (f.y1 - f.y0) * e - Math.sin(t * Math.PI) * f.arc,
    s: f.scale * (0.7 + 0.5 * Math.sin(t * Math.PI)),
    a: t > 0.9 ? (1 - t) * 10 : 1,
  };
}
