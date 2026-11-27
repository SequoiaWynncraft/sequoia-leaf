/**
 * Reach: you put pieces down and take them up only near where you stand, on the plot you stand on
 * and the eight round it. On the guild's land today that is the whole yard from its middle plot, so
 * nothing is harder; on a bigger map you walk out to build far away.
 *
 * Reach limits what changes what stands: building a piece (not raising or turning one where it
 * stands), laying a run, setting down pieces in hand, and taking pieces away, one or a marked area. A
 * card's settings, turning, painting a line (a line crosses the yard), raising a grade, undoing and
 * putting back a plan of the whole yard are done from anywhere. Without a figure of yours (a visit, a
 * review page's own yard) nothing is out of reach.
 *
 * It is the page's rule alone for now: Leaf does not know where you stand until visitors walk, and
 * building far away gains nothing over anyone else.
 */
import {
  type Act,
  at,
  blueprintAt,
  NONE,
  type Piece,
  piecesAt,
  placed,
  tilesOf,
  type Turned,
  type Yard,
} from "@sequoia-leaf/factory";

import { S } from "../state.ts";
import { yourPlot } from "./you.ts";

/** What a press out of reach says, and the code it is refused with. */
export const OUT_OF_REACH = "Out of reach";
const REACH = "out_of_reach";

/** The tiles within reach, corner to corner, or nothing for no limit: you have no figure here. */
export function reachBox(y: Yard = S.world): { x0: number; y0: number; x1: number; y1: number } | null {
  const plot = yourPlot();
  if (plot === null) return null;
  const p = y.land.plots[plot];
  // Off every plot (only ever for a moment, before you are put on clear ground), nothing is in reach.
  if (!p) return { x0: 0, y0: 0, x1: -1, y1: -1 };
  return { x0: p.x - p.w, y0: p.y - p.h, x1: p.x + 2 * p.w - 1, y1: p.y + 2 * p.h - 1 };
}

/** Whether a tile is within reach. A tile off the map is let be: the rules say why nothing goes there. */
export function reaches(x: number, y: number, yard: Yard = S.world): boolean {
  const box = reachBox(yard);
  if (!box || x < 0 || y < 0 || x >= yard.land.w || y >= yard.land.h) return true;
  return x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1;
}

/** Whether a tile, by its number, is within reach. */
const tileReaches = (y: Yard, i: number): boolean => i < 0 || reaches(i % y.land.w, Math.floor(i / y.land.w), y);

/** Why what is in hand cannot be used on a tile for reach, or null: the brush paints from anywhere, and an empty hand does nothing. */
export function handReach(x: number, y: number): string | null {
  const h = S.hand.is;
  return h === "idle" || h === "paint" || reaches(x, y) ? null : OUT_OF_REACH;
}

/** Why pieces cannot be set down where they stand for reach, or null. */
export const piecesReach = (pieces: readonly Piece[]): string | null =>
  pieces.every((p) => reaches(p.x, p.y)) ? null : OUT_OF_REACH;

/** Each piece's reason it cannot stand where it would (`whys`), with reach first: what a group in hand shows. */
export const withReach = (pieces: readonly Piece[], whys: readonly (string | null)[]): (string | null)[] =>
  pieces.map((p, n) => (reaches(p.x, p.y) ? (whys[n] ?? null) : OUT_OF_REACH));

/**
 * The tiles a command puts a piece on or takes one off: building a piece, laying a run, taking one or
 * a marked area away, and setting down pieces moved, copied or from a blueprint. Every other command
 * is done from anywhere, and touches none.
 */
function touched(y: Yard, act: Act): readonly number[] {
  const dest = (pieces: readonly Piece[] | null): number[] => (pieces ? tilesOf(y, pieces) : []);
  if (act.do === "build") {
    const i = at(y, act.x, act.y);
    // Over a piece of its kind it is only raised or turned where it stands.
    return (y.kind[i] ?? NONE) === act.kind ? [] : [i];
  }
  if (act.do === "lay") return act.legs.map((leg) => at(y, leg.x, leg.y));
  if (act.do === "remove") return [at(y, act.x, act.y)];
  if (act.do === "clear") return act.tiles;
  if (act.do === "move") return [...act.tiles, ...dest(placed(piecesAt(y, act.tiles), act.turns, act.x, act.y))];
  if (act.do === "copy") return dest(placed(piecesAt(y, act.tiles), act.turns, act.x, act.y));
  // A plan of the whole yard goes back where it was kept, from anywhere.
  if (act.do === "placeBlueprint" && !y.blueprints[act.slot]?.whole)
    return dest(blueprintAt(y, act.slot, act.turns, act.x, act.y));
  return [];
}

/** The refusal of a command that puts a piece down or takes one up out of reach, or null: what `doNow` asks before the rules. */
export function beyondReach(act: Act, y: Yard = S.world): Turned | null {
  return touched(y, act).every((i) => tileReaches(y, i)) ? null : { refused: REACH, why: OUT_OF_REACH };
}
