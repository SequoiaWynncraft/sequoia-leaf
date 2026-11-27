/**
 * Tools: things on the rack that no figure holds. Each is used once, by dropping it on a figure, and
 * is gone after. Tongs take back what a figure holds; a Whetstone turns each item it holds into
 * another of the same sort, by the run's dice. What they do is in `rack.ts`; where they come from,
 * `run.ts` (the picks after a room) and the carousel's ring.
 *
 * And what anything on the rack melts for (`melt`): a sink for surplus, only ever by the member's hand.
 */
import type { Catalog } from "./catalog.ts";
import { ITEM_IDS, type ItemId, itemName, sortOf } from "./items.ts";

export const TOOL_IDS = ["tongs", "whetstone"] as const;
export type ToolId = (typeof TOOL_IDS)[number];
/** Anything that can lie on the rack: an item of any sort, or a tool. */
export type RackItem = ItemId | ToolId;

export interface ToolSpec {
  readonly name: string;
  /** What it does, in a sentence. */
  readonly text: string;
  readonly quip: string;
}

export const TOOLS: Readonly<Record<ToolId, ToolSpec>> = {
  tongs: {
    name: "Tongs",
    text: "Drop on a figure: everything it holds goes back to the rack as it is.",
    quip: "For things too hot to hold by hand.",
  },
  whetstone: {
    name: "Whetstone",
    text: "Drop on a figure: each item it holds becomes another of the same sort, at random.",
    quip: "Same blade, other edge.",
  },
};

export const isToolId = (v: unknown): v is ToolId => TOOL_IDS.some((id) => id === v);
/**
 * Every kind that may lie on the rack, any release's, in the one order a rack keeps them
 * (`racks.ts`): components, finished items, emblems, tools. Only an order, never what is open.
 */
export const RACK_IDS: readonly RackItem[] = [...ITEM_IDS, ...TOOL_IDS];
/** What anything on the rack is called. */
export const rackName = (cat: Catalog, id: RackItem): string => (isToolId(id) ? TOOLS[id].name : itemName(cat, id));
/** What a tool, or an item, is: its own sort, or a tool. */
export const rackSortOf = (id: RackItem): "component" | "finished" | "emblem" | "tool" =>
  isToolId(id) ? "tool" : sortOf(id);

/** What anything on the rack melts for, in acorns, by its sort. */
export const MELT = { component: 1, finished: 3, emblem: 3, tool: 2 } as const;
export const meltValue = (id: RackItem): number => MELT[rackSortOf(id)];

/**
 * How tools turn up, first guesses for the sims, each "one in so many": a boss room's picks have a
 * tool in place of one component one time in `boss`; a trouble room's pick is of tools instead of
 * components one time in `trouble`; and in an endless run past room `endlessPast`, every
 * `endlessEvery`th room's pick is of tools. One figure of each carousel at a live table holds Tongs.
 */
export const TOOL_ODDS = { boss: 2, trouble: 10, endlessPast: 15, endlessEvery: 10 } as const;
