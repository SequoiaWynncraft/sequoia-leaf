/**
 * How a piece in the yard stands, and whether it is in trouble: decided in one place (`condition`,
 * a number, making nothing, so that a screen can ask it of every piece in view each frame), and put
 * in a sentence for a screen to show (`status`, which words what `condition` decides). Nothing here
 * changes the yard but working out its power and plumbing if a change left them unknown.
 */
import { BUFFER, FUEL, REACH, TICKS } from "./content/machines.ts";
import { MINUTE } from "./planner.ts";
import { litOf } from "./power.ts";
import {
  ALL_ITEMS,
  BELT,
  BENCH,
  BOILER,
  CRATE,
  DEADFALL,
  DEPOT,
  FOLIOS,
  GATHERER,
  GIVES,
  GOALS,
  isFolio,
  isItem,
  isMaker,
  type Item,
  ITEM_INFO,
  JOINER,
  MILL,
  NONE,
  PACE,
  PYLON,
  RECIPE,
  type Recipe,
  SORTER,
  SPAN_MOST,
  SPLITTER,
  STOP,
  STUDY,
  TUNNEL,
  WHEEL,
  WORK,
  WORKSHOP,
} from "./tables.ts";
import {
  ahead,
  carries,
  closedWays,
  nextOf,
  power,
  rewire,
  sortWay,
  takes as takesFrom,
  wayIn,
  wayOut,
} from "./wire.ts";
import { type Counts, held, holderOf, tunnelOf, type Yard } from "./yard.ts";

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

export interface Status {
  readonly state: State;
  readonly line: string;
  readonly trouble: boolean;
  /** For a machine that has filled up with one part while it waits for another: the part to tip out. */
  readonly spare?: Item;
  /** What a machine is waiting for. */
  readonly missing?: readonly Item[];
}

const many = (n: Item): string => ITEM_INFO[n]?.many ?? "";
const list = (items: readonly Item[]): string => {
  const names = items.map(many);
  const last = names.pop() ?? "";
  return names.length ? `${names.join(", ")} and ${last}` : last;
};
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const asItem = (n: number): Item | null => (isItem(n) ? n : null);

/** What a holder's row holds, as words: "3 planks and 1 pot". */
export function holding(y: Yard, r: number): string {
  const parts = ALL_ITEMS.flatMap((k) => {
    const n = held(y.holders, r, k);
    return n > 0 ? [`${n} ${n === 1 ? (ITEM_INFO[k]?.name ?? "").toLowerCase() : many(k)}`] : [];
  });
  const last = parts.pop() ?? "";
  return parts.length ? `${parts.join(", ")} and ${last}` : last || "nothing";
}

/** The recipes a kind of machine may make, as the plumbing has them (`recipesFor`, worked out once a change). */
const recipesOf = (y: Yard, k: number): readonly Recipe[] => (y.wire ?? rewire(y)).recipes[k] ?? [];

/** Whether a holder's row holds nothing a recipe does not use. */
function onlyFor(y: Yard, r: number, rec: Recipe): boolean {
  for (const n of ALL_ITEMS) if (held(y.holders, r, n) > 0 && !rec.from.includes(n)) return false;
  return true;
}

/** The recipe a machine is working toward: the one it is pinned to, or the first that uses everything it holds. */
export function aim(y: Yard, i: number): Recipe | null {
  const k = y.kind[i] ?? NONE;
  if (k !== MILL && k !== BENCH && k !== WORKSHOP) return null;
  const h = y.holders;
  const r = holderOf(y, i);
  if (h.making[r] !== NONE) return RECIPE[h.making[r] ?? NONE] ?? null;
  if (y.set[i] !== NONE) return RECIPE[y.set[i] ?? NONE] ?? null;
  if (h.count[r] === 0) return null;
  for (const rec of recipesOf(y, k)) if (onlyFor(y, r, rec)) return rec;
  return null;
}

/** Whether the piece at `to` could ever take a thing from the tile `i`, handed it there. A full belt or machine still counts. */
function takes(y: Yard, i: number, to: number, n: Item): boolean {
  const k = y.kind[to] ?? NONE;
  if (k === DEPOT || k === STOP || (k === STUDY && isFolio(n))) return true;
  if ((k === BELT || k === CRATE) && ahead(y, to) !== i) return true;
  if ((k === SPLITTER || k === SORTER || (k === TUNNEL && (y.span[to] ?? 0) > 0)) && takesFrom(y, to, i)) return true;
  if (k === JOINER && (wayIn(y, to, 0) === i || wayIn(y, to, 1) === i || wayIn(y, to, 2) === i)) return true;
  const only = y.set[to] ?? NONE;
  if (isMaker(k))
    for (const rec of recipesOf(y, k)) if (rec.from.includes(n) && (only === NONE || only === rec.out)) return true;
  return k === BOILER && n === DEADFALL;
}

/** Whether what stands ahead of a tile could ever take a thing from it: yes, nothing stands there, or never. */
function takenAhead(y: Yard, i: number, n: Item): "yes" | "nothing" | "never" {
  const k0 = y.kind[i];
  const ways = k0 === SPLITTER ? 3 : 1;
  let found: "nothing" | "never" = "nothing";
  for (let w = 0; w < ways; w++) {
    const to =
      k0 === SPLITTER
        ? wayOut(y, i, w)
        : k0 === SORTER
          ? wayOut(y, i, n === y.set[i] ? sortWay(y, i) : 0)
          : nextOf(y, i);
    if (to < 0 || (y.kind[to] ?? NONE) === NONE) continue;
    found = "never";
    if (takes(y, i, to, n)) return "yes";
  }
  return found;
}

/** How many of a thing a gatherer or machine turns out, or folios a Study takes in, in a minute at the yard's present pace, or 0. */
export function rate(y: Yard, i: number): number {
  if (i < 0 || y.kind[i] === NONE || litOf(y)[i] !== 1) return 0;
  const share = power(y).pace;
  const pace = (PACE[y.grade[i] ?? 0] ?? 0) * share * 600;
  if (y.kind[i] === GATHERER) return pace / WORK.gather;
  if (y.kind[i] === STUDY) return pace / WORK.study;
  const r = aim(y, i);
  return r ? pace / r.work : 0;
}

/**
 * What the pieces standing in a yard can make of each thing a minute, and what they need of each a
 * minute to do it: added to `made` and `needed`, which the caller clears. Every gatherer, machine and
 * Study power reaches is taken as working each tick the yard's power lets it (as `rate` takes it),
 * never waiting for a part or for room: so `made` is a ceiling, not a count of anything.
 *
 * A machine is counted for the recipe it is working toward (`aim`). One that holds nothing and is
 * told nothing has none for the moment: where the caller keeps `aimed` (a thing for each tile, `NONE`
 * to begin with), it is counted for the recipe it was last counted for, and this writes there what it
 * counts each machine for. A Study needs the folios the research first in line still wants, in the
 * shares it wants them; a boiler in reach, the deadfall it burns.
 *
 * It runs down the plumbing's lists, so it costs in step with the pieces that work, and makes nothing.
 */
export function flow(y: Yard, made: Counts, needed: Counts, aimed?: Uint8Array): void {
  const wire = y.wire ?? rewire(y);
  const share = power(y).pace;
  const work = wire.work;
  for (let c = 0; c < work.length; c++) {
    const i = work[c] ?? 0;
    const k = y.kind[i] ?? NONE;
    const often = (PACE[y.grade[i] ?? 0] ?? 0) * share * MINUTE;
    if (k === GATHERER) {
      const n = y.land.deposit[i] ?? NONE;
      if (isItem(n)) made[n] = (made[n] ?? 0) + often / WORK.gather;
      continue;
    }
    if (k === STUDY) {
      const g = y.line[0];
      const want = g === undefined ? undefined : GOALS[g]?.want;
      const got = g === undefined ? null : (y.got[g] ?? null);
      if (!want) continue;
      let left = 0;
      for (let f = 0; f < FOLIOS.length; f++) {
        const n = FOLIOS[f] ?? NONE;
        left += Math.max(0, (want[n] ?? 0) - (got?.[n] ?? 0));
      }
      if (left <= 0) continue;
      for (let f = 0; f < FOLIOS.length; f++) {
        const n = FOLIOS[f] ?? NONE;
        const still = Math.max(0, (want[n] ?? 0) - (got?.[n] ?? 0));
        if (still > 0) needed[n] = (needed[n] ?? 0) + ((often / WORK.study) * still) / left;
      }
      continue;
    }
    let rec = aim(y, i);
    if (rec) {
      if (aimed) aimed[i] = rec.out;
    } else {
      const last = aimed ? RECIPE[aimed[i] ?? NONE] : undefined;
      // What was kept for another kind of machine on this tile, or for a recipe it may not make now, is not this one's.
      rec = last && last.by === k && wire.recipes[k]?.includes(last) === true ? last : null;
    }
    if (!rec) continue;
    const batches = often / rec.work;
    made[rec.out] = (made[rec.out] ?? 0) + batches;
    for (let p = 0; p < rec.from.length; p++) {
      const n = rec.from[p] ?? NONE;
      needed[n] = (needed[n] ?? 0) + batches * (rec.need[p] ?? 1);
    }
  }
  needed[DEADFALL] = (needed[DEADFALL] ?? 0) + (wire.boilers.length * MINUTE) / TICKS.burn;
}

/** How `condition` says a piece stands: its state's place in `STATES`, with this added while it is in trouble. */
export const TROUBLE = 16;
const as = (st: State, trouble = false): number => STATES.indexOf(st) + (trouble ? TROUBLE : 0);
/** The state of a thing a piece holds ready with nowhere to go. */
const stuckAs = (y: Yard, i: number, n: Item): number =>
  takenAhead(y, i, n) === "yes" ? as("waiting") : as("blocked", true);

/**
 * How the piece on a tile stands: its state's place in `STATES`, and `TROUBLE` more while it is in
 * trouble; -1 if nothing stands there. The one place either is decided (`status` words it). It
 * makes nothing, so a screen can ask it of every piece in view.
 */
export function condition(y: Yard, i: number): number {
  const k = i < 0 ? NONE : (y.kind[i] ?? NONE);
  if (k === NONE) return -1;
  const lit = litOf(y)[i] === 1;
  const h = y.holders;
  if (k === DEPOT || k === STOP) return as("giving");
  if (k === PYLON || k === WHEEL) return lit ? as("giving") : as("unpowered", true);
  if (carries(k)) {
    const n = y.item[i] ?? NONE;
    // A splitter with every way shut, or taking things in, can send nothing on, whether or not it holds anything yet.
    if (closedWays(y, i) === 7) return as("blocked", true);
    if (!isItem(n)) return underground(y, i) > 0 ? as("carrying") : as("idle");
    if ((y.prog[i] ?? 0) < 8) return as("carrying");
    return tunnelOf(y, i) >= 0 ? as("waiting") : stuckAs(y, i, n);
  }
  const r = holderOf(y, i);
  if (k === BOILER) return !lit ? as("unpowered", true) : (h.fuel[r] ?? 0) > 0 ? as("giving") : as("cold", true);
  if (k === CRATE) return h.open[r] === 1 ? as((h.count[r] ?? 0) > 0 ? "carrying" : "idle") : as("shut");
  if (!lit) return as("unpowered", true);
  if (k === STUDY) {
    const g = y.line[0];
    if (g === undefined) return as("idle");
    for (const n of FOLIOS)
      if ((GOALS[g]?.want[n] ?? 0) > (y.got[g]?.[n] ?? 0) && held(h, r, n) > 0) return as("working");
    return as("waiting");
  }
  const out = h.out[r] ?? NONE;
  if (isItem(out)) return stuckAs(y, i, out);
  if (k === GATHERER || isItem(h.making[r] ?? NONE)) return as("working");
  const rec = aim(y, i);
  if (!rec) return as("idle", (h.count[r] ?? 0) > 0);
  let missing = false;
  let full = false;
  for (let p = 0; p < rec.from.length; p++) {
    const have = held(h, r, rec.from[p] ?? NONE);
    const need = rec.need[p] ?? 1;
    if (have < need) missing = true;
    if (have >= BUFFER * need) full = true;
  }
  return !missing ? as("working") : full ? as("starved", true) : as("waiting");
}

/** How many things are under the ground in the tunnel going in on a tile: 0 for anything else. */
function underground(y: Yard, i: number): number {
  const t = tunnelOf(y, i);
  if (t < 0) return 0;
  let under = 0;
  for (let s = 0; s < (y.span[i] ?? 0); s++) if (y.tunnels.under[t * SPAN_MOST + s] !== NONE) under++;
  return under;
}

/** Why a thing held ready has nowhere to go, in words: what stands ahead never takes it, or nothing does. */
function nowhere(y: Yard, i: number, n: Item): string {
  if (takenAhead(y, i, n) === "never") return `The piece it points at does not take ${many(n)}.`;
  // Only a splitter has ways to shut, or to take things in by.
  const shut = y.shut[i] ?? 0;
  const closed = shut | (y.ins[i] ?? 0);
  const why =
    closed === 7
      ? shut === 7
        ? "all 3 ways are shut"
        : "every way is shut or takes things in"
      : `nothing is on ${closed ? "any way that is open" : "the tile it points at"}`;
  return `Nowhere to send its ${many(n)}: ${why}.`;
}

type Words = Omit<Status, "state" | "trouble">;

/**
 * What the piece on a tile is doing, in a sentence: the state and trouble `condition` decides, and
 * the words for it, with what they name (the part to tip out, what is waited for). Nothing if nothing
 * stands there.
 */
export function status(y: Yard, i: number): Status | null {
  const c = condition(y, i);
  const state = STATES[c % TROUBLE];
  if (c < 0 || state === undefined) return null;
  return { state, trouble: c >= TROUBLE, ...words(y, i, state) };
}

/** The words for how the piece on a tile stands, the state given. */
function words(y: Yard, i: number, state: State): Words {
  const k = y.kind[i] ?? NONE;
  const share = power(y).pace;
  const slow = share < 1 ? `, at ${Math.floor(share * 100)}% of its pace: the yard is short of power` : "";
  const h = y.holders;
  const r = holderOf(y, i);
  const unlinked = "Not connected to a pylon, so the power it makes is not used.";
  if (k === DEPOT) return { line: `Sells every item that reaches it. Makes ${y.open.depot} power.` };
  if (k === STOP) return { line: "Sends every item that reaches it to the depot." };
  if (k === PYLON)
    return {
      line:
        state === "giving"
          ? `Powers the tiles up to ${Math.floor((REACH.pylon * y.open.reach) / 10_000)} tiles from it.`
          : "Not connected. It must be within reach of the depot or of a connected pylon.",
    };
  if (k === WHEEL) return { line: state === "giving" ? `Running. Makes ${GIVES[WHEEL] ?? 0} power.` : unlinked };
  if (k === BOILER) {
    if (state === "unpowered") return { line: unlinked };
    return {
      line:
        state === "giving"
          ? `Running. Makes ${GIVES[BOILER] ?? 0} power. Holds ${held(h, r, DEADFALL)} of ${FUEL} deadfall.`
          : "Out of fuel. It makes power only while it has deadfall.",
    };
  }
  if (k === CRATE) {
    const count = h.count[r] ?? 0;
    const line = `Holds ${count} of ${y.open.crate}${count > 0 ? `: ${holding(y, r)}` : ""}.`;
    return { line: state === "shut" ? `Shut: it lets no items out. ${line}` : line };
  }
  if (carries(k)) {
    const n = asItem(y.item[i] ?? NONE);
    if (n === null) {
      if (state === "blocked") return { line: "All 3 ways out are shut." };
      const under = underground(y, i);
      return { line: state === "carrying" ? `${under} thing${under === 1 ? "" : "s"} under the ground.` : "Empty." };
    }
    if (state === "carrying") return { line: `Carrying ${many(n)}.` };
    if (state === "blocked") return { line: nowhere(y, i, n) };
    return { line: `${cap(many(n))} waiting to move on.` };
  }
  if (state === "unpowered") return { line: "No power here. Place a pylon near it." };
  if (k === STUDY) {
    const g = y.line[0];
    const holds = (h.count[r] ?? 0) > 0 ? `Holds ${holding(y, r)}. ` : "";
    if (g === undefined) return { line: `${holds}Nothing is being studied.` };
    const name = GOALS[g]?.title ?? "";
    if (state === "working") return { line: `Studying ${name}${slow}.` };
    const missing = FOLIOS.filter((n) => (GOALS[g]?.want[n] ?? 0) > (y.got[g]?.[n] ?? 0));
    return { line: `${holds}Waiting for ${list(missing)} for ${name}.`, missing };
  }
  const out = asItem(h.out[r] ?? NONE);
  if (out !== null)
    return { line: state === "blocked" ? nowhere(y, i, out) : `Waiting: no room ahead for its ${many(out)}.` };
  if (k === GATHERER) {
    const what = asItem(y.land.deposit[i] ?? NONE);
    return { line: `Gathering ${what === null ? "nothing" : many(what)}${slow}.` };
  }
  const making = asItem(h.making[r] ?? NONE);
  if (making !== null) return { line: `Making ${many(making)}${slow}.` };
  const rec = aim(y, i);
  if (!rec)
    return { line: h.count[r] === 0 ? "Waiting for items." : `Holds ${holding(y, r)}. No recipe combines these.` };
  if (state === "working") return { line: `Making ${many(rec.out)}${slow}.` };
  const missing = rec.from.filter((n, p) => held(h, r, n) < (rec.need[p] ?? 1));
  const full = rec.from.find((n, p) => held(h, r, n) >= BUFFER * (rec.need[p] ?? 1));
  if (state === "starved" && full !== undefined)
    return {
      line: `Full of ${many(full)} and waiting for ${list(missing)}. If both come in on one belt, the ${many(full)} will be blocking it.`,
      spare: full,
      missing,
    };
  return { line: `Waiting for ${list(missing)} to make ${many(rec.out)}.`, missing };
}
