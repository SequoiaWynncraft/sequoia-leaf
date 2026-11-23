/**
 * A figure going from one point to another in an arc, over a while of whatever clock its table keeps
 * (the stage's seconds while planning, the fight's steps in a fight). Every figure that moves on a
 * table moves by one of these.
 */
import { clamp, lerp } from "@sequoia-leaf/kit/util.ts";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Move {
  readonly from: Point;
  readonly to: Point;
  /** When it set off, and how long it takes, on its table's clock. */
  readonly t0: number;
  readonly dur: number;
  /** How high it goes at the middle of the way. */
  readonly arc: number;
  /** Easing in and out, as a hop does, or at an even pace, as a walk does. */
  readonly smooth: boolean;
}

/** Where a move has got to at `t`: the point, how high off the table, and how far along (0 to 1). */
export function moveAt(m: Move, t: number): { x: number; y: number; lift: number; k: number } {
  const k = clamp((t - m.t0) / Math.max(m.dur, 1e-9), 0, 1);
  const e = m.smooth ? k * k * (3 - 2 * k) : k;
  return { x: lerp(m.from.x, m.to.x, e), y: lerp(m.from.y, m.to.y, e), lift: Math.sin(k * Math.PI) * m.arc, k };
}
