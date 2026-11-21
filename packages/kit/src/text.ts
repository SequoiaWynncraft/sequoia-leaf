/**
 * Words drawn on a canvas in the guild's font. The font is made on a grid of ten pixels to the em,
 * so it is only sharp when one of its pixels is a whole number of the canvas's: `px` here is that
 * number, the size of one font pixel, not the size of the letters.
 */
import { INK } from "./palette.ts";
import type { Ctx } from "./util.ts";

export const FONT = "Minecraft";

export const fontOf = (px: number, bold = false): string =>
  `${bold ? "bold " : ""}${Math.max(1, Math.round(px)) * 10}px ${FONT}, monospace`;

/** Resolves once both weights can be drawn; draw nothing with words in it before then. */
export async function fontsReady(): Promise<void> {
  try {
    await Promise.all([document.fonts.load(`10px ${FONT}`), document.fonts.load(`bold 10px ${FONT}`)]);
  } catch {
    // The page falls back to a plain monospace face.
  }
}

export interface Words {
  /** Canvas pixels to one font pixel. */
  px?: number;
  bold?: boolean;
  colour?: string;
  align?: "left" | "center" | "right";
  /** A one-pixel drop shadow, as in the block game. */
  shadow?: string | false;
  /** A dark edge all round instead, for words over busy ground. */
  edge?: string | false;
}

/** Writes one line with its top-left (or top-centre, or top-right) corner at `x`, `y`. Returns its width. */
export function write(g: Ctx, text: string, x: number, y: number, o: Words = {}): number {
  const px = Math.max(1, Math.round(o.px ?? 1));
  g.font = fontOf(px, o.bold);
  g.textBaseline = "alphabetic";
  g.textAlign = "left";
  const w = Math.round(g.measureText(text).width);
  const left = Math.round(o.align === "center" ? x - w / 2 : o.align === "right" ? x - w : x);
  // The font's baseline sits eight font pixels under the top of the line.
  const base = Math.round(y) + px * 8;
  if (o.edge) {
    g.fillStyle = o.edge;
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
      [1, 1],
    ] as const)
      g.fillText(text, left + dx * px, base + dy * px);
  } else if (o.shadow !== false) {
    g.fillStyle = o.shadow ?? INK;
    g.fillText(text, left + px, base + px);
  }
  g.fillStyle = o.colour ?? "#fff3cf";
  g.fillText(text, left, base);
  return w;
}

/** How wide a line would be. */
export function widthOf(g: Ctx, text: string, px = 1, bold = false): number {
  g.font = fontOf(px, bold);
  return Math.round(g.measureText(text).width);
}
