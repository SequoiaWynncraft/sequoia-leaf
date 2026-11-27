/**
 * The check: one pass over the yard into 32 bits, for Leaf and the page to compare their copies at a
 * tick without sending the yard. It mixes in everything `decode` keeps of the rules' state: the
 * clock, the power put by, the till and its counter, the goals (those done, in order, the node in
 * hand and those in line after it, the line of research, and what each goal not done has been
 * given) and the board (each order's wants, what came in, its pay, its words and when it began to
 * count), the plots owned and the redwoods felled, the depot's books (what awards and the standing are read from), what was seen at the
 * owner's last command, the pieces to hand, the blueprints, what Undo would undo (each entry's bytes:
 * its id is worked out from them), and every part of every piece, tile by
 * tile, numbered by the tables. Every tile it mixes in (a piece's, a redwood felled, a piece of a plan
 * of the whole yard) is mixed in as how far it is from the yard plot's corner (`fromCorner`), so the
 * same yard has the same check on a land of any size: more land round it changes nothing. Every number that may pass 32 bits (the clock, the counters, the
 * Coins, the books) is mixed in by both halves of its 64.
 *
 * It leaves out only what a yard read back from its kept form works out again or never had, so that
 * one gives the same check: what only Leaf holds and moves (the seed and `serial`, the orders ever
 * hung, and the orders hung that do not count yet, which the page may not have heard of; its clock's
 * moment; the letter); news no screen has taken, and the count of changes (`rev`); what is worked out from the rest (what is open,
 * where power reaches and the plumbing, a machine's note that it found nothing to start on); the
 * recipe a machine last began, which only a screen reads and nothing keeps; and which row of a side
 * table holds a piece's parts, which reading a yard back may change.
 * `test/codec.test.ts` changes every other part of a yard in turn and fails if the check does not
 * change with it.
 */
import { fromCorner, tileFromCorner } from "./keptland.ts";
import type { Land } from "./land.ts";
import { counting } from "./orders.ts";
import { waysOn } from "./pieces.ts";
import { ITEM_COUNT, NONE, SPAN_MOST } from "./tables.ts";
import { type Counts, holderOf, PIECE_BYTES, tunnelOf, type Yard } from "./yard.ts";

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

/** The piece on a tile as a number: its kind, way, place among those to hand, what it carries and its grade. */
const pieceWord = (y: Yard, i: number): number =>
  (y.kind[i] ?? 0) |
  ((y.dir[i] ?? 0) << 4) |
  ((y.free[i] ?? 0) << 6) |
  ((y.item[i] ?? 0) << 8) |
  ((y.prog[i] ?? 0) << 16) |
  ((y.via[i] ?? 0) << 24) |
  ((y.grade[i] ?? 0) << 28);
/** The settings of the piece on a tile as a number: its line's colour, its next way, its ways, its span and what it is set to. */
const settingsWord = (y: Yard, i: number): number =>
  (y.tint[i] ?? 0) |
  ((y.turn[i] ?? 0) << 4) |
  (waysOn(y, i) << 8) |
  (((y.span[i] ?? 0) + 8) << 16) |
  ((y.set[i] ?? 0) << 24);

/** Mixes in some bytes, how many and then four at a time: a plan of the whole yard is some 16,000 of them. */
function mixBytes(b: Uint8Array, mix: (v: number) => void): void {
  mix(b.length);
  for (let k = 0; k < b.length; k += 4)
    mix((b[k] ?? 0) | ((b[k + 1] ?? 0) << 8) | ((b[k + 2] ?? 0) << 16) | ((b[k + 3] ?? 0) << 24));
}

/**
 * Mixes in a plan of the whole yard's pieces (`PIECE_BYTES` each: its kind, x, y, then its other
 * parts), how many bytes and then each piece, part by part, its x and y as one word of how far it is
 * from the yard plot's corner.
 */
function mixPlan(land: Land, b: Uint8Array, mix: (v: number) => void): void {
  mix(b.length);
  for (let k = 0; k + PIECE_BYTES <= b.length; k += PIECE_BYTES) {
    mix(b[k] ?? 0);
    mix(fromCorner(land, b[k + 1] ?? 0, b[k + 2] ?? 0));
    for (let part = 3; part < PIECE_BYTES; part++) mix(b[k + part] ?? 0);
  }
}

/**
 * Mixes in the yard's kept bytes: each of its blueprints (or none) and whether it is a plan of the
 * whole yard, then what Undo would undo, how many entries and each one's bytes (its id among them).
 */
function mixKept(y: Yard, mix: (v: number) => void): void {
  for (const b of y.blueprints) {
    if (b === null) mix(-1);
    else if (b.whole) {
      mix(-2);
      mixPlan(y.land, b.pieces, mix);
    } else {
      mix(-3);
      mixBytes(b.pieces, mix);
    }
  }
  mix(y.history.length);
  for (const { bytes } of y.history) mixBytes(bytes, mix);
}

/** Mixes in the plots owned, in the order they were bought, and each redwood felled by its first tile; making nothing. */
function mixLand(y: Yard, mix: (v: number) => void): void {
  for (let k = 0; k < y.plots.length; k++) mix((y.plots[k] ?? 0) + 32);
  for (let t = 0; t < y.felled.length; t++)
    if (y.felled[t] === 1) {
      mix(0x10000);
      mix(tileFromCorner(y.land, y.land.trees[t]?.[0] ?? 0));
    }
}

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
  num(y.tick);
  mix(y.charge);
  num(y.till);
  num(y.bank);
  mix(y.told);
  for (const g of y.done) mix(g);
  mix(-1);
  mix(y.hand);
  for (const g of y.queue) mix(g);
  mix(-1);
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
  num(y.seen.tick);
  num(y.seen.till);
  tally(y.seen.depot);
  mixLand(y, mix);
  bytes(y.spare);
  mixKept(y, mix);
  tally(y.depot);
  for (const o of y.board) {
    if (!counting(o, y.tick)) continue;
    mix(o.id);
    num(o.starts);
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
    mix(tileFromCorner(y.land, i));
    mix(pieceWord(y, i));
    mix(settingsWord(y, i));
    const t = tunnelOf(y, i);
    if (t >= 0) {
      for (let s = t * SPAN_MOST; s < t * SPAN_MOST + SPAN_MOST; s++)
        mix((ts.under[s] ?? 0) | ((ts.along[s] ?? 0) << 8));
      continue;
    }
    const r = holderOf(y, i);
    if (r < 0) continue;
    mix((hs.out[r] ?? 0) | ((hs.making[r] ?? 0) << 8) | ((hs.fuel[r] ?? 0) << 16) | ((hs.open[r] ?? 0) << 24));
    // A by-product held is mixed in only where there is one, so a yard of pieces that make none checks as before.
    if (hs.also[r] !== NONE) mix(0x10000 | (hs.also[r] ?? 0));
    mix((hs.kinds[r] ?? 0) | ((hs.count[r] ?? 0) << 8));
    mix(hs.work[r] ?? 0);
    for (let n = 0; n < ITEM_COUNT; n++) {
      const c = hs.stock[r * ITEM_COUNT + n] ?? 0;
      if (c > 0) mix(n | (c << 8));
    }
  }
  return h >>> 0;
}
