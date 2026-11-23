/**
 * The town by the clock: where each of the town's own and each crab is, what it is doing and what
 * it says, worked out from a seed (the room's name; each turn stirs in the UTC day it is due on)
 * and a time (Leaf's clock, in milliseconds since 1970) and nothing else. Time is cut into turns
 * (an errand, a nap, a crab's amble, a line said), so the answer for a moment is the same whoever
 * asks and whenever they began asking. Nothing here is stepped, kept or sent.
 *
 * And what follows from that and what Leaf said, the same to every page: where a member in one of
 * the games stands and where one gone from it dozes (from who Leaf lists), the pieces on the
 * stump's board, and the guild's moments (a raid party home, a war), each from its own time.
 */
import { DAY_MS, mix, utcDay } from "@sequoia-leaf/core";

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

/** A walk from one spot to another, begun at a moment of Leaf's clock. */
export interface Walk {
  from: Spot;
  to: Spot;
  at: number;
}

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

// ---------- members in the games, and gone from them ----------

/** A game a member can be in that has a place in town to stand at. */
export type Stand = "works" | "table" | "grove";

/**
 * Where a member in one of the games is in town, facing it: by the Works' door, sitting at the stump
 * over its board, or before the Grove's standing stone. At the Works they carry crates (`haul`).
 */
export const STANDS: Readonly<Record<Stand, readonly Spot[]>> = {
  works: [
    spot(393, 137, 3),
    spot(352, 125, 3),
    spot(407, 143, 3),
    spot(383, 146, 3),
    spot(397, 151, 3),
    spot(409, 157, 3),
  ],
  table: [spot(418, 196, 2), spot(444, 205, 3), spot(436, 172, 0), spot(456, 172, 0)],
  grove: [spot(94, 196, 3), spot(114, 196, 3), spot(84, 188, 2), spot(124, 188, 1)],
};

/** Where a member in a game stands: one of its spots by their account, the same for as long as they are there. */
export const standOf = (id: string, at: Stand): Spot => nth(STANDS[at], seedOf(id));

/** Where a member at the Works carries crates: from in front of the pile at the belt's end, facing it, in at the Works' door. */
export const HAUL: Readonly<Record<"pile" | "door", readonly Spot[]>> = {
  pile: [spot(466, 148, 3), spot(470, 154, 3)],
  door: [spot(374, 131, 3), spot(383, 132, 3)],
};
/** How long a crate takes, there and back, by Leaf's clock; and how long a member stands at each end of the way. */
export const HAUL_MS = 10_000;
export const HAUL_STANDS = 1400;

/**
 * A member at the Works, by Leaf's clock, the same on every page: the walk they are on, in with a
 * crate (`laden`) from the pile at the belt's end to the Works' door, or back for the next. Each walk
 * begins once they have stood a moment where it starts; each member keeps their own way and their
 * own time round, by their account.
 */
export function haul(id: string, now: number): { walk: Walk; laden: boolean } {
  const seed = seedOf(id);
  const pile = nth(HAUL.pile, seed);
  const belt = nth(HAUL.door, seed >>> 4);
  const into = mod(now + (seed % HAUL_MS), HAUL_MS);
  const begun = now - into;
  const half = HAUL_MS / 2;
  return into < half
    ? { walk: { from: pile, to: belt, at: begun + HAUL_STANDS }, laden: true }
    : { walk: { from: belt, to: pile, at: begun + half + HAUL_STANDS }, laden: false };
}

/** In and out of town: the gateway, in the dark. */
export const GATE: Spot = spot(256, 84, 0);

/**
 * How long after Leaf last saw a member they stay on their feet where they were, in milliseconds.
 * Leaf lists them as gone 90 seconds after, and every page asks who is about every 30, so by now
 * every page knows: all see them sit down to doze, or go, at the same moment. And for how long
 * after that somebody going out through the gate is still on the way.
 */
export const SITS_AFTER = 120_000;
export const GOES_FOR = 15_000;

/** A seat, as far as who dozes on it goes: what it is by, which way its sitter faces, and whether it is left for the member. */
export interface SeatFor {
  at: "fire" | "bench" | "works" | "table";
  dir: number;
  yours?: boolean;
}

/** The seats a dozer may have, by where they were: theirs first, then the fire's logs, then the benches. */
const SEATS_FOR: Readonly<Record<"town" | Stand, readonly SeatFor["at"][]>> = {
  town: ["fire", "bench", "works"],
  grove: ["fire", "bench", "works"],
  table: ["table", "fire", "bench"],
  works: ["works", "fire", "bench"],
};

/** Seats facing us first, so that whoever dozes there is seen to; then side on; then with their back to us. */
const facing = (s: SeatFor): number => (s.dir === 0 ? 0 : s.dir === 3 ? 2 : 1);

/**
 * The seat each member who dozes has, by their account, of the seats nobody awake sits on
 * (`free`, in the town's own order): whoever has been gone longest chooses first (of two gone
 * together, by account), and takes the first seat left for where they were. Never a seat left for
 * the member; whoever finds none has none.
 */
export function dozing<S extends SeatFor>(
  resting: readonly { id: string; at: "town" | Stand; seen: number }[],
  free: readonly S[],
): Map<string, S> {
  const left = free.filter((s) => !s.yours);
  const out = new Map<string, S>();
  for (const r of resting.toSorted((a, b) => a.seen - b.seen || (a.id < b.id ? -1 : 1))) {
    const seat = SEATS_FOR[r.at]
      .flatMap((kind) => left.filter((s) => s.at === kind).toSorted((a, b) => facing(a) - facing(b)))
      .at(0);
    if (!seat) continue;
    left.splice(left.indexOf(seat), 1);
    out.set(r.id, seat);
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
 * A raid party's homecoming, in milliseconds after it begins: each walks in through the gate
 * `apart` after the one before, the town cheers at `cheer`, at `part` the first goes on to the
 * lantern tree and the others stay 3 to 6 seconds more and go, the lantern goes up at `hang`, the
 * first stays `stay` and 3 to 6 seconds more and goes, and at `over` nobody of it is left. The
 * walks fit a member's pace, 32 pixels a second.
 */
export const HOME = { apart: 350, cheer: 1500, part: 2800, hang: 8500, stay: 1600, over: 23_000 } as const;

/** Where a raid party musters before the gate, each from their own side of the gateway; and where the first hangs the lantern, facing the tree. */
export const MUSTER: readonly Spot[] = [spot(240, 112, 0), spot(272, 113, 0), spot(250, 125, 0), spot(265, 127, 0)];
export const BY_TREE = spot(340, 216, 2);

/**
 * The walk the `i`th of a raid party home since `at` is on at a moment: in through the gate to
 * their place before it, then (the first) to the lantern tree, then out again. Null once it is over.
 */
export function homecoming(seed: number, at: number, i: number, now: number): Walk | null {
  const muster = MUSTER[i];
  if (!muster || now >= at + HOME.over) return null;
  const linger = 3000 + 3000 * roll(seed, at, at % DAY_MS, i);
  const walks: Walk[] = [{ from: spot(GATE.x - 7 + (i % 2) * 13, GATE.y + 1, 0), to: muster, at: at + i * HOME.apart }];
  if (i === 0)
    walks.push(
      { from: muster, to: BY_TREE, at: at + HOME.part },
      { from: BY_TREE, to: GATE, at: at + HOME.hang + HOME.stay + linger },
    );
  else walks.push({ from: muster, to: GATE, at: at + HOME.part + linger });
  return walks.findLast((w) => w.at <= now) ?? walks[0] ?? null;
}

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
