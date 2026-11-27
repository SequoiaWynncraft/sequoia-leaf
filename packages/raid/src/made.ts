/**
 * What a recipe made (`combine`), given to the run it was made in. An item stays where the two met
 * (the hand-over or the rack puts it there), and a finished one goes in the almanac's notes. A boon
 * is the run's from then on, as if it had been taken; a run has a boon once, so a second is refused
 * and nothing is used up. A boon a recipe makes is only held (`BoonSpec.made`), so making it draws
 * nothing and the page can do it at once.
 */
import { catalogOf } from "./content/catalog.ts";
import type { ItemId } from "./content/items.ts";
import { forgedOf, holdItem, type Made } from "./content/recipes.ts";
import type { Note, Piece, RunView } from "./run.ts";

/** Gives a run what was made: the notes that say so, or null for a boon it has already. */
export function takeMade(run: Pick<RunView, "boons" | "seen">, made: Made | null): Note[] | null {
  if (made?.gives !== "boon") {
    const forged = forgedOf(made);
    if (forged && !run.seen.forged.includes(forged)) run.seen.forged.push(forged);
    return [];
  }
  if (run.boons.includes(made.id)) return null;
  run.boons.push(made.id);
  return [{ t: "boon", boon: made.id }];
}

/**
 * Hands an item to a figure as a merge does, with the notes of what it made: false where it cannot
 * be held, or would make a boon the run has, and so goes back to the rack.
 */
export function handOver(
  run: Pick<RunView, "boons" | "seen" | "era">,
  to: Piece,
  item: ItemId,
  notes: Note[],
): boolean {
  const got = holdItem(catalogOf(run), to, item);
  const made = "refused" in got ? null : takeMade(run, got.made);
  if ("refused" in got || !made) return false;
  to.items = got.held;
  notes.push(...made);
  return true;
}
