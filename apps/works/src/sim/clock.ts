/**
 * The yard and the clock on the wall: running it as time passes, the second shift, and catching up
 * after the member has been away.
 *
 * Away, the yard keeps working for up to eight hours. Running every tick of that would take far
 * too long, so the yard is run for a short while for real, and the rest is paid out at the pace the
 * depot has been taking things in. Where a crate would fill or run dry part-way through, or a
 * boiler with nothing gathered for it would burn the last of what it has, the yard is paid up to
 * that moment, run for another short while to find its new pace, and paid on from there.
 */
import { ITEM, type Item, ITEMS, type Tally } from "./content/items.ts";
import { TICKS } from "./content/machines.ts";
import { takeIn } from "./orders.ts";
import { rewire, step } from "./step.ts";
import { type Building, changed, take, type World } from "./world.ts";

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
  // Boilers with nothing gathered for them go out in time: each going out changes the yard's pace,
  // which is then measured afresh, once for each such boiler at most.
  const fires = exact ? [] : stores(w);
  let outs = fires.length;
  for (let phase = 0; left > 0;) {
    if (exact || left <= sample * 2) {
      real(left);
      break;
    }
    const burning = outs > 0 ? fires.filter((f) => alight(w, f)) : [];
    // A boiler that would go out before a short run for real is over is let go out for real first,
    // so that the run finds the pace without it.
    const soon = Math.min(...burning.map((f) => reserve(w, f)));
    if (soon < sample) {
      outs--;
      real(Math.min(left, soon + 1));
      if (left > 0) changed(w);
      continue;
    }
    // A short run for real: it brings the pace up to date and shows which crates are filling or emptying.
    const crates = w.cells.flatMap((b) => (b?.kind === "crate" ? [{ b, was: { ...b.buf }, count: b.count }] : []));
    const had = burning.map((f) => reserve(w, f));
    real(sample);
    // What a burning boiler's store holds is reckoned with the boiler, not as a crate emptying.
    const stored = new Set(burning.flatMap((f) => f.behind.map((i) => w.cells[i])));
    // How long this pace will hold: until the first crate is full or empty, or the first boiler out.
    let hold = left;
    for (const c of crates) {
      const change = c.b.count - c.count;
      const room = change > 0 ? w.rates.crate - c.b.count : c.b.count;
      if (Math.abs(change) >= 3 && phase < 2 && !stored.has(c.b))
        hold = Math.min(hold, Math.ceil((room / Math.abs(change)) * sample));
    }
    // A boiler burns a tick of its store a tick, or more if something else draws on the store too.
    const draw = burning.map((f, k) => Math.max(1, ((had[k] ?? 0) - reserve(w, f)) / sample));
    let out = false;
    for (const [k, f] of burning.entries()) {
      const lasts = Math.ceil(reserve(w, f) / (draw[k] ?? 1));
      if (lasts >= hold) continue;
      hold = lasts;
      out = true;
    }
    const keep = burning.map((f, k) => reserve(w, f) - Math.ceil(hold * (draw[k] ?? 1)));
    leap(w, hold);
    for (const [k, f] of burning.entries()) burnDown(w, f, keep[k] ?? 0);
    for (const c of crates) {
      // Each crate goes on filling or emptying as it was, as far as it can.
      let room = w.rates.crate - c.b.count - (c.b.out === null ? 0 : 1);
      for (const item of ITEMS) {
        if (item === "deadfall" && stored.has(c.b)) continue;
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
    if (out) outs--;
    phase++;
    // A crate has reached its end, or a boiler has gone out, so the yard settles to a new pace: measure it afresh.
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

/**
 * A boiler that nothing gathers for: it burns what it holds and what the open crates and the belts
 * behind it hold, and then it goes out for good. `behind` is those tiles, nearest first.
 */
interface Store {
  readonly at: number;
  readonly behind: readonly number[];
}

/** The boilers in reach of power with nothing gathered for them, and what stands behind each. */
function stores(w: World): Store[] {
  if (!w.cells.some((b) => b?.kind === "boiler")) return [];
  const wire = w.wire ?? rewire(w);
  // Who hands things to each tile.
  const from = new Map<number, number[]>();
  const link = (i: number, to: number): void => {
    if (to < 0) return;
    const list = from.get(to);
    if (list) list.push(i);
    else from.set(to, [i]);
  };
  w.cells.forEach((b, i) => {
    if (b?.kind === "splitter") for (let k = 0; k < 3; k++) link(i, wire.ways[i * 3 + k] ?? -1);
    else if (b) link(i, wire.next[i] ?? -1);
  });
  const found: Store[] = [];
  for (const at of wire.boilers) {
    const behind: number[] = [];
    const seen = new Set([at]);
    const queue = [...(from.get(at) ?? [])];
    let fed = false;
    for (let q = 0; q < queue.length && !fed; q++) {
      const i = queue[q] ?? -1;
      const b = w.cells[i];
      if (!b || seen.has(i)) continue;
      seen.add(i);
      switch (b.kind) {
        case "gatherer":
          fed = w.power[i] === 1 && w.land.deposit[i] === "deadfall";
          break;
        case "crate":
        case "belt":
        case "splitter":
        case "joiner":
        case "tunnel":
          // A shut crate lets nothing out, so neither it nor anything behind it feeds the boiler.
          if (b.kind === "crate" && !b.open) break;
          behind.push(i);
          queue.push(...(from.get(i) ?? []));
          break;
        // Nothing made burns, and nothing else hands anything on.
        case "mill":
        case "bench":
        case "workshop":
        case "boiler":
        case "depot":
        case "pylon":
        case "wheel":
          break;
      }
    }
    if (!fed) found.push({ at, behind });
  }
  return found;
}

/** Whether a boiler is burning, or about to burn what it holds. */
function alight(w: World, f: Store): boolean {
  const b = w.cells[f.at];
  return b !== null && b !== undefined && (b.fuel > 0 || (b.buf.deadfall ?? 0) > 0);
}

/** How many pieces of deadfall a tile holds, carried, waiting to leave, kept, or under the ground. */
function deadfallOn(b: Building): number {
  let n = (b.buf.deadfall ?? 0) + (b.item === "deadfall" ? 1 : 0) + (b.out === "deadfall" ? 1 : 0);
  for (const u of b.under) if (u === "deadfall") n++;
  return n;
}

/** How many ticks a boiler will go on burning with nothing more than its store. */
function reserve(w: World, f: Store): number {
  const boiler = w.cells[f.at];
  if (!boiler) return 0;
  let pieces = boiler.buf.deadfall ?? 0;
  for (const i of f.behind) {
    const b = w.cells[i];
    if (b) pieces += deadfallOn(b);
  }
  return boiler.fuel + pieces * TICKS.burn;
}

/** Takes one piece of deadfall off a tile, if it has one. */
function takeDeadfall(b: Building): boolean {
  if ((b.buf.deadfall ?? 0) > 0) take(b, "deadfall");
  else if (b.out === "deadfall") b.out = null;
  else if (b.item === "deadfall") {
    b.item = null;
    b.prog = 0;
    b.via = -1;
  } else {
    const k = b.under.indexOf("deadfall");
    if (k < 0) return false;
    b.under[k] = null;
    b.underProg[k] = 0;
  }
  return true;
}

/**
 * Leaves a boiler's store with `ticks` of burning in it, as it would be after burning the rest:
 * the pieces burnt are the ones furthest back, since what is nearer moves up as the boiler draws
 * it in, and then the boiler's own.
 */
function burnDown(w: World, f: Store, ticks: number): void {
  const boiler = w.cells[f.at];
  const now = reserve(w, f);
  if (!boiler || ticks >= now) return;
  const keep = Math.max(0, ticks);
  // The piece burning, and the whole pieces still to come.
  const pieces = keep > 0 ? Math.floor((keep - 1) / TICKS.burn) : 0;
  let gone = (now - boiler.fuel) / TICKS.burn - pieces;
  for (let k = f.behind.length - 1; k >= 0 && gone > 0; k--) {
    const b = w.cells[f.behind[k] ?? -1];
    if (!b) continue;
    while (gone > 0 && takeDeadfall(b)) gone--;
  }
  while (gone > 0 && takeDeadfall(boiler)) gone--;
  boiler.fuel = keep - pieces * TICKS.burn;
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
