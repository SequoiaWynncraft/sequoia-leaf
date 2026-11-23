import { PAL } from "@sequoia-leaf/figures/pal.ts";
import { readRows } from "@sequoia-leaf/figures/rows.ts";
/**
 * The small pictures: one for every trait, component, finished item and boon, the three kinds of
 * room, and the few signs the buttons carry. Typed as rows of letters like the figures and kept as
 * text (`icons.txt`), baked once with a dark edge, and handed out as fresh little canvases to put on
 * the page. An emblem is its kin's own sign.
 */
import { GOLD, INK } from "@sequoia-leaf/kit/palette.ts";
import { bitmap, outlined } from "@sequoia-leaf/kit/pix.ts";
import { makeCanvas } from "@sequoia-leaf/kit/util.ts";
import type { BoonId } from "@sequoia-leaf/raid/content/boons.ts";
import { EMBLEMS, isComponentId, isEmblemId, type ItemId } from "@sequoia-leaf/raid/content/items.ts";
import type { RoomKind } from "@sequoia-leaf/raid/content/rooms.ts";
import type { TraitId } from "@sequoia-leaf/raid/content/traits.ts";

import text from "./icons.txt";

const ROWS = readRows(text);
/** A picture's rows from `icons.txt`, by its kind and its id. */
const rowsOf = (kind: "trait" | "item" | "room" | "glyph", id: string): readonly string[] =>
  ROWS.get(`${kind} ${id}`) ?? [];

/** The signs the buttons and the purse carry. */
export const GLYPHS = [
  "acorn",
  "rustle",
  "pin",
  "up",
  "play",
  "fast",
  "skip",
  "book",
  "help",
  "door",
  "swords",
  "hand",
  "figure",
  "brush",
  "leaf",
  "coin",
  "flame",
  "frost",
] as const;
export type Glyph = (typeof GLYPHS)[number];

const baked = new Map<string, HTMLCanvasElement>();
function bakedOf(key: string, rows: readonly string[], edge = true): HTMLCanvasElement {
  let c = baked.get(key);
  if (!c) {
    const pic = bitmap(rows, PAL);
    c = edge ? outlined(pic, INK) : pic;
    baked.set(key, c);
  }
  return c;
}
/** A fresh copy of a baked picture, to put on the page (a canvas can only be in one place). */
function copy(src: HTMLCanvasElement): HTMLCanvasElement {
  const { c, g } = makeCanvas(src.width, src.height);
  g.drawImage(src, 0, 0);
  return c;
}

/** The kept picture of a trait, for drawing on the table. Do not put it on the page. */
export const traitPic = (id: TraitId): HTMLCanvasElement => bakedOf(`t:${id}`, rowsOf("trait", id));
export const traitIcon = (id: TraitId): HTMLCanvasElement => copy(traitPic(id));
export const itemPic = (id: ItemId): HTMLCanvasElement =>
  isEmblemId(id) ? traitPic(EMBLEMS[id]) : bakedOf(`i:${id}`, rowsOf("item", id));
export const itemIcon = (id: ItemId): HTMLCanvasElement => copy(itemPic(id));
export const glyphPic = (id: Glyph): HTMLCanvasElement => bakedOf(`g:${id}`, rowsOf("glyph", id), id !== "hand");
export const glyph = (id: Glyph): HTMLCanvasElement => copy(glyphPic(id));
export const roomIcon = (kind: RoomKind): HTMLCanvasElement => copy(bakedOf(`r:${kind}`, rowsOf("room", kind)));

/** A boon's picture: its own, or for a charm its kin's sign hanging on a string. */
export function boonIcon(id: BoonId): HTMLCanvasElement {
  // A boon that is not a charm has a picture of its own; a charm is its kin's sign on a string.
  const rows = ROWS.get(`boon ${id}`);
  if (rows) return copy(bakedOf(`b:${id}`, rows));
  if (!isEmblemId(id)) return copy(glyphPic("acorn"));
  const sign = traitPic(EMBLEMS[id]);
  const { c, g } = makeCanvas(sign.width, sign.height + 3);
  g.fillStyle = PAL.c ?? "#e9d8b8";
  g.fillRect(Math.floor(sign.width / 2) - 1, 0, 1, 3);
  g.fillRect(Math.floor(sign.width / 2) + 1, 0, 1, 3);
  g.fillRect(Math.floor(sign.width / 2), 0, 1, 1);
  g.drawImage(sign, 0, 3);
  return c;
}

/**
 * Halves a picture typed as letters: each square of two by two becomes the letter most of it is,
 * so a ten-pixel item keeps its shape and colours at five.
 */
function halved(rows: readonly string[]): string[] {
  const out: string[] = [];
  for (let y = 0; y < rows.length; y += 2) {
    let line = "";
    for (let x = 0; x < (rows[0]?.length ?? 0); x += 2) {
      const seen = new Map<string, number>();
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        const ch = rows[y + dy]?.[x + dx] ?? ".";
        if (ch !== ".") seen.set(ch, (seen.get(ch) ?? 0) + 1);
      }
      let best = ".";
      let most = 0;
      for (const [ch, n] of seen) {
        if (n <= most) continue;
        best = ch;
        most = n;
      }
      line += best;
    }
    out.push(line);
  }
  return out;
}

/**
 * What a figure holds, as it is shown under its base: the item at half size, a finished one (and an
 * emblem) with a gold edge and a loose component with the plain dark one, so a component waiting for
 * its pair stands out. Do not put it on the page.
 */
export function heldPic(id: ItemId): HTMLCanvasElement {
  const key = `h:${id}`;
  let c = baked.get(key);
  if (!c) {
    const pic = bitmap(halved(isEmblemId(id) ? rowsOf("trait", EMBLEMS[id]) : rowsOf("item", id)), PAL);
    c = outlined(pic, isComponentId(id) ? INK : GOLD[2]);
    baked.set(key, c);
  }
  return c;
}
