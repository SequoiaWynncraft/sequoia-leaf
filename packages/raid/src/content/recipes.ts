/**
 * Recipes: what two items make when they meet, on one figure or on the rack. A recipe is the `made`
 * of what it makes, an item (`ItemSpec.made`) or a boon (`BoonSpec.made`), so `combine` is the only
 * maker: handing an item over (`holdItem`), the rack's forge, a merge's hand-over, the bot, the
 * almanac and the Make preview all ask it. Words and numbers stay where the things are written.
 */
import type { BoonId } from "./boons.ts";
import type { Catalog } from "./catalog.ts";
import type { UnitKind } from "./figures.ts";
import {
  carries,
  type ComponentId,
  type FinishedId,
  HOLDS,
  isComponentId,
  isFinishedId,
  ITEM_IDS,
  type ItemId,
} from "./items.ts";

/** What a recipe makes: an item, held where the two met; or a boon, the run's from then on (Knife and Knife: An Extra Chair). */
export type Made = { readonly gives: "item"; readonly id: ItemId } | { readonly gives: "boon"; readonly id: BoonId };

/** Each catalogue's recipes, both ways round, made the first time they are asked for. */
const RECIPES = new WeakMap<Catalog, ReadonlyMap<string, Made>>();
const pair = (a: string, b: string): string => `${a}+${b}`;

function recipesOf(cat: Catalog): ReadonlyMap<string, Made> {
  const known = RECIPES.get(cat);
  if (known) return known;
  const out = new Map<string, Made>();
  const add = (halves: readonly [ComponentId, ComponentId] | undefined, made: Made): void => {
    if (!halves) return;
    const [a, b] = halves;
    const was = out.get(pair(a, b));
    if (was) throw new Error(`${a} and ${b} make both ${was.id} and ${made.id} at era ${cat.era}`);
    out.set(pair(a, b), made);
    out.set(pair(b, a), made);
  };
  for (const id of ITEM_IDS) add(cat.items[id]?.made, { gives: "item", id });
  for (const id of cat.ids.boons) add(cat.boons[id]?.made, { gives: "boon", id });
  RECIPES.set(cat, out);
  return out;
}

/** What two items make together, either way round, by the recipes a catalogue has open; null for nothing. */
export const combine = (cat: Catalog, a: ItemId, b: ItemId): Made | null => recipesOf(cat).get(pair(a, b)) ?? null;
/** The finished item something made, if it made one: what the almanac counts as forged. */
export const forgedOf = (made: Made | null): FinishedId | null =>
  made?.gives === "item" && isFinishedId(made.id) ? made.id : null;

/** Why an item cannot be held: no place for it, or it grants a trait its holder carries already. */
export type NotHeld = "hands_full" | "already_kin";
/** What a figure holds after an item is handed to it, what the item made with one it held, and with which. */
export interface Held {
  readonly held: ItemId[];
  readonly made: Made | null;
  /** The item made, if an item was. */
  readonly forged: ItemId | null;
  readonly with: ComponentId | null;
}
/** Whoever holds items, as far as handing one over goes. */
type Holder = { readonly kind: UnitKind; readonly items: readonly ItemId[] };
/** Whether an item grants a trait its holder carries already, by what else it holds (`held`) or its own. */
function clashes(cat: Catalog, kind: UnitKind, held: readonly ItemId[], item: ItemId): boolean {
  const grants = cat.items[item]?.grants;
  return grants !== undefined && carries(cat, kind, held, grants);
}
/**
 * Puts one more item into what a figure holds, the way handing it over does: it meets the first item
 * already held that it combines with, and the two become what they make (an item in that place, or
 * a boon, which leaves both places); otherwise it takes a free place. Nothing ends up held that
 * grants a trait its holder carries already. Gives the new holding and what was made, or why it
 * cannot be held. A boon made is the caller's to give the run.
 */
export function holdItem(cat: Catalog, holder: Holder, item: ItemId): Held | { refused: NotHeld } {
  const held = holder.items;
  const at = held.findIndex((other) => combine(cat, other, item) !== null);
  const other = held[at];
  const made = other === undefined ? null : combine(cat, other, item);
  if (made === null) {
    if (clashes(cat, holder.kind, held, item)) return { refused: "already_kin" };
    if (held.length >= HOLDS) return { refused: "hands_full" };
    return { held: [...held, item], made, forged: null, with: null };
  }
  const rest = held.toSpliced(at, 1);
  const kept = made.gives === "item" ? made.id : null;
  if (kept !== null && clashes(cat, holder.kind, rest, kept)) return { refused: "already_kin" };
  return {
    held: kept === null ? rest : held.with(at, kept),
    made,
    forged: kept,
    with: isComponentId(other) ? other : null,
  };
}
