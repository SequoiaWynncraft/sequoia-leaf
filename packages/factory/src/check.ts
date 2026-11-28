/**
 * The check: one pass over the yard into 32 bits, for Leaf and the page to compare their copies at a
 * tick without sending the yard. It mixes in everything `decode` keeps of the rules' state: the
 * clock, the power put by, the till and its counter, the goals (those done, in order, the node in
 * hand and those in line after it, the line of research, and what each goal not done has been
 * given) and the board (each order's wants, what came in, its pay, its words and when it began to
 * count), the plots owned, cleared and being cleared (with what it has been given), and the redwoods felled, the depot's books (what awards and the standing are read from), what was seen at the
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
import { spanByte } from "./bytes.ts";
import { fromCorner, tileFromCorner } from "./keptland.ts";
import type { Land } from "./land.ts";
import { counting } from "./orders.ts";
import { waysOn } from "./pieces.ts";
import { ITEM_COUNT, NODE_COUNT, NONE, SPAN_MOST } from "./tables.ts";
import { type Counts, holderOf, type Holders, PIECE_BYTES, tunnelOf, type Tunnels, type Yard } from "./yard.ts";

/** The kinds a kind's first four bits name: what every yard's check was taken over before kinds went past them. */
const FOUR_BITS = 16;
/**
 * How many tiles of a tunnel's row under the ground the check mixes in at least, empty or not: as
 * many as a tunnel could run under when every check kept today was made, so that a deeper culvert
 * changes no yard's check. A tunnel that runs under more mixes in each tile it runs under.
 */
const ROW_MIXED = 5;

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

/**
 * The piece on a tile as a number: its kind, way, place among those to hand, what it carries, how far
 * across (under 16, four bits), and its grade. A kind's bits past four go above how far across, where
 * a kind of four bits has none, so its pieces' numbers are as they always were.
 */
const pieceWord = (y: Yard, i: number): number =>
  ((y.kind[i] ?? 0) & 15) |
  (((y.kind[i] ?? 0) & 0xf0) << 16) |
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
  (spanByte(y.span[i] ?? 0) << 16) |
  ((y.set[i] ?? 0) << 24);

/** What a holder is at as a number: the thing it has made, what it is making, its fuel and whether it is open. */
const doingWord = (hs: Holders, r: number): number =>
  (hs.out[r] ?? 0) | ((hs.making[r] ?? 0) << 8) | ((hs.fuel[r] ?? 0) << 16) | ((hs.open[r] ?? 0) << 24);
/** How much a holder holds as a number: how many kinds of thing, and how many things. */
const heldWord = (hs: Holders, r: number): number => (hs.kinds[r] ?? 0) | ((hs.count[r] ?? 0) << 8);
/** A tile under a tunnel as a number: what is there, and how far along it is. */
const underWord = (ts: Tunnels, s: number): number => (ts.under[s] ?? 0) | ((ts.along[s] ?? 0) << 8);

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

/**
 * Mixes in the plots owned, in the order they were bought; those cleared, in the order they were
 * handed over, how many were begun, and the one being cleared with its number and what it has been
 * given, only where there are any; and
 * each redwood felled by its first tile; making nothing.
 */
function mixLand(y: Yard, mix: (v: number) => void): void {
  for (let k = 0; k < y.plots.length; k++) mix((y.plots[k] ?? 0) + 32);
  for (let k = 0; k < y.cleared.length; k++) mix(0x20000 + (y.cleared[k] ?? 0));
  if (y.begun > 0) mix(0x60000 + y.begun);
  if (y.clearing) {
    mix(0x30000 + y.clearing.plot);
    mix(y.clearing.begun);
    mixTally(mix, y.clearing.filled);
  }
  for (let t = 0; t < y.felled.length; t++)
    if (y.felled[t] === 1) {
      mix(0x10000);
      mix(tileFromCorner(y.land, y.land.trees[t]?.[0] ?? 0));
    }
}

/**
 * Mixes in the pieces to hand, by kind: of the sixteen kinds a kind's four bits once held, how many
 * and each, as they always were; of a kind past them, only where there is one, so that a kind a yard
 * has none of changes nothing.
 */
function mixSpare(spare: Uint8Array, mix: (v: number) => void): void {
  mix(Math.min(spare.length, FOUR_BITS));
  for (let k = 0; k < spare.length; k++)
    if (k < FOUR_BITS) mix(spare[k] ?? 0);
    else if ((spare[k] ?? 0) > 0) mix(0x30000 | (k << 8) | (spare[k] ?? 0));
}

/** Mixes in a number, as its 64 bits. */
function mixNum(mix: (v: number) => void, x: number): void {
  f64[0] = x;
  mix(u32[0] ?? 0);
  mix(u32[1] ?? 0);
}

/** Mixes in counts of things: each thing there is some of and how many, then -1. */
function mixTally(mix: (v: number) => void, c: Counts): void {
  for (let n = 0; n < ITEM_COUNT; n++)
    if ((c[n] ?? 0) !== 0) {
      mix(n);
      mixNum(mix, c[n] ?? 0);
    }
  mix(-1);
}

/** Mixes in some text: how long, and each of its characters. */
function mixWords(mix: (v: number) => void, s: string): void {
  mix(s.length);
  for (let c = 0; c < s.length; c++) mix(s.charCodeAt(c));
}

/**
 * How many nodes the tables had when every yard's check was first taken over its goals: tiers 0 to
 * 4's. The tables number the nodes first and research after them, so a node added since moves every
 * piece of research along; the check mixes in each goal by the number it had then (`goalWord`), so
 * that a yard's check does not change with nodes it has nothing to do with.
 */
const NODES_THEN = 31;
/** Where a node added since is mixed in: above every number a piece of research may have. */
const LATER_NODES = 0x10000;
/** A goal as the check mixes it in: by the number it had among the nodes there were then, and -1 for none. */
const goalWord = (g: number): number =>
  g < NODES_THEN ? g : g < NODE_COUNT ? LATER_NODES + g - NODES_THEN : g - (NODE_COUNT - NODES_THEN);

/** Mixes in the goals done, in hand, queued and in line, and what was got for each, then what was handed and paid. */
function mixGoals(y: Yard, mix: (v: number) => void): void {
  for (const g of y.done) mix(goalWord(g));
  mix(-1);
  mix(goalWord(y.hand));
  for (const g of y.queue) mix(goalWord(g));
  mix(-1);
  for (const g of y.line) mix(goalWord(g));
  mix(-1);
  y.got.forEach((got, g) => {
    if (got === null) return;
    mix(goalWord(g));
    mixTally(mix, got);
  });
  mix(y.handed);
}

/** Mixes in the orders on the board that count, each with its pay, words, what it wants and what it has. */
function mixBoard(y: Yard, mix: (v: number) => void): void {
  for (const o of y.board) {
    if (!counting(o, y.tick)) continue;
    mix(o.id);
    mixNum(mix, o.starts);
    mixNum(mix, o.pay);
    mixWords(mix, o.title);
    mixWords(mix, o.from);
    mixWords(mix, o.line);
    mixTally(mix, o.want);
    mixTally(mix, o.filled);
  }
}

/** The yard in 32 bits. */
export function check(y: Yard): number {
  let h = 0x811c9dc5 | 0;
  const mix = (v: number): void => {
    h = Math.imul(h ^ v, 0x01000193);
  };
  mixNum(mix, y.tick);
  mix(y.charge);
  mixNum(mix, y.till);
  mixNum(mix, y.bank);
  mix(y.told);
  mixGoals(y, mix);
  mixNum(mix, y.swapAt);
  mixNum(mix, y.sold);
  mixNum(mix, y.paid);
  mixNum(mix, y.seen.tick);
  mixNum(mix, y.seen.till);
  mixTally(mix, y.seen.depot);
  mixLand(y, mix);
  mixSpare(y.spare, mix);
  mixKept(y, mix);
  mixTally(mix, y.depot);
  mixBoard(y, mix);
  const { kind, holders: hs, tunnels: ts } = y;
  for (let i = 0; i < kind.length; i++) {
    const k = kind[i] ?? NONE;
    if (k === NONE) continue;
    mix(tileFromCorner(y.land, i));
    mix(pieceWord(y, i));
    mix(settingsWord(y, i));
    const t = tunnelOf(y, i);
    if (t >= 0) {
      const row = Math.max(ROW_MIXED, y.span[i] ?? 0);
      for (let s = t * SPAN_MOST; s < t * SPAN_MOST + row; s++) mix(underWord(ts, s));
      continue;
    }
    const r = holderOf(y, i);
    if (r >= 0) mixHolder(hs, r, mix);
  }
  return h >>> 0;
}

/** A holder's row: what it is doing and holding, its work, and how many of each thing. */
function mixHolder(hs: Yard["holders"], r: number, mix: (n: number) => void): void {
  mix(doingWord(hs, r));
  // A by-product held is mixed in only where there is one, so a yard of pieces that make none checks as before.
  if (hs.also[r] !== NONE) mix(0x10000 | (hs.also[r] ?? 0));
  // So are more finished things waiting behind the first (`Holders.more`): only an assembler holds any.
  if ((hs.more[r] ?? 0) > 0) mix(0x20000 | (hs.more[r] ?? 0));
  mix(heldWord(hs, r));
  mix(hs.work[r] ?? 0);
  for (let n = 0; n < ITEM_COUNT; n++) {
    const c = hs.stock[r * ITEM_COUNT + n] ?? 0;
    if (c > 0) mix(n | (c << 8));
  }
}
