/**
 * A picture of the part of the yard round the view, kept between frames: one canvas a little larger
 * than the view, that wraps round as the view moves (a pixel of the yard at (x, y) is kept at x and
 * y modulo the canvas's size). Moving the view keeps everything still in it where it is and says
 * which part of the yard came in, to be drawn; so what is kept is as large as the screen, and laying
 * it is at most four pictures.
 */

import { type Release, scope } from "@sequoia-leaf/kit/scope.ts";
import { type Ctx, makeCanvas } from "@sequoia-leaf/kit/util.ts";

import type { Box } from "./art/ground.ts";

/** A part of a box of the yard as it lies on the canvas: the yard's box, and its corner on the canvas. */
interface Piece {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly cx: number;
  readonly cy: number;
}

const mod = (v: number, n: number): number => ((v % n) + n) % n;

/** The parts of a box of the yard (cut to the box `k` kept) as they lie on a canvas of `k`'s size, split where it wraps. */
function pieces(b: Box, k: Box): Piece[] {
  const x0 = Math.max(b.x, k.x);
  const y0 = Math.max(b.y, k.y);
  const x1 = Math.min(b.x + b.w, k.x + k.w);
  const y1 = Math.min(b.y + b.h, k.y + k.h);
  if (x1 <= x0 || y1 <= y0) return [];
  const across = split(x0, x1, k.w);
  const down = split(y0, y1, k.h);
  return across.flatMap(([x, w, cx]) => down.map(([y, h, cy]) => ({ x, y, w, h, cx, cy })));
}

/** A box less another, as at most four boxes. */
function less(b: Box, o: Box): Box[] {
  const x0 = Math.max(b.x, o.x);
  const x1 = Math.min(b.x + b.w, o.x + o.w);
  const y0 = Math.max(b.y, o.y);
  const y1 = Math.min(b.y + b.h, o.y + o.h);
  if (x1 <= x0 || y1 <= y0) return [b];
  const out: Box[] = [];
  if (y0 > b.y) out.push({ x: b.x, y: b.y, w: b.w, h: y0 - b.y });
  if (y1 < b.y + b.h) out.push({ x: b.x, y: y1, w: b.w, h: b.y + b.h - y1 });
  if (x0 > b.x) out.push({ x: b.x, y: y0, w: x0 - b.x, h: y1 - y0 });
  if (x1 < b.x + b.w) out.push({ x: x1, y: y0, w: b.x + b.w - x1, h: y1 - y0 });
  return out;
}

export class Around {
  #made: { c: HTMLCanvasElement; g: Ctx; off: Release };
  readonly #lostThen: () => void;
  /** The box of the yard kept: its corner on the grid, and the canvas's size. */
  #box: Box = { x: 0, y: 0, w: 0, h: 0 };
  /** The canvas's pictures were emptied, by the browser or by `wipe`: nothing kept is trusted. */
  #lost = true;

  /** `lost` is told when the browser has emptied the canvas. */
  constructor(lost: () => void) {
    this.#lostThen = lost;
    this.#made = this.#canvas(1, 1);
  }

  #canvas(w: number, h: number): { c: HTMLCanvasElement; g: Ctx; off: Release } {
    const { c, g } = makeCanvas(w, h, true);
    const off = scope().on(c, "contextrestored", () => {
      this.#lost = true;
      this.#lostThen();
    });
    return { c, g, off };
  }

  /** Nothing kept is trusted any more. */
  wipe(): void {
    this.#lost = true;
  }

  /**
   * Keeps the box of the yard round `view`, `pad` pixels more each way, its corner on a grid of
   * `grid` pixels from (`ox`, `oy`). Gives back the boxes of the yard come into it, to be drawn
   * again, or null for all of it (the first time, or after a loss). What it kept before and still
   * keeps stays, at a new size too (a zoom).
   */
  follow(view: Box, pad: number, grid: number, ox: number, oy: number): Box[] | null {
    const x = ox + Math.floor((view.x - pad - ox) / grid) * grid;
    const y = oy + Math.floor((view.y - pad - oy) / grid) * grid;
    const w = Math.ceil((view.w + pad * 2) / grid + 1) * grid;
    const h = Math.ceil((view.h + pad * 2) / grid + 1) * grid;
    const was = this.#box;
    const box = { x, y, w, h };
    this.#box = box;
    if (w !== was.w || h !== was.h) {
      // Another size: what is kept is copied across to a canvas of the new size.
      const old = this.#made;
      this.#made = this.#canvas(w, h);
      if (!this.#lost)
        for (const to of pieces(was, box))
          for (const from of pieces(to, was))
            this.#made.g.drawImage(
              old.c,
              from.cx,
              from.cy,
              from.w,
              from.h,
              to.cx + from.x - to.x,
              to.cy + from.y - to.y,
              from.w,
              from.h,
            );
      old.off();
      old.c.width = 0;
      old.c.height = 0;
    }
    if (this.#lost) {
      this.#lost = false;
      this.#made.g.clearRect(0, 0, w, h);
      return null;
    }
    // What came in, where another part of the yard lay.
    const came = less(box, was);
    for (const b of came) for (const p of pieces(b, box)) this.#made.g.clearRect(p.cx, p.cy, p.w, p.h);
    return came;
  }

  /** Wipes a box of the yard and draws each of `things` (far to near, `a` how faint) on the part of it that lies there. */
  mend(b: Box, things: readonly { c: HTMLCanvasElement; x: number; y: number; a: number }[]): void {
    const g = this.#made.g;
    for (const p of pieces(b, this.#box)) {
      g.clearRect(p.cx, p.cy, p.w, p.h);
      for (const d of things) {
        const l = Math.max(d.x, p.x);
        const t = Math.max(d.y, p.y);
        const wide = Math.min(d.x + d.c.width, p.x + p.w) - l;
        const high = Math.min(d.y + d.c.height, p.y + p.h) - t;
        if (wide <= 0 || high <= 0) continue;
        g.globalAlpha = d.a;
        g.drawImage(d.c, l - d.x, t - d.y, wide, high, p.cx + l - p.x, p.cy + t - p.y, wide, high);
      }
    }
    g.globalAlpha = 1;
  }

  /** Lays what is kept of a box of the yard on a picture whose corner is (`view.x`, `view.y`). */
  lay(g: Ctx, view: Box): void {
    for (const p of pieces(view, this.#box))
      g.drawImage(this.#made.c, p.cx, p.cy, p.w, p.h, p.x - view.x, p.y - view.y, p.w, p.h);
  }
}

/** A run from `a` to `b` of the yard as it lies on a canvas `n` long that it wraps round: each part's start, length and place on the canvas. */
function split(a: number, b: number, n: number): (readonly [number, number, number])[] {
  const at = mod(a, n);
  if (at + (b - a) <= n) return [[a, b - a, at]];
  return [
    [a, n - at, at],
    [a + n - at, b - a - (n - at), 0],
  ];
}
