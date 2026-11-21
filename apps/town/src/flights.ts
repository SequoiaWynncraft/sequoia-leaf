/**
 * Things in the air: a parcel leaving a stall for the camp, a present hopping out of the mailbox,
 * a purchase landing where it will stand. Each flies in an arc from one spot to another, with its
 * shadow following along the ground, and something happens when it lands.
 */

import { type Ctx, lerp, type Pt } from "@sequoia-leaf/kit/util.ts";

import type { Standing } from "./props.ts";

interface Flight extends Standing {
  t: number;
  secs: number;
  land: (() => void) | null;
}

/** Everything in the air this moment, to be drawn over whatever stands. */
export const flights: Flight[] = [];

/** Throws a picture from one spot to another, `high` art pixels up at the top of its arc. */
export function fling(
  pic: HTMLCanvasElement,
  from: Pt,
  to: Pt,
  secs: number,
  high: number,
  land: (() => void) | null = null,
): void {
  const f: Flight = {
    t: 0,
    secs,
    land,
    z: 1e6,
    paint(g: Ctx, cx: number, cy: number): void {
      const k = Math.min(1, f.t / f.secs);
      const x = Math.round(lerp(from.x, to.x, k));
      const y = lerp(from.y, to.y, k);
      const up = Math.sin(k * Math.PI) * high;
      g.fillStyle = "rgba(20,10,28,0.3)";
      g.fillRect(x - 3 - cx, Math.round(y) - 1 - cy, 6, 2);
      g.drawImage(pic, x - Math.floor(pic.width / 2) - cx, Math.round(y - up) - pic.height - cy);
    },
  };
  flights.push(f);
}

export function stepFlights(dt: number): void {
  for (let i = flights.length - 1; i >= 0; i--) {
    const f = flights[i];
    if (!f) continue;
    f.t += dt;
    if (f.t < f.secs) continue;
    flights.splice(i, 1);
    f.land?.();
  }
}

/** Nothing is left in the air: the place is being cleared away. */
export function clearFlights(): void {
  flights.length = 0;
}
