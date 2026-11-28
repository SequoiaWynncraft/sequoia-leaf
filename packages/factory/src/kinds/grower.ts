/**
 * The grower, three tiles by three (tier 7): it takes star crystals and crystal feed in on the nine
 * tile-sides of its back and sides, up to 4 of each (`GROW`, `content/grow.ts`). A run takes 1 of each
 * and grows 1 star crystal, and every second run 2: 3 from every 2, so 2 of every 3 must go back into
 * it, and only the third is the yard's. What it grew leaves by the middle tile of its front; it grows
 * nothing more while it holds any. The second of a run that gave 2 waits behind the first
 * (`Holders.more`, as an assembler's do) and leaves on a later tick.
 *
 * Its place in its runs is kept on its row (`Holders.mix`, kept and checked since tier 5): 0 for a new
 * one, whose first run gives 1; then 1 before a run that gives 2, and 2 before one that gives 1. So the
 * runs give 1, 2, 1, 2, and one that has grown any is never at 0 again, which its words read: a grower
 * waiting for star crystals is in trouble only once it has grown some. Moved, it keeps its place; a
 * copy or a blueprint starts new.
 */
import type { KeptPiece } from "../cells.ts";
import type { Grow, Item } from "../tables.ts";
import type { Counts, Holders, Wire, Yard } from "../yard.ts";
import { firstOut, handPorts, readyPorts } from "./big.ts";
import { keep, stockOnto, workOnto } from "./holder.ts";
import { kind, type Words } from "./kind.ts";
import type { Kit } from "./kit.ts";
import { backAndSides, front } from "./ports.ts";
import { as, asItem, heldAs, heldWords, list, many, NO_POWER, rateOf, slow } from "./say.ts";

/** What the piece on a tile grows, or null. */
const growOf = (k: Kit, y: Yard, i: number): Grow | null => k.GROW_OF[y.kind[i] ?? k.NONE] ?? null;

/** Whether a run takes the thing `n`. */
function takes(g: Grow, n: number): boolean {
  for (let t = 0; t < g.takes.length; t++) if (g.takes[t] === n) return true;
  return false;
}

/** Whether a holder's row holds 1 of each thing a run takes. */
function fed(k: Kit, h: Holders, r: number, g: Grow): boolean {
  for (let t = 0; t < g.takes.length; t++)
    if ((h.stock[r * k.ITEM_COUNT + (g.takes[t] ?? k.NONE)] ?? 0) === 0) return false;
  return true;
}

/** It takes what a run takes, and nothing else. */
const wants = (k: Kit, y: Yard, i: number, n: number): boolean => {
  const g = growOf(k, y, i);
  return g !== null && takes(g, n);
};

/** It has room for what a run takes while it holds fewer of it than it holds at most. */
function room(k: Kit, y: Yard, i: number, n: number): boolean {
  const g = growOf(k, y, i);
  return g !== null && takes(g, n) && (y.holders.stock[k.holderOf(y, i) * k.ITEM_COUNT + n] ?? 0) < g.holds;
}

/**
 * Its step in the tick's work (the tick passes over it while it holds anything it grew): holding 1 of
 * each thing a run takes, work at its grade's pace; a run done uses them, and it holds what it grew,
 * 2 on a run whose place says so, and moves its place on. Says whether it had what a run takes.
 */
function work(k: Kit, y: Yard, i: number, r: number, speed: number, wire: Wire): boolean {
  const g = growOf(k, y, i);
  const h = y.holders;
  if (!g || !fed(k, h, r, g)) return false;
  h.work[r] = (h.work[r] ?? 0) + speed;
  if ((h.work[r] ?? 0) < g.work) return true;
  h.work[r] = (h.work[r] ?? 0) - g.work;
  for (let t = 0; t < g.takes.length; t++) k.take(h, r, g.takes[t] ?? k.NONE);
  const place = h.mix[r] ?? 0;
  h.out[r] = g.gives;
  h.more[r] = place === g.extraEvery - 1 ? 1 : 0;
  h.mix[r] = (place % g.extraEvery) + 1;
  k.roomBeside(y, i, wire.waiting);
  return true;
}

/**
 * What a grower holds and is doing, the one reading of it its status, its picture, its lamps and its
 * card take: the star crystals in it (its seeds, and those it grew waiting to leave), how many of
 * those it grew, whether it has grown any since it was built, and what of a run's it lacks.
 */
export interface Growth {
  readonly crystals: number;
  readonly ready: number;
  readonly grown: boolean;
  readonly lacks: readonly Item[];
}

const NO_GROWTH: Growth = { crystals: 0, ready: 0, grown: false, lacks: [] };

export function growth(k: Kit, y: Yard, i: number): Growth {
  const g = growOf(k, y, i);
  if (!g) return NO_GROWTH;
  const h = y.holders;
  const r = k.holderOf(y, i);
  const ready = h.out[r] === g.gives ? 1 + (h.more[r] ?? 0) : 0;
  return {
    crystals: k.held(h, r, g.gives) + ready,
    ready,
    grown: (h.mix[r] ?? 0) !== 0,
    lacks: g.takes.filter((n) => k.held(h, r, n) === 0),
  };
}

/**
 * How it stands: with no power; holding what it grew, waiting for room ahead or stopped (`heldAs`);
 * growing while it holds what a run takes; else waiting for it, in trouble for want of star crystals
 * once it has grown any (a new one waits for its first seeds).
 */
function condition(k: Kit, y: Yard, i: number, lit: boolean): number {
  if (!lit) return as("unpowered", true);
  const g = growOf(k, y, i);
  const out = asItem(k, y.holders.out[k.holderOf(y, i)] ?? k.NONE);
  if (!g) return as("idle");
  if (out !== null) return heldAs(k, y, i, out);
  const now = growth(k, y, i);
  if (now.lacks.length === 0) return as("working");
  return as("waiting", now.lacks.includes(g.gives) && now.grown);
}

/** Its words: growing; waiting for star crystals, and how many to send back; waiting for feed; or what it grew with no room ahead. */
function words(k: Kit, y: Yard, i: number, state: string): Words {
  if (state === "unpowered") return { line: NO_POWER };
  const g = growOf(k, y, i);
  const out = asItem(k, y.holders.out[k.holderOf(y, i)] ?? k.NONE);
  if (!g) return { line: "" };
  if (out !== null) return heldWords(k, y, i, state, out, "It grows nothing more until they do.");
  if (state === "working") return { line: `Growing ${many(k, g.gives)}${slow(k, y, i)}.` };
  const { lacks } = growth(k, y, i);
  if (!lacks.includes(g.gives)) return { line: `Waiting for ${list(k, lacks)}.`, missing: lacks };
  const [every, gives] = [g.extraEvery, g.extraEvery + 1];
  return {
    line: `Waiting for ${many(k, g.gives)}. It grows ${gives} from every ${every}: send ${every} of every ${gives} back into it.`,
    missing: lacks,
  };
}

/**
 * What it adds a minute to what the yard makes and needs: its runs as every screen says them
 * (`rateOf`: at its grade's pace, the share power and smog let it, and no more than its way out
 * carries), what it grows at its share of a run, and 1 of each thing a run takes.
 */
function flow(k: Kit, y: Yard, i: number, made: Counts, needed: Counts): void {
  const g = growOf(k, y, i);
  if (!g) return;
  const runs = rateOf(k, y, i, null).effective;
  made[g.gives] = (made[g.gives] ?? 0) + runs * k.grownPerRun(g.by);
  for (const n of g.takes) needed[n] = (needed[n] ?? 0) + runs;
}

/** How many of a thing it may hold: of what a run takes, as many as it holds at most. */
const most = (k: Kit, y: Yard, i: number, n: number): number => {
  const g = growOf(k, y, i);
  return g && takes(g, n) ? g.holds : 0;
};

/** Puts back what a kept one held and was doing: what a run takes, what it grew (2 at most), its place in its runs, its work below a run's. */
function onto(k: Kit, y: Yard, i: number, r: number, o: KeptPiece): void {
  const g = growOf(k, y, i);
  if (!g) return;
  const h = y.holders;
  stockOnto(k, y, i, r, o, g.holds * g.takes.length);
  if (o.out === g.gives) {
    h.out[r] = g.gives;
    h.more[r] = Math.min(k.whole(o.more, 255) ?? 0, 1);
  }
  h.mix[r] = k.whole(o.mix, g.extraEvery) ?? 0;
  workOnto(k, y, r, o, g.work);
}

export const grower = kind({
  name: "grower",
  info: {
    name: "Grower",
    cost: 12000,
    draw: 80,
    gives: 0,
    what: "Grows star crystals: from every 2 it takes in, with 2 crystal feed, it gives 3. Send 2 of every 3 back into it.",
  },
  graded: true,
  holds: true,
  size: [3, 3],
  ports: { in: backAndSides(3, 3), out: [{ at: front(3, 1), sends: "out" }] },
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
