/**
 * Reach: you build by hand only near where you stand, on the plot you stand on and the plots round
 * it, as many plots out as the yard's range (`Open.range`: 1, the eight round it, until research
 * makes it more: 2 with `longreach`, 3 with `longerreach`). On the 7 by 7 land, 3 is the whole land
 * from its middle plot; with less you walk out to build by hand far away.
 *
 * Reach is for building by hand and for nothing else (`footprint`): one piece built, raised or
 * turned in place by building over it, a run of belt, a tunnel, and one piece removed by hand. Every
 * tile such a command puts a piece on or takes one off must be in reach, whatever stood there
 * before. Nothing the select tool or a blueprint does is limited by reach: moving, copying or
 * removing an area, saving it, and setting down a blueprint (a pasted code's too) work anywhere on
 * the yard's land. They are the way to build far from where you stand. Nor is anything that puts no
 * piece down and takes none up: turning a piece, Upgrade, a card's settings, painting, Undo.
 *
 * A preview asks it of the very command its press would send (`acts.ts`), and `doNow` asks it before
 * the rules, so a gold preview is never refused and a coral one never goes through. Without a figure
 * of yours (a visit, a review page's own yard) nothing is out of reach.
 *
 * It is the page's rule alone for now: Leaf does not know where you stand until visitors walk, and
 * building far away gains nothing over anyone else.
 */
import {
  type Act,
  at,
  legPiece,
  type Piece,
  piecesAt,
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

/**
 * The tiles within reach, corner to corner, or nothing for no limit: you have no figure here. The
 * one box every question of reach asks: the plot you stand on and `range` plots out on every side,
 * however far past the land's edge that goes.
 */
export function reachBox(y: Yard = S.world): { x0: number; y0: number; x1: number; y1: number } | null {
  const plot = yourPlot();
  if (plot === null) return null;
  const p = y.land.plots[plot];
  // Off every plot (only ever for a moment, before you are put on clear ground), nothing is in reach.
  if (!p) return { x0: 0, y0: 0, x1: -1, y1: -1 };
  const r = y.open.range;
  return { x0: p.x - r * p.w, y0: p.y - r * p.h, x1: p.x + (r + 1) * p.w - 1, y1: p.y + (r + 1) * p.h - 1 };
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
 * The tiles reach asks of a command: every tile it puts a piece on or takes one off, if it is
 * building by hand, and none else. Building by hand is a build (raising or turning a piece in place
 * too), a run of belt, a tunnel (built or laid), a remove, and standing one piece, which the rules
 * count a build of no tool. Everything else, the select tool's and a blueprint's commands among
 * them, is done anywhere on the land.
 */
export function footprint(y: Yard, act: Act): number[] {
  if (act.do === "build") return built(y, act);
  if (act.do === "lay") return act.legs.flatMap((l) => setsDown(y, legPiece(l)));
  if (act.do === "remove") return taken(y, [at(y, act.x, act.y)]);
  if (act.do === "stand" && act.pieces.length === 1) return act.pieces.flatMap((p) => setsDown(y, p));
  return [];
}

/** Why a command cannot be done for reach, or null: what a single preview, a run and `doNow` ask. */
export function reachOf(act: Act, y: Yard = S.world): string | null {
  return footprint(y, act).every((i) => tileReaches(y, i)) ? null : OUT_OF_REACH;
}

/** The refusal of a command out of reach, or null: what `doNow` asks before the rules. */
export function beyondReach(act: Act, y: Yard = S.world): Turned | null {
  const why = reachOf(act, y);
  return why === null ? null : { refused: REACH, why };
}
