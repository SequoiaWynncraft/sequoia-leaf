/**
 * Where each member busy at one of the games is in town, and what they do there, in place: a spot
 * of their own. Each place has spots laid by hand where they read well (`LAID`), and past those
 * further ones a step out (`further`), on top of nobody and nothing. A member's spot is chosen by
 * their account and kept for as long as they stay (`makeSpots`), and nobody is given one that
 * somebody else has. At the Works they work at a crate of their own beside them (`atWork`, by Leaf's
 * clock); at the stump they sit over the board; before the Grove's stone they stand facing it.
 * Nothing here is drawn (`visitors.ts` draws it), and who is at which place is `where.ts`'s word.
 */

import type { Pt } from "@sequoia-leaf/kit/util.ts";
import { seedOf, type Spot, SPOTS as FOLK_SPOTS, type Stand } from "@sequoia-leaf/town/clock.ts";

import { STRINGS, wire } from "./strings.ts";
import { place, POSTS, SEATS } from "./world.ts";

/** A box on the town's ground, in its pixels: its left and top, and how wide and tall. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const spot = (x: number, y: number, dir: Spot["dir"]): Spot => ({ x, y, dir });

/**
 * The spots of each place laid by hand, the first wanted most. At the Works, along its front and by
 * the crate pile, side on, each with room for a crate on the side they face, and none on the bench,
 * in the doorway or where the town's own stand at the door; at the stump, sitting round it over the
 * board, none on the logs (the member's and the dozers' seats) and one behind the board, where the
 * string of lights only just clears a head; before the Grove's stone, facing it, either side of
 * where the member stands to go in.
 */
export const LAID: Readonly<Record<Stand, readonly Spot[]>> = {
  works: [spot(451, 139, 2), spot(466, 151, 1), spot(408, 138, 1), spot(391, 153, 2), spot(407, 160, 1)],
  table: [spot(444, 205, 3), spot(448, 171, 0), spot(415, 193, 2), spot(472, 193, 1)],
  grove: [spot(92, 197, 3), spot(116, 197, 3), spot(79, 195, 2), spot(129, 195, 1)],
};

/** Where each place is, for the spots past those laid by hand to face, and to be nearest to: the Works' pile, the stump's board, the Grove's stone. */
export const MIDDLE: Readonly<Record<Stand, Pt>> = {
  works: { x: 430, y: 145 },
  table: { x: 444, y: 185 },
  grove: { x: 104, y: 180 },
};

/** Where whoever comes to a place, from nowhere the page saw, comes from: the Works' door, the way along to the stump, the Grove's stone. */
export const WAY_IN: Readonly<Record<Stand, Pt>> = {
  works: { x: 375, y: 132 },
  table: { x: 414, y: 207 },
  grove: { x: 104, y: 192 },
};

/** At the stump a member sits; at the Works and before the stone they stand. Past the spots laid by hand, everybody stands. */
export const sits = (at: Stand, n: number): boolean => at === "table" && n < LAID.table.length;

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
  return [
    ...SEATS.flatMap((s) => [
      box(s.x - 5, s.y - TALL.front, ACROSS, TALL.front),
      box(s.from.x - 5, s.from.y - 4, ACROSS, 5),
    ]),
    ...Object.values(FOLK_SPOTS).flatMap((ss) => ss.map((s) => box(s.x - 5, s.y - 14, ACROSS, 14))),
    ...stands.map((p) => box(p.x - 6, p.y - TALL.stands, 12, TALL.stands + 2)),
    box(362, 116, 24, 26),
    ...POSTS.map((p) => box(p.x - 3, p.y - 42, 14, 42)),
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
 * any spot before it; of those, the nearest to the place itself (`MIDDLE`) comes first. At the Works
 * the crate is on the side away from the middle if there is room, else the other; elsewhere they
 * face the place.
 */
export function further(at: Stand, most: number, open: (p: Pt) => boolean, clear: (b: Box) => boolean): Spot[] {
  const laid = LAID[at];
  const out = [...laid];
  const taken = laid.flatMap((s, n) => footprint(at, s, sits(at, n)));
  const mid = MIDDLE[at];
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
 * `laid` laid by hand), for everybody at it (`ids`), given who had which before (`had`): whoever had
 * one keeps it; everybody else, in order of their account, takes the one their account wants among
 * those laid by hand if it is free, else the next free one round from it, else the first free one
 * further out. Nobody has a spot that somebody else has; with nothing free, somebody has none.
 */
export function choose(
  count: number,
  laid: number,
  ids: readonly string[],
  had: ReadonlyMap<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  const used = new Set<number>();
  const here = [...new Set(ids)];
  const hand = Math.min(laid, count);
  for (const id of here) {
    const n = had.get(id);
    if (n === undefined || n >= count || used.has(n)) continue;
    out.set(id, n);
    used.add(n);
  }
  for (const id of here.filter((i) => !out.has(i)).toSorted()) {
    const want = hand > 0 ? seedOf(id) % hand : 0;
    const round = Array.from({ length: hand }, (_, k) => (want + k) % hand);
    const rest = Array.from({ length: count - hand }, (_, k) => hand + k);
    const n = [...round, ...rest].find((k) => !used.has(k));
    if (n === undefined) continue;
    out.set(id, n);
    used.add(n);
  }
  return out;
}

/**
 * The spots everybody busy in town has, kept from one moment to the next: `place` says, for
 * everybody at a place (`ids`), the spot each has, which is the one they had for as long as they
 * stay there (`choose`); leaving a place frees theirs. `spotsOf` is each place's spots, the first
 * `LAID[at].length` laid by hand.
 */
export function makeSpots(spotsOf: (at: Stand) => readonly Spot[]) {
  const had = new Map<Stand, Map<string, number>>();
  return {
    place(at: Stand, ids: readonly string[]): Map<string, { spot: Spot; n: number }> {
      const spots = spotsOf(at);
      const now = choose(spots.length, LAID[at].length, ids, had.get(at) ?? new Map());
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
  walking: boolean;
  seated: boolean;
  dozing: boolean;
  work: Work | null;
}

/**
 * How somebody at a place (`at`) is at a moment (`now`, Leaf's clock), with their spot (`spot`, the
 * `n`th of the place's): on the way to it (`way`, where their one walk there has them, if it is not
 * over), awake whatever Leaf says of them, so that nobody walks dozing; else at it and nowhere else,
 * dozing there, sat down facing us, if they are away (Leaf's rule); else busy there: at the stump
 * sitting over the board, at the Works at work at their crate, before the stone standing facing it.
 */
export function poseAt(o: {
  id: string;
  at: Stand;
  spot: Spot;
  n: number;
  away: boolean;
  now: number;
  way: (Pt & { next: Pt | null }) | null;
}): Pose {
  const { spot: s } = o;
  if (o.way?.next) {
    const { x, y, next } = o.way;
    return { x, y, dir: facing({ x, y }, next), walking: true, seated: false, dozing: false, work: null };
  }
  const at = { x: s.x, y: s.y, walking: false };
  if (o.away) return { ...at, dir: 0, seated: true, dozing: true, work: null };
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
