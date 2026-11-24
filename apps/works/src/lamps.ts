/**
 * The yard's lamps and fires, as plain values: the depot's lamps, the gate's lantern, power's reach
 * round each joined pylon and its own small lamp, and the pool of a kiln or a workshop at work, a
 * boiler burning and a Study that power reaches. The lamplight is power's reach, so it is listed by
 * how far each light reaches into a rectangle of the yard, never by which pieces are drawn there: a
 * lamp does not come and go as the view moves (`scene.ts` cuts them out of its dusk).
 */

import { BOILER, holderOf, litOf, MILL, NONE, PYLON, REACH, STUDY, WORKSHOP, type Yard } from "@sequoia-leaf/factory";
import type { Pt } from "@sequoia-leaf/kit/util.ts";

import { TILE } from "./art/belts.ts";

/** A pool of light: its middle and radius in the yard's pixels, how strong, and whether it marks power's reach. */
export interface Lamp {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly power: number;
  readonly reach: boolean;
}

/** The most any lamp or fire but power's own reaches, in the yard's pixels: the depot's doorway lamp. */
const LAMP_MOST = 34;

/** How bright the lamps burn: full while there is power for everything, and visibly lower when there is not. */
export const lamp = (pace: number): number => 0.3 + 0.7 * pace * pace;

/**
 * Every lamp and fire whose light reaches `view` (in the yard's pixels): looked for over each tile its
 * light could reach the view from. `pace` is the share of its pace everything works at; `working`
 * says whether the piece on a tile is at work, and `kiln` whether a mill there is firing.
 */
export function lampsIn(
  w: Yard,
  gate: Pt,
  view: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  pace: number,
  working: (i: number) => boolean,
  kiln: (i: number) => boolean,
): Lamp[] {
  const { land } = w;
  const out: Lamp[] = [];
  const [dx, dy] = land.depot;
  const depotX = dx * TILE + 8;
  const depotFoot = (dy + 2) * TILE;
  out.push({ x: depotX, y: depotFoot - 24, r: (REACH.depot / 100) * TILE * 1.2, power: lamp(pace), reach: true });
  out.push({ x: depotX, y: depotFoot - 6, r: 34, power: 0.9, reach: false });
  out.push({ x: gate.x - 6, y: gate.y - 14, r: 26, power: 0.75, reach: false });
  const reach = ((REACH.pylon * w.open.reach) / 10_000) * TILE * 1.2;
  const m = Math.ceil(Math.max(reach, LAMP_MOST) / TILE) + 1;
  const powered = litOf(w);
  const tall = w.open.reach > 100;
  const ty0 = Math.max(0, Math.floor(view.y / TILE) - m);
  const ty1 = Math.min(land.h - 1, Math.ceil((view.y + view.h) / TILE) + m);
  const tx0 = Math.max(0, Math.floor(view.x / TILE) - m);
  const tx1 = Math.min(land.w - 1, Math.ceil((view.x + view.w) / TILE) + m);
  for (let ty = ty0; ty <= ty1; ty++)
    for (let tx = tx0; tx <= tx1; tx++) {
      const i = ty * land.w + tx;
      const k = w.kind[i] ?? NONE;
      if (powered[i] !== 1 || (k !== PYLON && k !== MILL && k !== WORKSHOP && k !== BOILER && k !== STUDY)) continue;
      const x = tx * TILE + 8;
      const foot = (ty + 1) * TILE;
      if (k === PYLON) {
        out.push({ x, y: foot - 8, r: reach, power: lamp(pace), reach: true });
        out.push({ x: x + 5, y: foot - (tall ? 24 : 16), r: 14, power: 0.5 * pace, reach: false });
      } else if (k === STUDY) out.push({ x: x - 4, y: foot - 13, r: 15, power: 0.6, reach: false });
      else if (k === BOILER) {
        const r = holderOf(w, i);
        if (r >= 0 && (w.holders.fuel[r] ?? 0) > 0)
          out.push({ x: x - 2, y: foot - 4, r: 24, power: 0.85, reach: false });
      } else if (working(i)) {
        if (k === WORKSHOP) out.push({ x: x - 3, y: foot - 10, r: 18, power: 0.7, reach: false });
        else if (kiln(i)) out.push({ x, y: foot - 6, r: 22, power: 0.8, reach: false });
      }
    }
  return out;
}
