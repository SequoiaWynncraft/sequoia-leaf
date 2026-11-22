/**
 * Nobody stands inside anybody: where a page loaded again puts its member back (`stoodAt`, from what
 * `stood` kept), and how members standing on one spot are drawn a step apart (`apart`), the same on
 * every page. Only the drawing steps aside; where a figure is does not change.
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

/** Two figures this near, in the town's pixels, stand on one spot; and how far a figure steps aside from it. */
export const NEAR = 6;
export const STEP = 7;
/** How long a step aside, or back, takes, in seconds. */
export const EASE = 0.2;
/** Which way each figure after the first steps, in turn: right, left, down, up, then the diagonals. */
const ASIDE: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

/** Somebody standing still, by their account. */
export interface Still extends Pt {
  id: string;
}

const byId = (a: Still, b: Still): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * How far from where each stands each is drawn, by their account, for everybody standing still:
 * those within `NEAR` of one another (and of anybody within `NEAR` of them) are on one spot. On
 * each, the first by account keeps the spot and the rest stand `STEP` aside from it in turn
 * (`ASIDE`), past nine the same again twice as far, and so on. Only those who step aside are in the answer.
 */
export function apart(still: readonly Still[]): Map<string, Pt> {
  const out = new Map<string, Pt>();
  const left = new Set(still);
  for (const first of still.toSorted(byId)) {
    if (!left.has(first)) continue;
    const spot = [first];
    left.delete(first);
    // Those who join the spot are looked round from in turn, as they join.
    for (const s of spot)
      for (const o of left)
        if (Math.hypot(o.x - s.x, o.y - s.y) <= NEAR) {
          left.delete(o);
          spot.push(o);
        }
    spot.toSorted(byId).forEach((s, n) => {
      if (n === 0) return;
      const [dx, dy] = ASIDE[(n - 1) % ASIDE.length] ?? [0, 0];
      const far = STEP * Math.ceil(n / ASIDE.length);
      out.set(s.id, { x: first.x + dx * far - s.x, y: first.y + dy * far - s.y });
    });
  }
  return out;
}

/** Moves a figure's step aside (`at`) towards where it is to be (`to`), `dt` seconds on: a whole `STEP` takes `EASE`. */
export function ease(at: Pt, to: Pt, dt: number): void {
  const d = Math.hypot(to.x - at.x, to.y - at.y);
  const k = d <= 0 ? 1 : Math.min(1, ((STEP / EASE) * dt) / d);
  at.x += (to.x - at.x) * k;
  at.y += (to.y - at.y) * k;
}
