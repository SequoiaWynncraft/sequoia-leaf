/**
 * The rack as a run keeps it: how many of each kind lie on it, never a list of them, so that a rack
 * a run has filled for hundreds of rooms is as small as one with a handful on it. A kind there is
 * none of is not in it, and its kinds are always in one order (`RACK_IDS`: components, finished
 * items, emblems, tools), so two racks with the same on them are the same rack.
 *
 * Everything that puts something on the rack or takes it off goes through `counted`.
 */
import { isItemId, type ItemId } from "./content/items.ts";
import { isToolId, RACK_IDS, type RackItem } from "./content/tools.ts";

/**
 * What the rack's own commands say happened: something melted for acorns by the member's hand
 * (`melt`); Tongs took everything a figure held back to the rack; a Whetstone turned each component
 * and finished item a figure held into another of its sort (`was` became `now`, place by place).
 */
export type RackNote =
  | { t: "melted"; item: RackItem; acorns: number }
  | { t: "tongs"; piece: number; items: ItemId[] }
  | { t: "whetted"; piece: number; was: ItemId[]; now: ItemId[] };

/** How many of each kind lie on the rack. */
export type Rack = Readonly<Partial<Record<RackItem, number>>>;

export const isRackItem = (v: unknown): v is RackItem => isItemId(v) || isToolId(v);

/** How many of a kind lie on the rack. */
export const countOn = (rack: Rack, id: RackItem): number => rack[id] ?? 0;

/** The kinds on the rack, in its order. */
export const kindsOn = (rack: Rack): RackItem[] => RACK_IDS.filter((id) => countOn(rack, id) > 0);

/** How many things lie on the rack in all. */
export const rackSize = (rack: Rack): number => kindsOn(rack).reduce((n, id) => n + countOn(rack, id), 0);

/** The rack with `by` more of a kind on it (fewer, for less than 0; never below none), in its order. */
export function counted(rack: Rack, id: RackItem, by: number): Rack {
  const out: Partial<Record<RackItem, number>> = {};
  for (const kind of RACK_IDS) {
    const n = countOn(rack, kind) + (kind === id ? by : 0);
    if (n > 0) out[kind] = n;
  }
  return out;
}

/** The rack with each of a list of things put on it. */
export const withAll = (rack: Rack, items: readonly RackItem[]): Rack =>
  items.reduce((r, item) => counted(r, item, 1), rack);

/** A rack from a list of what lies on it (as a run kept it before its rack was counts). */
export const rackOf = (items: readonly RackItem[]): Rack => withAll({}, items);
