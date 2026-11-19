import { type ColorKey, PALETTE } from "./palette.ts";

/** A pixel image: a grid of palette keys, `.` for transparent. */
export interface Sprite {
  readonly width: number;
  readonly height: number;
  readonly pixels: readonly (ColorKey | ".")[];
}

function isPixel(key: string): key is ColorKey | "." {
  return key === "." || Object.hasOwn(PALETTE, key);
}

/** Reads a sprite drawn by hand as rows of palette letters. Rows may differ in length; the short ones are padded. */
export function sprite(rows: readonly string[]): Sprite {
  const width = Math.max(...rows.map((row) => row.length));
  const pixels: (ColorKey | ".")[] = [];
  for (const row of rows) {
    for (let x = 0; x < width; x += 1) {
      const key = row[x] ?? ".";
      if (!isPixel(key)) {
        throw new Error(`Unknown colour "${key}" in sprite row "${row}"`);
      }
      pixels.push(key);
    }
  }
  return { width, height: rows.length, pixels };
}

/** A blank canvas of sprite pixels to draw others onto. */
export function blank(width: number, height: number): Sprite {
  return { width, height, pixels: Array.from({ length: width * height }, () => ".") };
}

/** Draws `top` onto `base` at (x, y), skipping transparent pixels. Returns a new sprite. */
export function stamp(base: Sprite, top: Sprite, x: number, y: number): Sprite {
  const pixels = [...base.pixels];
  for (let ty = 0; ty < top.height; ty += 1) {
    for (let tx = 0; tx < top.width; tx += 1) {
      const key = top.pixels[ty * top.width + tx];
      const bx = x + tx;
      const by = y + ty;
      if (key === undefined || key === "." || bx < 0 || by < 0 || bx >= base.width || by >= base.height) {
        continue;
      }
      pixels[by * base.width + bx] = key;
    }
  }
  return { ...base, pixels };
}

/** The sprite mirrored left to right. */
export function mirror(source: Sprite): Sprite {
  const pixels: (ColorKey | ".")[] = [];
  for (let y = 0; y < source.height; y += 1) {
    for (let x = source.width - 1; x >= 0; x -= 1) {
      pixels.push(source.pixels[y * source.width + x] ?? ".");
    }
  }
  return { ...source, pixels };
}

/** Swaps colours, for recolours such as a tree's autumn canopy or a shiny collectible. */
export function recolor(source: Sprite, swaps: Partial<Record<ColorKey, ColorKey>>): Sprite {
  return { ...source, pixels: source.pixels.map((key) => (key === "." ? key : (swaps[key] ?? key))) };
}

/** Draws a sprite onto a canvas at a whole-number scale, so every pixel stays square and sharp. */
export function draw(context: CanvasRenderingContext2D, source: Sprite, x: number, y: number, scale: number): void {
  for (let sy = 0; sy < source.height; sy += 1) {
    for (let sx = 0; sx < source.width; sx += 1) {
      const key = source.pixels[sy * source.width + sx];
      if (key === undefined || key === ".") {
        continue;
      }
      context.fillStyle = PALETTE[key];
      context.fillRect(x + sx * scale, y + sy * scale, scale, scale);
    }
  }
}

/** A canvas holding the sprite at a scale, for use as an image or in the DOM. */
export function toCanvas(source: Sprite, scale: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = source.width * scale;
  canvas.height = source.height * scale;
  const context = canvas.getContext("2d");
  if (context !== null) {
    draw(context, source, 0, 0, scale);
  }
  return canvas;
}
