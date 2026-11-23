/**
 * The town by the clock: where each of the town's own and each crab is, what it is doing and what
 * it says, worked out from a seed (the room's name; each turn stirs in the UTC day it is due on)
 * and a time (Leaf's clock, in milliseconds since 1970) and nothing else. Time is cut into turns
 * (an errand, a nap, a crab's amble, a line said), so the answer for a moment is the same whoever
 * asks and whenever they began asking. Nothing here is stepped, kept or sent.
 */
import { mix, utcDay } from "@sequoia-leaf/core";

import { type Doing, type Errand, ERRAND_LINES, FOLK, type Townsperson } from "./folk.ts";

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

/** Somewhere one of the town's own goes to be busy: where it stands, and which way it faces (0 towards us, 1 left, 2 right, 3 away). */
export interface Spot {
  x: number;
  y: number;
  dir: 0 | 1 | 2 | 3;
}
const spot = (x: number, y: number, dir: Spot["dir"]): Spot => ({ x, y, dir });

type Post = Errand | "works" | "fire";

/** Where each errand is run, the Works' doorstep and the fire's edge: each turn there is at one of them. */
export const SPOTS: Readonly<Record<Post, readonly Spot[]>> = {
  crabs: [spot(404, 254, 0), spot(340, 277, 2)],
  board: [spot(188, 166, 3), spot(208, 167, 3)],
  gate: [spot(240, 112, 0)],
  works: [spot(387, 126, 0), spot(398, 131, 1)],
  fire: [spot(284, 226, 1), spot(230, 230, 2)],
};

/**
 * The rounds of those who get about: where each turn goes, the seconds it has for the walk there
 * (a gnome goes 22 pixels a second and a cat 26, along the town's paths) and the seconds stayed;
 * and how many seconds late a turn may begin.
 */
const ROUNDS: Readonly<
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
    const at = (k: number): Spot => drawn(SPOTS[nth(legs, k).to], r.dice(k, 1));
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

/** How long the missing crab hides in one place, in milliseconds. */
export const STRETCH = 60_000;
/** Which stretch of the missing crab's hiding a moment is in: a member's sighting counts once in each. */
export const stretchOf = (now: number): number => Math.floor(now / STRETCH);

/** Somewhere the missing crab hides: where, and how far down the town it is sorted among what stands there. */
export interface Hide {
  x: number;
  y: number;
  z: number;
}
const hide = (x: number, y: number, z: number): Hide => ({ x, y, z });
const HIDES: readonly Hide[] = [
  hide(198, 121, 161),
  hide(122, 36, 121),
  hide(108, 206, 249),
  hide(256, 44, 99),
  hide(352, 148, 201),
  hide(272, 232, 241),
  hide(468, 117, 135),
  hide(130, 301, 313),
  hide(404, 40, 119),
];

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
