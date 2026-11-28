/**
 * What the page counts of each launch pad (SPEC-2 3.2: the pad's card; the rules keep nothing for it).
 * After each tick the page's copy runs, each pad is read beside how it stood the tick before
 * (`notePads`):
 *
 * - the charged cells that came in: what it holds now less what it held, with what a launch used (all
 *   of them: its parts went too) and what the beat turned plain (its cells with 1 bar) put back;
 * - the most charged cells it has held since its last launch, and the tick that most was reached, so
 *   that its card can say once it has stood for two beats that cells go flat as fast as they come;
 * - the tick of its last launch, which the frame is told of (`fx.ts`), for its rocket's rise and trail.
 *
 * Counted a second of the yard's clock at a time, a minute of seconds kept, for each pad by its own
 * tile; another yard begins again. Only what a tick moved is counted: after each command the page
 * plays each pad is read again as it stands (`commanded`), and one no longer standing is forgotten. A
 * yard with no pad runs on as it always has. Counting a tick makes no objects.
 */
import { beats, CHARGED, held, holderOf, kind, OWN, padAt, type Yard } from "@sequoia-leaf/factory";

import { launched as noteLaunch } from "./fx.ts";

const PAD = kind("launchpad");
/** Ticks in a second of the yard's clock, seconds counted over, and the ticks of two beats. */
const EVERY = 10;
const SECONDS = 60;
const TWO_BEATS = CHARGED.beat * 2;
const [ONE = 0, TWO = 0, THREE = 0] = CHARGED.bars;

/** One pad's count: how it stood a tick ago, its most since its last launch and when, its last launch, and what came in each second. */
interface Count {
  one: number;
  two: number;
  three: number;
  plain: number;
  parts: number;
  most: number;
  mostAt: number;
  launched: number;
  readonly second: Int32Array;
  readonly came: Int32Array;
}

/** What a pad's card says of what the page counted: the most since its last launch and whether it has stood two beats, and what came in over the last minute. */
export interface PadCounted {
  readonly most: number;
  readonly stood: boolean;
  readonly came: number;
  readonly seconds: number;
}

/** The yard counted, the count of changes its pads were last found at, its pads' own tiles, and each one's count. */
const kept = { yard: null as Yard | null, rev: -1, tiles: [] as number[], counts: new Map<number, Count>() };

/** The yard's pads, by their own tiles, found again whenever it changes. */
function padsOf(y: Yard): readonly number[] {
  if (kept.yard === y && kept.rev === y.rev) return kept.tiles;
  if (kept.yard !== y) kept.counts.clear();
  kept.yard = y;
  kept.rev = y.rev;
  kept.tiles = [];
  for (let i = 0; i < y.kind.length; i++) if (y.kind[i] === PAD && y.part[i] === OWN) kept.tiles.push(i);
  for (const t of kept.counts.keys()) if (!kept.tiles.includes(t)) kept.counts.delete(t);
  return kept.tiles;
}

/** Whether the page counts a tick at a time for a yard: while it has any pad. */
export const counting = (y: Yard): boolean => padsOf(y).length > 0;

/** All its rocket's parts a pad holds, in all: they go only with a launch, in a tick. */
function partsIn(y: Yard, i: number, r: number): number {
  const rocket = padAt(y, i)?.rocket;
  let n = 0;
  for (const p of rocket?.parts ?? []) n += held(y.holders, r, p.item);
  return n;
}

/** Sets a count's reading of a pad as it stands: its charged cells by bars, its plain cells, and its parts. */
function read(c: Count, y: Yard, i: number): void {
  const h = y.holders;
  const r = holderOf(y, i);
  c.one = held(h, r, ONE);
  c.two = held(h, r, TWO);
  c.three = held(h, r, THREE);
  c.plain = held(h, r, CHARGED.plain);
  c.parts = partsIn(y, i, r);
}

/** A pad's count, begun as it stands. */
function begun(y: Yard, i: number): Count {
  const c: Count = {
    one: 0,
    two: 0,
    three: 0,
    plain: 0,
    parts: 0,
    most: 0,
    mostAt: y.tick,
    launched: -1,
    second: new Int32Array(SECONDS + 1).fill(-1),
    came: new Int32Array(SECONDS + 1),
  };
  read(c, y, i);
  c.most = c.one + c.two + c.three;
  return c;
}

/** One pad's tick: what came in, its most, and a launch, from how it stood before and stands now. */
function noteOne(c: Count, y: Yard, i: number, beat: boolean, second: number, at: number): void {
  const h = y.holders;
  const r = holderOf(y, i);
  const [one, two, three, plain] = [held(h, r, ONE), held(h, r, TWO), held(h, r, THREE), held(h, r, CHARGED.plain)];
  const parts = partsIn(y, i, r);
  const launched = parts < c.parts;
  // What it held before what came in: nothing after a launch, which used every charged cell.
  const [b1, b2, b3] = launched ? [0, 0, 0] : [c.one, c.two, c.three];
  // On a beat what it held lost a bar after what came in had come: those with 1 bar went plain.
  const came = beat ? one + two - b2 - b3 + Math.max(0, plain - c.plain - b1) : one + two + three - b1 - b2 - b3;
  if (c.second[at] !== second) {
    c.second[at] = second;
    c.came[at] = 0;
  }
  c.came[at] = (c.came[at] ?? 0) + Math.max(0, came);
  const charged = one + two + three;
  if (launched) {
    c.launched = y.tick;
    // The frame shows its rocket rise (`fx.ts`).
    noteLaunch(i, y.tick);
  }
  if (launched || charged > c.most) {
    c.most = charged;
    c.mostAt = y.tick;
  }
  [c.one, c.two, c.three, c.plain, c.parts] = [one, two, three, plain, parts];
}

/** Notes what each pad did in the tick the yard has just run. */
export function notePads(y: Yard): void {
  const beat = beats(y);
  const second = Math.floor(y.tick / EVERY);
  const at = second % (SECONDS + 1);
  const tiles = padsOf(y);
  for (let p = 0; p < tiles.length; p++) {
    const i = tiles[p] ?? 0;
    const c = kept.counts.get(i);
    if (c) noteOne(c, y, i, beat, second, at);
    else kept.counts.set(i, begun(y, i));
  }
}

/** Begins the count of each pad that has none, as it stands now, before the next tick: that tick is counted too. */
export function beginCounts(y: Yard): void {
  for (const i of padsOf(y)) if (!kept.counts.has(i)) kept.counts.set(i, begun(y, i));
}

/** A command was played on the copy: what it did to a pad is no tick's work. Each pad is read again as it now stands. */
export function commanded(y: Yard): void {
  if (kept.yard !== y) return;
  for (const i of padsOf(y)) {
    const c = kept.counts.get(i);
    if (c) read(c, y, i);
  }
  beginCounts(y);
}

/** What the page counted of the pad on its own tile `i`; nothing for one not counted yet. */
export function padCounted(y: Yard, i: number): PadCounted | null {
  const c = kept.yard === y ? kept.counts.get(i) : undefined;
  if (!c) return null;
  const second = Math.floor(y.tick / EVERY);
  let came = 0;
  let first = second;
  for (let s = 0; s <= SECONDS; s++) {
    const was = c.second[s] ?? -1;
    if (was < 0 || was <= second - SECONDS || was > second) continue;
    came += c.came[s] ?? 0;
    first = Math.min(first, was);
  }
  return { most: c.most, stood: y.tick - c.mostAt >= TWO_BEATS, came, seconds: Math.min(SECONDS, second - first + 1) };
}

/**
 * Leaf's yard read afresh (`into`) in place of the page's copy (`from`): it keeps the count of each pad
 * that stands where one stood, as from what it holds now, and begins the rest afresh.
 */
export function keepCounts(from: Yard, into: Yard): void {
  if (kept.yard !== from) return;
  kept.yard = into;
  kept.rev = -1;
  for (const [i, c] of kept.counts) {
    if (into.kind[i] !== PAD || into.part[i] !== OWN) {
      kept.counts.delete(i);
      continue;
    }
    read(c, into, i);
  }
}
