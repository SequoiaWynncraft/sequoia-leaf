/**
 * Where each member busy at one of the games is in town, and what they do there, in place: a spot
 * of their own. Each place has spots laid by hand where they read well (`LAID`), and past those
 * further ones a step out (`further`), on top of nobody and nothing. At the stump the first are its
 * logs, which somebody sits on while one is free; past those, and at the other places, a member's
 * spot is chosen by their account. Each keeps theirs for as long as they stay (`makeSpots`), and
 * nobody is given one that somebody else has. At the Works they work at a crate of their own beside
 * them (`atWork`, by Leaf's clock); at the stump they sit on a log over the board, or stand round it
 * when the logs are taken; before the Grove's stone they stand facing it.
 * Nothing here is drawn (`visitors.ts` draws it), and who is at which place is `where.ts`'s word.
 */

import type { Pt } from "@sequoia-leaf/kit/util.ts";
import { seedOf } from "@sequoia-leaf/town/clock.ts";
import { BUSY, ERRANDS, piece, piecesOf, place, RESTS, type Spot, STRINGS } from "@sequoia-leaf/town/map/map.ts";
import type { Stand } from "@sequoia-leaf/town/map/rows.ts";

import { wire } from "./strings.ts";

/** A box on the town's ground, in its pixels: its left and top, and how wide and tall. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const spot = (x: number, y: number, dir: Spot["dir"]): Spot => ({ x, y, dir });

/** The stump's logs that are not kept for the member, as spots: somebody at the raid table sits on one of these before anywhere else. */
const LOGS: readonly Spot[] = RESTS.filter((r) => r.at === "table" && !r.yours).map((r) => spot(r.x, r.y, r.dir));

/** How many of each place's first spots are seats: sat on, and given out in order before any other. */
export const SEATED: Readonly<Record<Stand, number>> = { works: 0, table: LOGS.length, grove: 0 };

/** The spots of each place laid by hand: the stump's logs first, then the map's (`busy`). */
export const LAID: Readonly<Record<Stand, readonly Spot[]>> = {
  works: BUSY.works.spots,
  table: [...LOGS, ...BUSY.table.spots],
  grove: BUSY.grove.spots,
};

/** Whether somebody at a place's `n`th spot sits: on the stump's logs they do; everywhere else they stand. */
export const sits = (at: Stand, n: number): boolean => n < SEATED[at];

/** How wide a member's figure is drawn, in the town's pixels; and how tall standing, sitting facing us, and sitting side on or away. */
const ACROSS = 10;
const TALL = { stands: 21, front: 19, side: 16 } as const;
/** A crate, as one stands on the ground beside whoever works at it. */
export const CRATE = { w: 6, h: 5 } as const;

/** Where the crate of somebody at the Works stands on the ground: beside them, on the side they face. */
export const crateAt = (s: Spot): Box => ({
  x: s.dir === 1 ? s.x - 4 - CRATE.w : s.x + 4,
  y: s.y - CRATE.h,
  w: CRATE.w,
  h: CRATE.h,
});

/** What somebody at a spot takes up on the ground: their figure, and at the Works their crate. */
export function footprint(at: Stand, s: Spot, seated: boolean): Box[] {
  const tall = !seated ? TALL.stands : s.dir === 0 ? TALL.front : TALL.side;
  const figure = { x: s.x - ACROSS / 2, y: s.y - tall, w: ACROSS, h: tall };
  return at === "works" ? [figure, crateAt(s)] : [figure];
}

const box = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h });

/** Whether two boxes share any of the ground, or come within `gap` pixels of each other. */
export const meet = (a: Box, b: Box, gap = 0): boolean =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/**
 * What nobody busy at a place stands on or in front of, besides the things standing in town: the
 * seats and whoever sits on them, where the town's own go to be busy, where the member stands to go
 * into the Works and the Grove and the Works' doorway, and the lantern posts with their arms.
 */
export function keepClear(): Box[] {
  const stands = (["works", "grove"] as const).map((id) => place(id).stand);
  const works = piece("works");
  return [
    ...RESTS.flatMap((s) => [
      box(s.x - 5, s.y - TALL.front, ACROSS, TALL.front),
      box(s.from.x - 5, s.from.y - 4, ACROSS, 5),
    ]),
    ...Object.values(ERRANDS).flatMap((ss) => ss.map((s) => box(s.x - 5, s.y - 14, ACROSS, 14))),
    ...stands.map((p) => box(p.x - 6, p.y - TALL.stands, 12, TALL.stands + 2)),
    // The Works' doorway.
    box(works.x + 18, works.y - 4, 24, 26),
    ...piecesOf("post").map((p) => box(p.x - 3, p.y - 42, 14, 42)),
  ];
}

/** A thing standing in town, as far as where people stand goes: the box of its picture, and how far down the town its foot is. */
export interface Thing {
  box: Box;
  z: number;
}

/** How deep the ground a figure's feet take up is, and a thing's foot, in the town's pixels. */
const FEET = 4;

/**
 * Whether what somebody takes up (`b`, standing on its bottom row) is clear of the things standing
 * in town: on none of their feet (the bottom rows of a thing's picture), and behind none of them
 * where it would hide them. In front of a thing, over the top of its picture, is fine.
 */
export const clearOf =
  (things: readonly Thing[]) =>
  (b: Box): boolean => {
    const foot = b.y + b.h;
    const feet = box(b.x, foot - FEET, b.w, FEET);
    return things.every(
      (t) => !meet(feet, box(t.box.x, t.z - FEET, t.box.w, FEET + 1)) && !(t.z > foot && meet(b, t.box)),
    );
  };

/** The strings of lights, a pixel at a time: nobody a step out stands under one. */
export const strings = (): Box[] => STRINGS.flatMap((s) => wire(s).map((p) => box(p.x, p.y, 1, 1)));

/** Which way somebody at `p` faces to face `to`: as a figure in town turns. */
function facing(p: Pt, to: Pt): Spot["dir"] {
  const dx = to.x - p.x;
  const dy = to.y - p.y;
  return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 2) : dy < 0 ? 3 : 0;
}

/** How far out from the spots laid by hand the town looks for more, and how far apart it tries them, in its pixels. */
const OUT = 56;
const TRY = 4;
/** The space kept between two people a step out, in the town's pixels. */
export const APART = 2;

/**
 * A place's spots: those laid by hand, then further ones a step out, `most` in all if the ground
 * allows. A spot further out stands on ground somebody can stand on (`open`), and what it takes up
 * (`footprint`, standing) is on top of nothing that is not to be stood on (`clear`) and of nobody at
 * any spot before it; of those, the nearest to the place's middle (the map's `busy`) comes first. At
 * the Works the crate is on the side away from the middle if there is room, else the other;
 * elsewhere they face the place.
 */
export function further(at: Stand, most: number, open: (p: Pt) => boolean, clear: (b: Box) => boolean): Spot[] {
  const laid = LAID[at];
  const out = [...laid];
  const taken = laid.flatMap((s, n) => footprint(at, s, sits(at, n)));
  const mid = BUSY[at].middle;
  const near = (p: Pt): number => Math.min(...laid.map((s) => Math.hypot(s.x - p.x, s.y - p.y)));
  const xs = laid.map((s) => s.x);
  const ys = laid.map((s) => s.y);
  const tries: Pt[] = [];
  for (let y = Math.min(...ys) - OUT; y <= Math.max(...ys) + OUT; y += TRY)
    for (let x = Math.min(...xs) - OUT; x <= Math.max(...xs) + OUT; x += TRY) tries.push({ x, y });
  const order = tries
    .filter((p) => near(p) <= OUT)
    .map((p) => ({ p, d: Math.hypot(p.x - mid.x, p.y - mid.y) }))
    .toSorted((a, b) => a.d - b.d || a.p.y - b.p.y || a.p.x - b.p.x);
  for (const { p } of order) {
    if (out.length >= most) break;
    if (!open(p)) continue;
    // At the Works the crate goes on the side away from the middle, or failing that the other.
    const away: Spot["dir"] = p.x < mid.x ? 1 : 2;
    const dirs: Spot["dir"][] = at === "works" ? [away, away === 1 ? 2 : 1] : [facing(p, mid)];
    for (const dir of dirs) {
      const s = spot(p.x, p.y, dir);
      const boxes = footprint(at, s, false);
      if (!boxes.every(clear) || boxes.some((b) => taken.some((t) => meet(b, t, APART)))) continue;
      out.push(s);
      taken.push(...boxes);
      break;
    }
  }
  return out;
}

/**
 * Who has which of a place's spots (by their number in the place's list, `count` of them, the first
 * `laid` laid by hand and the first `seated` of those seats), for everybody at it (`ids`), given who
 * had which before (`had`): whoever had one keeps it; everybody else, in order of their account,
 * takes the first free seat, else the spot their account wants among the rest laid by hand if it is
 * free, else the next free one round from it, else the first free one further out. A spot in `shut`
 * (a seat somebody else sits on) is given to nobody new. Nobody has a spot that somebody else has;
 * with nothing free, somebody has none.
 */
export function choose(
  count: number,
  laid: number,
  ids: readonly string[],
  had: ReadonlyMap<string, number>,
  seated = 0,
  shut: ReadonlySet<number> = new Set(),
): Map<string, number> {
  const out = new Map<string, number>();
  const used = new Set<number>();
  const here = [...new Set(ids)];
  const hand = Math.min(laid, count);
  const seats = Array.from({ length: Math.min(seated, hand) }, (_, k) => k);
  const pick = hand - seats.length;
  for (const id of here) {
    const n = had.get(id);
    if (n === undefined || n >= count || used.has(n)) continue;
    out.set(id, n);
    used.add(n);
  }
  for (const id of here.filter((i) => !out.has(i)).toSorted()) {
    const want = pick > 0 ? seedOf(id) % pick : 0;
    const round = Array.from({ length: pick }, (_, k) => seats.length + ((want + k) % pick));
    const rest = Array.from({ length: count - hand }, (_, k) => hand + k);
    const n = [...seats, ...round, ...rest].find((k) => !used.has(k) && !shut.has(k));
    if (n === undefined) continue;
    out.set(id, n);
    used.add(n);
  }
  return out;
}

/**
 * The spots everybody busy in town has, kept from one moment to the next: `place` says, for
 * everybody at a place (`ids`), the spot each has, which is the one they had for as long as they
 * stay there (`choose`); leaving a place frees theirs. A seat `held` says somebody else sits on is
 * given to nobody new. `spotsOf` is each place's spots, the first `LAID[at].length` laid by hand.
 */
export function makeSpots(spotsOf: (at: Stand) => readonly Spot[]) {
  const had = new Map<Stand, Map<string, number>>();
  return {
    place(
      at: Stand,
      ids: readonly string[],
      held: (s: Spot) => boolean = () => false,
    ): Map<string, { spot: Spot; n: number }> {
      const spots = spotsOf(at);
      const shut = new Set(spots.slice(0, SEATED[at]).flatMap((s, n) => (held(s) ? [n] : [])));
      const now = choose(spots.length, LAID[at].length, ids, had.get(at) ?? new Map(), SEATED[at], shut);
      had.set(at, now);
      const out = new Map<string, { spot: Spot; n: number }>();
      for (const [id, n] of now) {
        const s = spots[n];
        if (s) out.set(id, { spot: s, n });
      }
      return out;
    },
  };
}

// ---------- what each is doing ----------

/** How somebody at a place is drawn at a moment: where, facing which way, on their feet or sitting, dozing, and at the Works their work. */
export interface Pose {
  x: number;
  y: number;
  dir: Spot["dir"];
  seated: boolean;
  dozing: boolean;
  work: Work | null;
}

/**
 * How somebody at a place (`at`) is at a moment (`now`, Leaf's clock), with their spot (`spot`, the
 * `n`th of the place's): at it and nowhere else, never on the way to it; dozing there if they are
 * away (Leaf's rule), sat down facing us, or on a log as it faces; else busy there: at the stump
 * on a log over the board or standing round it, at the Works at work at their crate, before the
 * stone standing facing it.
 */
export function poseAt(o: { id: string; at: Stand; spot: Spot; n: number; away: boolean; now: number }): Pose {
  const { spot: s } = o;
  const at = { x: s.x, y: s.y };
  if (o.away) return { ...at, dir: sits(o.at, o.n) ? s.dir : 0, seated: true, dozing: true, work: null };
  if (o.at === "works") {
    const work = atWork(o.id, s, o.now);
    return { ...at, dir: work.dir, seated: false, dozing: false, work };
  }
  return { ...at, dir: s.dir, seated: sits(o.at, o.n), dozing: false, work: null };
}

// ---------- at the Works ----------

/** A round of work at a crate, by Leaf's clock, in milliseconds: hammering it, lifting it to look it over, setting it down, a breather. */
export const WORK_MS = 9000;
/**
 * When each part of the round ends, in milliseconds into it: hammering, lifting the crate, looking it
 * over (then it is down again, and they stand a moment). Each blow takes `BLOW`, the hammer up for
 * `UP` of it, and falls as it ends.
 */
const ROUND = { hammer: 4800, lift: 5300, look: 7300 } as const;
const BLOW = 800;
const UP = 450;
const BLOWS = ROUND.hammer / BLOW;

/** Somebody at work at their crate at a moment. */
export interface Work {
  /** Which way they face: their spot's way, or towards us while they look a crate over. */
  dir: Spot["dir"];
  /** Their crate in their arms, rather than on the ground beside them. */
  held: boolean;
  /** Their hammer: raised, down on the crate, or by (none drawn). */
  hammer: "up" | "down" | null;
  /** When their last blow fell, by Leaf's clock: a chip flies off the crate at each. */
  blow: number;
}

const mod = (n: number, by: number): number => ((n % by) + by) % by;

/**
 * Somebody at work at the Works at a moment of Leaf's clock, at their spot, the same on every page:
 * a round of `WORK_MS` of their own time, hammering at the crate beside them, then lifting it and
 * turning to us to look it over, setting it down again and standing a moment. They never leave
 * their spot.
 */
export function atWork(id: string, s: Spot, now: number): Work {
  const off = seedOf(id) % WORK_MS;
  const into = mod(now + off, WORK_MS);
  const began = now - into;
  // The last blow: this round's, or before its first the last of the round before.
  const k = Math.min(BLOWS - 1, Math.floor((into - UP) / BLOW));
  const blow = k >= 0 ? began + k * BLOW + UP : began - WORK_MS + (BLOWS - 1) * BLOW + UP;
  if (into < ROUND.hammer) {
    const up = into % BLOW < UP;
    return { dir: s.dir, held: false, hammer: up ? "up" : "down", blow };
  }
  if (into < ROUND.lift) return { dir: s.dir, held: true, hammer: null, blow };
  if (into < ROUND.look) return { dir: 0, held: true, hammer: null, blow };
  return { dir: s.dir, held: false, hammer: null, blow };
}
