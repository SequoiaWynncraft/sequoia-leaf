/**
 * The town by the clock: where each of the town's own and each crab is, what it is doing and what
 * it says, worked out from a seed (the room's name; each turn stirs in the UTC day it is due on)
 * and a time (Leaf's clock, in milliseconds since 1970) and nothing else. Time is cut into turns
 * (an errand, a nap, a crab's amble, a line said), so the answer for a moment is the same whoever
 * asks and whenever they began asking. Nothing here is stepped, kept or sent.
 *
 * And what follows from that and what Leaf said, the same to every page: where a member gone from
 * one of the games dozes (from who Leaf lists), the pieces on the stump's board, and the guild's
 * moments (a raid party home, a war), each from its own time. Where a member busy at one of the
 * games is drawn is the town page's (`apps/town/src/spots.ts`).
 */
import { mix, utcDay } from "@sequoia-leaf/core";

import { type Doing, type Errand, ERRAND_LINES, FOLK, type Townsperson } from "./folk.ts";
import type { SeatAt } from "./map/kinds.ts";
import { ERRANDS, type Hide, HIDES, type Spot } from "./map/map.ts";
import type { Post, Stand } from "./map/rows.ts";
import { STRETCH, stretchOf } from "./stretch.ts";

/** A room's seed: its name as a number. */
export function seedOf(room: string): number {
  let seed = 0x70c1;
  for (let i = 0; i < room.length; i++) seed = mix(seed, room.charCodeAt(i));
  return seed;
}

/** A number from 0 up to 1, always the same for the same seed, UTC day (of `at`) and numbers. */
export const roll = (seed: number, at: number, ...ns: readonly number[]): number =>
  ns.reduce((s, n) => mix(s, n), mix(seed, utcDay(at))) / 2 ** 32;

const mod = (n: number, by: number): number => ((n % by) + by) % by;
/** One of a list by any whole number, going round. */
function nth<T>(list: readonly T[], n: number): T {
  const v = list[mod(n, list.length)];
  if (v === undefined) throw new Error("nothing to choose from");
  return v;
}
/** One of a list by a roll from 0 up to 1. */
const drawn = <T>(list: readonly T[], r: number): T => nth(list, Math.floor(r * list.length));
const sum = (ns: readonly number[]): number => ns.reduce((a, b) => a + b, 0);

/**
 * Time cut into turns: a round of them, each so many seconds long (`secs`), gone round for ever
 * since 1970, each beginning up to `sway` seconds late by its own roll (less than the shortest of
 * them). `at` is the turn a moment is in, `begins` when a turn does, and `dice` a turn's own roll
 * for one thing or another (`k`).
 */
function turns(seed: number, secs: readonly number[], sway: number) {
  const round = sum(secs) * 1000;
  const into = secs.map((_, i) => sum(secs.slice(0, i)) * 1000);
  const due = (n: number): number => Math.floor(n / secs.length) * round + nth(into, n);
  const dice = (n: number, k: number): number => roll(seed, due(n), n, k);
  const begins = (n: number): number => due(n) + dice(n, 0) * sway * 1000;
  const at = (now: number): number => {
    let n = Math.floor(now / round) * secs.length;
    while (begins(n + 1) <= now) n++;
    return begins(n) > now ? n - 1 : n;
  };
  return { dice, begins, at };
}

// ---------- the town's own ----------

/** A walk from one spot to another, begun at a moment of Leaf's clock. */
export interface Walk {
  from: Spot;
  to: Spot;
  at: number;
}

/**
 * The rounds of those who get about: where each turn goes (each turn there is at one of its spots,
 * the map's `ERRANDS`), the seconds it has for the walk there (at its pace, `PACE`, along the
 * town's paths: the map's checks hold every walk to it) and the seconds stayed; and how many
 * seconds late a turn may begin.
 */
export const ROUNDS: Readonly<
  Record<"errands" | "between", { sway: number; legs: readonly { to: Post; walk: number; stay: number }[] }>
> = {
  errands: {
    sway: 3,
    legs: [
      { to: "crabs", walk: 12, stay: 12 },
      { to: "board", walk: 12, stay: 12 },
      { to: "gate", walk: 5, stay: 12 },
    ],
  },
  between: {
    sway: 5,
    legs: [
      { to: "works", walk: 9, stay: 23 },
      { to: "fire", walk: 9, stay: 23 },
    ],
  },
};

/** A cat on a stall naps in turns of this many seconds, each beginning up to `sway` late; 3 naps in 10 end with it awake for 5 to 9 seconds. */
const NAP = { secs: 22, sway: 6, wakes: 0.3 } as const;

/** One of them says a line to itself every `every` seconds, beginning up to `sway` late, for `secs`. */
const LINE = { every: 4.5, sway: 1.7, secs: 2.8 } as const;

/** One of the town's own at a moment. */
export interface FolkNow {
  /** Where it set out from and where it is going, for whoever gets about; null for whoever keeps to its post. */
  from: Spot | null;
  to: Spot | null;
  /** When it set out, by Leaf's clock. */
  at: number;
  /** What it does there, once it is there. */
  doing: Doing;
  /** What it is saying to itself, and until when by Leaf's clock. */
  say: { text: string; until: number } | null;
}

/** Where one of the town's own is at a moment, and whether it is at its post and awake: free to say a line. */
function about(seed: number, t: Townsperson, now: number): Omit<FolkNow, "say"> & { free: boolean } {
  const own = mix(seed, FOLK.indexOf(t));
  const { job } = t;
  if (job === "errands" || job === "between") {
    const { legs, sway } = ROUNDS[job];
    const r = turns(
      own,
      legs.map((l) => l.walk + l.stay),
      sway,
    );
    const n = r.at(now);
    const at = (k: number): Spot => drawn(ERRANDS[nth(legs, k).to], r.dice(k, 1));
    const leg = nth(legs, n);
    return {
      from: at(n - 1),
      to: at(n),
      at: r.begins(n),
      doing: leg.to,
      free: now >= r.begins(n) + leg.walk * 1000,
    };
  }
  if (typeof job === "object" && job.naps) {
    const r = turns(own, [NAP.secs], NAP.sway);
    const n = r.at(now);
    const awake = r.dice(n, 1) < NAP.wakes && now >= r.begins(n + 1) - (5 + 4 * r.dice(n, 2)) * 1000;
    return { from: null, to: null, at: r.begins(n), doing: awake ? "stall" : "asleep", free: awake };
  }
  const doing = job === "counter" ? "counter" : job === "fire" ? "fire" : job === "calls" ? "call" : "stall";
  return { from: null, to: null, at: 0, doing, free: job !== "calls" && t.chatter.length > 0 };
}

const isErrand = (d: Doing): d is Errand => d === "crabs" || d === "board" || d === "gate";

/** The line being said in town at a moment, if one is: one line at a time, by whoever of them is at its post and awake as it begins. */
function lineAt(seed: number, now: number): { who: Townsperson; text: string; until: number } | null {
  const r = turns(mix(seed, 0x11e), [LINE.every], LINE.sway);
  const n = r.at(now);
  const at = r.begins(n);
  const free = FOLK.filter((t) => about(seed, t, at).free);
  if (now >= at + LINE.secs * 1000 || free.length === 0) return null;
  const who = drawn(free, r.dice(n, 1));
  const { doing } = about(seed, who, at);
  // On an errand, three lines in four are about it.
  const lines = isErrand(doing) && r.dice(n, 2) < 0.75 ? ERRAND_LINES[doing] : who.chatter;
  return { who, text: drawn(lines, r.dice(n, 3)), until: at + LINE.secs * 1000 };
}

/** One of the town's own at a moment of Leaf's clock: where it was, where it is going, when it set out, what it is doing and what it says. */
export function folkAt(seed: number, t: Townsperson, now: number): FolkNow {
  const { from, to, at, doing } = about(seed, t, now);
  const line = lineAt(seed, now);
  return { from, to, at, doing, say: line?.who === t ? { text: line.text, until: line.until } : null };
}

// ---------- the crabs ----------

/**
 * A crab of the pond at a moment, by its number: how far from home it was and is going, as shares
 * of how far it ever goes (-0.5 to 0.5), and when it set out. It ambles off every 5.5 seconds,
 * up to 3 late.
 */
export function crabAt(seed: number, n: number, now: number): { from: number; to: number; at: number } {
  const r = turns(mix(seed, 0xc0 + n), [5.5], 3);
  const k = r.at(now);
  return { from: r.dice(k - 1, 1) - 0.5, to: r.dice(k, 1) - 0.5, at: r.begins(k) };
}

/**
 * Where the missing crab hides at a moment: which stretch it is, how long into it, the place for
 * this stretch and the place for the one before, never the same two: even stretches take the
 * even places and odd stretches the odd ones.
 */
export function hiding(seed: number, now: number): { stretch: number; since: number; at: Hide; was: Hide } {
  const place = (k: number): Hide => {
    const odd = mod(k, 2);
    const some = HIDES.filter((_, i) => i % 2 === odd);
    return drawn(some, roll(mix(seed, 0x7), k * STRETCH, k));
  };
  const stretch = stretchOf(now);
  return { stretch, since: now - stretch * STRETCH, at: place(stretch), was: place(stretch - 1) };
}

// ---------- members in the games, and gone from them ----------

/**
 * How long after Leaf last saw a member they stay on their feet where they were, in milliseconds.
 * Leaf lists them as gone 90 seconds after, and every page asks who is about every 30, so by now
 * every page knows: all see them doze on their seat, or go, at the same moment.
 */
export const SITS_AFTER = 120_000;

/** A seat, as far as who dozes on it goes: where it is, what it is by, and whether it is left for the member. */
export interface SeatFor {
  x: number;
  y: number;
  at: SeatAt;
  yours?: boolean;
}

/** The seats a dozer may have, by where they were: theirs first, then the fire's logs, then the benches. */
const SEATS_FOR: Readonly<Record<"town" | Stand, readonly SeatFor["at"][]>> = {
  town: ["fire", "bench", "works"],
  grove: ["fire", "bench", "works"],
  table: ["table", "fire", "bench"],
  works: ["works", "fire", "bench"],
};

/** How much a member wants a seat, by their account and where it is: lower is wanted more, the same every time, and different for each. */
const want = (id: string, s: SeatFor): number => mix(mix(seedOf(id), s.x), s.y);
/** Of some seats, the one a member wants most. */
const most = <S extends SeatFor>(id: string, seats: readonly S[]): S | undefined =>
  seats.toSorted((a, b) => want(id, a) - want(id, b) || a.x - b.x || a.y - b.y).at(0);

/**
 * The seat each member who dozes has, by their account, of the seats nobody awake sits on (`free`,
 * in any order), never one left for the member. Each has a seat of their own, the one they want most
 * of those they may have (`SEATS_FOR`, `want`), unless somebody gone longer wants it too (of two
 * gone together, by account); then whoever has none takes, gone longest first, the one they want
 * most of the first kind left for where they were. So somebody coming or going moves nobody on a
 * seat of their own, only somebody who took one that was left; whoever finds none left has none.
 */
export function dozing<S extends SeatFor>(
  resting: readonly { id: string; at: "town" | Stand; seen: number }[],
  free: readonly S[],
): Map<string, S> {
  const left = free.filter((s) => !s.yours);
  const out = new Map<string, S>();
  const order = resting.toSorted((a, b) => a.seen - b.seen || (a.id < b.id ? -1 : 1));
  for (const r of order) {
    const own = most(
      r.id,
      left.filter((s) => SEATS_FOR[r.at].includes(s.at)),
    );
    if (!own || [...out.values()].includes(own)) continue;
    out.set(r.id, own);
  }
  for (const r of order) {
    if (out.has(r.id)) continue;
    const taken = new Set(out.values());
    const seat = SEATS_FOR[r.at]
      .map((kind) =>
        most(
          r.id,
          left.filter((s) => s.at === kind && !taken.has(s)),
        ),
      )
      .find((s) => s !== undefined);
    if (seat) out.set(r.id, seat);
  }
  return out;
}

/** When a member who dozes last breathed out a "z", by their account: one every 2 seconds, up to 0.8 late. */
export function zAt(seed: number, id: string, now: number): number {
  const r = turns(mix(seed, seedOf(id)), [2], 0.8);
  return r.begins(r.at(now));
}

// ---------- the stump's board ----------

/** Where the hexes of the stump's board are, in the stump's own pixels: a row of five, four, five. */
export const BOARD: readonly (readonly [number, number])[] = [
  [12, 7],
  [18, 7],
  [24, 7],
  [30, 7],
  [36, 7],
  [15, 11],
  [21, 11],
  [27, 11],
  [33, 11],
  [12, 15],
  [18, 15],
  [24, 15],
  [30, 15],
  [36, 15],
];

/** The board with nobody at it: which hex each of the five carved figures stands on. */
export const SET_OUT: readonly number[] = [9, 11, 13, 1, 3];

/** A figure is moved every 2.1 seconds, up to 0.8 late; after this many moves they are taken back, last first. */
const MOVE = { every: 2.1, sway: 0.8, game: 32 } as const;

/**
 * The board while somebody is at it, at a moment: the hex each figure stands on, and the figure
 * moved this turn (which, from which hex, and when), if one was. Each turn one figure goes to a
 * hex beside its own that nobody stands on; after 32 turns the moves are taken back one a turn,
 * last first, so the board is set out again every 64 and never jumps.
 */
export function boardAt(
  seed: number,
  now: number,
): { on: number[]; moved: { piece: number; from: number; at: number } | null } {
  const r = turns(mix(seed, 0xb0a2), [MOVE.every], MOVE.sway);
  const n = r.at(now);
  const first = Math.floor(n / (2 * MOVE.game)) * 2 * MOVE.game;
  const back = n - first >= MOVE.game;
  /** The move made this turn, or taken back. */
  const last = back ? 2 * MOVE.game - 1 - (n - first) : n - first;
  const on = [...SET_OUT];
  let move: { piece: number; from: number; to: number } | null = null;
  for (let k = first; k <= first + last; k++) {
    const piece = Math.floor(r.dice(k, 1) * on.length);
    const from = on[piece] ?? 0;
    const [x, y] = nth(BOARD, from);
    const beside = BOARD.flatMap(([bx, by], i) =>
      !on.includes(i) && Math.abs(bx - x) <= 6 && Math.abs(by - y) <= 4 ? [i] : [],
    );
    move = beside.length > 0 ? { piece, from, to: drawn(beside, r.dice(k, 2)) } : null;
    if (move) on[piece] = move.to;
  }
  if (!move) return { on, moved: null };
  if (back) on[move.piece] = move.from;
  return { on, moved: { piece: move.piece, from: back ? move.to : move.from, at: r.begins(n) } };
}

// ---------- the guild's moments ----------

/**
 * A raid party home, in milliseconds after the town begins to stage it: the town cheers at `cheer`
 * and the feed names them, a lantern goes up in the tree at `hang`, and at `over` it is over.
 * Nobody walks in for it: whoever of the party is drawn in town is pleased where they are.
 */
export const HOME = { cheer: 1500, hang: 8500, over: 23_000 } as const;

/**
 * What the town has staged of a day's raids or wars at a moment: how many (`n`), and when each of
 * those the page still knows of was (`at`, oldest first: they are the newest). `count` is how many
 * the guild finished in the day, as Leaf said and the page has heard since; `whens` is when each of
 * them the page knows of is staged, and one still to come is not counted yet.
 */
export function stagedBy(count: number, whens: readonly number[], now: number): { n: number; at: number[] } {
  const at = whens.filter((when) => when <= now).toSorted((a, b) => a - b);
  return { n: Math.max(at.length, count - (whens.length - at.length)), at };
}

/** A war, as the banner goes by it: the territory, when the war happened, and when the town begins to stage it (0 for one from before the page). */
export interface Fought {
  land: string;
  happened: number;
  at: number;
}

/** Which of two wars is the later, as a sort has it: by when each happened, and of two at one moment the one whose territory's name sorts later. */
export const later = (a: Omit<Fought, "at">, b: Omit<Fought, "at">): number =>
  a.happened - b.happened || (a.land < b.land ? -1 : a.land > b.land ? 1 : 0);

/** How fast the banner goes up or down its pole, in pole lengths a second; and how low it dips to change. */
const BANNER = { pace: 0.75, dip: 0.12 } as const;

/**
 * The banner at a moment, from the wars the guild fought (`wars`, in any order): whose it is, how
 * far up the pole (0 to 1), and when it is at the top. It is the last war's that the town has begun
 * to stage, by when each happened (`later`), so an older war heard of late changes nothing. The
 * first goes up; a later one finds the last flying, which dips, changes and goes up again. Null
 * before any.
 */
export function bannerAt(wars: readonly Fought[], now: number): { land: string; up: number; full: number } | null {
  const begun = wars.filter((w) => w.at <= now).toSorted(later);
  const war = begun.at(-1);
  if (!war) return null;
  const flying = begun.findLast((w) => w.at < war.at);
  const secs = (now - war.at) / 1000;
  const dip = flying ? (1 - BANNER.dip) / BANNER.pace : 0;
  const full = war.at + (flying ? 2 * dip : 1 / BANNER.pace) * 1000;
  if (flying && secs < dip) return { land: flying.land, up: 1 - BANNER.pace * secs, full };
  return { land: war.land, up: Math.min(1, (flying ? BANNER.dip : 0) + BANNER.pace * (secs - dip)), full };
}
