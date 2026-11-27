/**
 * How a piece stands, in the words every kind shares: the states (`STATES`, a number each, with
 * `TROUBLE` added while it is in trouble), a thing held ready with nowhere to go, what a holder
 * holds, and what a piece does a minute (`rateOf`). `status.ts` asks each kind how it stands; this
 * is what the kinds say it with.
 */
import type { Item, Recipe } from "../tables.ts";
import type { Yard } from "../yard.ts";
import type { Kit } from "./kit.ts";

/** How a thing stands: doing its job, with nothing to do just now, or in trouble that will not mend itself. */
export const STATES = [
  "working",
  "carrying",
  "giving",
  "idle",
  "waiting",
  "blocked",
  "starved",
  "unpowered",
  "cold",
  "shut",
] as const;
export type State = (typeof STATES)[number];

/** How `condition` says a piece stands: its state's place in `STATES`, with this added while it is in trouble. */
export const TROUBLE = 16;
/** A state as `condition` gives it. */
export const as = (st: State, trouble = false): number => STATES.indexOf(st) + (trouble ? TROUBLE : 0);

/** What is said of a piece that gives power where none is used, and of a machine where power does not reach. */
export const UNLINKED = "Not connected to a pylon, so the power it makes is not used.";
export const NO_POWER = "No power here. Place a pylon near it.";

/** How a pile of a thing is spoken of: "planks". */
export const many = (k: Kit, n: Item): string => k.ITEM_INFO[n]?.many ?? "";
/** Things in words: "planks, ingots and pots". */
export function list(k: Kit, items: readonly Item[]): string {
  const names = items.map((n) => many(k, n));
  const last = names.pop() ?? "";
  return names.length ? `${names.join(", ")} and ${last}` : last;
}
export const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
/** A number as a thing, or nothing where it is none. */
export const asItem = (k: Kit, n: number): Item | null => (k.isItem(n) ? n : null);

/** What a holder's row holds, as words: "3 planks and 1 pot". */
export function holding(k: Kit, y: Yard, r: number): string {
  const parts = k.ALL_ITEMS.flatMap((n) => {
    const c = k.held(y.holders, r, n);
    return c > 0 ? [`${c} ${c === 1 ? (k.ITEM_INFO[n]?.name ?? "").toLowerCase() : many(k, n)}`] : [];
  });
  const last = parts.pop() ?? "";
  return parts.length ? `${parts.join(", ")} and ${last}` : last || "nothing";
}

/** ", at 75% of its pace: the yard is short of power", or nothing while it has power enough. */
export function slow(k: Kit, y: Yard): string {
  const share = k.pace(y);
  return share < 1 ? `, at ${Math.floor(share * 100)}% of its pace: the yard is short of power` : "";
}

/** Whether the piece at `to` could ever take a thing from the tile `i`, handed it there: by that side, and that thing. A full belt or machine still counts. */
const takes = (k: Kit, y: Yard, i: number, to: number, n: Item): boolean => k.takes(y, to, i) && k.wants(y, to, n);

/** Whether what stands where a piece sends a thing could ever take it: yes, nothing stands there, or never. */
function takenAhead(k: Kit, y: Yard, i: number, n: Item): "yes" | "nothing" | "never" {
  const ways = k.waysOf(y.kind[i] ?? k.NONE);
  const sends = ways > 0 ? k.sendsOf(y, i, n) : 1;
  let found: "nothing" | "never" = "nothing";
  for (let w = 0; w < Math.max(1, ways); w++) {
    if (((sends >> w) & 1) === 0) continue;
    const to = ways > 0 ? k.wayOut(y, i, w) : k.nextOf(y, i);
    if (to < 0 || (y.kind[to] ?? k.NONE) === k.NONE) continue;
    found = "never";
    if (takes(k, y, i, to, n)) return "yes";
  }
  return found;
}

/** The state of a piece holding a thing ready with nowhere to go: waiting if what stands there takes it, else blocked. */
export const stuckAs = (k: Kit, y: Yard, i: number, n: Item): number =>
  takenAhead(k, y, i, n) === "yes" ? as("waiting") : as("blocked", true);

/** Why a thing held ready has nowhere to go, in words: what stands ahead never takes it, or nothing does. */
export function nowhere(k: Kit, y: Yard, i: number, n: Item): string {
  if (takenAhead(k, y, i, n) === "never") return `The piece it points at does not take ${many(k, n)}.`;
  // Only a splitter has ways to shut, or to take things in by.
  const shut = y.shut[i] ?? 0;
  const closed = shut | (y.ins[i] ?? 0);
  const why =
    closed === 7
      ? shut === 7
        ? "all 3 ways are shut"
        : "every way is shut or takes things in"
      : `nothing is on ${closed ? "any way that is open" : "the tile it points at"}`;
  return `Nowhere to send its ${many(k, n)}: ${why}.`;
}

/**
 * What a gatherer, a machine or a Study does a minute (the planner's `makes`), as every screen says
 * it: what it turns out (or a Study takes in) at full power, for `recipe` (a machine's); the share of
 * ticks it works, none where power does not reach and else the yard's pace; what it does now at
 * that share; and the power it draws now, its grade's where power reaches it and none where it does
 * not. Anything else does nothing a minute.
 */
export interface MachineRate {
  readonly nominal: number;
  readonly share: number;
  readonly effective: number;
  readonly draw: number;
}

export function rateOf(k: Kit, y: Yard, i: number, recipe: Recipe | null): MachineRate {
  const kind = i < 0 ? k.NONE : (y.kind[i] ?? k.NONE);
  const grade = y.grade[i] ?? 0;
  const lit = kind !== k.NONE && k.litOf(y)[i] === 1;
  const share = lit ? k.pace(y) : 0;
  const own = k.isKind(kind) && (k.WORK_OF[kind] ?? 0) > 0;
  const nominal = own ? k.makes(kind, grade, null) : k.isMaker(kind) && recipe ? k.makes(recipe.by, grade, recipe) : 0;
  return { nominal, share, effective: nominal * share, draw: lit ? k.drawnAt(kind, grade) / k.HALF : 0 };
}
