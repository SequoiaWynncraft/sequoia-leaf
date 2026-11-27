/**
 * The yard's lamps and fires, as plain values: the depot's lamps, the gate's lantern, and each piece's
 * own where power reaches it, as its kind says (`kinds/`): power's reach round each joined pylon and
 * its own small lamp, the pool of a kiln or a workshop at work, a boiler burning and a Study. The lamplight is power's reach, so it is listed by
 * how far each light reaches into a rectangle of the yard, never by which pieces are drawn there: a
 * lamp does not come and go as the view moves (`scene.ts` cuts them out of its dusk).
 */

import { litAt, litOf, NONE, REACH, type Yard } from "@sequoia-leaf/factory";
import type { Pt } from "@sequoia-leaf/kit/util.ts";

import { TILE } from "./art/belts.ts";
import { drawnFrom, pieceBox } from "./big.ts";
import { pageOf } from "./kinds/index.ts";
import type { LampsAt } from "./kinds/kind.ts";

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
  const at: LampsAt = { pace, bright: lamp(pace), reach, tall: w.open.reach > 100, working, kiln };
  const ty0 = Math.max(0, Math.floor(view.y / TILE) - m);
  const ty1 = Math.min(land.h - 1, Math.ceil((view.y + view.h) / TILE) + m);
  const tx0 = Math.max(0, Math.floor(view.x / TILE) - m);
  const tx1 = Math.min(land.w - 1, Math.ceil((view.x + view.w) / TILE) + m);
  for (let ty = ty0; ty <= ty1; ty++)
    for (let tx = tx0; tx <= tx1; tx++) {
      const i = ty * land.w + tx;
      // Each kind's own lamps and fires, where power reaches it (`KindPage.lamps`).
      if (w.part[i] !== 0) bigLamps(w, i, at, out);
      else if (powered[i] === 1) pageOf(w.kind[i] ?? NONE)?.lamps?.(w, i, tx * TILE + 8, (ty + 1) * TILE, at, out);
    }
  return out;
}

/** A piece of more than one tile's lamps, once, from its own tile: from the middle of the foot of its box, where power reaches any of its tiles. */
function bigLamps(w: Yard, i: number, at: LampsAt, out: Lamp[]): void {
  const lamps = drawnFrom(w, i) && litAt(w, i) ? pageOf(w.kind[i] ?? NONE)?.lamps : undefined;
  if (!lamps) return;
  const b = pieceBox(w, i);
  lamps(w, i, b.x * TILE + (b.w * TILE) / 2, (b.y + b.h) * TILE, at, out);
}
