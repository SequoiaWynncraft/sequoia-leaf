/**
 * How a piece stands, in the words every kind shares: the states (`STATES`, a number each, with
 * `TROUBLE` added while it is in trouble), a thing held ready with nowhere to go, what a holder
 * holds, and what a piece does a minute (`rateOf`). `status.ts` asks each kind how it stands; this
 * is what the kinds say it with.
 */
import type { Item, Recipe } from "../tables.ts";
import type { Yard } from "../yard.ts";
import type { Words } from "./kind.ts";
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
 * more sends from each way out that sends its finished thing (or, with `also`, its by-product), and
 * sends `n` (a way for one thing only sends that thing).
 */
function sendings(k: Kit, y: Yard, i: number, n: Item, also: boolean): { from: number; to: number }[] {
  const outs = k.outsOf(y, i);
  if (outs.length > 0)
    return outs.flatMap((o, p) =>
      o.also === also && k.sendsThing(o, n) ? [{ from: i + o.dx + o.dy * y.land.w, to: k.portTo(y, i, p) }] : [],
    );
  const ways = k.waysOf(y.kind[i] ?? k.NONE);
  if (ways === 0) return [{ from: i, to: k.nextOf(y, i) }];
  const sends = k.sendsOf(y, i, n);
  return [0, 1, 2].filter((w) => w < ways && ((sends >> w) & 1) === 1).map((w) => ({ from: i, to: k.wayOut(y, i, w) }));
}

/**
 * Whether what stands where a piece sends a thing could ever take it, from the tile it leaves by: yes,
 * nothing stands there, or never. A full belt or machine still counts; a crate full and shut never takes.
 */
function takenAhead(k: Kit, y: Yard, i: number, n: Item, also = false): "yes" | "nothing" | "never" {
  let found: "nothing" | "never" = "nothing";
  for (const { from, to } of sendings(k, y, i, n, also)) {
    if (to < 0 || (y.kind[to] ?? k.NONE) === k.NONE) continue;
    found = "never";
    if (k.takes(y, to, from) && k.wants(y, to, n) && !fullAndShut(k, y, to)) return "yes";
  }
  return found;
}

/** The state of a piece holding a thing ready with nowhere to go (with `also`, its by-product): waiting if what stands there takes it, else blocked. */
export const stuckAs = (k: Kit, y: Yard, i: number, n: Item, also = false): number =>
  takenAhead(k, y, i, n, also) === "yes" ? as("waiting") : as("blocked", true);

/**
 * Whether the line a piece sends a thing into (with `also`, its by-product) has stopped: every tile of
 * it ahead holds a thing at the end of its tile, waiting, up to one that is blocked (in trouble). A
 * line with room on any tile, or that runs into a piece that is not a line, still moves. Each line is
 * followed no further than the land has tiles.
 */
export function jammedAhead(k: Kit, y: Yard, i: number, n: Item, also = false): boolean {
  for (const { to } of sendings(k, y, i, n, also)) {
    let t = to;
    for (let step = 0; step < y.kind.length && t >= 0 && k.carries(y.kind[t] ?? k.NONE); step++) {
      const held = y.item[t] ?? k.NONE;
      if (!k.isItem(held) || (y.prog[t] ?? 0) < 8 || k.tunnelOf(y, t) >= 0) break;
      if (stuckAs(k, y, t, held) !== as("waiting")) return true;
      t = k.nextOf(y, t);
    }
  }
  return false;
}

/** Whether the piece on a tile holds things, is shut and can take no more: a crate, which alone shuts. */
function fullAndShut(k: Kit, y: Yard, i: number): boolean {
  const r = i < 0 ? -1 : k.holderOf(y, i);
  const h = y.holders;
  return r >= 0 && h.open[r] === 0 && (h.count[r] ?? 0) + (h.out[r] === k.NONE ? 0 : 1) >= y.open.crate;
}

/** The name of the way out of a piece of more than one tile that sends a thing it holds ready (`Out.name`): "left", "middle", "right". */
export function wayFor(k: Kit, y: Yard, i: number, n: Item, also = false): string {
  return k.outsOf(y, i).find((o) => o.also === also && k.sendsThing(o, n))?.name ?? "";
}

/**
 * How a piece of more than one tile stands while it holds a finished thing `out` (a still, a grower):
 * waiting while what stands ahead of its way out takes it and the line there still moves; else
 * stopped, in trouble, with nowhere ahead to take it or the line ahead stopped.
 */
export function heldAs(k: Kit, y: Yard, i: number, out: Item): number {
  const stuck = stuckAs(k, y, i, out);
  return stuck === as("waiting") && !jammedAhead(k, y, i, out) ? stuck : as("blocked", true);
}

/**
 * Its words for that (`heldAs`): stopped, which thing cannot leave by which way out, and `until`, what
 * it does not do until it has; or waiting for room ahead, by that way out.
 */
export function heldWords(k: Kit, y: Yard, i: number, state: string, out: Item, until: string): Words {
  const way = wayFor(k, y, i, out);
  return state === "blocked"
    ? { line: `Stopped: its ${many(k, out)} cannot leave by its ${way} way out. ${until}`, stuck: out }
    : { line: `Waiting: no room ahead for its ${many(k, out)}, by its ${way} way out.` };
}

/** The sink a thing held ready would go into and that never takes it, as named: "the depot", "the cart stop"; or nothing. */
function refusingSink(k: Kit, y: Yard, i: number, n: Item, also: boolean): string | null {
  if (k.ITEM_INFO[n]?.unsold !== true) return null;
  for (const { to } of sendings(k, y, i, n, also)) {
    const kind = to < 0 ? k.NONE : (y.kind[to] ?? k.NONE);
    if (k.SINKS[kind] === 1) return `the ${(k.KIND_INFO[kind]?.name ?? "").toLowerCase()}`;
  }
  return null;
}

/**
 * Why what stands where a thing held ready would go refuses it, in its own words: a sink that does not
 * take what the town does not buy (charged cells of every bars spoken of together), or a piece whose
 * kind says more (a launch pad, which takes only charged cells); or nothing.
 */
function refusedBy(k: Kit, y: Yard, i: number, n: Item, also: boolean): string | null {
  const sink = refusingSink(k, y, i, n, also);
  if (sink !== null && k.CHARGED.bars.includes(n))
    return `Charged cells have nowhere to go: ${sink} does not take them.`;
  if (sink !== null) return `${k.ITEM_INFO[n]?.name ?? ""} has nowhere to go: ${sink} does not take it.`;
  for (const { to } of sendings(k, y, i, n, also)) {
    const why = k.wants(y, to, n) ? null : k.refusing(y, to, n);
    if (why !== null) return why;
  }
  return null;
}

/** Why a thing held ready (with `also`, a by-product) has nowhere to go, in words: what stands ahead never takes it, or nothing does. */
export function nowhere(k: Kit, y: Yard, i: number, n: Item, also = false): string {
  const refused = refusedBy(k, y, i, n, also);
  if (refused !== null) return refused;
  if (sendings(k, y, i, n, also).some(({ to }) => fullAndShut(k, y, to)))
    return "The crate it points at is full and shut.";
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
 * What a gatherer, a machine, a Study or a piece that breaks a mix does a minute (the planner's
 * `makes`), as every screen says it: what it turns out (or a Study takes in) at full power, for
 * `recipe` (a machine's; `flatOut`); the share of its pace it works at, none where power does not
 * reach and else the yard's pace and its plot's smog's; what it does now at that share; and the power
 * it draws now, its grade's where power reaches it and none where it does not. Anything else does
 * nothing a minute.
 *
 * What it does now is no more than the belt it hands to carries (`most`, null where that is not
 * less): a piece that makes faster than that (an assembler, a breaker) waits for room on it the rest
 * of the time.
 */
export interface MachineRate {
  readonly nominal: number;
  readonly share: number;
  readonly effective: number;
  readonly draw: number;
  /** What the belt (or what else carries) it hands to carries a minute, where that keeps it to less than it would make; else null. */
  readonly most: number | null;
}

/** What a tile carries a minute, if something that carries stands there: else no limit. */
function carriedAt(k: Kit, y: Yard, to: number): number {
  const there = to < 0 ? k.NONE : (y.kind[to] ?? k.NONE);
  return k.carries(there) ? k.carried(y.grade[to] ?? 1) : Infinity;
}

/**
 * The most a piece can turn out a minute for what it hands to carry it: what the tile it hands to
 * carries; for one whose ways out each send one thing of its mix (a still's), the least of each way's
 * belt over that thing's share of the mix, as the slowest way holds all of it back.
 */
function carriedAhead(k: Kit, y: Yard, i: number): number {
  if (i < 0) return Infinity;
  const outs = k.outsOf(y, i);
  const kind = y.kind[i] ?? k.NONE;
  // One that grows gives more than one a run, on the whole (`grownPerRun`): 3 for every 2 of a grower's.
  const grown = k.isKind(kind) ? k.grownPerRun(kind) : 0;
  if (grown > 0) return carriedAt(k, y, k.nextOf(y, i)) / grown;
  if (!k.isKind(kind) || outs.length === 0 || outs[0]?.only === k.NONE) return carriedAt(k, y, k.nextOf(y, i));
  let most = Infinity;
  for (let p = 0; p < outs.length; p++) {
    const only = outs[p]?.only ?? k.NONE;
    const share = k.isItem(only) ? k.mixShare(kind, only) : 0;
    if (share > 0) most = Math.min(most, carriedAt(k, y, k.portTo(y, i, p)) / share);
  }
  return most;
}

/**
 * What the piece of a kind at a grade on the tile `i` turns out a minute flat out, for `recipe` (a
 * machine's): a gatherer what lies under it, at that thing's own pace (`gathers`); a Study its own
 * pace's worth; a thing a run for one that breaks a mix (`mixPerMinute`); runs, for one that grows a
 * thing (`growPerMinute`); or its recipe's; else nothing.
 */
function flatOut(k: Kit, y: Yard, i: number, kind: number, grade: number, recipe: Recipe | null): number {
  if (!k.isKind(kind)) return 0;
  if (kind === k.GATHERING) return k.gathers(y.land.deposit[i] ?? k.NONE, grade);
  if ((k.WORK_OF[kind] ?? 0) > 0) return k.makes(kind, grade, null);
  if (k.MIX_OF[kind]) return k.mixPerMinute(kind, grade);
  if (k.GROW_OF[kind]) return k.growPerMinute(kind, grade);
  return k.isMaker(kind) && recipe ? k.makes(kind, grade, recipe) : 0;
}

export function rateOf(k: Kit, y: Yard, i: number, recipe: Recipe | null): MachineRate {
  const kind = i < 0 ? k.NONE : (y.kind[i] ?? k.NONE);
  const grade = y.grade[i] ?? 0;
  const lit = kind !== k.NONE && k.litAt(y, i);
  const share = lit ? k.pace(y) * k.smogPace(y, i) : 0;
  const nominal = flatOut(k, y, i, kind, grade, recipe);
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
