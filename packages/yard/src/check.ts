/**
 * The check: one number that tells two yards apart. Leaf answers a batch of commands with it rather
 * than with the yard (`WORKS.answer`), and the page works it out on its own copy for the same tick:
 * the same number is the same yard, as far as the rules can tell.
 *
 * One pass mixes in, a 32-bit word at a time (FNV's multiply), every field the rules read: every
 * part of every piece, and everything of the yard's that is kept. Left out are what only Leaf holds
 * (`seed`), what Leaf and the page each move by their own clock (`at`, the moment a tick stands for,
 * which Leaf sets again while a yard stands still), the letter only the page is shown (`away`), the
 * news, and whatever is worked out again from the rest: power, the plumbing, what is open and how
 * fast, a machine's `idle`, `kinds` and `count`, where a thing on a belt came from (`via`), and an
 * order's words. Things, kinds, plots and plans are numbered by the rules' own lists, and a number
 * that is not whole is mixed by its bits, so that any two places running these rules agree.
 */
import { ITEMS, type Tally } from "./content/items.ts";
import { KINDS } from "./content/machines.ts";
import { PLAN_IDS } from "./content/plans.ts";
import { PLOT_IDS } from "./content/plots.ts";
import type { Building, World } from "./world.ts";

/** A thing's, a kind's, a plot's and a plan's number, from 1: 0 is none. */
const numbered = <K extends string>(list: readonly K[]): ReadonlyMap<K | null, number> =>
  new Map<K | null, number>([[null, 0], ...list.map((k, i): [K, number] => [k, i + 1])]);
const ITEM_NO = numbered(ITEMS);
const KIND_NO = numbered(KINDS);
const PLOT_NO = numbered(PLOT_IDS);
const PLAN_NO = numbered(PLAN_IDS);

const bits = new Float64Array(1);
const words = new Uint32Array(bits.buffer);
let h = 0;

const mix = (v: number): void => {
  h = Math.imul(h ^ v, 0x01000193);
};
/** A number: a whole one that fits a word as itself, any other by its 64 bits. */
function num(x: number): void {
  if ((x | 0) === x) return mix(x);
  bits[0] = x;
  mix(words[0] ?? 0);
  mix(words[1] ?? 0);
}
/** A count of things: each that is there, by its number, then an end. */
function tally(t: Tally): void {
  for (const [k, item] of ITEMS.entries()) {
    const n = t[item] ?? 0;
    if (n === 0) continue;
    mix(k + 1);
    num(n);
  }
  mix(0);
}
const item = (k: Parameters<typeof ITEM_NO.get>[0]): number => ITEM_NO.get(k) ?? 0;

/** Every part of a piece the rules read. */
function piece(b: Building): void {
  mix(((KIND_NO.get(b.kind) ?? 0) << 2) | b.dir);
  mix(item(b.out) | (item(b.making) << 5) | (item(b.recipe) << 10) | (item(b.item) << 15));
  mix(b.turn | (b.shut << 2) | (b.tint << 5) | ((b.span + 8) << 8) | (Number(b.open) << 12) | (Number(b.free) << 13));
  if (b.item !== null) num(b.prog);
  if (b.work !== 0) num(b.work);
  if (b.fuel !== 0) num(b.fuel);
  if (b.count > 0) tally(b.buf);
  for (let k = 0; k < b.span; k++) {
    mix(item(b.under[k] ?? null));
    num(b.underProg[k] ?? 0);
  }
}

/** The yard's check: a whole number from 0 up to 2^32. */
export function check(w: World): number {
  h = 0x811c9dc5 | 0;
  for (const n of [w.tick, w.till, w.bank, w.told, w.seen.tick, w.seen.till, w.story, w.serial, w.done, w.swapAt])
    num(n);
  for (const n of [w.sold, w.paid, w.pace.ticks, w.pace.warm]) num(n);
  for (const t of [w.seen.depot, w.filled, w.depot, w.given, w.pace.made]) tally(t);
  for (const p of w.plots) mix(PLOT_NO.get(p) ?? 0);
  mix(0);
  for (const p of w.plans) mix(PLAN_NO.get(p) ?? 0);
  mix(0);
  for (const kind of KINDS) num(w.spare[kind] ?? 0);
  for (const o of w.board) {
    num(o.id);
    num(o.pay);
    tally(o.want);
    tally(o.filled);
  }
  mix(w.board.length);
  for (const print of w.blueprints) {
    for (const p of print ?? []) {
      mix(((KIND_NO.get(p.kind) ?? 0) << 2) | p.dir);
      mix(p.x | (p.y << 8) | ((p.span + 8) << 16) | ((p.tint ?? 0) << 20));
      mix(item(p.recipe ?? null) | ((p.shut ?? 0) << 5) | (Number(p.open ?? true) << 8));
    }
    mix(print === null ? -1 : print.length);
  }
  const { cells } = w;
  for (let i = 0; i < cells.length; i++) {
    const b = cells[i];
    if (!b) continue;
    mix(i);
    piece(b);
  }
  return h >>> 0;
}
