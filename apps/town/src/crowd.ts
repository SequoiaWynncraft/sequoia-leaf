/**
 * Everybody in a place on top of one another, members and the town's own, standing, sitting or
 * walking the same way, is drawn apart (`apart.ts`), stepping aside and back as they meet and part.
 * A page spreads what it shows: two walking in line may be apart on one page and not on another,
 * and on neither inside each other. The town and a camp each step their own (`makeApart`), and say
 * who is on their ground (`peopleOn`), so that a walk there ends beside them, never on their seat.
 */

import type { Pt } from "@sequoia-leaf/kit/util.ts";
import type { Ground } from "@sequoia-leaf/town/map/grid.ts";

import { headOf, peopleOn } from "./actors.ts";
import { apart, ease } from "./apart.ts";
import type { Actor } from "./game.ts";

/** Faster than anybody walks, in pixels a second: put somewhere else, not walking there. */
const JUMP = 300;
const HOME: Pt = { x: 0, y: 0 };

/** Who a figure is, for `apart`: a member's account, or which of the town's own. */
const whoIs = (a: Actor): string => (a.folk ? `folk:${a.folk.t.id}` : a.id);

/** Draws everybody in a place (`people`, on its `ground`) apart, a moment of `dt` seconds at a time. */
export function makeApart(ground: Ground, people: () => readonly Actor[]): (dt: number) => void {
  peopleOn(ground, people);
  /**
   * Where each figure's feet were at the last step, and how fast they have been going, over about a
   * tenth of a second: a live player's place, drawn from the room's samples, jitters from frame to frame.
   */
  const pace = new WeakMap<Actor, { x: number; y: number; vx: number; vy: number }>();
  return (dt) => {
    if (dt <= 0) return;
    const everybody = people();
    const k = Math.min(1, dt / 0.1);
    const drawn = everybody.flatMap((a) => {
      if (a.away || a.alpha <= 0.02) {
        pace.delete(a);
        return [];
      }
      const { x, y } = a.seat ?? a;
      const was = pace.get(a);
      const [rx, ry] = was ? [(x - was.x) / dt, (y - was.y) / dt] : [0, 0];
      // Standing, only now in sight, or put somewhere else: not walking.
      const walks = a.moving && Math.hypot(rx, ry) < JUMP;
      const vx = was && walks ? was.vx + (rx - was.vx) * k : 0;
      const vy = was && walks ? was.vy + (ry - was.vy) * k : 0;
      pace.set(a, { x, y, vx, vy });
      // One of the town's own at its post keeps its place, as whoever sits does.
      const seated = a.seat !== null || (a.folk !== null && !a.moving);
      return [{ id: whoIs(a), x, y, tall: headOf(a), seated, vx, vy }];
    });
    const to = apart(drawn);
    for (const a of everybody) ease(a.aside, to.get(whoIs(a)) ?? HOME, dt);
  };
}
