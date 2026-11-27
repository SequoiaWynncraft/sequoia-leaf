import { catalogOf } from "./content/catalog.ts";
/**
 * The rack: the items nobody is holding. Two components on it forge there, into the finished item
 * a figure would have made of them, to hand over afterwards. (Handing an item over is `giveItem`,
 * in `run.ts`.)
 */
import { forge, isComponentId } from "./content/items.ts";
import { type Done, notPlanning, refusal, remember, type RunView } from "./run.ts";

/**
 * Makes the finished item of the components at two places on the rack. It takes the place of the
 * first, and the second's place closes up. Anything but two components (an emblem, a finished item,
 * one place twice) is refused, and nothing is ever taken apart again.
 */
export function forgeItems(run: RunView, at: number, other: number): Done {
  const stop = notPlanning(run);
  if (stop) return refusal(stop);
  const a = run.items[at];
  const b = run.items[other];
  if (a === undefined || b === undefined) return refusal("no_such_item");
  if (at === other || !isComponentId(a) || !isComponentId(b)) return refusal("two_components");
  const item = forge(catalogOf(run), a, b);
  run.items[at] = item;
  run.items.splice(other, 1);
  remember(run.seen.forged, item);
  return { ok: true, notes: [{ t: "made", item, at: other < at ? at - 1 : at }] };
}
