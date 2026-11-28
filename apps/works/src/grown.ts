/**
 * What each grower took in and gave out of star crystals in the yard's last minute, counted by the
 * page (SPEC-2: the grower's card says it; the rules keep nothing for it). After each tick the page's
 * copy runs, each grower's row is set beside what it was the tick before (`noteGrowers`): a run done
 * shows as its place in its runs moving on (every run moves it), giving 1 or, from the place before a
 * run that gives 2, 2; what it took in is its star crystals up by more than a run used, what it gave
 * out is what it grew less what it still holds of that. A grower that has had star crystals taken out
 * of it by hand counts none taken in for it.
 *
 * Counted a second of the yard's clock at a time, a minute of seconds kept, for each grower by its own
 * tile; a grower moved or built is counted afresh, and another yard begins again. Leaf's yard read in
 * place of the page's copy keeps the count of each grower standing in both (`keepCounts`). A yard with
 * no grower runs on as it always has (`counting`).
 */
import { GROW_OF, held, holderOf, kind, OWN, type Yard } from "@sequoia-leaf/factory";

const GROWER = kind("grower");
const GROW = GROW_OF[GROWER];
/** Ticks in a second of the yard's clock, and seconds counted over. */
const EVERY = 10;
const SECONDS = 60;

/** One grower's count: what it held and where it was in its runs a tick ago, and what it took in and gave out each second. */
interface Count {
  seeds: number;
  ready: number;
  place: number;
  readonly second: Int32Array;
  readonly took: Int32Array;
  readonly gave: Int32Array;
}

/** What was taken in and given out in the last minute, and over how many seconds of it the count has been kept. */
export interface Counted {
  readonly took: number;
  readonly gave: number;
  readonly seconds: number;
}

/** The yard counted, the count of changes its growers were last found at, its growers' own tiles, and each one's count. */
const kept = { yard: null as Yard | null, rev: -1, tiles: [] as number[], counts: new Map<number, Count>() };

/** The yard's growers, by their own tiles, found again whenever it changes. */
function growersOf(y: Yard): readonly number[] {
  if (kept.yard === y && kept.rev === y.rev) return kept.tiles;
  if (kept.yard !== y) kept.counts.clear();
  kept.yard = y;
  kept.rev = y.rev;
  kept.tiles = [];
  for (let i = 0; i < y.kind.length; i++) if (y.kind[i] === GROWER && y.part[i] === OWN) kept.tiles.push(i);
  for (const t of kept.counts.keys()) if (!kept.tiles.includes(t)) kept.counts.delete(t);
  return kept.tiles;
}

/** Whether the page counts a tick at a time for a yard: while it has any grower. */
export const counting = (y: Yard): boolean => GROW !== null && growersOf(y).length > 0;

/** What a grower's row holds now: its star crystals, those it grew waiting to leave, its place in its runs. */
function now(y: Yard, i: number): { seeds: number; ready: number; place: number } {
  const h = y.holders;
  const r = holderOf(y, i);
  const gives = GROW?.gives ?? 0;
  return {
    seeds: held(h, r, gives),
    ready: h.out[r] === gives ? 1 + (h.more[r] ?? 0) : 0,
    place: h.mix[r] ?? 0,
  };
}

/** Notes what each grower did in the tick the yard has just run. */
export function noteGrowers(y: Yard): void {
  if (!GROW) return;
  const second = Math.floor(y.tick / EVERY);
  const at = second % (SECONDS + 1);
  for (const i of growersOf(y)) {
    const is = now(y, i);
    const c = kept.counts.get(i);
    if (!c) {
      const fresh = {
        ...is,
        second: new Int32Array(SECONDS + 1).fill(-1),
        took: new Int32Array(SECONDS + 1),
        gave: new Int32Array(SECONDS + 1),
      };
      kept.counts.set(i, fresh);
      continue;
    }
    const ran = is.place !== c.place;
    const made = !ran ? 0 : c.place === GROW.extraEvery - 1 ? 2 : 1;
    if (c.second[at] !== second) {
      c.second[at] = second;
      c.took[at] = 0;
      c.gave[at] = 0;
    }
    c.took[at] = (c.took[at] ?? 0) + Math.max(0, is.seeds - c.seeds + (ran ? 1 : 0));
    c.gave[at] = (c.gave[at] ?? 0) + Math.max(0, c.ready + made - is.ready);
    c.seeds = is.seeds;
    c.ready = is.ready;
    c.place = is.place;
  }
}

/** What the grower on its own tile `i` took in and gave out in the yard's last minute, as counted; nothing for one not counted yet. */
export function countedAt(y: Yard, i: number): Counted | null {
  const c = kept.yard === y ? kept.counts.get(i) : undefined;
  if (!c) return null;
  const second = Math.floor(y.tick / EVERY);
  let [took, gave, first] = [0, 0, second];
  for (let s = 0; s <= SECONDS; s++) {
    const was = c.second[s] ?? -1;
    if (was < 0 || was <= second - SECONDS || was > second) continue;
    took += c.took[s] ?? 0;
    gave += c.gave[s] ?? 0;
    first = Math.min(first, was);
  }
  return { took, gave, seconds: Math.min(SECONDS, second - first + 1) };
}

/**
 * Leaf's yard read afresh (`into`) in place of the page's copy (`from`): it keeps the count of each
 * grower that stands where one stood, as from what it holds now, and begins the rest afresh.
 */
export function keepCounts(from: Yard, into: Yard): void {
  if (kept.yard !== from) return;
  kept.yard = into;
  kept.rev = -1;
  for (const [i, c] of kept.counts) {
    if (into.kind[i] !== GROWER || into.part[i] !== OWN) {
      kept.counts.delete(i);
      continue;
    }
    Object.assign(c, now(into, i));
  }
}
