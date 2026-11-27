import { pick } from "@sequoia-leaf/core";

import { type Catalog, catalogOf } from "./content/catalog.ts";
/**
 * The rack: what nobody is holding, as how many of each kind (`racks.ts`), with no limit. Two on it
 * that a recipe joins (`combine`) make what it makes there: an item, to hand over afterwards, or a
 * boon. Anything on it can be melted for acorns, by the member's hand only. A tool on it is used by
 * dropping it on a figure: Tongs take back everything the figure holds; a Whetstone turns each
 * component and finished item it holds into another of its sort. (Handing an item over is `giveItem`, in `run.ts`.)
 */
import { carries, drawnComponents, grantOf, type ItemId, sortOf } from "./content/items.ts";
import { combine } from "./content/recipes.ts";
import { meltValue, type RackItem, type ToolId } from "./content/tools.ts";
import { takeMade } from "./made.ts";
import { counted, countOn, withAll } from "./racks.ts";
import {
  type Done,
  notPlanning,
  type Piece,
  pieceAt,
  refusal,
  type Refused,
  type Run,
  type RunView,
  type Spot,
} from "./run.ts";

/**
 * Makes what one of each of two kinds on the rack make (two of one kind, for a recipe of two the
 * same): the item made goes on the rack, and a boon is the run's. Two that make nothing (an emblem,
 * a finished item, a tool) are refused, as is a boon the run has already, and nothing is ever taken
 * apart again.
 */
export function forgeItems(run: RunView, a: ItemId, b: ItemId, cat = catalogOf(run)): Done {
  const stop = notPlanning(run);
  if (stop) return refusal(stop);
  const there = a === b ? countOn(run.rack, a) >= 2 : countOn(run.rack, a) > 0 && countOn(run.rack, b) > 0;
  if (!there) return refusal("no_such_item");
  const made = combine(cat, a, b);
  if (!made) return refusal("two_components");
  const notes = takeMade(run, made);
  if (!notes) return refusal("boon_held");
  run.rack = counted(counted(run.rack, a, -1), b, -1);
  if (made.gives === "boon") return { ok: true, notes };
  run.rack = counted(run.rack, made.id, 1);
  return { ok: true, notes: [{ t: "made", item: made.id }] };
}

/** Melts one of a kind on the rack for acorns (`meltValue`): a component 1, a finished item or an emblem 3, a tool 2. */
export function melt(run: RunView, item: RackItem): Done {
  const stop = notPlanning(run);
  if (stop) return refusal(stop);
  if (countOn(run.rack, item) === 0) return refusal("no_such_item");
  const acorns = meltValue(item);
  run.rack = counted(run.rack, item, -1);
  run.acorns += acorns;
  return { ok: true, notes: [{ t: "melted", item, acorns }] };
}

/**
 * Why a tool on the rack cannot be dropped on the figure at a spot, or null if it can: what a page
 * may say before Leaf answers, even of a tool whose outcome it cannot know.
 */
export function toolRefusal(run: RunView, tool: ToolId, to: Spot): Refused | null {
  const on = toolOn(run, tool, to);
  return "ok" in on ? on : null;
}

/** The figure at a spot a tool on the rack is dropped on, or why it cannot be. */
function toolOn(run: RunView, tool: ToolId, to: Spot): Piece | Refused {
  const stop = notPlanning(run);
  if (stop) return refusal(stop);
  if (countOn(run.rack, tool) === 0) return refusal("no_such_item");
  const piece = pieceAt(run, to);
  if (!piece) return refusal("nobody_there");
  if (piece.items.length === 0) return refusal("holds_nothing");
  // A Whetstone leaves emblems as they are: on a figure holding nothing else it would do nothing.
  if (tool === "whetstone" && piece.items.every((i) => sortOf(i) === "emblem")) return refusal("only_emblems");
  return piece;
}

/** The Tongs dropped on a figure: everything it holds goes back to the rack as it is, and the Tongs are gone. */
export function useTongs(run: RunView, to: Spot): Done {
  const piece = toolOn(run, "tongs", to);
  if ("ok" in piece) return piece;
  const items = piece.items;
  run.rack = withAll(counted(run.rack, "tongs", -1), items);
  piece.items = [];
  return { ok: true, notes: [{ t: "tongs", piece: piece.id, items: items.slice() }] };
}

/**
 * What an item a figure holds may become under a Whetstone: another component for a component,
 * another finished item for a finished one, as the catalogue has them open, granting nothing its
 * holder carries by itself or by what else it holds (`rest`). An emblem stays: it is its charm's.
 */
function whetted(cat: Catalog, kind: Piece["kind"], item: ItemId, rest: readonly ItemId[]): ItemId[] {
  const sort = sortOf(item);
  if (sort === "emblem") return [];
  // Components as every draw has them: never one that turns up only elsewhere (the Knife).
  const open = sort === "component" ? drawnComponents(cat) : cat.ids.finished;
  return open.filter((id) => {
    const grants = grantOf(cat, id);
    return id !== item && (grants === undefined || !carries(cat, kind, rest, grants));
  });
}

/**
 * A Whetstone dropped on a figure: each component and finished item it holds becomes another of its
 * sort, place by place, by the run's dice; an emblem stays, as does one with nothing it may become.
 * The Whetstone is gone. Leaf's to do: it draws.
 */
export function useWhetstone(run: Run, to: Spot): Done {
  const piece = toolOn(run, "whetstone", to);
  if ("ok" in piece) return piece;
  const cat = catalogOf(run);
  const was = piece.items.slice();
  const now = was.slice();
  now.forEach((item, i) => {
    const could = whetted(cat, piece.kind, item, now.toSpliced(i, 1));
    if (could.length > 0) now[i] = pick(run, could);
  });
  run.rack = counted(run.rack, "whetstone", -1);
  piece.items = now;
  return { ok: true, notes: [{ t: "whetted", piece: piece.id, was, now: now.slice() }] };
}
