/**
 * The kit's small frames drawn on a canvas, for words that live in a game's world rather than on
 * the page: somebody speaking, and the key to press by a door. They match `k-say` and `k-tip`.
 * Everything is counted in art pixels and drawn `px` canvas pixels to each, the same number
 * `text.ts` takes, so the letters and the frames stay on one grid.
 */
import { BARK, CREAM, GOLD, INK } from "./palette.ts";
import { widthOf, write } from "./text.ts";
import type { Ctx } from "./util.ts";

/** A size in canvas pixels. */
export interface Size {
  w: number;
  h: number;
}

/** Breaks a sentence into lines no wider than `max` canvas pixels, at its spaces. */
export function wrap(g: Ctx, text: string, max: number, px = 1, bold = false): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const longer = line ? `${line} ${word}` : word;
    if (line && widthOf(g, longer, px, bold) > max) {
      lines.push(line);
      line = word;
    } else line = longer;
  }
  if (line) lines.push(line);
  return lines;
}

const widest = (g: Ctx, lines: readonly string[], px: number, bold = false): number =>
  lines.reduce((m, l) => Math.max(m, widthOf(g, l, px, bold)), 0);

/** Lines sit eleven art pixels apart: ten of letter and one of air. */
const LINE = 11;

/** How large the bubble for these lines is, tail not counted (the tail hangs three pixels under). */
export function bubbleSize(g: Ctx, lines: readonly string[], px: number): Size {
  return { w: widest(g, lines, px) + 10 * px, h: (lines.length * LINE + 5) * px };
}

/**
 * Somebody speaking: a cream bubble with its top-left corner at `x`, `y` and its tail pointing
 * down at `tailX`.
 */
export function bubble(g: Ctx, lines: readonly string[], x: number, y: number, px: number, tailX: number): void {
  const { w, h } = bubbleSize(g, lines, px);
  const r = (ax: number, ay: number, aw: number, ah: number, c: string): void => {
    g.fillStyle = c;
    g.fillRect(x + ax * px, y + ay * px, aw * px, ah * px);
  };
  const W = w / px;
  const H = h / px;
  r(2, 0, W - 4, H, INK);
  r(0, 2, W, H - 4, INK);
  r(1, 1, W - 2, H - 2, INK);
  r(2, 1, W - 4, H - 2, CREAM);
  r(1, 2, W - 2, H - 4, CREAM);
  // The tail, kept under the flat part of the bubble's edge.
  const t = Math.min(Math.max(Math.round((tailX - x) / px), 6), W - 6);
  r(t - 3, H - 1, 6, 1, INK);
  r(t - 2, H - 1, 4, 1, CREAM);
  r(t - 2, H, 4, 1, INK);
  r(t - 1, H, 2, 1, CREAM);
  r(t - 1, H + 1, 2, 1, INK);
  lines.forEach((line, i) => {
    write(g, line, x + 5 * px, y + (3 + i * LINE) * px, { px, colour: INK, shadow: false });
  });
}

/** How large a key prompt is. */
export function promptSize(g: Ctx, key: string, label: string, px: number): Size {
  const cap = key === "" ? 0 : widthOf(g, key, px, true) + 9 * px;
  return { w: cap + widthOf(g, label, px, true) + 10 * px, h: 18 * px };
}

/**
 * The key to press and what it does, on a dark plate in a wooden rim like a tip: `[E] Treasury`; with
 * no key (""), what it is alone. Its top-left corner goes at `x`, `y`.
 */
export function prompt(g: Ctx, key: string, label: string, x: number, y: number, px: number): void {
  const { w, h } = promptSize(g, key, label, px);
  const r = (ax: number, ay: number, aw: number, ah: number, c: string): void => {
    g.fillStyle = c;
    g.fillRect(x + ax * px, y + ay * px, aw * px, ah * px);
  };
  const W = w / px;
  const H = h / px;
  r(1, 0, W - 2, H, INK);
  r(0, 1, W, H - 2, INK);
  r(1, 1, W - 2, H - 2, BARK[1]);
  r(1, 1, W - 3, 1, BARK[3]);
  r(1, 1, 1, H - 3, BARK[3]);
  r(2, 2, W - 4, H - 4, "#1f1226");
  if (key === "") {
    write(g, label, x + 5 * px, y + 5 * px, { px, bold: true, colour: GOLD[2], shadow: INK });
    return;
  }
  // The key, as a cap with a lip under it.
  const kw = widthOf(g, key, px, true) / px + 5;
  r(4, 3, kw, 12, INK);
  r(5, 4, kw - 2, 9, CREAM);
  r(5, 13, kw - 2, 1, "#c9aa72");
  write(g, key, x + 7 * px, y + 5 * px, { px, bold: true, colour: INK, shadow: false });
  write(g, label, x + (kw + 8) * px, y + 5 * px, { px, bold: true, colour: GOLD[2], shadow: INK });
}
