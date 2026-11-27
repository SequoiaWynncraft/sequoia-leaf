import type { KeptPiece } from "../cells.ts";
/**
 * The joiner: a belt that takes things in from behind and from both sides in turn, an item from each
 * way that has one ready, so that no line starves another. Its next way in is kept in `turn`.
 */
import type { Yard } from "../yard.ts";
import { kind } from "./kind.ts";
import type { Kit } from "./kit.ts";
import { aheadOf, allButAhead, anything, carrierCondition, carrierWords, carryOn, lay, readyAhead } from "./line.ts";

/** Which of its ways in (0 behind, 1 left, 2 right) is on the side `side` of it, or -1 for ahead. */
function slot(y: Yard, i: number, side: number): number {
  const d = y.dir[i] ?? 0;
  return side === ((d + 2) & 3) ? 0 : side === ((d + 3) & 3) ? 1 : side === ((d + 1) & 3) ? 2 : -1;
}

/** The tile its way in `s` takes from. */
const from = (k: Kit, y: Yard, i: number, s: number): number => k.wayIn(y, i, s);

/** Room for a thing from its side `side`: nothing on it, and that way's turn. */
const room = (k: Kit, y: Yard, i: number, _n: number, side: number): boolean =>
  y.item[i] === k.NONE && k.onTurn(k, y, i, slot(y, i, side), 3, y.turn[i] ?? 0, from);

/** Takes a thing in, and the turn goes to the next way in. */
function give(k: Kit, y: Yard, i: number, n: number, side: number, over: number): void {
  y.turn[i] = (slot(y, i, side) + 1) % 3;
  lay(k, y, i, n, side, over);
}

/** A kept joiner's next way in, put back. */
const onto = (k: Kit, y: Yard, i: number, _r: number, o: KeptPiece): void => void (y.turn[i] = k.whole(o.turn, 2) ?? 0);

export const joiner = kind({
  name: "joiner",
  info: {
    name: "Joiner",
    cost: 8,
    draw: 0,
    gives: 0,
    what: "Merges up to three lines into one, taking an item from each in turn. Without it, a belt takes whichever arrives first and one line can starve.",
  },
  graded: true,
  carries: true,
  tint: "alone",
  over: ["belt", "splitter"],
  regraded: true,
  rules: {
    sides: allButAhead,
    next: aheadOf,
    wants: anything,
    room,
    give,
    turns: () => true,
    hands: carryOn,
    ready: readyAhead,
    condition: carrierCondition,
    words: carrierWords,
    onto,
  },
});
