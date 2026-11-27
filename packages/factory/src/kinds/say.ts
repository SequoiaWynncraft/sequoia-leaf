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

/**
 * ", at 75% of its pace: the yard is short of power" for the piece on its own tile `i`, then ", at 50%
 * of its pace: smog on this plot" (`smog.ts`); nothing while it has power enough and clean air.
 */
export function slow(k: Kit, y: Yard, i: number): string {
  const share = k.pace(y);
  const smog = k.smogPace(y, i);
  const power = share < 1 ? `, at ${Math.floor(share * 100)}% of its pace: the yard is short of power` : "";
  return smog < 1 ? `${power}, at ${Math.floor(smog * 100)}% of its pace: smog on this plot` : power;
}

/**
 * Where the piece on its own tile `i` sends a thing held ready: each tile it leaves from and the tile it
 * goes to. One of one tile sends from its tile, ahead or by the ways it sends the thing `n` by; one of
 * more sends from each way out that sends its finished thing (or, with `also`, its by-product).
 */
function sendings(k: Kit, y: Yard, i: number, n: Item, also: boolean): { from: number; to: number }[] {
  const outs = k.outsOf(y, i);
  if (outs.length > 0)
    return outs.flatMap((o, p) =>
      o.also === also ? [{ from: i + o.dx + o.dy * y.land.w, to: k.portTo(y, i, p) }] : [],
    );
  const ways = k.waysOf(y.kind[i] ?? k.NONE);
  if (ways === 0) return [{ from: i, to: k.nextOf(y, i) }];
  const sends = k.sendsOf(y, i, n);
  return [0, 1, 2].filter((w) => w < ways && ((sends >> w) & 1) === 1).map((w) => ({ from: i, to: k.wayOut(y, i, w) }));
}

/**
 * Whether what stands where a piece sends a thing could ever take it, from the tile it leaves by: yes,
 * nothing stands there, or never. A full belt or machine still counts.
 */
function takenAhead(k: Kit, y: Yard, i: number, n: Item, also = false): "yes" | "nothing" | "never" {
  let found: "nothing" | "never" = "nothing";
  for (const { from, to } of sendings(k, y, i, n, also)) {
    if (to < 0 || (y.kind[to] ?? k.NONE) === k.NONE) continue;
    found = "never";
    if (k.takes(y, to, from) && k.wants(y, to, n)) return "yes";
  }
  return found;
}

/** The state of a piece holding a thing ready with nowhere to go (with `also`, its by-product): waiting if what stands there takes it, else blocked. */
export const stuckAs = (k: Kit, y: Yard, i: number, n: Item, also = false): number =>
  takenAhead(k, y, i, n, also) === "yes" ? as("waiting") : as("blocked", true);

/** The sink a thing held ready would go into and that never takes it, as named: "the depot", "the cart stop"; or nothing. */
function refusingSink(k: Kit, y: Yard, i: number, n: Item, also: boolean): string | null {
  if (k.ITEM_INFO[n]?.unsold !== true) return null;
  for (const { to } of sendings(k, y, i, n, also)) {
    const kind = to < 0 ? k.NONE : (y.kind[to] ?? k.NONE);
    if (k.SINKS[kind] === 1) return `the ${(k.KIND_INFO[kind]?.name ?? "").toLowerCase()}`;
  }
  return null;
}

/** Why a thing held ready (with `also`, a by-product) has nowhere to go, in words: what stands ahead never takes it, or nothing does. */
export function nowhere(k: Kit, y: Yard, i: number, n: Item, also = false): string {
  const sink = refusingSink(k, y, i, n, also);
  if (sink !== null) return `${k.ITEM_INFO[n]?.name ?? ""} has nowhere to go: ${sink} does not take it.`;
  if (takenAhead(k, y, i, n, also) === "never") return `The piece it points at does not take ${many(k, n)}.`;
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
 *
 * What it does now is no more than the belt it hands to carries (`most`, null where that is not
 * less): a piece that makes faster than that (an assembler) waits for room on it the rest of the time.
 */
export interface MachineRate {
  readonly nominal: number;
  readonly share: number;
  readonly effective: number;
  readonly draw: number;
  /** What the belt (or what else carries) it hands to carries a minute, where that keeps it to less than it would make; else null. */
  readonly most: number | null;
}

/** What the tile a piece hands to carries a minute, if something that carries stands there: else no limit. */
function carriedAhead(k: Kit, y: Yard, i: number): number {
  const to = i < 0 ? -1 : k.nextOf(y, i);
  const there = to < 0 ? k.NONE : (y.kind[to] ?? k.NONE);
  return k.carries(there) ? k.carried(y.grade[to] ?? 1) : Infinity;
}

export function rateOf(k: Kit, y: Yard, i: number, recipe: Recipe | null): MachineRate {
  const kind = i < 0 ? k.NONE : (y.kind[i] ?? k.NONE);
  const grade = y.grade[i] ?? 0;
  const lit = kind !== k.NONE && k.litAt(y, i);
  const share = lit ? k.pace(y) * k.smogPace(y, i) : 0;
  const own = k.isKind(kind) && (k.WORK_OF[kind] ?? 0) > 0;
  const nominal = own
    ? k.makes(kind, grade, null)
    : k.isKind(kind) && k.isMaker(kind) && recipe
      ? k.makes(kind, grade, recipe)
      : 0;
  const ahead = nominal > 0 ? carriedAhead(k, y, i) : Infinity;
  const effective = Math.min(nominal * share, ahead);
  return {
    nominal,
    share,
    effective,
    draw: lit ? k.drawnAt(kind, grade) / k.HALF : 0,
    most: nominal * share > ahead ? ahead : null,
  };
}
