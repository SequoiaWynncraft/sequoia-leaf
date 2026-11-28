import type { KeptPiece } from "../cells.ts";
/**
 * The gatherer: stands on a deposit and gathers its thing, one every 15 ticks at grade 1, or as long as
 * the thing's own time says (`ItemInfo.gather`: a star crystal 1,500), and hands it ahead.
 */
import { TICKS } from "../content/machines.ts";
import type { Item } from "../tables.ts";
import type { Counts, Yard } from "../yard.ts";
import { handOut, readyOut, stockOnto, workOnto } from "./holder.ts";
import { kind, type Words } from "./kind.ts";
import type { Kit } from "./kit.ts";
import { aheadOf } from "./line.ts";
import { outWords } from "./maker.ts";
import { as, asItem, many, NO_POWER, rateOf, slow, stuckAs } from "./say.ts";

/** The work in gathering one thing, in half-ticks, as a kind's: what most things take. */
const WORK = TICKS.gather * 2;
/** The work in gathering one of what lies under a tile, in half-ticks (`GATHER_WORK`). */
const workFor = (k: Kit, y: Yard, i: number): number => k.GATHER_WORK[y.land.deposit[i] ?? k.NONE] ?? WORK;

/** It gathers at its grade's pace, and once a thing is gathered it holds it out to hand on. It always has something to work on. */
function work(k: Kit, y: Yard, i: number, r: number, speed: number): boolean {
  const h = y.holders;
  h.work[r] = (h.work[r] ?? 0) + speed;
  // Most things take a gatherer's own time, which is the least any takes: what lies under it is read
  // only once that is reached.
  if ((h.work[r] ?? 0) < WORK) return true;
  const n = y.land.deposit[i] ?? k.NONE;
  const need = k.GATHER_WORK[n] ?? WORK;
  if ((h.work[r] ?? 0) >= need) {
    h.work[r] = (h.work[r] ?? 0) - need;
    h.out[r] = n;
  }
  return true;
}

/**
 * ": 1 every 75 seconds", for a thing that takes its own time to gather, at the pace its headline says
 * (`rateOf`), as its grade, the yard's power and smog let it; nothing for the rest.
 */
function slowly(k: Kit, y: Yard, i: number, n: Item): string {
  if (k.ITEM_INFO[n]?.gather === undefined) return "";
  const perMinute = rateOf(k, y, i, null).effective;
  return perMinute > 0 ? `: 1 every ${Math.round(60 / perMinute)} seconds` : "";
}

function condition(k: Kit, y: Yard, i: number, lit: boolean): number {
  if (!lit) return as("unpowered", true);
  const out = y.holders.out[k.holderOf(y, i)] ?? k.NONE;
  return k.isItem(out) ? stuckAs(k, y, i, out) : as("working");
}

function words(k: Kit, y: Yard, i: number, state: string): Words {
  if (state === "unpowered") return { line: NO_POWER };
  const out = asItem(k, y.holders.out[k.holderOf(y, i)] ?? k.NONE);
  if (out !== null) return outWords(k, y, i, state, out);
  const what = asItem(k, y.land.deposit[i] ?? k.NONE);
  if (what === null) return { line: `Gathering nothing${slow(k, y, i)}.` };
  return { line: `Gathering ${many(k, what)}${slowly(k, y, i, what)}${slow(k, y, i)}.` };
}

/** What it adds a minute: its deposit's thing, made. */
function flow(k: Kit, y: Yard, i: number, made: Counts): void {
  const n = y.land.deposit[i] ?? k.NONE;
  if (k.isItem(n)) made[n] = (made[n] ?? 0) + rateOf(k, y, i, null).effective;
}

/** A kept gatherer: holding nothing, its thing out only if it is from the ground, and its work below a thing's. */
function onto(k: Kit, y: Yard, i: number, r: number, o: KeptPiece): void {
  stockOnto(k, y, i, r, o, 1e6);
  if (o.out !== undefined && k.isItem(o.out) && k.isRaw(o.out)) y.holders.out[r] = o.out;
  workOnto(k, y, r, o, workFor(k, y, i));
}

export const gatherer = kind({
  name: "gatherer",
  info: {
    name: "Gatherer",
    cost: 10,
    draw: 1,
    gives: 0,
    what: "Place it on a deposit. It gathers that deposit's item.",
  },
  graded: true,
  starters: 1,
  holds: true,
  gathers: true,
  work: WORK,
  does: ["Gathers", "items"],
  rules: {
    next: aheadOf,
    hands: handOut,
    ready: readyOut,
    work,
    refusal: (k, y, i) => (y.land.deposit[i] === k.NONE ? "A gatherer must be placed on a deposit" : null),
    condition,
    words,
    flow,
    onto,
  },
});
