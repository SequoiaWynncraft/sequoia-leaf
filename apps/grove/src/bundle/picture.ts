/**
 * The compositor: one frame of a bundle loop with the client's own sprites and effects over it, in
 * the welcome's order. A frame is drawn as the Rust welcome renderer draws one:
 *
 *   1. the decoded loop frame (`begin`);
 *   2. sprites and effects that live in the world (`set`, `blend`, `sparkle`, `sprite`);
 *   3. the near layer put back in front (`restore`): every pixel of the season's near mask is
 *      copied back from the decoded frame, so the giant trunks, canopy and ferns pass in front of
 *      everything drawn in step 2;
 *   4. what stands over the world (tools in hand, a reveal's flash), then `blit` to the screen.
 *
 * The Forest has no loop: its frame is its still parallax layers, each pasted at its own offset
 * (`layer`), the far one first and opaque; its member trees come from atlases (`paste`), and its
 * near layer is pasted last rather than restored.
 *
 * Coordinates are the picture's own (0 to 255 by 0 to 143); colours are packed RGBA (`palette.ts`).
 *
 * A picture can hold art finer than its loop (`density`): the glade's is two, because a member's
 * tree is drawn at twice the welcome's pixel density. Then every picture pixel is a block of
 * `density` by `density` buffer pixels: the loop frame is laid down in blocks, the tree is stamped
 * on the buffer's own grid (`stamp`), and everything else still draws in picture pixels, a block at
 * a time, so whatever is drawn over the tree lights or covers the tree's own fine pixels. Nothing is
 * ever smoothed, and the screen shows a whole number of device pixels per buffer pixel.
 */

import type { Mask, Pixels } from "./art.ts";
import type { CastFrame } from "./cast.ts";
import { blue, green, mixColour, red } from "./palette.ts";

/** The welcome's sparkle (welcome/scene.py `SPARKLE`): a dot, a plus, a big plus. */
const SPARKLE: readonly (readonly [number, number, boolean])[][] = [
  [[0, 0, true]],
  [
    [0, 0, true],
    [-1, 0, false],
    [1, 0, false],
    [0, -1, false],
    [0, 1, false],
  ],
  [
    [0, 0, true],
    [-1, 0, true],
    [1, 0, true],
    [0, -1, true],
    [0, 1, true],
    [-2, 0, false],
    [2, 0, false],
    [0, -2, false],
    [0, 2, false],
  ],
];

export class Picture {
  /** The picture's size in its own pixels. */
  readonly W: number;
  readonly H: number;
  /** Buffer pixels per picture pixel, each way. */
  readonly density: number;
  /** The buffer's size: the picture's, times `density`. */
  readonly FW: number;
  readonly FH: number;
  readonly px: Uint32Array;
  /** The decoded loop frame under this one, or null before the loop is in. */
  private under: Uint32Array | null = null;
  private drawn = false;

  constructor(W: number, H: number, density = 1) {
    this.W = W;
    this.H = H;
    this.density = Math.max(1, Math.round(density));
    this.FW = W * this.density;
    this.FH = H * this.density;
    this.px = new Uint32Array(this.FW * this.FH);
  }

  /** Step 1: a loop frame, a block to each of its pixels. */
  begin(frame: Uint32Array): void {
    this.under = frame;
    this.drawn = true;
    const k = this.density;
    if (k === 1) {
      this.px.set(frame);
      return;
    }
    for (let y = 0; y < this.H; y++) {
      const row = y * k * this.FW;
      for (let x = 0; x < this.W; x++) this.px.fill(frame[y * this.W + x] ?? 0, row + x * k, row + x * k + k);
      for (let d = 1; d < k; d++) this.px.copyWithin(row + d * this.FW, row, row + this.FW);
    }
  }

  /** No frame yet: one colour. */
  blank(colour: number): void {
    this.under = null;
    this.drawn = false;
    this.px.fill(colour);
  }

  get ready(): boolean {
    return this.drawn;
  }

  /**
   * A still layer `ox` columns into it: its opaque pixels over what is there. The first, opaque,
   * layer of a frame (`base`) covers the whole picture and makes it ready. (The Forest's; its
   * picture has a density of one.)
   */
  layer(src: Pixels, ox: number, base = false): void {
    const W = this.W;
    const x0 = Math.max(0, -ox);
    const x1 = Math.min(W, src.w - ox);
    const rows = Math.min(this.H, src.h);
    if (base) {
      this.under = null;
      this.drawn = true;
    }
    for (let y = 0; y < rows; y++) {
      const si = y * src.w + ox;
      const di = y * W;
      if (base && x0 === 0 && x1 === W) {
        this.px.set(src.data.subarray(si, si + W), di);
        continue;
      }
      for (let x = x0; x < x1; x++) {
        const v = src.data[si + x] ?? 0;
        if (v >>> 24 >= 128) this.px[di + x] = (v | 0xff000000) >>> 0;
      }
    }
  }

  /** A box of an atlas (`sx`, `sy`, `w` by `h`) with its top left at (dx, dy): its opaque pixels. */
  paste(src: Pixels, sx: number, sy: number, w: number, h: number, dx: number, dy: number): void {
    dx = Math.round(dx);
    dy = Math.round(dy);
    for (let y = Math.max(0, -dy); y < h && dy + y < this.H; y++) {
      const si = (sy + y) * src.w + sx;
      const di = (dy + y) * this.W + dx;
      for (let x = Math.max(0, -dx); x < w && dx + x < this.W; x++) {
        const v = src.data[si + x] ?? 0;
        if (v >>> 24 >= 128) this.px[di + x] = (v | 0xff000000) >>> 0;
      }
    }
  }

  /**
   * A sprite drawn on the buffer's own grid, its top left at buffer pixel (fx, fy): its opaque
   * pixels. The member's tree, at the glade's density.
   */
  stamp(src: Pixels, fx: number, fy: number): void {
    fx = Math.round(fx);
    fy = Math.round(fy);
    for (let y = Math.max(0, -fy); y < src.h && fy + y < this.FH; y++) {
      const si = y * src.w;
      const di = (fy + y) * this.FW + fx;
      for (let x = Math.max(0, -fx); x < src.w && fx + x < this.FW; x++) {
        const v = src.data[si + x] ?? 0;
        if (v >>> 24 >= 128) this.px[di + x] = (v | 0xff000000) >>> 0;
      }
    }
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.W && y < this.H;
  }

  get(x: number, y: number): number {
    x = Math.round(x);
    y = Math.round(y);
    return this.inside(x, y) ? (this.px[y * this.density * this.FW + x * this.density] ?? 0) : 0;
  }

  /** One picture pixel: its whole block. */
  private block(x: number, y: number, c: number): void {
    const k = this.density;
    if (k === 1) {
      this.px[y * this.W + x] = c;
      return;
    }
    for (let d = 0; d < k; d++) {
      const i = (y * k + d) * this.FW + x * k;
      this.px.fill(c, i, i + k);
    }
  }

  /** Each buffer pixel of one picture pixel through `change`. */
  private each(x: number, y: number, change: (v: number) => number): void {
    const k = this.density;
    for (let d = 0; d < k; d++) {
      const row = (y * k + d) * this.FW + x * k;
      for (let i = row; i < row + k; i++) this.px[i] = change(this.px[i] ?? 0);
    }
  }

  set(x: number, y: number, c: number): void {
    x = Math.round(x);
    y = Math.round(y);
    if (this.inside(x, y)) this.block(x, y, c);
  }

  /** The pixel moved `a` of the way toward `c`, as the welcome blends a glow over what is there. */
  blend(x: number, y: number, c: number, a: number): void {
    x = Math.round(x);
    y = Math.round(y);
    if (!this.inside(x, y) || a <= 0) return;
    this.each(x, y, (v) => mixColour(v, c, a));
  }

  /** Light added over a pixel: warm light brightens what it falls on rather than painting it. */
  light(x: number, y: number, c: number, a: number): void {
    x = Math.round(x);
    y = Math.round(y);
    if (!this.inside(x, y) || a <= 0) return;
    const add = (ch: number, l: number): number => Math.min(255, Math.round(ch + l * a * (1 - ch / 320)));
    this.each(
      x,
      y,
      (v) => ((255 << 24) | (add(blue(v), blue(c)) << 16) | (add(green(v), green(c)) << 8) | add(red(v), red(c))) >>> 0,
    );
  }

  /** The welcome's sparkle at (x, y): stage 0 a dot, 1 a plus, 2 a big plus. */
  sparkle(
    x: number,
    y: number,
    stage: number,
    star: number,
    arm: number,
    keepOut?: (x: number, y: number) => boolean,
  ): void {
    const shape = SPARKLE[Math.max(0, Math.min(2, Math.round(stage)))] ?? [];
    for (const [dx, dy, core] of shape) {
      const px = Math.round(x) + dx;
      const py = Math.round(y) + dy;
      if (keepOut?.(px, py)) continue;
      this.set(px, py, core ? star : arm);
    }
  }

  /** A cast frame standing with its foot on (x, y), facing left when `flip`; all one colour if `solid`. */
  sprite(f: CastFrame, x: number, y: number, flip = false, solid?: number): void {
    const ox = Math.round(x) - (flip ? f.w - 1 - f.foot.x : f.foot.x);
    const oy = Math.round(y) - f.foot.y;
    const sx = f.index * f.w;
    const sw = f.strip.w;
    for (let yy = 0; yy < f.h; yy++) {
      const ty = oy + yy;
      if (ty < 0 || ty >= this.H) continue;
      for (let xx = 0; xx < f.w; xx++) {
        const v = f.strip.data[yy * sw + sx + xx] ?? 0;
        if (v >>> 24 < 128) continue;
        const tx = ox + (flip ? f.w - 1 - xx : xx);
        if (tx >= 0 && tx < this.W) this.block(tx, ty, solid ?? (v | 0xff000000) >>> 0);
      }
    }
  }

  /** Step 3: the near layer back in front. */
  restore(near: Mask | null): void {
    const under = this.under;
    if (!under || !near || near.w !== this.W) return;
    if (this.density === 1) {
      for (const i of near.set) this.px[i] = under[i] ?? 0;
      return;
    }
    for (const i of near.set) this.block(i % this.W, Math.floor(i / this.W), under[i] ?? 0);
  }

  /**
   * The picture in its own pixels (the first buffer pixel of each block), for a drawing that works
   * in picture pixels on a buffer of its own; `merge` brings back what it changed.
   */
  coarse(): Uint32Array {
    const k = this.density;
    if (k === 1) return this.px.slice();
    const out = new Uint32Array(this.W * this.H);
    for (let y = 0; y < this.H; y++)
      for (let x = 0; x < this.W; x++) out[y * this.W + x] = this.px[y * k * this.FW + x * k] ?? 0;
    return out;
  }

  /** Every picture pixel of `after` that differs from `before`, as its block. */
  merge(after: Uint32Array, before: Uint32Array): void {
    for (let i = 0; i < after.length; i++)
      if (after[i] !== before[i]) this.block(i % this.W, Math.floor(i / this.W), after[i] ?? 0);
  }

  /**
   * Copies `W` buffer columns from `cropX` and `H` buffer rows from `cropY` into a screen buffer `W`
   * wide, the whole picture knocked by (dx, dy) picture pixels for a reveal's impact.
   */
  blit(out: Uint32Array, W: number, H: number, cropX: number, dx = 0, dy = 0, cropY = 0): void {
    const kx = dx * this.density;
    const ky = dy * this.density;
    for (let y = 0; y < H; y++) {
      const sy = Math.max(0, Math.min(this.FH - 1, cropY + y - ky));
      const row = sy * this.FW;
      if (kx === 0) {
        out.set(this.px.subarray(row + cropX, row + cropX + W), y * W);
        continue;
      }
      for (let x = 0; x < W; x++) {
        const sx = Math.max(0, Math.min(this.FW - 1, cropX + x - kx));
        out[y * W + x] = this.px[row + sx] ?? 0;
      }
    }
  }
}

/**
 * The colour round a picture: its edges' mean, sunk most of the way into the dark the HUD is drawn
 * on, so the picture's frame of trunks and canopy fades into the page.
 */
export function edgeColour(frame: Uint32Array, W: number, H: number): string {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const take = (i: number): void => {
    const v = frame[i] ?? 0;
    r += red(v);
    g += green(v);
    b += blue(v);
    n++;
  };
  for (let x = 0; x < W; x++) {
    take(x);
    take((H - 1) * W + x);
  }
  for (let y = 0; y < H; y++) {
    take(y * W);
    take(y * W + W - 1);
  }
  const dark = [14, 11, 16];
  const k = 0.32;
  const hex = (v: number, d: number): string =>
    Math.round(d + (v / Math.max(1, n) - d) * k)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(r, dark[0] ?? 0)}${hex(g, dark[1] ?? 0)}${hex(b, dark[2] ?? 0)}`;
}
