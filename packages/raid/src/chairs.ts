/**
 * Chairs: what the figures on a run's board take (`chairsUsed`, one each but none for the first copy
 * of a Stowaway) against what the room it is in has (`Room.chairs`). Moving a figure onto the board,
 * locking it for a fight, the bot's party, a board's admission and the pips all read these two.
 */
import { catalogOf } from "./content/catalog.ts";
import { chairsUsed } from "./party.ts";
import { roomOf, type RoomRun } from "./room.ts";
import type { Piece, RunView } from "./run.ts";

/** Who is on a board. */
const seated = (board: readonly (Piece | null)[]): Piece[] => board.filter((p) => p !== null);

/** The chairs a run's board takes now, by its catalogue (or, for a test, another). */
export const chairsOn = (run: Pick<RunView, "board" | "era">, cat = catalogOf(run)): number =>
  chairsUsed(cat, seated(run.board));

/**
 * Whether putting a figure on the board, changing places with whoever is there (`there`, or
 * nobody), would take more chairs than the room has, and more than the board takes now.
 */
export function overfills(
  run: RoomRun & Pick<RunView, "board">,
  piece: Piece,
  there: Piece | null,
  cat = catalogOf(run),
): boolean {
  const before = seated(run.board);
  const after = [...before.filter((p) => p !== there), piece];
  const used = chairsUsed(cat, after);
  return used > roomOf(run).chairs && used > chairsUsed(cat, before);
}
