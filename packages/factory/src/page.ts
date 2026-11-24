/**
 * The wire between Leaf and the page, from the page's side. Leaf reads a command off the wire with
 * `readCommand` (`game.ts`); the page writes one with `writeCommand`, its inverse, from the commands'
 * table (`commands.ts`). What Leaf sends the
 * page is read back here: the yard as the page is given it (`readView`), what a command did
 * (`readNotes`), and Leaf's answer to a batch (`readAnswer`), whose orders the page's copy hears
 * (`hear`). On the wire things, kinds, plots and goals go by their names; everywhere else they are
 * numbers.
 */
import { keptOrder, orderOf } from "./codec.ts";
import { type Wired, writeAct } from "./commands.ts";
import type { Command, Short, View } from "./game.ts";
import { counting } from "./orders.ts";
import { goalNamed, HOOKS_MOST } from "./tables.ts";
import type { News, Standing, Yard } from "./yard.ts";

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
