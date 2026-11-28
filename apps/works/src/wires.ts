/**
 * The sagging lines between pylons, with a glint running along each. The lines are worked out once
 * for each change to the yard, as the pixels along each sag, and every pixel of every line in view is
 * drawn each frame, faint and dark, the three under its glint bright. A pixel two stretches of line
 * lie on is drawn for each, and so is darker.
 */

import { CREAM, GOLD } from "@sequoia-leaf/kit/palette.ts";
import type { Pen } from "@sequoia-leaf/kit/pix.ts";
import { hash } from "@sequoia-leaf/kit/util.ts";

import type { Box } from "./art/ground.ts";
import { isSpark } from "./era.ts";
import type { Layout } from "./layout.ts";
import { S } from "./state.ts";

const WIRE = "#2a1519";
/** How solid a line is drawn. */
const FAINT = 0.6;

/** A line between two pylons: each pixel along its sag in the yard's pixels, and the box they lie in. */
interface Line {
  readonly xs: Int16Array;
  readonly ys: Int16Array;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** A line from its two ends: a pixel for every 1.2 of its length, sagging most in the middle. */
function strung(ax: number, ay: number, bx: number, by: number): Line {
  const len = Math.hypot(bx - ax, by - ay);
  const n = Math.max(2, Math.round(len / 1.2));
  const sag = Math.min(9, len * 0.07);
  const xs = new Int16Array(n + 1);
  const ys = new Int16Array(n + 1);
  for (let k = 0; k <= n; k++) {
    const u = k / n;
    xs[k] = Math.round(ax + (bx - ax) * u);
    ys[k] = Math.round(ay + (by - ay) * u + sag * 4 * u * (1 - u));
  }
  return { xs, ys, x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) + sag };
}

/** Whether any of a line's box shows in a view. */
const shows = (line: Line, view: Box): boolean =>
  line.x1 >= view.x && line.x0 < view.x + view.w && line.y1 >= view.y && line.y0 < view.y + view.h;

/** The lines of the yard, kept until where they are made fast changes. */
export class Wires {
  #of: Layout | null = null;
  #ends = "";
  #lines: Line[] = [];

  /** The lines of a layout: strung again only when its ends are not those of the layout before. */
  #strung(L: Layout): readonly Line[] {
    if (this.#of === L) return this.#lines;
    this.#of = L;
    const ends = L.wires.join();
    if (ends === this.#ends) return this.#lines;
    this.#ends = ends;
    this.#lines = [];
    for (let w = 0; w + 3 < L.wires.length; w += 4)
      this.#lines.push(strung(L.wires[w] ?? 0, L.wires[w + 1] ?? 0, L.wires[w + 2] ?? 0, L.wires[w + 3] ?? 0));
    return this.#lines;
  }

  /**
   * Draws the lines on a picture whose corner is (`view.x`, `view.y`) of the yard; `corner` is where
   * the picture's corner is in the view, for where each glint starts.
   */
  draw(g: Pen, view: Box, L: Layout, corner: { x: number; y: number }): void {
    // The glint is gold, or from the Spark era cream.
    const glint = isSpark(S.world) ? CREAM : GOLD[2];
    this.#strung(L).forEach((line, n) => {
      if (!shows(line, view)) return;
      // The glint starts from a different place on every line, by where the line is on the screen.
      const at = hash((L.wires[n * 4] ?? 0) - view.x + corner.x, (L.wires[n * 4 + 1] ?? 0) - view.y + corner.y, 9);
      const spot = Math.floor(((S.t * 0.7 + at) % 1) * (line.xs.length - 1));
      for (let k = 0; k < line.xs.length; k++) {
        const col = Math.abs(k - spot) < 2 ? glint : WIRE;
        g.rect((line.xs[k] ?? 0) - view.x, (line.ys[k] ?? 0) - view.y, 1, 1, col, FAINT);
      }
    });
  }
}
