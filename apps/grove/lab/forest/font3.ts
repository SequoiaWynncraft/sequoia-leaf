/**
 * A tiny 3x5 capital font for words painted on signs in the world, drawn in palette indices so a
 * sign's lettering is lit with the rest of the scene. HUD text uses the Minecraft font instead.
 */

import type { Surface } from "../pixel/raster.ts";

const GLYPHS: Record<string, readonly string[]> = {
  A: [".#.", "#.#", "###", "#.#", "#.#"],
  B: ["##.", "#.#", "##.", "#.#", "##."],
  C: [".##", "#..", "#..", "#..", ".##"],
  D: ["##.", "#.#", "#.#", "#.#", "##."],
  E: ["###", "#..", "##.", "#..", "###"],
  F: ["###", "#..", "##.", "#..", "#.."],
  G: [".##", "#..", "#.#", "#.#", ".##"],
  H: ["#.#", "#.#", "###", "#.#", "#.#"],
  I: ["#", "#", "#", "#", "#"],
  J: ["..#", "..#", "..#", "#.#", ".#."],
  K: ["#.#", "#.#", "##.", "#.#", "#.#"],
  L: ["#.", "#.", "#.", "#.", "##"],
  M: ["#...#", "##.##", "#.#.#", "#...#", "#...#"],
  N: ["#..#", "##.#", "#.##", "#..#", "#..#"],
  O: [".#.", "#.#", "#.#", "#.#", ".#."],
  P: ["##.", "#.#", "##.", "#..", "#.."],
  Q: [".#.", "#.#", "#.#", "##.", ".##"],
  R: ["##.", "#.#", "##.", "#.#", "#.#"],
  S: [".##", "#..", ".#.", "..#", "##."],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
  U: ["#.#", "#.#", "#.#", "#.#", "###"],
  V: ["#.#", "#.#", "#.#", "#.#", ".#."],
  W: ["#...#", "#...#", "#.#.#", "##.##", "#...#"],
  X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
  Y: ["#.#", "#.#", ".#.", ".#.", ".#."],
  Z: ["###", "..#", ".#.", "#..", "###"],
  "0": [".#.", "#.#", "#.#", "#.#", ".#."],
  "1": [".#", "##", ".#", ".#", ".#"],
  "2": ["##.", "..#", ".#.", "#..", "###"],
  "3": ["##.", "..#", ".#.", "..#", "##."],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
  "5": ["###", "#..", "##.", "..#", "##."],
  "6": [".##", "#..", "###", "#.#", "###"],
  "7": ["###", "..#", ".#.", ".#.", ".#."],
  "8": ["###", "#.#", "###", "#.#", "###"],
  "9": ["###", "#.#", "###", "..#", "##."],
  " ": ["..", "..", "..", "..", ".."],
  ".": [".", ".", ".", ".", "#"],
  ":": [".", "#", ".", "#", "."],
  "'": ["#", "#", ".", ".", "."],
  "-": ["..", "..", "##", "..", ".."],
  "?": ["##.", "..#", ".#.", "...", ".#."],
  "!": ["#", "#", "#", ".", "#"],
  "/": ["..#", "..#", ".#.", "#..", "#.."],
  "#": ["#.#", "###", "#.#", "###", "#.#"],
};

const glyph = (ch: string): readonly string[] => GLYPHS[ch.toUpperCase()] ?? GLYPHS["?"] ?? [];

/** Width in pixels of `text` with one pixel between letters. */
export function tinyWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += (glyph(ch)[0]?.length ?? 3) + 1;
  return Math.max(0, w - 1);
}

/**
 * Paints `text` with its top-left at (x, y). `shade`, if given, is painted a pixel below each
 * stroke, as letters cut into wood catch a shadow.
 */
export function tinyText(s: Surface, text: string, x: number, y: number, index: number, shade?: number): void {
  let cx = Math.round(x);
  for (const ch of text) {
    const rows = glyph(ch);
    const w = rows[0]?.length ?? 3;
    rows.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        if (row[rx] !== "#") continue;
        if (shade !== undefined && rows[ry + 1]?.[rx] !== "#") s.set(cx + rx, y + ry + 1, shade);
        s.set(cx + rx, y + ry, index);
      }
    });
    cx += w + 1;
  }
}
