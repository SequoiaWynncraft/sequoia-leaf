/**
 * The check: one pass over the yard into 32 bits, for Leaf and the page to compare their copies at a
 * tick without sending the yard. It mixes in everything the rules read: the clock, the till and its
 * counter, the story and the board (each order's wants, what came in, its pay and its words), the
 * depot's books (what awards and the standing are read from), what was seen at the owner's last
 * command, the pace, the pieces to hand, the blueprints, and every part of every piece, tile by tile,
 * numbered by the tables. Fractions are mixed in by their bits.
 *
 * It leaves out only what a yard read back from its kept form works out again or never had, so that
 * one gives the same check: what only Leaf holds (the seed, its clock's moment, the letter); news no
 * screen has taken; what is worked out from the rest (what is open and how fast things go, where
 * power reaches and the plumbing, a machine's note that it found nothing to start on); and which row
 * of a side table holds a piece's parts, which reading a yard back may change. `test/codec.test.ts`
 * changes every other part of a yard in turn and fails if the check does not change with it.
 */
import { SPAN } from "./content/machines.ts";
import { ITEM_COUNT, NONE } from "./tables.ts";
import type { Counts, Yard } from "./yard.ts";

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

/** The yard in 32 bits. */
export function check(y: Yard): number {
  let h = 0x811c9dc5 | 0;
  const mix = (v: number): void => {
    h = Math.imul(h ^ v, 0x01000193);
  };
  const num = (x: number): void => {
    f64[0] = x;
    mix(u32[0] ?? 0);
    mix(u32[1] ?? 0);
  };
  const tally = (c: Counts): void => {
    for (let n = 0; n < ITEM_COUNT; n++)
      if ((c[n] ?? 0) !== 0) {
        mix(n);
        num(c[n] ?? 0);
      }
    mix(-1);
  };
  const words = (s: string): void => {
    mix(s.length);
    for (let c = 0; c < s.length; c++) mix(s.charCodeAt(c));
  };
  const bytes = (b: Uint8Array | null): void => {
    mix(b === null ? -1 : b.length);
    for (const v of b ?? []) mix(v);
  };
  mix(y.tick);
  num(y.till);
  mix(y.bank);
  mix(y.told);
  mix(y.story);
  mix(y.serial);
  mix(y.done);
  num(y.swapAt);
  num(y.sold);
  num(y.paid);
  mix(y.seen.tick);
  num(y.seen.till);
  tally(y.seen.depot);
  num(y.pace.ticks);
  mix(y.pace.warm);
  tally(y.pace.made);
  for (const p of y.plots) mix(p + 32);
  for (const p of y.plans) mix(p + 64);
  bytes(y.spare);
  for (const b of y.blueprints) bytes(b);
  tally(y.filled);
  tally(y.depot);
  tally(y.given);
  for (const o of y.board) {
    mix(o.id);
    num(o.pay);
    words(o.title);
    words(o.from);
    words(o.line);
    tally(o.want);
    tally(o.filled);
  }
  const { kind, holders: hs, tunnels: ts } = y;
  for (let i = 0; i < kind.length; i++) {
    const k = kind[i] ?? NONE;
    if (k === NONE) continue;
    mix(i);
    mix(k | ((y.dir[i] ?? 0) << 4) | ((y.item[i] ?? 0) << 8) | ((y.prog[i] ?? 0) << 16) | ((y.via[i] ?? 0) << 24));
    mix(
      (y.tint[i] ?? 0) |
        ((y.turn[i] ?? 0) << 4) |
        ((y.shut[i] ?? 0) << 8) |
        ((y.free[i] ?? 0) << 12) |
        (((y.span[i] ?? 0) + 8) << 16),
    );
    const r = y.row[i] ?? -1;
    if (r < 0) continue;
    if ((y.span[i] ?? 0) > 0) {
      for (let s = r * SPAN; s < r * SPAN + SPAN; s++) mix((ts.under[s] ?? 0) | ((ts.along[s] ?? 0) << 8));
      continue;
    }
    mix((hs.out[r] ?? 0) | ((hs.making[r] ?? 0) << 8) | ((hs.recipe[r] ?? 0) << 16) | ((hs.open[r] ?? 0) << 24));
    mix((hs.fuel[r] ?? 0) | ((hs.kinds[r] ?? 0) << 8) | ((hs.count[r] ?? 0) << 16));
    num(hs.work[r] ?? 0);
    for (let n = 0; n < ITEM_COUNT; n++) {
      const c = hs.stock[r * ITEM_COUNT + n] ?? 0;
      if (c > 0) mix(n | (c << 8));
    }
  }
  return h >>> 0;
}
