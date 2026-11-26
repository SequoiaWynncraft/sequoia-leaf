/**
 * What a figure that is a person on a rig (a banner's member) is doing at a moment of a fight, as
 * the stance it is drawn in: its body acts out what the fight says is happening to it. Everybody
 * else is one picture bent as it moves (`motion.ts`); a person walks with arms and legs, throws
 * with an arm, raises an ability, points at whoever it is for, brings it down, reels, sways dazed
 * and falls with its limbs going (`acts.ts` in the figures has each of those).
 */
import {
  cheering,
  dazed,
  falling,
  holding,
  raising,
  recoiling,
  slamming,
  standing,
  throwing,
  walking,
} from "@sequoia-leaf/figures/acts.ts";
import { handOf, type Stance } from "@sequoia-leaf/figures/rig.ts";
import { rigOf } from "@sequoia-leaf/figures/sprites.ts";
import { clamp } from "@sequoia-leaf/kit/util.ts";

import type { Pt } from "./geometry.ts";
import type { Actor } from "./motion.ts";

/** The angle an arm is held at to point at somebody `dx`, `dy` pixels away: between a little below level and well above it. */
export const aimAt = (dx: number, dy: number): number =>
  clamp(Math.round(Math.atan2(Math.abs(dx), dy) / (Math.PI / 8)), 3, 6);

/** Steps a throwing arm stays out after the thing has left it, and steps the head stays on whoever it was thrown at. */
const OUT = 7;
const KEEN = 18;
/** Steps it takes to straighten up after bringing an ability down. */
const SPENT = 12;

type Clip = (a: Actor, c: number, tick: number) => Stance | null;

/** Whatever is being done to it: falling, reeling from a blow, dazed. */
const suffering: Clip = (a, c, tick) => {
  if (c >= a.fallAt) return falling(c - a.fallAt, a.tumble < 0);
  const hurt = c - a.hurtAt;
  if (hurt >= 0 && hurt < 5) return recoiling(hurt, a.hx < 0, a.hard);
  return a.unit.stunUntil > tick ? dazed(c) : null;
};
/** Its ability: raising it, holding whoever it is for until it lands, bringing it down; or throwing it out, for one that lands at once. */
const casting: Clip = (a, c) => {
  const h = a.held;
  if (h && c < h.lands) return holding(c - h.at, h.lands - c, h.left, h.aim);
  if (h && c < h.lands + SPENT) return slamming(c - h.lands, h.left);
  const w = a.wind;
  if (!w || c < w.from || c >= w.at + OUT) return null;
  return c < w.at ? raising((c - w.from) / Math.max(1e-9, w.at - w.from), a.left) : throwing(1, c - w.at, a.left, 4);
};
/** An attack: the arm on the side of whoever it is at, at the angle they are at. */
const attacking: Clip = (a, c) => {
  const b = a.blow;
  if (!b || c < b.from || c >= b.at + OUT) return null;
  const left = Math.abs(b.bx) > 0.2 ? b.bx < 0 : a.left;
  return throwing((c - b.from) / Math.max(1e-9, b.at - b.from), c - b.at, left, aimAt(b.bx, b.by));
};
/** Going somewhere on foot, or hopping for joy. */
const moving: Clip = (a, c) => {
  if (a.move && a.move.arc < 6) return walking(c, a.left);
  const hop = c - a.hopAt;
  return hop >= 0 && hop < 6 ? cheering(hop / 6, a.left) : null;
};
/** What it may be doing, the most pressing first. */
const CLIPS: readonly Clip[] = [suffering, casting, attacking, moving];

/** The stance of a person on a rig at the fight's clock `c` (and step `tick`); null for a figure that is not one. */
export function stanceOf(a: Actor, c: number, tick: number): Stance | null {
  if (!rigOf(a.unit.kind)) return null;
  for (const clip of CLIPS) {
    const s = clip(a, c, tick);
    if (s) return s;
  }
  const b = a.blow;
  return standing(c, a.left, a.phase, b !== null && c >= b.from && c < b.at + KEEN);
}

/** Where the hand a person on a rig throws with is at a moment, from the board's corner; null for a figure that is not one. */
export function handAt(a: Actor, c: number, tick: number): Pt | null {
  const s = stanceOf(a, c, tick);
  if (!s) return null;
  const hand = handOf(s);
  return { x: a.x + hand.x, y: a.y - 2 + hand.y };
}
