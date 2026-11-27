/**
 * The way of playing of a piece that breaks one thing into several (`MIX_OF`, `content/mixes.ts`),
 * shared by the breaker and, from tier 6, the still: it takes in only its mix's thing, up to so many;
 * each run of work uses one and gives the next thing of its mix, round and round, its place in the mix
 * kept on its row (`Holders.mix`); it holds that one finished thing and makes nothing more until it
 * has left by its way out; and each thing it finishes adds its kind's smog to its plot (`smog.ts`).
 */
import type { KeptPiece } from "../cells.ts";
import type { Mix } from "../tables.ts";
import type { Counts, Wire, Yard } from "../yard.ts";
import { handPorts, readyPorts } from "./big.ts";
import { keep, stockOnto, workOnto } from "./holder.ts";
import type { Hooks, Words } from "./kind.ts";
import type { Kit } from "./kit.ts";
import { outWords } from "./maker.ts";
import { as, asItem, many, NO_POWER, slow, stuckAs } from "./say.ts";

/** The mix of the piece on a tile. */
const mixOf = (k: Kit, y: Yard, i: number): Mix | null => k.MIX_OF[y.kind[i] ?? k.NONE] ?? null;

/** It takes its mix's thing, and nothing else. */
const wants = (k: Kit, y: Yard, i: number, n: number): boolean => mixOf(k, y, i)?.from === n;

/** It has room for its mix's thing while it holds fewer than its mix says. */
function room(k: Kit, y: Yard, i: number, n: number): boolean {
  const m = mixOf(k, y, i);
  return m !== null && m.from === n && (y.holders.stock[k.holderOf(y, i) * k.ITEM_COUNT + n] ?? 0) < m.holds;
}

/**
 * Its step in the tick's work (the tick passes over it while it holds something finished): with its
 * mix's thing to hand, work at its grade's pace; a run done uses one, gives the next of its mix, moves
 * its place on, and adds its smog to its plot.
 */
export function work(k: Kit, y: Yard, i: number, r: number, speed: number, wire: Wire): void {
  const m = mixOf(k, y, i);
  const h = y.holders;
  if (!m || (h.stock[r * k.ITEM_COUNT + m.from] ?? 0) === 0) return;
  h.work[r] = (h.work[r] ?? 0) + speed;
  if ((h.work[r] ?? 0) < m.work) return;
  h.work[r] = (h.work[r] ?? 0) - m.work;
  k.take(h, r, m.from);
  const place = h.mix[r] ?? 0;
  h.out[r] = m.gives[place] ?? k.NONE;
  h.mix[r] = (place + 1) % m.gives.length;
  k.smogged(y, i, k.SMOG_OF[y.kind[i] ?? k.NONE] ?? 0);
  k.roomBeside(y, i, wire.waiting);
}

/** How it stands: with no power; holding a finished thing (waiting, or blocked where nothing ahead takes it); at work while it holds its mix's thing; else waiting for it. */
function condition(k: Kit, y: Yard, i: number, lit: boolean): number {
  if (!lit) return as("unpowered", true);
  const m = mixOf(k, y, i);
  const r = k.holderOf(y, i);
  const out = asItem(k, y.holders.out[r] ?? k.NONE);
  if (out !== null) return stuckAs(k, y, i, out);
  return m && k.held(y.holders, r, m.from) > 0 ? as("working") : as("waiting");
}

/** Its words: "Breaking salvage.", "Waiting for salvage.", or what it holds with no room ahead. */
function words(k: Kit, y: Yard, i: number, state: string): Words {
  if (state === "unpowered") return { line: NO_POWER };
  const m = mixOf(k, y, i);
  const out = asItem(k, y.holders.out[k.holderOf(y, i)] ?? k.NONE);
  if (out !== null) return outWords(k, y, i, state, out);
  if (!m) return { line: "" };
  return state === "working"
    ? { line: `${m.doing} ${many(k, m.from)}${slow(k, y, i)}.` }
    : { line: `Waiting for ${many(k, m.from)}.`, missing: [m.from] };
}

/** Its runs a minute at its grade's pace, at full power. */
export const runsOf = (k: Kit, m: Mix, grade: number): number => (k.MINUTE * (k.PACE[grade] ?? 0)) / m.work;

/** What it adds a minute to what the yard makes and needs: each thing of its mix at its share, and one of its mix's thing a run. */
function flow(k: Kit, y: Yard, i: number, made: Counts, needed: Counts): void {
  const m = mixOf(k, y, i);
  if (!m) return;
  const runs = runsOf(k, m, y.grade[i] ?? 0) * k.pace(y) * k.smogPace(y, i);
  for (const n of m.gives) made[n] = (made[n] ?? 0) + runs / m.gives.length;
  needed[m.from] = (needed[m.from] ?? 0) + runs;
}

/** How many of a thing it may hold: its mix's thing, as many as its mix says. */
const most = (k: Kit, y: Yard, i: number, n: number): number => {
  const m = mixOf(k, y, i);
  return m && m.from === n ? m.holds : 0;
};

/** Puts back what a kept one held and was doing: its mix's thing, a finished thing of its mix, its place in it, its work below a run's. */
function onto(k: Kit, y: Yard, i: number, r: number, o: KeptPiece): void {
  const m = mixOf(k, y, i);
  if (!m) return;
  stockOnto(k, y, i, r, o, m.holds);
  const out = o.out;
  if (out !== undefined && k.isItem(out) && m.gives.includes(out)) y.holders.out[r] = out;
  y.holders.mix[r] = k.whole(o.mix, m.gives.length - 1) ?? 0;
  workOnto(k, y, r, o, m.work);
}

/** A piece that breaks one thing into several, of more than one tile: it hands on by its ways out. */
export const MIXER: Hooks = {
  wants,
  room,
  give: keep,
  hands: handPorts,
  ready: readyPorts,
  next: (k, y, i) => k.portTo(y, i, 0),
  work,
  condition,
  words,
  flow,
  most,
  onto,
};
