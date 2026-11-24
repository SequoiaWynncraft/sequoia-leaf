/** Small things everything else leans on: canvases, numbers, and repeatable noise. */

import type { Rect } from "@sequoia-leaf/core";

// Points, boxes and noise are core's, so that the rules can use them too.
export { clamp, hash, type Pt, type Rect, vnoise } from "@sequoia-leaf/core";

export type Ctx = CanvasRenderingContext2D;

export function must<T>(v: T | null | undefined, what = "value"): T {
  if (v === null || v === undefined) throw new Error(`missing ${what}`);
  return v;
}

/**
 * A canvas to draw on. A picture painted once and kept (a sprite, the ground, an icon) is held in
 * ordinary memory: a phone that takes its graphics memory back (another app in front, memory
 * short) empties every large canvas kept there, and nothing would paint these again. A canvas
 * `redrawn` every frame is left to the browser to place.
 */
export function makeCanvas(w: number, h: number, redrawn = false): { c: HTMLCanvasElement; g: Ctx } {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const g = must(c.getContext("2d", redrawn ? undefined : { willReadFrequently: true }), "2d context");
  g.imageSmoothingEnabled = false;
  return { c, g };
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const dist = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(ax - bx, ay - by);
export const inRect = (r: Rect, x: number, y: number): boolean =>
  x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

/** A seeded stream of numbers in [0, 1). */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(list: readonly T[], r: number): T {
  return must(list[Math.min(list.length - 1, Math.floor(r * list.length))], "list entry");
}
