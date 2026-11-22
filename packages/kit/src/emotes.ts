/**
 * The emotes a player can make where others see it (core's `ACTS`, kind `emote`), each as a small
 * pixel picture: a wave, a cheer, a laugh and a heart. The same pictures are the kit's icons
 * (`tools/frames.ts` draws them into the stylesheet) and, drawn on a canvas, what floats up from
 * somebody who makes one (`emotePicture`).
 */

import { CORAL, CREAM, GOLD, INK } from "./palette.ts";
import { bitmap, outlined } from "./pix.ts";

/** The emotes a player picks from, in the order they are offered. */
export const EMOTES = ["wave", "cheer", "laugh", "heart"] as const;
export type Emote = (typeof EMOTES)[number];

/** Whether a word is one of the emotes. */
export const isEmote = (v: string): v is Emote => EMOTES.some((e) => e === v);

/** Each emote, as rows of letters (the colours in `EMOTE_PAL`, the kit's icon letters). */
export const EMOTE_ART: Readonly<Record<Emote, readonly string[]>> = {
  wave: [
    "....w.w.w...",
    "....w.w.w.w.",
    "....w.w.w.w.",
    "....wwwwwww.",
    "ww..wwwwwww.",
    ".ww.wwwwwww.",
    "..wwwwwwwww.",
    "...wwwwwwww.",
    "....wwwwww..",
    ".....wwww...",
  ],
  cheer: [
    ".....y.....",
    "..y..y..y..",
    "...y.Y.y...",
    "....YYY....",
    "yyyYYwYYyyy",
    "....YYY....",
    "...y.Y.y...",
    "..y..y..y..",
    ".....y.....",
  ],
  laugh: [
    "...yyyyy...",
    ".yyYYYYYyy.",
    ".yYYYYYYYy.",
    "yYYkYYYkYYy",
    "yYkYkYkYkYy",
    "yYYYYYYYYYy",
    "yYkkkkkkkYy",
    "yYYkwrwkYYy",
    ".yYYkkkYYy.",
    ".yyYYYYYyy.",
    "...yyyyy...",
  ],
  heart: [
    ".rr...rr..",
    "rwrr.rrrr.",
    "rwrrrrrrr.",
    "rrrrrrrrr.",
    "rrrrrrrrr.",
    ".rrrrrrr..",
    "..rrrrr...",
    "...rrr....",
    "....r.....",
  ],
};

/** The colours the emotes are drawn in, by letter: the same as the kit's icons. */
export const EMOTE_PAL: Readonly<Record<string, string>> = {
  k: INK,
  w: CREAM,
  y: GOLD[1],
  Y: GOLD[2],
  r: CORAL,
};

const pictures = new Map<Emote, HTMLCanvasElement>();
/** An emote as a small picture with its dark edge, for a canvas, one of its pixels to each of the scene's. Made once. */
export function emotePicture(e: Emote): HTMLCanvasElement {
  let p = pictures.get(e);
  if (!p) {
    p = outlined(bitmap(EMOTE_ART[e], EMOTE_PAL), INK);
    pictures.set(e, p);
  }
  return p;
}
