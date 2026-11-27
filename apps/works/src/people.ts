/**
 * Whoever stands in the yard, drawn among what stands, each by the row of their feet: the gnomes who
 * come to the gate and the yard's own (`actors.ts`), and the member in their own yard (`figure/you.ts`).
 */
import { HOP, walkers } from "./actors.ts";
import type { Art } from "./art/index.ts";
import { drawYou, type Put } from "./figure/you.ts";

/** Lists everybody in the yard to be drawn (`put`), the picture's corner at `cx`, `cy` in the yard. */
export function eachPerson(art: Art, cx: number, cy: number, put: Put): void {
  // The gnomes who come to the gate, and the yard's own: waddling, or standing; arms up under a crate.
  const m = art.m;
  for (const a of walkers) {
    const hat = a.carrying ? 1 : 0;
    const frame = a.moving
      ? m.waddle[a.hat]?.[hat]?.[Math.floor(a.walked / 4) % 2]
      : m.gnome[a.hat]?.[a.carrying ? 3 : 0];
    if (!frame) continue;
    const up = a.hop > 0 ? Math.abs(Math.sin((1 - a.hop / HOP) * Math.PI)) * 5 : 0;
    const x = Math.round(a.x) - cx;
    const y = Math.round(a.y - up) - cy;
    put(frame.c, x - frame.ax, y - frame.ay, a.y, a.alpha);
    if (a.carrying) put(art.parcel.c, x - art.parcel.ax, y - 14 - art.parcel.ay, a.y + 0.1, a.alpha);
  }
  drawYou(put, cx, cy);
}
