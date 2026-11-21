/**
 * The yard and the clock on the wall: running it as time passes, the second shift, and catching up
 * after the member has been away.
 *
 * Away, the yard keeps working for up to eight hours. Running every tick of that would take far
 * too long, so the yard is run for a short while for real, and the rest is paid out at the pace the
 * depot has been taking things in. Where a crate would fill or run dry part-way through, the yard
 * is paid up to that moment, run for another short while to find its new pace, and paid on from
 * there.
 */
import { ITEM, type Item, ITEMS, type Tally } from "./content/items.ts";
import { takeIn } from "./orders.ts";
import { step } from "./step.ts";
import { changed, type World } from "./world.ts";

/** One tick of the yard in the clock's time, the gap after which the member counts as having been away, and the most the yard works unwatched. */
export const TICK_MS = 100;
export const AWAY_AFTER_MS = 15_000;
export const AWAY_MOST_MS = 8 * 3600 * 1000;

/** Whether a second shift is running at a given moment, and how long it has left, in milliseconds. */
export const boosted = (w: World, now: number): boolean => now < w.boostUntil;
export const boostLeft = (w: World, now: number): number => Math.max(0, w.boostUntil - now);

/**
 * Starts a second shift, or lengthens the one running: the yard goes at double speed until it ends.
 * Who pays for it is the town's business; it opens nothing that cannot be had without it.
 */
export function boost(w: World, now: number, ms: number): void {
  if (ms > 0) w.boostUntil = Math.max(w.boostUntil, now) + ms;
}

/** What the yard did while nobody was watching. */
export interface Away {
  /** How long the yard is counted as having worked, in seconds, and whether that was cut at eight hours. */
  readonly seconds: number;
  readonly capped: boolean;
  /** How much of that was on a second shift, in seconds. */
  readonly boosted: number;
  /** Coins earned, now in the till. */
  readonly coins: number;
  /** What the depot took in. */
  readonly made: Tally;
  /** The orders that were filled, in the order they were filled, and the Coins waiting on the board for those that are standing orders. */
  readonly orders: readonly string[];
  readonly waiting: number;
  /** Ticks the yard was moved on by, and how many of them were run for real. */
  readonly ticks: number;
  readonly run: number;
}

/**
 * Brings the yard up to `now`. A short gap is run tick by tick, two to a tick on a second shift,
 * and nothing is given back; after a long one the yard catches up and says what it did. Call it
 * every frame, and once on opening.
 */
export function runTo(w: World, now: number): Away | null {
  if (w.seen <= 0 || now < w.seen) {
    w.seen = now;
    return null;
  }
  const gap = now - w.seen;
  if (gap < AWAY_AFTER_MS) {
    for (let t = w.seen + TICK_MS; t <= now; t += TICK_MS) {
      step(w);
      if (t <= w.boostUntil) step(w);
      w.seen = t;
    }
    return null;
  }
  const span = Math.min(gap, AWAY_MOST_MS);
  const double = Math.max(0, Math.min(span, w.boostUntil - w.seen));
  const away = forward(w, Math.floor(span / TICK_MS) + Math.floor(double / TICK_MS));
  w.seen = now;
  return { ...away, seconds: span / 1000, capped: gap > AWAY_MOST_MS, boosted: double / 1000 };
}

/** How many tick-tiles (one tile for one tick) may be run for real in one catching-up. */
const WORK = 3_000_000;
/** The fewest and most ticks run for real at a time, however small or large the yard. */
const FEWEST = 900;
const MOST = 6000;

/**
 * Moves the yard on by `ticks`, quickly: a short run for real, and the rest at the yard's pace.
 * `exact` runs every tick instead, however long that takes; it is there to check the quick way
 * against.
 */
export function forward(w: World, ticks: number, exact = false): Away {
  const before = { till: w.till, depot: { ...w.depot } };
  const kept = w.news;
  w.news = [];
  let left = Math.max(0, Math.floor(ticks));
  let run = 0;
  const real = (n: number): void => {
    for (let k = 0; k < n; k++) step(w);
    run += n;
    left -= n;
  };
  const built = w.cells.reduce((n, b) => n + (b ? 1 : 0), 0);
  const sample = Math.max(FEWEST, Math.min(MOST, Math.floor(WORK / (built + 40) / 3)));
  for (let phase = 0; left > 0; phase++) {
    if (exact || left <= sample * 2) {
      real(left);
      break;
    }
    // A short run for real: it brings the pace up to date and shows which crates are filling or emptying.
    const crates = w.cells.flatMap((b) => (b?.kind === "crate" ? [{ b, was: { ...b.buf }, count: b.count }] : []));
    real(sample);
    // How long this pace will hold: until the first crate is full or empty.
    let hold = left;
    for (const c of crates) {
      const change = c.b.count - c.count;
      const room = change > 0 ? w.rates.crate - c.b.count : c.b.count;
      if (Math.abs(change) >= 3 && phase < 2) hold = Math.min(hold, Math.ceil((room / Math.abs(change)) * sample));
    }
    leap(w, hold);
    for (const c of crates) {
      // Each crate goes on filling or emptying as it was, as far as it can.
      let room = w.rates.crate - c.b.count - (c.b.out === null ? 0 : 1);
      for (const item of ITEMS) {
        const now = c.b.buf[item] ?? 0;
        const change = Math.round(((now - (c.was[item] ?? 0)) / sample) * hold);
        const add = Math.max(-now, Math.min(room, change));
        if (add === 0) continue;
        if (now === 0) c.b.kinds++;
        if (now + add === 0) c.b.kinds--;
        c.b.buf[item] = now + add;
        c.b.count += add;
        room -= add;
      }
    }
    left -= hold;
    // A crate has reached its end, so the yard settles to a new pace: measure it afresh.
    if (left > 0) changed(w);
  }
  const made: Tally = {};
  for (const item of ITEMS) {
    const n = (w.depot[item] ?? 0) - (before.depot[item] ?? 0);
    if (n > 0) made[item] = n;
  }
  const orders = w.news.flatMap((n) => (n.kind === "standing" ? [] : [n.title]));
  const waiting = w.news.reduce((sum, n) => sum + (n.kind === "filled" ? n.pay : 0), 0);
  w.news = kept;
  return {
    seconds: Math.floor(ticks) / 10,
    capped: false,
    boosted: 0,
    coins: Math.floor(w.till - before.till),
    made,
    orders,
    waiting,
    ticks: Math.max(0, Math.floor(ticks)),
    run,
  };
}

/** Pays the yard for `ticks` it is not run for, at the pace the depot has been taking things in. */
function leap(w: World, ticks: number): void {
  if (ticks <= 0) return;
  w.tick += ticks;
  if (w.pace.ticks <= 0) return;
  const pace: [Item, number][] = [];
  for (const item of ITEMS) {
    const n = w.pace.made[item] ?? 0;
    if (n > 0) pace.push([item, (n / w.pace.ticks) * ticks]);
  }
  // In slices, so that orders are filled in something like the order they would have been.
  const slices = Math.min(96, ticks);
  const sent = pace.map(() => 0);
  for (let s = 1; s <= slices; s++)
    for (const [k, [item, total]] of pace.entries()) {
      const due = Math.floor((total * s) / slices);
      takeIn(w, item, due - (sent[k] ?? 0));
      sent[k] = due;
    }
}

/** What the town can say about an absence: "While you were away the Works made 340 Coins and finished …". */
export function awayLine(a: Away): string {
  const coins = `${a.coins.toLocaleString("en-US")} Coin${a.coins === 1 ? "" : "s"}`;
  const last = a.orders.at(-1);
  const orders =
    last === undefined
      ? ""
      : a.orders.length === 1
        ? ` and finished "${last}"`
        : ` and finished ${a.orders.length} orders, the last of them "${last}"`;
  if (a.coins <= 0 && last === undefined) return "While you were away the Works stood quiet.";
  return `While you were away the Works made ${coins}${orders}.`;
}

/** What a pile of things is called: "12 planks". */
export const pile = (item: Item, n: number): string =>
  `${n} ${n === 1 ? ITEM[item].name.toLowerCase() : ITEM[item].many}`;
