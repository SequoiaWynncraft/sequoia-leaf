import { catalogOf } from "./content/catalog.ts";
/**
 * The rack: the items nobody is holding. Two on it that a recipe joins (`combine`) make what it
 * makes there: an item, to hand over afterwards, or a boon. (Handing an item over is `giveItem`, in
 * `run.ts`.)
 */
import { combine } from "./content/recipes.ts";
import { takeMade } from "./made.ts";
import { type Done, notPlanning, refusal, type RunView } from "./run.ts";

/**
 * Makes what the items at two places on the rack make. An item takes the place of the first, and
 * the second's place closes up; a boon closes both. Two that make nothing (an emblem, a finished
 * item, one place twice) are refused, as is a boon the run has already, and nothing is ever taken
 * apart again.
 */
export function forgeItems(run: RunView, at: number, other: number, cat = catalogOf(run)): Done {
  const stop = notPlanning(run);
  if (stop) return refusal(stop);
  const a = run.items[at];
  const b = run.items[other];
  if (a === undefined || b === undefined) return refusal("no_such_item");
  const made = at === other ? null : combine(cat, a, b);
  if (!made) return refusal("two_components");
  const notes = takeMade(run, made);
  if (!notes) return refusal("boon_held");
  if (made.gives === "boon") {
    run.items = run.items.filter((_, i) => i !== at && i !== other);
    return { ok: true, notes };
  }
  run.items[at] = made.id;
  run.items.splice(other, 1);
  return { ok: true, notes: [{ t: "made", item: made.id, at: other < at ? at - 1 : at }] };
}
