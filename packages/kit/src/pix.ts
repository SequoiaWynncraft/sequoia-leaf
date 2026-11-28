/** Pixel-art tools: flat rectangles, pictures typed out as rows of letters, outlines, and painting a pixel at a time. */

import { type Ctx, hash, makeCanvas } from "./util.ts";

export function R(g: Ctx, x: number, y: number, w: number, h: number, c: string): void {
  g.fillStyle = c;
  g.fillRect(x, y, w, h);
}

/**
 * What flat boxes and pictures are drawn with, whichever draws them: the graphics card
 * (`painter.ts`), or a canvas (`penOn`). `a` is how solid, 1 unless said.
 */
export interface Pen {
  rect(x: number, y: number, w: number, h: number, colour: string, a?: number): void;
  pic(c: HTMLCanvasElement, x: number, y: number, a?: number): void;
}

/** A pen that draws on a canvas. */
export function penOn(g: Ctx): Pen {
  return {
    rect(x, y, w, h, colour, a = 1) {
      g.globalAlpha = a;
      R(g, x, y, w, h, colour);
      g.globalAlpha = 1;
    },
    pic(c, x, y, a = 1) {
      g.globalAlpha = a;
      g.drawImage(c, x, y);
      g.globalAlpha = 1;
    },
  };
}

/** A picture typed as rows of letters, each letter a colour in `pal`; anything else is clear. */
export function bitmap(rows: readonly string[], pal: Readonly<Record<string, string>>): HTMLCanvasElement {
  const w = rows.reduce((m, r) => Math.max(m, r.length), 1);
  const { c, g } = makeCanvas(w, rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = pal[row.charAt(x)];
      if (col) R(g, x, y, 1, 1, col);
    }
  });
  return c;
}

const RGB = new Map<string, readonly [number, number, number]>();
export function rgb(hex: string): readonly [number, number, number] {
  let v = RGB.get(hex);
  if (!v) {
    const n = parseInt(hex.slice(1), 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    RGB.set(hex, v);
  }
  return v;
}

/** A picture made by asking for each pixel's colour in turn (`null` leaves it clear). */
export function paint(w: number, h: number, fn: (x: number, y: number) => string | null): HTMLCanvasElement {
  const { c, g } = makeCanvas(w, h);
  const img = g.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const col = fn(x, y);
      if (col === null) continue;
      const [r, gg, b] = rgb(col);
      const i = (y * w + x) * 4;
      d[i] = r;
      d[i + 1] = gg;
      d[i + 2] = b;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Gives a picture a one-pixel dark edge, drawn in the clear pixels that touch it. */
function edge(g: Ctx, w: number, h: number, colour: string): void {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const [r, gg, b] = rgb(colour);
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) solid[i] = (d[i * 4 + 3] ?? 0) > 40 ? 1 : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (solid[i]) continue;
      const near =
        (x > 0 && solid[i - 1]) ||
        (x < w - 1 && solid[i + 1]) ||
        (y > 0 && solid[i - w]) ||
        (y < h - 1 && solid[i + w]);
      if (!near) continue;
      d[i * 4] = r;
      d[i * 4 + 1] = gg;
      d[i * 4 + 2] = b;
      d[i * 4 + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

/** A copy one pixel larger all round, with the dark edge. */
export function outlined(src: HTMLCanvasElement, colour: string): HTMLCanvasElement {
  const { c, g } = makeCanvas(src.width + 2, src.height + 2);
  g.drawImage(src, 1, 1);
  edge(g, c.width, c.height, colour);
  return c;
}

/** The dark edge, for a picture that already has a clear pixel of room all round. */
export function outlineInPlace(c: HTMLCanvasElement, g: Ctx, colour: string): void {
  edge(g, c.width, c.height, colour);
}

export function flipped(src: HTMLCanvasElement): HTMLCanvasElement {
  const { c, g } = makeCanvas(src.width, src.height);
  g.translate(src.width, 0);
  g.scale(-1, 1);
  g.drawImage(src, 0, 0);
  return c;
}

/** A filled ellipse with hard pixel edges. */
export function ell(g: Ctx, cx: number, cy: number, rx: number, ry: number, c: string): void {
  g.fillStyle = c;
  for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) {
    const k = 1 - (dy * dy) / (ry * ry);
    if (k < 0) continue;
    const half = rx * Math.sqrt(k);
    const x0 = Math.round(cx - half);
    const x1 = Math.round(cx + half);
    if (x1 > x0) g.fillRect(x0, Math.round(cy + dy), x1 - x0, 1);
  }
}

/** Rows of shingles on a roof that narrows towards its ridge. `cols`: shadow, two body tones, light. */
export function shingles(
  g: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  inset: (row: number) => number,
  cols: readonly [string, string, string, string],
  seed: number,
): void {
  for (let r = 0; r * 4 < h; r++) {
    const by = y + r * 4;
    const bh = Math.min(4, y + h - by);
    const ins = inset(by - y);
    const bx = x + ins;
    const bw = w - ins * 2;
    R(g, bx, by, bw, bh, r % 2 ? cols[1] : cols[2]);
    R(g, bx, by + bh - 1, bw, 1, cols[0]);
    for (let sx = bx + (r % 2 ? 3 : 0); sx < bx + bw - 1; sx += 6) {
      R(g, sx, by, 1, bh - 1, cols[0]);
      if (hash(sx, r, seed) > 0.55 && sx + 4 < bx + bw) R(g, sx + 1, by, 3, 1, cols[3]);
    }
  }
}
