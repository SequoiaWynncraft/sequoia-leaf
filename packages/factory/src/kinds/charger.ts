/**
 * The charger, two tiles by two (tier 8): it takes cells, and charged cells with 1 or 2 bars, in on the
 * six tile-sides of its back and sides, up to 4 in all (`CHARGE`, `content/charge.ts`), and charges one
 * at a time. A charge done uses a cell if it holds one, else one with 1 bar, else one with 2, and it
 * holds a charged cell with 3 bars, charging nothing more until that has left by the left tile of its
 * front. Set against a launch pad's back or side, it hands straight into it. On the beat what it holds
 * loses bars as every other charged cell does (`beat.ts`), the one it holds ready too.
 */
import type { KeptPiece } from "../cells.ts";
import { CHARGE } from "../content/charge.ts";
import type { Item } from "../tables.ts";
import type { Counts, Wire, Yard } from "../yard.ts";
import { firstOut, handPorts, readyPorts } from "./big.ts";
import { keep, stockOnto, workOnto } from "./holder.ts";
import { kind, type Words } from "./kind.ts";
import type { Kit } from "./kit.ts";
import { outWords } from "./maker.ts";
import { backAndSides, front } from "./ports.ts";
import { as, asItem, NO_POWER, rateOf, slow, stuckAs } from "./say.ts";

/** Whether it takes the thing `n`: a cell of any charge but a full one. */
function wants(k: Kit, _y: Yard, _i: number, n: number): boolean {
  const { takes } = k.CHARGED;
  for (let t = 0; t < takes.length; t++) if (takes[t] === n) return true;
  return false;
}

/** It has room for what it takes while it holds fewer than it holds at most, of all of them together. */
const room = (k: Kit, y: Yard, i: number, n: number): boolean =>
  wants(k, y, i, n) && (y.holders.count[k.holderOf(y, i)] ?? 0) < k.CHARGED.holds;

/**
 * Its step in the tick's work (the tick passes over it while it holds a charged cell ready): holding
 * anything to charge, work at its grade's pace; a charge done uses the first of what it takes that it
 * holds, and it holds a charged cell with 3 bars. Says whether it had anything to charge.
 */
function work(k: Kit, y: Yard, i: number, r: number, speed: number, wire: Wire): boolean {
  const c = k.CHARGED;
  const h = y.holders;
  if ((h.count[r] ?? 0) === 0) return false;
  h.work[r] = (h.work[r] ?? 0) + speed;
  if ((h.work[r] ?? 0) < c.work) return true;
  h.work[r] = (h.work[r] ?? 0) - c.work;
  // A cell if it holds one, else one with 1 bar, else one with 2.
  for (let t = 0; t < c.takes.length; t++) {
    const n = c.takes[t] ?? k.NONE;
    if (k.held(h, r, n) === 0) continue;
    k.take(h, r, n);
    break;
  }
  h.out[r] = c.gives;
  k.roomBeside(y, i, wire.waiting);
  return true;
}

/**
 * How it stands: with no power; holding a charged cell ready, waiting while what is directly ahead
 * takes it, in trouble where it never does; charging while it holds anything to charge; else waiting.
 */
function condition(k: Kit, y: Yard, i: number, lit: boolean): number {
  if (!lit) return as("unpowered", true);
  const r = k.holderOf(y, i);
  const out = asItem(k, y.holders.out[r] ?? k.NONE);
  if (out !== null) return stuckAs(k, y, i, out);
  return (y.holders.count[r] ?? 0) > 0 ? as("working") : as("waiting");
}

/** Its words: "Charging cells.", "Waiting for cells.", or what it holds ready with no room ahead. */
function words(k: Kit, y: Yard, i: number, state: string): Words {
  if (state === "unpowered") return { line: NO_POWER };
  const out = asItem(k, y.holders.out[k.holderOf(y, i)] ?? k.NONE);
  if (out !== null && state === "waiting") return { line: "Waiting: no room ahead for its charged cells." };
  if (out !== null) return outWords(k, y, i, state, out);
  return state === "working"
    ? { line: `Charging cells${slow(k, y, i)}.` }
    : { line: "Waiting for cells.", missing: [k.CHARGED.plain] };
}

/** What it adds a minute to what the yard makes and needs: a charged cell from a cell for each charge, as every screen says them (`rateOf`). */
function flow(k: Kit, y: Yard, i: number, made: Counts, needed: Counts): void {
  const c = k.CHARGED;
  const charges = rateOf(k, y, i, null).effective;
  made[c.gives] = (made[c.gives] ?? 0) + charges;
  needed[c.plain] = (needed[c.plain] ?? 0) + charges;
}

/** How many of a thing it may hold: of what it takes, as many as it holds at most. */
const most = (k: Kit, y: Yard, i: number, n: number): number => (wants(k, y, i, n) ? k.CHARGED.holds : 0);

/** Whether a thing is a cell of any charge, as one a charger may hold ready after a beat. */
const isCell = (k: Kit, n: number): n is Item => n === k.CHARGED.plain || k.CHARGED.bars.some((b) => b === n);

/** Puts back what a kept one held and was doing: what it takes, up to 4 in all, a cell it held ready, its work below a charge's. */
function onto(k: Kit, y: Yard, i: number, r: number, o: KeptPiece): void {
  stockOnto(k, y, i, r, o, k.CHARGED.holds);
  if (o.out !== undefined && isCell(k, o.out)) y.holders.out[r] = o.out;
  workOnto(k, y, r, o, k.CHARGED.work);
}

export const charger = kind({
  name: "charger",
  info: {
    name: "Charger",
    cost: 6000,
    draw: 60,
    gives: 0,
    what: "Charges a cell to 3 bars. Takes cells of any charge. Every 20 seconds every charged cell loses 1 bar, wherever it is.",
  },
  graded: true,
  holds: true,
  size: [2, 2],
  // Its own work, a charge, in half-ticks at grade 1, as the planner reads it (`makes`).
  work: CHARGE.ticks * 2,
  ports: { in: backAndSides(2, 2), out: [{ at: front(2, 0), sends: "out" }] },
  rules: {
    wants,
    room,
    give: keep,
    hands: handPorts,
    ready: readyPorts,
    next: firstOut,
    work,
    condition,
    words,
    flow,
    most,
    onto,
  },
});
