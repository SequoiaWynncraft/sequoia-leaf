/**
 * The sorter: takes things in from behind; the one thing it is set to (`set`) goes out to its left,
 * or once flipped to its right, everything else ahead. With nothing set it is a belt. While the tile
 * a thing goes to has no room, it waits.
 *
 * Which side it sends to is kept as a splitter keeps the way it puts first, 1 + the way, but only 3
 * is kept: 0 is the left, the way every sorter sent before one could be set to the right.
 */
import type { Lay } from "../build.ts";
import type { KeptPiece } from "../cells.ts";
import type { Kept, Piece } from "../pieces.ts";
import type { Item } from "../tables.ts";
import type { Wire, Yard } from "../yard.ts";
import { gradeKept, tintKept } from "./kept.ts";
import { kind, type Unchecked } from "./kind.ts";
import type { Kit } from "./kit.ts";
import { anything, behindOnly, carrierCondition, carrierWords, crossed, empty, lay } from "./line.ts";

/** The way it sends the thing it is set to: 1, to its left, or 2, to its right. */
export const sortWay = (y: { readonly first: Uint8Array }, i: number): 1 | 2 => (y.first[i] === 3 ? 2 : 1);

/** The way it sends what it carries: the thing it is set to to its side, anything else ahead. */
const sortedWay = (y: Yard, i: number): number => (y.item[i] === y.set[i] ? sortWay(y, i) : 0);

/** Hands on what it carries, once it has crossed the tile, the one way it goes, when the tile there takes it. */
function hands(k: Kit, y: Yard, i: number, wire: Wire): void {
  if (!crossed(k, y, i)) return;
  const w = sortedWay(y, i);
  if (!k.passWay(y, i, w, wire)) k.refused(y, i, k.wayOut(y, i, w), wire);
}

/** Sends what it is set to to its right or its left. */
function sideTo(k: Kit, y: Yard, i: number, right: boolean): void {
  const first = right ? 3 : 0;
  if (y.first[i] === first) return;
  y.first[i] = first;
  k.changed(y);
}

/** Sets the one thing it sends to its side, or with nothing makes it a belt. */
function sort(k: Kit, y: Yard, i: number, n: Item | null): void {
  y.set[i] = n ?? k.NONE;
  k.changed(y);
}

/** What it keeps: what it sends to its side, its colour, its side where it is the right (2), and its grade. */
const keeps = (k: Kit, _kind: number, v: Unchecked): Kept => ({
  ...(typeof v.recipe === "number" && k.isItem(v.recipe) ? { recipe: v.recipe } : {}),
  ...tintKept(k, v),
  ...(v.first === 2 ? { first: 2 } : {}),
  ...gradeKept(k, v),
});

/** Sets its side as kept: a sorter's side needs nothing unlocked. */
function waysTo(_k: Kit, y: Yard, i: number, kept: Kept): void {
  y.shut[i] = 0;
  if (kept.first !== undefined) y.first[i] = kept.first + 1;
}

/** A kept sorter's thing and side, as it may keep them. */
function onto(k: Kit, y: Yard, i: number, _r: number, o: KeptPiece): void {
  const kept = keeps(k, y.kind[i] ?? k.NONE, { ...k.unpackWays(k.whole(o.ways, 255) ?? 0), recipe: o.recipe });
  if (kept.recipe !== undefined) y.set[i] = kept.recipe;
  waysTo(k, y, i, kept);
}

export const sorter = kind({
  name: "sorter",
  info: {
    name: "Sorter",
    cost: 12,
    draw: 0,
    gives: 0,
    what: "Takes items in from behind. The one item it is set to goes out to its left, or to its right once flipped; everything else goes straight on. While the belt an item goes to is full, the sorter waits.",
  },
  graded: true,
  carries: true,
  tint: "alone",
  ways: 3,
  regraded: true,
  rules: {
    sides: behindOnly,
    closed: (_k, y, i) => (sortWay(y, i) === 1 ? 4 : 2),
    sends: (_k, y, i, n) => 1 << (n === y.set[i] ? sortWay(y, i) : 0),
    wants: anything,
    room: empty,
    give: lay,
    hands,
    ready: (k, y, i, to) => crossed(k, y, i) && k.wayOut(y, i, sortedWay(y, i)) === to,
    condition: carrierCondition,
    words: carrierWords,
    set: { sort, side: sideTo },
    laid: (k, y, i, l: Lay) => void (l.right === undefined || sideTo(k, y, i, l.right)),
    asLaid: (_k, p: Piece): Lay => ({ ...p, right: p.first === 2 }),
    keeps,
    waysTo,
    onto,
  },
});
