/**
 * The check: one pass over the yard into 32 bits, for Leaf and the page to compare their copies at a
 * tick without sending the yard. It mixes in everything the rules read as the yard runs: the clock,
 * the till, the story and the board, and every part of every piece, tile by tile, numbered by the
 * tables. It leaves out what only Leaf holds (the seed, its clock's moment, the letter) and what is
 * worked out again when read (a machine's note that it found nothing to start on), so a yard read
 * back from its kept form gives the same check. Fractions are mixed in by their bits.
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
  };
  mix(y.tick);
  mix(y.seen.tick);
  num(y.till);
  mix(y.bank);
  mix(y.story);
  mix(y.serial);
  mix(y.done);
  num(y.swapAt);
  for (const p of y.plots) mix(p + 32);
  for (const p of y.plans) mix(p + 64);
  tally(y.filled);
  for (const o of y.board) {
    mix(o.id);
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
    mix((hs.fuel[r] ?? 0) | ((hs.count[r] ?? 0) << 8));
    num(hs.work[r] ?? 0);
    for (let n = 0; n < ITEM_COUNT; n++) {
      const c = hs.stock[r * ITEM_COUNT + n] ?? 0;
      if (c > 0) mix(n | (c << 8));
    }
  }
  return h >>> 0;
}
