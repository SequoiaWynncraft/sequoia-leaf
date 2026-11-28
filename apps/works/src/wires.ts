/**
 * The sagging lines between pylons, with a glint running along each. The lines are worked out once
 * for each change to the yard and drawn as dark pixels on patches kept round the view
 * (`patches.ts`), which go on the picture faint; a patch is drawn when it comes into view, with only
 * the pixels of lines that cross it. A glint is cut out of the kept line where it is now and put back
 * where it was. A pixel two stretches of line lie on is darker for it, so those few are drawn every
 * frame, in their order.
 */

import { CREAM, GOLD } from "@sequoia-leaf/kit/palette.ts";
import { type Ctx, hash } from "@sequoia-leaf/kit/util.ts";

import type { Box } from "./art/ground.ts";
import { isSpark } from "./era.ts";
import type { Layout } from "./layout.ts";
import { PATCH, Patches, placeOf, spanOf } from "./patches.ts";
import { S } from "./state.ts";

const WIRE = "#2a1519";

/** A line between two pylons: each pixel along its sag in the yard's pixels, which of them no other line crosses, and where its glint last was. */
interface Line {
  xs: Int16Array;
  ys: Int16Array;
  alone: Uint8Array;
  lit: number;
}

/** The lines of a yard as last worked out, and the patches they are kept on. */
interface Strung {
  readonly patches: Patches;
  of: Layout | null;
  lost: number;
  lines: Line[];
  /** The pixels more than one stretch of line lies on, as line and place along it, in the order they are drawn. */
  shared: number[];
  /** The pixels no other line lies on, as line and place along it, by the patch they fall on. */
  on: Map<number, number[]>;
  /** Where each line was made fast when they were worked out: its two ends, across and down. */
  ends: string;
}

/** A pixel of a line as one number, to find those more than one line lies on. */
const at = (line: Line, k: number): number => ((line.ys[k] ?? 0) + 4096) * 8192 + (line.xs[k] ?? 0) + 4096;

/** The lines worked out from the layout's ends. */
function string(s: Strung, L: Layout): void {
  const hits = new Map<number, number>();
  s.lines = [];
  for (let w = 0; w + 3 < L.wires.length; w += 4) {
    const [ax = 0, ay = 0, bx = 0, by = 0] = L.wires.subarray(w, w + 4);
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(2, Math.round(len / 1.2));
    const sag = Math.min(9, len * 0.07);
    const line = { xs: new Int16Array(n + 1), ys: new Int16Array(n + 1), alone: new Uint8Array(n + 1), lit: -9 };
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      line.xs[k] = Math.round(ax + (bx - ax) * u);
      line.ys[k] = Math.round(ay + (by - ay) * u + sag * 4 * u * (1 - u));
      hits.set(at(line, k), (hits.get(at(line, k)) ?? 0) + 1);
    }
    s.lines.push(line);
  }
  s.shared = [];
  s.on = new Map();
  s.lines.forEach((line, n) => {
    for (let k = 0; k < line.xs.length; k++) {
      if (hits.get(at(line, k)) !== 1) {
        s.shared.push(n, k);
        continue;
      }
      line.alone[k] = 1;
      const place = placeOf(Math.floor((line.xs[k] ?? 0) / PATCH.w), Math.floor((line.ys[k] ?? 0) / PATCH.h));
      const here = s.on.get(place);
      if (here) here.push(n, k);
      else s.on.set(place, [n, k]);
    }
  });
  s.patches.clear();
}

/** Puts back (`fill`) or cuts out a pixel of a line on the patch it falls on, if that is kept. */
function pixel(s: Strung, line: Line, k: number, fill: boolean): void {
  const x = line.xs[k] ?? 0;
  const y = line.ys[k] ?? 0;
  const p = s.patches.get(Math.floor(x / PATCH.w), Math.floor(y / PATCH.h));
  if (!p) return;
  if (fill) p.g.fillRect(x - p.x, y - p.y, 1, 1);
  else p.g.clearRect(x - p.x, y - p.y, 1, 1);
}

/** Draws the patches of the view that are not kept and have a line on them: every pixel no other line lies on, but where the glint is. */
function drawIn(s: Strung, view: Box): void {
  const span = spanOf(view);
  for (let row = span.r0; row <= span.r1; row++)
    for (let col = span.c0; col <= span.c1; col++) {
      const pixels = s.on.get(placeOf(col, row));
      if (!pixels || s.patches.get(col, row)) continue;
      const p = s.patches.take(col, row);
      p.g.fillStyle = WIRE;
      for (let j = 0; j < pixels.length; j += 2) {
        const line = s.lines[pixels[j] ?? 0];
        const k = pixels[j + 1] ?? 0;
        if (line && Math.abs(k - line.lit) > 1) p.g.fillRect((line.xs[k] ?? 0) - p.x, (line.ys[k] ?? 0) - p.y, 1, 1);
      }
    }
}

/** The lines of the yard, kept between frames; `lost` counts each time the kept pictures may have been emptied. */
export class Wires {
  readonly #s: Strung;

  constructor(lost: () => void) {
    this.#s = { patches: new Patches(lost), of: null, lost: -1, lines: [], shared: [], on: new Map(), ends: "" };
  }

  /** Lets go of the patches the lines are kept on; they are drawn again when next shown. */
  release(): void {
    this.#s.patches.clear();
  }

  /**
   * Draws the lines on a picture whose corner is (`view.x`, `view.y`) of the yard; `corner` is where
   * the picture's corner is in the view, for where each glint starts.
   */
  draw(g: Ctx, view: Box, L: Layout, corner: { x: number; y: number }, lost: number): void {
    const s = this.#s;
    const { x: cx, y: cy } = view;
    const ends = s.of === L ? s.ends : L.wires.join();
    s.of = L;
    if (ends !== s.ends || s.lost !== lost) {
      s.ends = ends;
      s.lost = lost;
      string(s, L);
    }
    glints(s, L, view, corner);
    drawIn(s, view);
    s.patches.keep(spanOf(view, 1));
    g.globalAlpha = 0.6;
    s.patches.lay(g, cx, cy, view.w, view.h);
    gold(g, s, cx, cy);
    g.globalAlpha = 1;
  }
}

/** Moves each line's glint along: the kept line put back where it was, and cut out where it is now. */
function glints(s: Strung, L: Layout, view: Box, corner: { x: number; y: number }): void {
  for (const p of s.patches.kept) p.g.fillStyle = WIRE;
  for (let n = 0; n < s.lines.length; n++) {
    const line = s.lines[n];
    if (!line) continue;
    // The glint starts from a different place on every line, by where the line is on the screen.
    const ax = L.wires[n * 4] ?? 0;
    const ay = L.wires[n * 4 + 1] ?? 0;
    const spot = Math.floor(
      ((S.t * 0.7 + hash(ax - view.x + corner.x, ay - view.y + corner.y, 9)) % 1) * (line.xs.length - 1),
    );
    if (spot === line.lit) continue;
    for (let k = line.lit - 1; k <= line.lit + 1; k++) if (line.alone[k] === 1) pixel(s, line, k, true);
    for (let k = spot - 1; k <= spot + 1; k++) if (line.alone[k] === 1) pixel(s, line, k, false);
    line.lit = spot;
  }
}

/** The glints on the picture, and the pixels more than one line lies on, darker or in the glint: gold, or from the Spark era cream. */
function gold(g: Ctx, s: Strung, cx: number, cy: number): void {
  const glint = isSpark(S.world) ? CREAM : GOLD[2];
  // A pixel at a time, a thousand or more of them on a large yard: the colour is given only when it
  // changes, as reading a colour again for each pixel costs more than drawing it.
  g.fillStyle = glint;
  for (const line of s.lines)
    for (let k = line.lit - 1; k <= line.lit + 1; k++)
      if (line.alone[k] === 1) g.fillRect((line.xs[k] ?? 0) - cx, (line.ys[k] ?? 0) - cy, 1, 1);
  let fill: string = glint;
  for (let j = 0; j < s.shared.length; j += 2) {
    const line = s.lines[s.shared[j] ?? 0];
    const k = s.shared[j + 1] ?? 0;
    if (!line) continue;
    const col = Math.abs(k - line.lit) < 2 ? glint : WIRE;
    if (col !== fill) {
      g.fillStyle = col;
      fill = col;
    }
    g.fillRect((line.xs[k] ?? 0) - cx, (line.ys[k] ?? 0) - cy, 1, 1);
  }
}
