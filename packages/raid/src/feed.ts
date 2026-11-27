/**
 * Feeding Greg, a planning command beside selling (`{ do: "feed", from, to }`): a figure from the
 * bench is eaten by a Greg on the board or the bench. Greg gains a share of his health for good for
 * each acorn of the figure's price, its cost times its copies (a two-star of one-acorn figures is 3,
 * whatever was paid for them: one a boon gave free feeds at its price as well), up to
 * Greg's most. The figure is gone; what it held goes back to the rack, as selling sends it; no acorns
 * come back. What Greg has gained lives on that Greg (`Piece.fed`): copies merging into a star keep
 * the sum of theirs, up to the most, and selling him loses it.
 */
import { catalogOf } from "./content/catalog.ts";
import { type FigureId, figureIn, type Stars } from "./content/figures.ts";
import type { ItemId } from "./content/items.ts";
import { worth } from "./content/rooms.ts";
import { traitNumber } from "./content/traits.ts";
import { type Done, notPlanning, pieceAt, refusal, type Refused, type RunView, type Spot } from "./run.ts";

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
 * What Greg (at `to`) would gain from eating the figure on the bench at `from`, in percent of his
 * health, without doing it: the number a screen shows before the figure is let go. Turned down as
 * feeding is: outside planning, from anywhere but the bench, for nobody there, for anyone but a Greg
 * eating, for a Greg being eaten, and when Greg has gained all he can.
 */
export function mealFor(run: RunView, from: Spot, to: Spot): { ok: true; gained: number } | Refused {
  const stop = notPlanning(run);
  if (stop) return refusal(stop);
  const meal = pieceAt(run, from);
  const greg = pieceAt(run, to);
  if (meal === undefined || greg === undefined) return refusal("no_such_place");
  if (from.on !== "bench") return refusal("not_from_bench");
  if (!meal || !greg) return refusal("nobody_there");
  if (greg.kind !== "greg") return refusal("not_greg");
  if (meal.kind === "greg") return refusal("greg_on_greg");
  const cat = catalogOf(run);
  const most = traitNumber(cat, "greg", "most", 1);
  if (greg.fed >= most) return refusal("greg_full");
  return {
    ok: true,
    gained: Math.min(
      most - greg.fed,
      worth(figureIn(cat, meal.kind).tier, meal.stars) * traitNumber(cat, "greg", "grows", 1),
    ),
  };
}

/** Greg (at `to`) eats the figure on the bench at `from`, when `mealFor` says he may. */
export function feed(run: RunView, from: Spot, to: Spot): Done {
  const meal = mealFor(run, from, to);
  if (!meal.ok) return meal;
  const eaten = pieceAt(run, from);
  const greg = pieceAt(run, to);
  if (!eaten || !greg) return refusal("nobody_there");
  greg.fed += meal.gained;
  run.items.push(...eaten.items);
  run.bench[from.at] = null;
  const ate: Fed = {
    t: "fed",
    piece: greg.id,
    fed: greg.fed,
    gained: meal.gained,
    ate: eaten.id,
    kind: eaten.kind,
    stars: eaten.stars,
    from,
    items: eaten.items.slice(),
  };
  return { ok: true, notes: [ate] };
}
