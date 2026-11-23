/**
 * The check: one pass over the yard into 32 bits, for Leaf and the page to compare their copies at a
 * tick without sending the yard. It mixes in everything the rules read: the clock, the power put by,
 * the till and its counter, the goals (those done, in order, the node in hand, the line of research, and
 * what each goal not done has been given) and the board (each order's wants, what came in, its pay and its words), the
 * depot's books (what awards and the standing are read from), what was seen at the owner's last
 * command, the pace, the pieces to hand, the blueprints, and every part of every piece, tile by tile,
 * numbered by the tables. Numbers that may pass 32 bits (the clock's Coins, the books) are mixed in by
 * both halves of their 64.
 *
 * It leaves out only what a yard read back from its kept form works out again or never had, so that
 * one gives the same check: what only Leaf holds and moves (the seed and `serial`, the orders ever
 * hung, and the orders hung that do not count yet, which the page may not have heard of; its clock's
 * moment; the letter); an order's `starts`, which nothing reads once it counts; news no
 * screen has taken; what is worked out from the rest (what is open, where power reaches and the
 * plumbing, a machine's note that it found nothing to start on); and which row
 * of a side table holds a piece's parts, which reading a yard back may change. `test/codec.test.ts`
 * changes every other part of a yard in turn and fails if the check does not change with it.
 */
import { counting } from "./orders.ts";
import { ITEM_COUNT, NONE, SPAN_MOST } from "./tables.ts";
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
  mix(y.charge);
  num(y.till);
  mix(y.bank);
  mix(y.told);
  for (const g of y.done) mix(g);
  mix(-1);
  mix(y.hand);
  for (const g of y.line) mix(g);
  mix(-1);
  y.got.forEach((got, g) => {
    if (got === null) return;
    mix(g);
    tally(got);
  });
  mix(y.handed);
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
  bytes(y.spare);
  for (const b of y.blueprints) bytes(b);
  tally(y.depot);
  for (const o of y.board) {
    if (!counting(o, y.tick)) continue;
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
    mix(
      k |
        ((y.dir[i] ?? 0) << 4) |
        ((y.item[i] ?? 0) << 8) |
        ((y.prog[i] ?? 0) << 16) |
        ((y.via[i] ?? 0) << 24) |
        ((y.grade[i] ?? 0) << 28),
    );
    mix(
      (y.tint[i] ?? 0) |
        ((y.turn[i] ?? 0) << 4) |
        ((y.shut[i] ?? 0) << 8) |
        ((y.free[i] ?? 0) << 12) |
        (((y.span[i] ?? 0) + 8) << 16) |
        ((y.set[i] ?? 0) << 24),
    );
    const r = y.row[i] ?? -1;
    if (r < 0) continue;
    if ((y.span[i] ?? 0) > 0) {
      for (let s = r * SPAN_MOST; s < r * SPAN_MOST + SPAN_MOST; s++)
        mix((ts.under[s] ?? 0) | ((ts.along[s] ?? 0) << 8));
      continue;
    }
    mix((hs.out[r] ?? 0) | ((hs.making[r] ?? 0) << 8) | ((hs.fuel[r] ?? 0) << 16) | ((hs.open[r] ?? 0) << 24));
    mix((hs.kinds[r] ?? 0) | ((hs.count[r] ?? 0) << 8));
    mix(hs.work[r] ?? 0);
    for (let n = 0; n < ITEM_COUNT; n++) {
      const c = hs.stock[r * ITEM_COUNT + n] ?? 0;
      if (c > 0) mix(n | (c << 8));
    }
  }
  return h >>> 0;
}
