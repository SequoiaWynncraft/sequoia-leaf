/**
 * What a thing in the yard is doing, in a sentence, and whether it is in trouble: for a screen to
 * show on a machine and say when it is pointed at. Nothing here changes the yard.
 */
import { ITEM, type Item, ITEMS } from "./content/items.ts";
import { BUFFER, FUEL, KIND, REACH, TICKS } from "./content/machines.ts";
import { MADE_BY, MILLED, RECIPE, type Recipe } from "./content/recipes.ts";
import { DX, DY } from "./grid.ts";
import { repower } from "./power.ts";
import { power, rewire } from "./step.ts";
import { at, type Building, type World } from "./world.ts";

/**
 * How a thing stands. `working`, `carrying` and `giving` are a thing doing its job; `idle` and
 * `waiting` are a thing with nothing to do just now; the rest are trouble that will not mend itself.
 */
export type State =
  "working" | "carrying" | "giving" | "idle" | "waiting" | "blocked" | "starved" | "unpowered" | "cold" | "shut";

export interface Status {
  readonly state: State;
  /** What it is doing, or why it is not. */
  readonly line: string;
  /** Whether the member should be told: it will not come right without them. */
  readonly trouble: boolean;
  /** For a machine that has filled up with one part while it waits for another: the part to tip out. */
  readonly spare?: Item;
  /** What a machine is waiting for. */
  readonly missing?: readonly Item[];
}

const many = (item: Item): string => ITEM[item].many;
const list = (items: readonly Item[]): string => {
  const names = items.map(many);
  const last = names.pop() ?? "";
  return names.length ? `${names.join(", ")} and ${last}` : last;
};
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** What a machine, crate or boiler holds, as words: "3 planks and 1 pot". */
export function holding(b: Building): string {
  const parts = ITEMS.flatMap((k) => {
    const n = b.buf[k] ?? 0;
    return n > 0 ? [`${n} ${n === 1 ? ITEM[k].name.toLowerCase() : ITEM[k].many}`] : [];
  });
  const last = parts.pop() ?? "";
  return parts.length ? `${parts.join(", ")} and ${last}` : last || "nothing";
}

/** The recipe a machine is working toward: the one it is pinned to, or the first that uses everything it holds. */
export function aim(b: Building): Recipe | null {
  if (b.kind !== "mill" && b.kind !== "bench" && b.kind !== "workshop") return null;
  if (b.making !== null) return RECIPE[b.making] ?? null;
  if (b.recipe !== null) return RECIPE[b.recipe] ?? null;
  if (b.count === 0) return null;
  return MADE_BY[b.kind].find((r) => ITEMS.every((k) => (b.buf[k] ?? 0) === 0 || r.from.includes(k))) ?? null;
}

/**
 * Whether what stands ahead of the tile at `i` could ever take `item` from it: something is there,
 * it takes things in from that side, and the thing is of use to it. A full belt or a full machine
 * still counts; it is only waiting.
 */
function takenAhead(w: World, i: number, item: Item): "yes" | "nothing" | "never" {
  const wire = w.wire ?? rewire(w);
  const b = w.cells[i];
  if (!b) return "nothing";
  const outs = b.kind === "splitter" ? [0, 1, 2].map((k) => wire.ways[i * 3 + k] ?? -1) : [wire.next[i] ?? -1];
  let found: "nothing" | "never" = "nothing";
  for (const to of outs) {
    const t = to < 0 ? null : w.cells[to];
    if (!t) continue;
    found = "never";
    switch (t.kind) {
      case "depot":
        return "yes";
      case "belt":
      case "crate":
        if (wire.next[to] !== i) return "yes";
        break;
      case "splitter":
      case "tunnel":
        if (wire.back[to] === i && (t.kind !== "tunnel" || t.span > 0)) return "yes";
        break;
      case "joiner":
        if ([0, 1, 2].some((k) => wire.ways[to * 3 + k] === i)) return "yes";
        break;
      case "mill": {
        const r = MILLED[item];
        if (r && (t.recipe === null || t.recipe === r.out)) return "yes";
        break;
      }
      case "bench":
      case "workshop":
        if (MADE_BY[t.kind].some((r) => r.from.includes(item) && (t.recipe === null || t.recipe === r.out)))
          return "yes";
        break;
      case "boiler":
        if (item === "deadfall") return "yes";
        break;
      case "gatherer":
      case "pylon":
      case "wheel":
        break;
    }
  }
  return found;
}

function stuck(w: World, i: number, item: Item): Status {
  const there = takenAhead(w, i, item);
  if (there === "nothing") {
    // Only a splitter has ways to shut.
    const shut = w.cells[i]?.shut ?? 0;
    const why =
      shut === 7 ? "all 3 ways are shut" : `nothing is on ${shut ? "any way that is open" : "the tile it points at"}`;
    return { state: "blocked", line: `Nowhere to send its ${many(item)}: ${why}.`, trouble: true };
  }
  if (there === "never")
    return { state: "blocked", line: `The piece it points at does not take ${many(item)}.`, trouble: true };
  return { state: "waiting", line: `Waiting: no room ahead for its ${many(item)}.`, trouble: false };
}

/** How many of a thing a gatherer or machine turns out in a minute at the yard's present pace, or 0. */
export function rate(w: World, i: number): number {
  const b = w.cells[i];
  if (!b || (w.power ?? repower(w))[i] !== 1) return 0;
  const share = power(w).pace;
  if (b.kind === "gatherer") return (600 * w.rates.gather * share) / TICKS.gather;
  const r = aim(b);
  return r ? (600 * w.rates.craft * share) / r.ticks : 0;
}

/** What the thing on the tile at `i` is doing. Nothing if nothing stands there. */
export function status(w: World, i: number): Status | null {
  const b = i < 0 ? null : w.cells[i];
  if (!b) return null;
  const lit = (w.power ?? repower(w))[i] === 1;
  const share = power(w).pace;
  const slow = share < 1 ? `, at ${Math.round(share * 100)}% of its pace: the yard is short of power` : "";
  switch (b.kind) {
    case "depot":
      return {
        state: "giving",
        line: `Sells every item that reaches it. Makes ${w.rates.depot} power.`,
        trouble: false,
      };
    case "pylon":
      return lit
        ? {
            state: "giving",
            line: `Powers the tiles up to ${Math.floor(REACH.pylon * w.rates.reach)} tiles from it.`,
            trouble: false,
          }
        : {
            state: "unpowered",
            line: "Not connected. It must be within reach of the depot or of a connected pylon.",
            trouble: true,
          };
    case "wheel":
      return lit
        ? { state: "giving", line: `Running. Makes ${KIND.wheel.gives} power.`, trouble: false }
        : {
            state: "unpowered",
            line: "Not connected to a pylon, so the power it makes is not used.",
            trouble: true,
          };
    case "boiler":
      if (!lit)
        return {
          state: "unpowered",
          line: "Not connected to a pylon, so the power it makes is not used.",
          trouble: true,
        };
      return b.fuel > 0
        ? {
            state: "giving",
            line: `Running. Makes ${KIND.boiler.gives} power. Holds ${b.buf.deadfall ?? 0} of ${FUEL} deadfall.`,
            trouble: false,
          }
        : { state: "cold", line: "Out of fuel. It makes power only while it has deadfall.", trouble: true };
    case "crate": {
      const held = `Holds ${b.count} of ${w.rates.crate}${b.count > 0 ? `: ${holding(b)}` : ""}.`;
      return b.open
        ? { state: b.count > 0 ? "carrying" : "idle", line: held, trouble: false }
        : { state: "shut", line: `Shut: it lets no items out. ${held}`, trouble: false };
    }
    case "belt":
    case "splitter":
    case "joiner":
    case "tunnel": {
      // A splitter with every way shut can send nothing on, whether or not it holds anything yet.
      if (b.kind === "splitter" && b.shut === 7) {
        const line =
          b.item === null ? "All 3 ways out are shut." : `Nowhere to send its ${many(b.item)}: all 3 ways are shut.`;
        return { state: "blocked", line, trouble: true };
      }
      if (b.item === null) {
        const under = b.under.filter((k) => k !== null).length;
        return under > 0
          ? { state: "carrying", line: `${under} thing${under === 1 ? "" : "s"} under the ground.`, trouble: false }
          : { state: "idle", line: "Empty.", trouble: false };
      }
      if (b.prog < 1) return { state: "carrying", line: `Carrying ${many(b.item)}.`, trouble: false };
      const s = b.kind === "tunnel" && b.span > 0 ? null : stuck(w, i, b.item);
      return s && s.state === "blocked"
        ? s
        : { state: "waiting", line: `${cap(many(b.item))} waiting to move on.`, trouble: false };
    }
    case "gatherer": {
      if (!lit) return { state: "unpowered", line: "No power here. Place a pylon near it.", trouble: true };
      if (b.out !== null) return stuck(w, i, b.out);
      const what = w.land.deposit[i];
      return {
        state: "working",
        line: `Gathering ${what ? many(what) : "nothing"}${slow}.`,
        trouble: false,
      };
    }
    case "mill":
    case "bench":
    case "workshop": {
      if (!lit) return { state: "unpowered", line: "No power here. Place a pylon near it.", trouble: true };
      if (b.out !== null) return stuck(w, i, b.out);
      if (b.making !== null) return { state: "working", line: `Making ${many(b.making)}${slow}.`, trouble: false };
      const r = aim(b);
      if (!r)
        return {
          state: "idle",
          line: b.count === 0 ? "Waiting for items." : `Holds ${holding(b)}. No recipe combines these.`,
          trouble: b.count > 0,
        };
      const missing = r.from.filter((k) => (b.buf[k] ?? 0) === 0);
      if (missing.length === 0) return { state: "working", line: `Making ${many(r.out)}${slow}.`, trouble: false };
      const full = r.from.find((k) => (b.buf[k] ?? 0) >= BUFFER);
      if (full !== undefined)
        return {
          state: "starved",
          line: `Full of ${many(full)} and waiting for ${list(missing)}. If both come in on one belt, the ${many(full)} will be blocking it.`,
          trouble: true,
          spare: full,
          missing,
        };
      return {
        state: "waiting",
        line: `Waiting for ${list(missing)} to make ${many(r.out)}.`,
        trouble: false,
        missing,
      };
    }
  }
}

/** The tile a thing hands on to, for a screen to point at. Nothing for things that hand nothing on. */
export function ahead(w: World, i: number): number {
  const b = w.cells[i];
  if (!b) return -1;
  const x = i % w.land.w;
  const y = Math.floor(i / w.land.w);
  return at(w, x + DX[b.dir], y + DY[b.dir]);
}
