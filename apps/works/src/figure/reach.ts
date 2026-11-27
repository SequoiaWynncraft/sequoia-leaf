/**
 * Reach: you put pieces down and take them up only near where you stand, on the plot you stand on
 * and the eight round it. On the guild's land today that is the whole yard from its middle plot, so
 * nothing is harder; on a bigger map you walk out to build far away.
 *
 * One rule, asked of a command: every tile it puts a piece on or takes one off must be in reach
 * (`footprint`), whatever stood there before: both mouths of a tunnel, a move's every piece where it
 * leaves and where it lands, a blueprint's every piece, every tile of a run of belt, a piece built
 * over one of its kind. A preview asks it of the very command its press would send (`acts.ts`), and
 * `doNow` asks it before the rules, so a gold preview is never refused and a coral one never goes
 * through. Only commands that put nothing down and take nothing up are done from anywhere: turning a
 * piece, raising grades with the grade command (Upgrade on a marked area or the whole yard), a card's
 * settings, painting a line, undoing, and putting back a plan of the whole yard. Without a figure of
 * yours (a visit, a review page's own yard) nothing is out of reach.
 *
 * It is the page's rule alone for now: Leaf does not know where you stand until visitors walk, and
 * building far away gains nothing over anyone else.
 */
import {
  type Act,
  at,
  blueprintAt,
  legPiece,
  type Piece,
  piecesAt,
  placed,
  SPANS,
  tilesAt,
  tilesOf,
  tunnelExit,
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

/** What standing on some tiles takes up: the pieces there, a tunnel by both its mouths. */
function taken(y: Yard, tiles: readonly number[]): number[] {
  const on = tiles.filter((i) => i >= 0);
  return tilesOf(y, piecesAt(y, on));
}

/** The tiles a piece set down changes: every tile it stands on (a tunnel's far mouth too), and every tile of whatever stood there. */
function setsDown(y: Yard, p: Piece): number[] {
  const tiles = tilesOf(y, [p]);
  return [...tiles, ...taken(y, tiles)];
}

/**
 * The tiles a build changes, as the rules build it. Over one of its kind, which the rules lay again
 * only on its own tile, it is that piece set down again where it stands, raised or turned: the piece
 * as it stands (a tunnel by its two mouths), and every tile it will cover as it then faces, which
 * differ for a piece of more than one tile that is not square. Else every tile the new piece will
 * cover (a tunnel's far mouth where the rules dig it), and every tile of whatever stood there.
 */
function built(y: Yard, act: Extract<Act, { do: "build" }>): number[] {
  const i = at(y, act.x, act.y);
  if (i >= 0 && y.kind[i] === act.kind)
    return [...new Set([...taken(y, [i]), ...tilesAt(act.kind, act.x, act.y, act.dir, y.land.w, y.land.h)])];
  const exit = SPANS[act.kind] === 1 ? tunnelExit(y, act.x, act.y, act.dir) : null;
  return setsDown(y, { kind: act.kind, x: act.x, y: act.y, dir: act.dir, span: exit?.span ?? 0 });
}

/**
 * What a command puts down and takes up, piece by piece: for each piece it builds, lays, sets down or
 * takes away, the tiles that changes (in the order the pieces are set down, for pieces in hand).
 * Every other command, and a plan of the whole yard put back, changes none.
 */
export function footprint(y: Yard, act: Act): number[][] {
  const each = (pieces: readonly Piece[] | null): number[][] => (pieces ?? []).map((p) => setsDown(y, p));
  if (act.do === "build") return [built(y, act)];
  if (act.do === "lay") return each(act.legs.map(legPiece));
  if (act.do === "stand") return each(act.pieces);
  if (act.do === "remove") return [taken(y, [at(y, act.x, act.y)])];
  if (act.do === "clear") return piecesAt(y, act.tiles).map((p) => tilesOf(y, [p]));
  if (act.do === "copy") return each(placed(piecesAt(y, act.tiles), act.turns, act.x, act.y));
  if (act.do === "move") {
    const from = piecesAt(y, act.tiles);
    const to = placed(from, act.turns, act.x, act.y);
    return from.map((p, n) => tilesOf(y, [p]).concat(to[n] ? setsDown(y, to[n]) : []));
  }
  if (act.do === "placeBlueprint" && !y.blueprints[act.slot]?.whole)
    return each(blueprintAt(y, act.slot, act.turns, act.x, act.y));
  return [];
}

/** Why a command cannot be done for reach, or null: what a single preview, a run and `doNow` ask. */
export function reachOf(act: Act, y: Yard = S.world): string | null {
  return footprint(y, act).every((tiles) => tiles.every((i) => tileReaches(y, i))) ? null : OUT_OF_REACH;
}

/** For pieces in hand set down by a command, each piece's reason it cannot stand (`whys`), reach first. */
export function withReach(act: Act, whys: readonly (string | null)[], y: Yard = S.world): (string | null)[] {
  const out = footprint(y, act).map((tiles) => (tiles.every((i) => tileReaches(y, i)) ? null : OUT_OF_REACH));
  return whys.map((why, n) => out[n] ?? why);
}

/** The refusal of a command out of reach, or null: what `doNow` asks before the rules. */
export function beyondReach(act: Act, y: Yard = S.world): Turned | null {
  const why = reachOf(act, y);
  return why === null ? null : { refused: REACH, why };
}
