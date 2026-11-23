/**
 * What a piece in the yard is doing, in a sentence, and whether it is in trouble: for a screen to
 * show. Nothing here changes the yard but working out its power and plumbing if a change left them unknown.
 */
import { BUFFER, FUEL, REACH } from "./content/machines.ts";
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
  MADE_BY,
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
import { ahead, behind, nextOf, power, wayIn, wayOut } from "./wire.ts";
import { held, type Yard } from "./yard.ts";

/** How a thing stands: doing its job, with nothing to do just now, or in trouble that will not mend itself. */
export type State =
  "working" | "carrying" | "giving" | "idle" | "waiting" | "blocked" | "starved" | "unpowered" | "cold" | "shut";

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

/** The recipe a machine is working toward: the one it is pinned to, or the first that uses everything it holds. */
export function aim(y: Yard, i: number): Recipe | null {
  const k = y.kind[i] ?? NONE;
  if (k !== MILL && k !== BENCH && k !== WORKSHOP) return null;
  const h = y.holders;
  const r = y.row[i] ?? 0;
  if (h.making[r] !== NONE) return RECIPE[h.making[r] ?? NONE] ?? null;
  if (y.set[i] !== NONE) return RECIPE[y.set[i] ?? NONE] ?? null;
  if (h.count[r] === 0) return null;
  return (MADE_BY[k] ?? []).find((rec) => ALL_ITEMS.every((n) => held(h, r, n) === 0 || rec.from.includes(n))) ?? null;
}

/** Whether what stands ahead of a tile could ever take a thing from it. A full belt or machine still counts. */
function takenAhead(y: Yard, i: number, n: Item): "yes" | "nothing" | "never" {
  const k0 = y.kind[i];
  const outs =
    k0 === SPLITTER
      ? [0, 1, 2].map((w) => wayOut(y, i, w))
      : k0 === SORTER
        ? [wayOut(y, i, n === y.set[i] ? 1 : 0)]
        : [nextOf(y, i)];
  let found: "nothing" | "never" = "nothing";
  for (const to of outs) {
    const k = to < 0 ? NONE : (y.kind[to] ?? NONE);
    if (k === NONE) continue;
    found = "never";
    if (k === DEPOT || k === STOP || (k === STUDY && isFolio(n))) return "yes";
    if ((k === BELT || k === CRATE) && ahead(y, to) !== i) return "yes";
    if ((k === SPLITTER || k === SORTER || (k === TUNNEL && (y.span[to] ?? 0) > 0)) && behind(y, to) === i)
      return "yes";
    if (k === JOINER && [0, 1, 2].some((w) => wayIn(y, to, w) === i)) return "yes";
    const only = y.set[to] ?? NONE;
    if (isMaker(k) && (MADE_BY[k] ?? []).some((rec) => rec.from.includes(n) && (only === NONE || only === rec.out)))
      return "yes";
    if (k === BOILER && n === DEADFALL) return "yes";
  }
  return found;
}

function stuck(y: Yard, i: number, n: Item): Status {
  const there = takenAhead(y, i, n);
  if (there === "nothing") {
    // Only a splitter has ways to shut.
    const shut = y.shut[i] ?? 0;
    const why =
      shut === 7 ? "all 3 ways are shut" : `nothing is on ${shut ? "any way that is open" : "the tile it points at"}`;
    return { state: "blocked", line: `Nowhere to send its ${many(n)}: ${why}.`, trouble: true };
  }
  if (there === "never")
    return { state: "blocked", line: `The piece it points at does not take ${many(n)}.`, trouble: true };
  return { state: "waiting", line: `Waiting: no room ahead for its ${many(n)}.`, trouble: false };
}

/** How many of a thing a gatherer or machine turns out in a minute at the yard's present pace, or 0. */
export function rate(y: Yard, i: number): number {
  if (i < 0 || y.kind[i] === NONE || litOf(y)[i] !== 1) return 0;
  const share = power(y).pace;
  const pace = (PACE[y.grade[i] ?? 0] ?? 0) * share * 600;
  if (y.kind[i] === GATHERER) return pace / WORK.gather;
  const r = aim(y, i);
  return r ? pace / r.work : 0;
}

/** What the piece on a tile is doing. Nothing if nothing stands there. */
export function status(y: Yard, i: number): Status | null {
  const k = i < 0 ? NONE : (y.kind[i] ?? NONE);
  if (k === NONE) return null;
  const lit = litOf(y)[i] === 1;
  const share = power(y).pace;
  const slow = share < 1 ? `, at ${Math.round(share * 100)}% of its pace: the yard is short of power` : "";
  const h = y.holders;
  const r = y.row[i] ?? 0;
  const unlinked = {
    state: "unpowered",
    line: "Not connected to a pylon, so the power it makes is not used.",
    trouble: true,
  } as const;
  if (k === DEPOT)
    return { state: "giving", line: `Sells every item that reaches it. Makes ${y.open.depot} power.`, trouble: false };
  if (k === STOP) return { state: "giving", line: "Sends every item that reaches it to the depot.", trouble: false };
  if (k === PYLON)
    return lit
      ? {
          state: "giving",
          line: `Powers the tiles up to ${Math.floor(REACH.pylon * y.open.reach)} tiles from it.`,
          trouble: false,
        }
      : {
          state: "unpowered",
          line: "Not connected. It must be within reach of the depot or of a connected pylon.",
          trouble: true,
        };
  if (k === WHEEL)
    return lit ? { state: "giving", line: `Running. Makes ${GIVES[WHEEL] ?? 0} power.`, trouble: false } : unlinked;
  if (k === BOILER) {
    if (!lit) return unlinked;
    return (h.fuel[r] ?? 0) > 0
      ? {
          state: "giving",
          line: `Running. Makes ${GIVES[BOILER] ?? 0} power. Holds ${held(h, r, DEADFALL)} of ${FUEL} deadfall.`,
          trouble: false,
        }
      : { state: "cold", line: "Out of fuel. It makes power only while it has deadfall.", trouble: true };
  }
  if (k === CRATE) {
    const count = h.count[r] ?? 0;
    const line = `Holds ${count} of ${y.open.crate}${count > 0 ? `: ${holding(y, r)}` : ""}.`;
    return h.open[r] === 1
      ? { state: count > 0 ? "carrying" : "idle", line, trouble: false }
      : { state: "shut", line: `Shut: it lets no items out. ${line}`, trouble: false };
  }
  if (k === BELT || k === SPLITTER || k === JOINER || k === TUNNEL || k === SORTER) {
    const n = asItem(y.item[i] ?? NONE);
    // A splitter with every way shut can send nothing on, whether or not it holds anything yet.
    if (k === SPLITTER && y.shut[i] === 7) {
      const line = n === null ? "All 3 ways out are shut." : `Nowhere to send its ${many(n)}: all 3 ways are shut.`;
      return { state: "blocked", line, trouble: true };
    }
    if (n === null) {
      let under = 0;
      const span = y.span[i] ?? 0;
      for (let s = 0; s < span; s++) if (y.tunnels.under[(y.row[i] ?? 0) * SPAN_MOST + s] !== NONE) under++;
      return under > 0
        ? { state: "carrying", line: `${under} thing${under === 1 ? "" : "s"} under the ground.`, trouble: false }
        : { state: "idle", line: "Empty.", trouble: false };
    }
    if ((y.prog[i] ?? 0) < 8) return { state: "carrying", line: `Carrying ${many(n)}.`, trouble: false };
    const s = k === TUNNEL && (y.span[i] ?? 0) > 0 ? null : stuck(y, i, n);
    return s && s.state === "blocked"
      ? s
      : { state: "waiting", line: `${cap(many(n))} waiting to move on.`, trouble: false };
  }
  if (!lit) return { state: "unpowered", line: "No power here. Place a pylon near it.", trouble: true };
  if (k === STUDY) {
    const g = y.line[0];
    const holds = (h.count[r] ?? 0) > 0 ? `Holds ${holding(y, r)}. ` : "";
    if (g === undefined) return { state: "idle", line: `${holds}Nothing is being studied.`, trouble: false };
    const name = GOALS[g]?.title ?? "";
    const missing = FOLIOS.filter((n) => (GOALS[g]?.want[n] ?? 0) > (y.got[g]?.[n] ?? 0));
    if (missing.some((n) => held(h, r, n) > 0))
      return { state: "working", line: `Studying ${name}${slow}.`, trouble: false };
    return { state: "waiting", line: `${holds}Waiting for ${list(missing)} for ${name}.`, trouble: false, missing };
  }
  const out = asItem(h.out[r] ?? NONE);
  if (out !== null) return stuck(y, i, out);
  if (k === GATHERER) {
    const what = asItem(y.land.deposit[i] ?? NONE);
    return { state: "working", line: `Gathering ${what === null ? "nothing" : many(what)}${slow}.`, trouble: false };
  }
  const making = asItem(h.making[r] ?? NONE);
  if (making !== null) return { state: "working", line: `Making ${many(making)}${slow}.`, trouble: false };
  const rec = aim(y, i);
  if (!rec)
    return {
      state: "idle",
      line: h.count[r] === 0 ? "Waiting for items." : `Holds ${holding(y, r)}. No recipe combines these.`,
      trouble: (h.count[r] ?? 0) > 0,
    };
  const missing = rec.from.filter((n, p) => held(h, r, n) < (rec.need[p] ?? 1));
  if (missing.length === 0) return { state: "working", line: `Making ${many(rec.out)}${slow}.`, trouble: false };
  const full = rec.from.find((n, p) => held(h, r, n) >= BUFFER * (rec.need[p] ?? 1));
  if (full !== undefined)
    return {
      state: "starved",
      line: `Full of ${many(full)} and waiting for ${list(missing)}. If both come in on one belt, the ${many(full)} will be blocking it.`,
      trouble: true,
      spare: full,
      missing,
    };
  return { state: "waiting", line: `Waiting for ${list(missing)} to make ${many(rec.out)}.`, trouble: false, missing };
}
