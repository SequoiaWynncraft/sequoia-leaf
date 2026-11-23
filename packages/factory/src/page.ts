/**
 * The wire between Leaf and the page, from the page's side. Leaf reads a command off the wire with
 * `readCommand` (`game.ts`); the page writes one with `writeAct`, its inverse. What Leaf sends the
 * page is read back here: the yard as the page is given it (`readView`), what a command did
 * (`readNotes`), and Leaf's answer to a batch (`readAnswer`), whose orders the page's copy hears
 * (`hear`). On the wire things, kinds, plots and goals go by their names; everywhere else they are
 * numbers.
 */
import { keptOrder, orderOf } from "./codec.ts";
import type { Act, Command, Short, View } from "./game.ts";
import { counting } from "./orders.ts";
import type { Piece } from "./pieces.ts";
import { type Leg, legKind } from "./route.ts";
import { type Goal, goalNamed, GOALS, HOOKS_MOST, itemName, kindName, plotName } from "./tables.ts";
import type { News, Standing, Yard } from "./yard.ts";

/** A command as it goes on the wire: what was done, with every thing, kind, plot and goal by its name. */
export type Wired = { readonly do: Act["do"]; readonly [field: string]: unknown };

const goalId = (g: Goal): string => GOALS[g]?.id ?? "";

/** A piece as the wire names it: its kind, and what it is set to make. */
const named = (p: Piece): Record<string, unknown> => ({
  ...p,
  kind: kindName(p.kind),
  ...(p.recipe === undefined ? {} : { recipe: itemName(p.recipe) }),
});

/** A leg of a run as the wire names it: its kind, and nothing but what a leg holds. */
const legOnWire = (l: Leg): Record<string, unknown> => ({
  kind: kindName(legKind(l)),
  x: l.x,
  y: l.y,
  dir: l.dir,
  span: l.span,
  ...(l.grade === 1 ? {} : { grade: l.grade }),
});

/** What goes on the wire for an act: `readCommand` reads it back, with its tick, as the same act. */
export function writeAct(a: Act): Wired {
  switch (a.do) {
    case "build":
      return {
        do: a.do,
        kind: kindName(a.kind),
        x: a.x,
        y: a.y,
        dir: a.dir,
        ...(a.grade === 1 ? {} : { grade: a.grade }),
      };
    case "lay":
      return {
        do: a.do,
        legs: a.legs.map(legOnWire),
        ...(a.turn ? { turn: { x: a.turn.x, y: a.turn.y, dir: a.turn.dir } } : {}),
      };
    case "stand":
      return { do: a.do, pieces: a.pieces.map(named) };
    case "placeBlueprint":
      return { do: a.do, slot: a.slot, turns: a.turns, x: a.x, y: a.y };
    case "move":
    case "copy":
      return { do: a.do, tiles: a.tiles, turns: a.turns, x: a.x, y: a.y };
    case "remove":
      return { do: a.do, x: a.x, y: a.y };
    case "clear":
    case "upgrade":
      return { do: a.do, tiles: a.tiles };
    case "saveBlueprint":
      return { do: a.do, slot: a.slot, tiles: a.tiles };
    case "deleteBlueprint":
      return { do: a.do, slot: a.slot };
    case "turn":
      return { do: a.do, dir: a.dir, x: a.x, y: a.y };
    case "paint":
      return { do: a.do, tint: a.tint, x: a.x, y: a.y };
    case "recipe":
    case "sort":
    case "tipOut":
      return { do: a.do, item: a.item === null ? null : itemName(a.item), x: a.x, y: a.y };
    case "crate":
      return { do: a.do, open: a.open, x: a.x, y: a.y };
    case "way":
      return { do: a.do, way: a.way, open: a.open, x: a.x, y: a.y };
    case "buyPlot":
      return { do: a.do, plot: plotName(a.plot) };
    case "take":
      return { do: a.do, node: goalId(a.node) };
    case "study":
    case "unstudy":
      return { do: a.do, research: goalId(a.research) };
    case "swap":
    case "handOver":
      return { do: a.do, order: a.order };
    case "collect":
      return { do: a.do };
  }
}

/** A command as it goes on the wire, with the tick the page's copy stood at. */
export const writeCommand = (c: Command): Wired & { readonly tick: number } => ({ ...writeAct(c), tick: c.tick });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const whole = (v: unknown, most: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= most;

/** What Leaf gives the page of a yard, read back; null for anything these rules could not have made. The yard in it is read with `decode`. */
export function readView(v: unknown): View | null {
  return isRecord(v) && typeof v.yard === "string" && whole(v.clock, 1e12) ? { yard: v.yard, clock: v.clock } : null;
}

/** Leaf's answer to a batch as the page holds it: Leaf's clock, the yard's tick and check, and the orders hung in the last minute. */
export interface Heard {
  readonly clock: number;
  readonly tick: number;
  readonly check: number;
  readonly hung: readonly Standing[];
}

/** Leaf's answer to a batch (`Short`), read back; null for anything these rules could not have made. */
export function readAnswer(v: unknown): Heard | null {
  if (!isRecord(v) || !whole(v.clock, 1e12) || !whole(v.tick, 1e12) || !whole(v.check, 0xffffffff)) return null;
  if (!Array.isArray(v.hung) || v.hung.length > HOOKS_MOST) return null;
  const hung = v.hung.map(orderOf).filter((o) => o !== null);
  return hung.length === v.hung.length ? { clock: v.clock, tick: v.tick, check: v.check, hung } : null;
}

/**
 * Puts on a copy of a yard (the page's, which holds no seed and so hangs no order of its own) each
 * order Leaf hung that is new to it, while it does not count yet. Says false when one was heard of
 * after it began to count: the copy has missed what the depot gave it, and must take Leaf's yard.
 * Order ids only go up (`serial`): one under the copy's serial it has had, and may since have swapped
 * out or handed over, so it is passed over.
 */
export function hear(y: Yard, hung: readonly Standing[]): boolean {
  for (const order of hung) {
    if (order.id < y.serial) continue;
    if (counting(order, y.tick)) return false;
    y.board.push(order);
    y.serial = order.id + 1;
  }
  return true;
}

/** One piece of a yard's news, read back. */
function newsOf(n: unknown): News | null {
  if (!isRecord(n) || typeof n.title !== "string" || !whole(n.pay, 1e9)) return null;
  const { title, pay } = n;
  if (n.kind === "done")
    return typeof n.goal === "string" && goalNamed(n.goal) !== null ? { kind: "done", goal: n.goal, title, pay } : null;
  return (n.kind === "filled" || n.kind === "standing") && whole(n.id, 1e9)
    ? { kind: n.kind, id: n.id, title, pay }
    : null;
}

/** What a command did, read back: the yard's news. */
export function readNotes(v: unknown): News[] | null {
  if (!Array.isArray(v)) return null;
  const notes = v.map(newsOf);
  return notes.every((n) => n !== null) ? notes.filter((n) => n !== null) : null;
}

/** Leaf's answer to a batch, as it goes on the wire: the orders by name (`keptOrder`). */
export const shortOf = (
  clock: number,
  a: { readonly tick: number; readonly check: number; readonly hung: readonly Standing[] },
): Short => ({
  clock,
  tick: a.tick,
  check: a.check,
  hung: a.hung.map(keptOrder),
});
