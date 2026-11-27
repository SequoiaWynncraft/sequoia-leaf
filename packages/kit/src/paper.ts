/**
 * A canvas for tests, where there is no browser: pixels kept in memory and drawn the way the game
 * draws them, whole pixels with no smoothing, each pixel of a picture landing where the canvas's
 * turn, flip or move puts its middle. Enough of a 2D canvas for the game's pictures to be put
 * together (`skin.ts`, the figures' rig) and read back a pixel at a time. Pages never load this.
 *
 * `onPaper()` stands it in for the browser's `document.createElement("canvas")` until what it
 * gives back is called.
 */

type Matrix = readonly [a: number, b: number, c: number, d: number, e: number, f: number];
type Picture = { readonly width: number; readonly height: number; readonly pixels?: Uint8ClampedArray };

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const times = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

/** A colour as the canvas is given it: `#rgb`, `#rrggbb`, `rgb()` or `rgba()`. */
function rgbaOf(style: string): readonly [number, number, number, number] {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(style)?.[1];
  if (hex) {
    const full = hex.length === 3 ? hex.replace(/./g, (h) => h + h) : hex;
    const n = parseInt(full, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(style)?.[1];
  if (fn) {
    const [r = 0, g = 0, b = 0, a = 1] = fn.split(",").map((v) => Number(v.trim()));
    return [r, g, b, Math.round(a * 255)];
  }
  throw new Error(`The paper canvas cannot read the colour ${style}`);
}

/** A canvas's pixels, `width` by `height`, clear until drawn on. */
export class Paper {
  #w = 300;
  #h = 150;
  pixels = new Uint8ClampedArray(this.#w * this.#h * 4);
  readonly #pen = new Pen(this);
  get width(): number {
    return this.#w;
  }
  set width(w: number) {
    this.#w = w;
    this.pixels = new Uint8ClampedArray(this.#w * this.#h * 4);
  }
  get height(): number {
    return this.#h;
  }
  set height(h: number) {
    this.#h = h;
    this.pixels = new Uint8ClampedArray(this.#w * this.#h * 4);
  }
  getContext(): Pen {
    return this.#pen;
  }
}

/** What draws on a `Paper`, as a 2D context does. */
class Pen {
  fillStyle = "#000000";
  globalAlpha = 1;
  imageSmoothingEnabled = false;
  #m: Matrix = IDENTITY;
  readonly #kept: { m: Matrix; alpha: number; fill: string }[] = [];
  readonly canvas: Paper;
  constructor(canvas: Paper) {
    this.canvas = canvas;
  }

  save(): void {
    this.#kept.push({ m: this.#m, alpha: this.globalAlpha, fill: this.fillStyle });
  }
  restore(): void {
    const k = this.#kept.pop();
    if (!k) return;
    this.#m = k.m;
    this.globalAlpha = k.alpha;
    this.fillStyle = k.fill;
  }
  setTransform(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0): void {
    this.#m = [a, b, c, d, e, f];
  }
  resetTransform(): void {
    this.#m = IDENTITY;
  }
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.#m = times(this.#m, [a, b, c, d, e, f]);
  }
  translate(x: number, y: number): void {
    this.transform(1, 0, 0, 1, x, y);
  }
  scale(x: number, y: number): void {
    this.transform(x, 0, 0, y, 0, 0);
  }
  rotate(turn: number): void {
    const cos = Math.round(Math.cos(turn) * 1e9) / 1e9;
    const sin = Math.round(Math.sin(turn) * 1e9) / 1e9;
    this.transform(cos, sin, -sin, cos, 0, 0);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const colour = rgbaOf(this.fillStyle);
    this.#cover(x, y, w, h, () => colour);
  }
  clearRect(x: number, y: number, w: number, h: number): void {
    this.#cover(x, y, w, h, () => [0, 0, 0, 0], true);
  }
  drawImage(src: Picture, ...at: number[]): void {
    const [sx, sy, sw, sh, dx, dy, dw, dh] =
      at.length === 8
        ? at
        : at.length === 4
          ? [0, 0, src.width, src.height, ...at]
          : [0, 0, src.width, src.height, at[0] ?? 0, at[1] ?? 0, src.width, src.height];
    const from = src.pixels;
    if (!from || !sw || !sh || !dw || !dh) return;
    this.#cover(dx ?? 0, dy ?? 0, dw, dh, (u, v) => {
      const px = Math.floor((sx ?? 0) + (u * sw) / dw);
      const py = Math.floor((sy ?? 0) + (v * sh) / dh);
      if (px < 0 || py < 0 || px >= src.width || py >= src.height) return [0, 0, 0, 0];
      const i = (py * src.width + px) * 4;
      return [from[i] ?? 0, from[i + 1] ?? 0, from[i + 2] ?? 0, from[i + 3] ?? 0];
    });
  }

  getImageData(x: number, y: number, w: number, h: number): ImageData {
    const out = this.createImageData(w, h);
    for (let row = 0; row < h; row++)
      for (let col = 0; col < w; col++) {
        const cx = x + col;
        const cy = y + row;
        if (cx < 0 || cy < 0 || cx >= this.canvas.width || cy >= this.canvas.height) continue;
        const i = (cy * this.canvas.width + cx) * 4;
        out.data.set(this.canvas.pixels.subarray(i, i + 4), (row * w + col) * 4);
      }
    return out;
  }
  putImageData(img: ImageData, x: number, y: number): void {
    for (let row = 0; row < img.height; row++)
      for (let col = 0; col < img.width; col++) {
        const cx = x + col;
        const cy = y + row;
        if (cx < 0 || cy < 0 || cx >= this.canvas.width || cy >= this.canvas.height) continue;
        const i = (row * img.width + col) * 4;
        this.canvas.pixels.set(img.data.subarray(i, i + 4), (cy * this.canvas.width + cx) * 4);
      }
  }
  createImageData(w: number, h: number): ImageData {
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: "srgb" };
  }

  /**
   * Lays a rectangle of the drawing's own space over the canvas, as it is turned and moved now:
   * each canvas pixel whose middle falls inside it takes the colour `at` gives for that point of
   * the rectangle (`u`, `v` from its corner), over what is there (or in place of it, `clear`).
   */
  #cover(
    x: number,
    y: number,
    w: number,
    h: number,
    at: (u: number, v: number) => readonly number[],
    clear = false,
  ): void {
    const m = this.#m;
    const det = m[0] * m[3] - m[1] * m[2];
    if (det === 0) return;
    const { width: cw, pixels } = this.canvas;
    const box = this.#box(x, y, w, h);
    for (let cy = box.y0; cy < box.y1; cy++)
      for (let cx = box.x0; cx < box.x1; cx++) {
        const qx = cx + 0.5 - m[4];
        const qy = cy + 0.5 - m[5];
        const ux = (m[3] * qx - m[2] * qy) / det - x;
        const uy = (-m[1] * qx + m[0] * qy) / det - y;
        if (ux < 0 || uy < 0 || ux >= w || uy >= h) continue;
        const i = (cy * cw + cx) * 4;
        if (clear) pixels.set(at(ux, uy), i);
        else over(pixels, i, at(ux, uy), this.globalAlpha);
      }
  }

  /** The canvas pixels a rectangle of the drawing's own space may cover, as it is turned and moved now. */
  #box(x: number, y: number, w: number, h: number): { x0: number; y0: number; x1: number; y1: number } {
    const m = this.#m;
    const corners = [
      [x, y],
      [x + w, y],
      [x, y + h],
      [x + w, y + h],
    ].map(([px = 0, py = 0]) => [m[0] * px + m[2] * py + m[4], m[1] * px + m[3] * py + m[5]] as const);
    const xs = corners.map((p) => p[0]);
    const ys = corners.map((p) => p[1]);
    return {
      x0: Math.max(0, Math.floor(Math.min(...xs))),
      y0: Math.max(0, Math.floor(Math.min(...ys))),
      x1: Math.min(this.canvas.width, Math.ceil(Math.max(...xs))),
      y1: Math.min(this.canvas.height, Math.ceil(Math.max(...ys))),
    };
  }
}

/** A colour laid over the pixel at `i`, as solid as its own alpha times `alpha`. */
function over(pixels: Uint8ClampedArray, i: number, colour: readonly number[], alpha: number): void {
  const [r = 0, g = 0, b = 0, a = 0] = colour;
  const top = (a / 255) * alpha;
  if (top <= 0) return;
  const under = ((pixels[i + 3] ?? 0) / 255) * (1 - top);
  const all = top + under;
  const mix = (s: number, d: number): number => Math.round((s * top + d * under) / all);
  pixels.set(
    [mix(r, pixels[i] ?? 0), mix(g, pixels[i + 1] ?? 0), mix(b, pixels[i + 2] ?? 0), Math.round(all * 255)],
    i,
  );
}

/** A picture loaded from somewhere, which a test fills with pixels of its own. */
class Pictured {
  width = 0;
  height = 0;
  naturalWidth = 0;
  naturalHeight = 0;
  pixels?: Uint8ClampedArray;
}

/** Stands the paper canvas in for the browser's, until what it gives back is called. */
export function onPaper(): () => void {
  const had = Object.getOwnPropertyDescriptors(globalThis);
  const stand = (name: string, value: unknown): void => {
    if (!(name in had)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };
  stand("document", { createElement: () => new Paper() });
  stand("HTMLCanvasElement", Paper);
  stand("HTMLImageElement", Pictured);
  return () => {
    for (const name of ["document", "HTMLCanvasElement", "HTMLImageElement"])
      if (!(name in had)) Reflect.deleteProperty(globalThis, name);
  };
}

/** The pixels of a canvas, `width` by `height`, four numbers each (red, green, blue, how solid). */
export function pixelsOf(c: HTMLCanvasElement): Uint8ClampedArray {
  const g = c.getContext("2d");
  if (!g) throw new Error("No 2D context");
  return g.getImageData(0, 0, c.width, c.height).data;
}
