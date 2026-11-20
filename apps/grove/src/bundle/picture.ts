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
  readonly W: number;
  readonly H: number;
  readonly px: Uint32Array;
  /** The decoded loop frame under this one, or null before the loop is in. */
  private under: Uint32Array | null = null;
  private drawn = false;

  constructor(W: number, H: number) {
    this.W = W;
    this.H = H;
    this.px = new Uint32Array(W * H);
  }

  /** Step 1: a loop frame. */
  begin(frame: Uint32Array): void {
    this.under = frame;
    this.drawn = true;
    this.px.set(frame);
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
   * layer of a frame (`base`) covers the whole picture and makes it ready.
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

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.W && y < this.H;
  }

  get(x: number, y: number): number {
    x = Math.round(x);
    y = Math.round(y);
    return this.inside(x, y) ? (this.px[y * this.W + x] ?? 0) : 0;
  }

  set(x: number, y: number, c: number): void {
    x = Math.round(x);
    y = Math.round(y);
    if (this.inside(x, y)) this.px[y * this.W + x] = c;
  }

  /** The pixel moved `a` of the way toward `c`, as the welcome blends a glow over what is there. */
  blend(x: number, y: number, c: number, a: number): void {
    x = Math.round(x);
    y = Math.round(y);
    if (!this.inside(x, y) || a <= 0) return;
    const i = y * this.W + x;
    this.px[i] = mixColour(this.px[i] ?? 0, c, a);
  }

  /** Light added over a pixel: warm light brightens what it falls on rather than painting it. */
  light(x: number, y: number, c: number, a: number): void {
    x = Math.round(x);
    y = Math.round(y);
    if (!this.inside(x, y) || a <= 0) return;
    const i = y * this.W + x;
    const v = this.px[i] ?? 0;
    const add = (ch: number, l: number): number => Math.min(255, Math.round(ch + l * a * (1 - ch / 320)));
    this.px[i] =
      ((255 << 24) | (add(blue(v), blue(c)) << 16) | (add(green(v), green(c)) << 8) | add(red(v), red(c))) >>> 0;
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
        if (tx >= 0 && tx < this.W) this.px[ty * this.W + tx] = solid ?? (v | 0xff000000) >>> 0;
      }
    }
  }

  /** Step 3: the near layer back in front. */
  restore(near: Mask | null): void {
    const under = this.under;
    if (!under || !near || near.w !== this.W) return;
    for (const i of near.set) this.px[i] = under[i] ?? 0;
  }

  /**
   * Copies `W` columns from `cropX` and `H` rows from `cropY` into a screen buffer `W` wide, the
   * whole picture knocked by (dx, dy) pixels for a reveal's impact.
   */
  blit(out: Uint32Array, W: number, H: number, cropX: number, dx = 0, dy = 0, cropY = 0): void {
    for (let y = 0; y < H; y++) {
      const sy = Math.max(0, Math.min(this.H - 1, cropY + y - dy));
      const row = sy * this.W;
      if (dx === 0) {
        out.set(this.px.subarray(row + cropX, row + cropX + W), y * W);
        continue;
      }
      for (let x = 0; x < W; x++) {
        const sx = Math.max(0, Math.min(this.W - 1, cropX + x - dx));
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
