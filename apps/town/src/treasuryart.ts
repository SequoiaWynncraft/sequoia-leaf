/**
 * The Treasury's requests as pictures, one for each row: a tome, plum with a gold clasp; an aspect, a
 * shard of blue light; and LE, an emerald cut in the town's own greens, its table catching the light.
 * Each is lit from the upper left, with a dark edge, in the town's colours (`PAL`), and is drawn when
 * it is asked for.
 */

import type { RequestKind } from "@sequoia-leaf/core";
import { bitmap } from "@sequoia-leaf/kit/pix.ts";

import { PAL } from "./sprites.ts";

const ROWS: Readonly<Record<RequestKind, readonly string[]>> = {
  tome: [
    ".kkkkkkkk.",
    "kVvvvvvvvk",
    "kVvyyyyyvk",
    "kVvvvvvvvk",
    "kVvvvYvvvk",
    "kVvvYoYvvo",
    "kVvvvYvvvo",
    "kVvvvvvvvk",
    "kVvvvvvvvk",
    "kVkkkkkkkk",
    "kVwcwcwcwk",
    ".kkkkkkkk.",
  ],
  aspect: [
    "....kk..y.",
    "...kwuk...",
    "..kwuuUk..",
    "..kwuUUk..",
    ".kwuuUUUk.",
    ".kwuUUUUk.",
    "y.kuuUUk..",
    "..kuUUUk..",
    "...kuUk...",
    "...kUUk..y",
    "....kk....",
  ],
  le: [
    "...kkkk..y",
    "..kwlllk..",
    ".kwlGGGgk.",
    "kwlGlllGgk",
    "klGlwllGgk",
    "klGllllGgk",
    "klGllllGgk",
    "kgGGlllGdk",
    ".kgGGGGdk.",
    "..kggddk..",
    "y..kkkk...",
  ],
};

/** A request's picture on its row at the Treasury. */
export const requestArt = (kind: RequestKind): HTMLCanvasElement => bitmap(ROWS[kind], PAL);
