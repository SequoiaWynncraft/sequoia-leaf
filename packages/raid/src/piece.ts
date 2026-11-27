/**
 * One figure the party owns on a run, and a new one as it is bought or picked: its own number in the
 * run (`Run.nextId`), so a screen can follow it about.
 */
import type { FigureId, Stars } from "./content/figures.ts";
import type { ItemId } from "./content/items.ts";
import type { RunView } from "./run.ts";

/** One figure the party owns. */
export interface Piece {
  /** Its own number in this run, so a screen can follow it about. */
  id: number;
  kind: FigureId;
  stars: Stars;
  items: ItemId[];
  /** What Greg has eaten (`feed`): percent of his health he has gained for good. 0 for anyone else. */
  fed: number;
  /** Fights it has fought on the board, for one that counts them (Crafter); 0 for anyone else. */
  fights: number;
}
/** A new figure for a run, of one star, holding nothing, numbered next. */
export function newPiece(run: Pick<RunView, "nextId">, kind: FigureId): Piece {
  return { id: run.nextId++, kind, stars: 1, items: [], fed: 0, fights: 0 };
}
