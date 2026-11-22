/**
 * Nobody stands inside anybody: where a page loaded again puts its member back (`stoodAt`, from what
 * `stood` kept); where somebody stops if somebody is there already (`beside`); and how members on
 * top of one another, standing, sitting or walking along together, are drawn apart (`apart`): the
 * same on every page once they have stopped. Only the drawing steps aside; where a figure is does
 * not change.
 */

import type { Dir } from "@sequoia-leaf/kit/skin.ts";
import type { Pt } from "@sequoia-leaf/kit/util.ts";

import { dirOf } from "./motion.ts";

/** How long after a page goes the next page in its tab puts the member back where they stood, in milliseconds. */
export const BACK_WITHIN = 10 * 60_000;

/** Where a member stands, and which way they face. */
export interface Stood {
  x: number;
  y: number;
  dir: Dir;
}

/** What a page keeps of where its member stands, `now`. */
export const stood = (a: Stood, now: number): string => JSON.stringify({ x: a.x, y: a.y, dir: a.dir, at: now });

/** Where the last page left its member (`kept`, as `stood` wrote it), if it went no more than `BACK_WITHIN` before `now`. */
export function stoodAt(kept: string | null, now: number): Stood | null {
  try {
    const v: unknown = JSON.parse(kept ?? "null");
    if (typeof v !== "object" || v === null || !("x" in v) || !("y" in v) || !("dir" in v) || !("at" in v)) return null;
    const { x, y, dir, at } = v;
    if (typeof x !== "number" || typeof y !== "number" || typeof dir !== "number" || typeof at !== "number")
      return null;
    return now >= at && now - at <= BACK_WITHIN ? { x, y, dir: dirOf(dir, 0) } : null;
  } catch {
    return null;
  }
}

/** How wide a figure is drawn, in the town's pixels; how tall depends on its pose (`headOf`). */
const ACROSS = 10;
/** The furthest a figure is drawn from where it is, and a walk's end from where it was going, in the town's pixels. */
export const MOST = 21;
/** How fast a figure steps aside, or back, in pixels a second. */
export const PACE = 50;
/** Every place round a point no further than `MOST`, nearest first. */
const ROUND: readonly Pt[] = Array.from({ length: (2 * MOST + 1) ** 2 }, (_, i) => ({
  x: (i % (2 * MOST + 1)) - MOST,
  y: Math.floor(i / (2 * MOST + 1)) - MOST,
}))
  .filter((d) => Math.hypot(d.x, d.y) <= MOST)
  .toSorted((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));

/** Somebody's figure where it is drawn: their feet, and how tall it is drawn. */
export interface Placed extends Pt {
  tall: number;
}

/** Whether two figures are drawn on top of one another: they overlap by over a third of the smaller. */
export function crowds(a: Placed, b: Placed): boolean {
  const across = Math.max(0, ACROSS - Math.abs(a.x - b.x));
  const high = Math.max(0, Math.min(a.y, b.y) - Math.max(a.y - a.tall, b.y - b.tall));
  return across * high * 3 > ACROSS * Math.min(a.tall, b.tall);
}

/**
 * Where `who` is to be, with others there already (`taken`): the nearest place to where they are,
 * that place first, that is on top of nobody and `fits`; with none within `MOST`, where they are.
 */
export function beside(who: Placed, taken: readonly Placed[], fits: (p: Pt) => boolean): Placed {
  for (const d of ROUND) {
    const there = { x: who.x + d.x, y: who.y + d.y, tall: who.tall };
    if (taken.every((t) => !crowds(t, there)) && fits(there)) return there;
  }
  return who;
}

/** Somebody going slower than this, in pixels a second, has stopped: nobody walks slower than 30. */
export const SLOW = 24;

/** Somebody drawn, by their account: where, whether they keep their place first (`seated`), and how fast they go each way, in pixels a second. */
export interface Someone extends Placed {
  id: string;
  seated: boolean;
  vx: number;
  vy: number;
}

const stopped = (a: Someone): boolean => Math.hypot(a.vx, a.vy) < SLOW;
/** Whoever sits first, then by account. */
const order = (a: Someone, b: Someone): number =>
  a.seated !== b.seated ? (a.seated ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
/**
 * Two who are not to be drawn on top of one another: either has stopped (whoever walks goes round
 * them), or they walk the same way, at any pace. Two walking across or against each other are
 * through in a moment.
 */
const along = (a: Someone, b: Someone): boolean => stopped(a) || stopped(b) || a.vx * b.vx + a.vy * b.vy > 0;

/**
 * How far from where each is each is drawn, by their account, for everybody: first those who have
 * stopped, then those walking, who so never move anybody standing. Of each, in turn (`order`):
 * somebody on top of nobody placed before them stays where they are; each of the rest takes the
 * nearest place round where they are themselves that is on top of nobody drawn (`beside`), of those
 * they are `along` with. Only those who step aside are in the answer.
 */
export function apart(everybody: readonly Someone[]): Map<string, Pt> {
  const drawn: Someone[] = [];
  const out = new Map<string, Pt>();
  for (const walking of [false, true]) {
    const some = everybody.filter((s) => stopped(s) !== walking).toSorted(order);
    const on = (o: Someone, s: Someone): boolean => along(o, s) && crowds(o, s);
    const stay = some.filter((s, i) => [...drawn, ...some.slice(0, i)].every((o) => !on(o, s)));
    drawn.push(...stay);
    for (const s of some) {
      if (stay.includes(s)) continue;
      const at = beside(
        s,
        drawn.filter((d) => along(d, s)),
        () => true,
      );
      drawn.push({ ...s, x: at.x, y: at.y });
      if (at.x !== s.x || at.y !== s.y) out.set(s.id, { x: at.x - s.x, y: at.y - s.y });
    }
  }
  return out;
}

/** Moves a figure's step aside (`at`) towards where it is to be (`to`), `dt` seconds on, at `PACE`. */
export function ease(at: Pt, to: Pt, dt: number): void {
  const d = Math.hypot(to.x - at.x, to.y - at.y);
  const k = d <= 0 ? 1 : Math.min(1, (PACE * dt) / d);
  at.x += (to.x - at.x) * k;
  at.y += (to.y - at.y) * k;
}
