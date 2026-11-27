/**
 * A picture as large as the yard's ground, kept as patches: a canvas for each box of `PATCH` of the
 * yard's pixels, lined up with the map's own corner, made when something is drawn there and given
 * back once it is out of view. So what is kept grows with the screen, not with the land. A patch is
 * a whole number of tiles each way, and a plot (sixteen tiles by twelve) is two patches by two.
 */

import { type Release, scope } from "@sequoia-leaf/kit/scope.ts";
import { type Ctx, makeCanvas } from "@sequoia-leaf/kit/util.ts";

import type { Box } from "./art/ground.ts";

export const PATCH = { w: 128, h: 96 } as const;

export interface Patch {
  readonly c: HTMLCanvasElement;
  readonly g: Ctx;
  /** Where it is: its column and row of patches, and its corner in the yard's pixels. */
  col: number;
  row: number;
  x: number;
  y: number;
  /** What was painted on it, for a picture whose patches are painted by what they show (the floor). */
  key: string;
  /** How to stop hearing that its canvas came back empty. */
  readonly off: Release;
}

/** The patches a box covers: the first and last column and row. */
export interface Span {
  readonly c0: number;
  readonly r0: number;
  readonly c1: number;
  readonly r1: number;
}

/** The patches a box of the yard's pixels covers, with `pad` patches more round it each way. */
export const spanOf = (b: Box, pad = 0): Span => ({
  c0: Math.floor(b.x / PATCH.w) - pad,
  r0: Math.floor(b.y / PATCH.h) - pad,
  c1: Math.floor((b.x + b.w - 1) / PATCH.w) + pad,
  r1: Math.floor((b.y + b.h - 1) / PATCH.h) + pad,
});

export const inSpan = (s: Span, col: number, row: number): boolean =>
  col >= s.c0 && col <= s.c1 && row >= s.r0 && row <= s.r1;

/** A patch's place as one number, for patches within a thousand of the map's corner every way. */
export const placeOf = (col: number, row: number): number => (row + 1024) * 4096 + col + 1024;

/** Canvases given back are kept for the next patches made, up to this many. */
const SPARE = 4;

export class Patches {
  readonly #kept = new Map<number, Patch>();
  readonly #spare: Patch[] = [];
  readonly #lost: () => void;
  readonly #held = scope();

  /** `lost` is told when the browser has emptied one of the patches' canvases: none can be trusted. */
  constructor(lost: () => void) {
    this.#lost = lost;
  }

  get(col: number, row: number): Patch | undefined {
    return this.#kept.get(placeOf(col, row));
  }

  /** The patch at a place, made clear if there was none. */
  take(col: number, row: number): Patch {
    const had = this.get(col, row);
    if (had) return had;
    let p = this.#spare.pop();
    if (p) p.g.clearRect(0, 0, PATCH.w, PATCH.h);
    else {
      const { c, g } = makeCanvas(PATCH.w, PATCH.h, true);
      p = { c, g, col, row, x: 0, y: 0, key: "", off: this.#held.on(c, "contextrestored", this.#lost) };
    }
    p.col = col;
    p.row = row;
    p.x = col * PATCH.w;
    p.y = row * PATCH.h;
    p.key = "";
    this.#kept.set(placeOf(col, row), p);
    return p;
  }

  #give(p: Patch): void {
    this.#kept.delete(placeOf(p.col, p.row));
    if (this.#spare.length < SPARE) this.#spare.push(p);
    else p.off();
  }

  /** Gives back every patch outside a span, telling `gone` of each. */
  keep(s: Span, gone?: (p: Patch) => void): void {
    for (const p of this.#kept.values())
      if (!inSpan(s, p.col, p.row)) {
        gone?.(p);
        this.#give(p);
      }
  }

  /** Gives back every patch, telling `gone` of each. */
  clear(gone?: (p: Patch) => void): void {
    for (const p of this.#kept.values()) {
      gone?.(p);
      this.#give(p);
    }
  }

  /** Puts `other`'s patch at a place in this one's stead, and gives this one's back. */
  swap(other: Patches, col: number, row: number): Patch | undefined {
    const p = other.get(col, row);
    if (!p) return undefined;
    other.#kept.delete(placeOf(col, row));
    const had = this.get(col, row);
    if (had) this.#give(had);
    this.#kept.set(placeOf(col, row), p);
    return p;
  }

  /** How many patches are kept. */
  get size(): number {
    return this.#kept.size;
  }

  get kept(): IterableIterator<Patch> {
    return this.#kept.values();
  }

  /** Lays each patch kept that shows in a picture of `w` by `h` whose corner is (`x`, `y`) of the yard. */
  lay(g: Ctx, x: number, y: number, w: number, h: number): void {
    for (const p of this.#kept.values())
      if (p.x < x + w && p.x + PATCH.w > x && p.y < y + h && p.y + PATCH.h > y) g.drawImage(p.c, p.x - x, p.y - y);
  }
}
