/**
 * Feeding Greg, a planning command beside selling (`{ do: "feed", from, to }`): a figure from the
 * bench is eaten by a Greg on the board or the bench. Greg gains a share of his health for good for
 * each acorn the figure cost (what was spent on it: a two-star of one-acorn figures cost 3), up to
 * Greg's most. The figure is gone; what it held goes back to the rack, as selling sends it; no acorns
 * come back. What Greg has gained lives on that Greg (`Piece.fed`): copies merging into a star keep
 * the sum of theirs, up to the most, and selling him loses it.
 */
import { type FigureId, FIGURES, type Stars } from "./content/figures.ts";
import type { ItemId } from "./content/items.ts";
import { worth } from "./content/rooms.ts";
import { traitNumber } from "./content/traits.ts";
import { type Done, notPlanning, pieceAt, refusal, type RunView, type Spot } from "./run.ts";

/** What feeding Greg did, for a screen to show. */
export interface Fed {
  t: "fed";
  /** Greg, by his number in the run, and what he has gained for good now, in percent of his health. */
  piece: number;
  fed: number;
  /** What this meal added. */
  gained: number;
  /** The figure eaten: its number, what it was, and where on the bench it was. */
  ate: number;
  kind: FigureId;
  stars: Stars;
  from: Spot;
  /** What it held, put back on the rack. */
  items: ItemId[];
}

/**
 * Greg (at `to`) eats the figure on the bench at `from`. Turned down outside planning, from anywhere
 * but the bench, for nobody there, for anyone but a Greg eating, for a Greg being eaten, and when
 * Greg has gained all he can.
 */
export function feed(run: RunView, from: Spot, to: Spot): Done {
  const stop = notPlanning(run);
  if (stop) return refusal(stop);
  const meal = pieceAt(run, from);
  const greg = pieceAt(run, to);
  if (meal === undefined || greg === undefined) return refusal("no_such_place");
  if (from.on !== "bench") return refusal("not_from_bench");
  if (!meal || !greg) return refusal("nobody_there");
  if (greg.kind !== "greg") return refusal("not_greg");
  if (meal.kind === "greg") return refusal("greg_on_greg");
  const most = traitNumber("greg", "most", 1);
  if (greg.fed >= most) return refusal("greg_full");
  const gained = Math.min(
    most - greg.fed,
    worth(FIGURES[meal.kind].tier, meal.stars) * traitNumber("greg", "grows", 1),
  );
  greg.fed += gained;
  run.items.push(...meal.items);
  run.bench[from.at] = null;
  const ate: Fed = {
    t: "fed",
    piece: greg.id,
    fed: greg.fed,
    gained,
    ate: meal.id,
    kind: meal.kind,
    stars: meal.stars,
    from,
    items: meal.items.slice(),
  };
  return { ok: true, notes: [ate] };
}
