import type { KeptPiece } from "../cells.ts";
/** The gatherer: stands on a deposit and gathers its thing, one every 15 ticks at grade 1, and hands it ahead. */
import { TICKS } from "../content/machines.ts";
import type { Counts, Yard } from "../yard.ts";
import { handOut, readyOut, stockOnto, workOnto } from "./holder.ts";
import { kind, type Words } from "./kind.ts";
import type { Kit } from "./kit.ts";
import { aheadOf } from "./line.ts";
import { outWords } from "./maker.ts";
import { as, asItem, many, NO_POWER, rateOf, slow, stuckAs } from "./say.ts";

/** The work in gathering one thing, in half-ticks. */
const WORK = TICKS.gather * 2;

/** It gathers at its grade's pace, and once a thing is gathered it holds it out to hand on. */
function work(k: Kit, y: Yard, i: number, r: number, speed: number): void {
  const h = y.holders;
  h.work[r] = (h.work[r] ?? 0) + speed;
  if ((h.work[r] ?? 0) >= WORK) {
    h.work[r] = (h.work[r] ?? 0) - WORK;
    h.out[r] = y.land.deposit[i] ?? k.NONE;
  }
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
  return { line: `Gathering ${what === null ? "nothing" : many(k, what)}${slow(k, y)}.` };
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
  workOnto(k, y, r, o, WORK);
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
