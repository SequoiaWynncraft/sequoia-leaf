/**
 * What using a tool on the yard comes to, for every tool alike: an aim worked out of the yard and the
 * purse as they are now, a refusal said with its sound, and a piece landing with dust, a ring, its
 * sound and what it took from the purse rising from it.
 */

import { CREAM, GOLD } from "@sequoia-leaf/kit/palette.ts";

import { TILE } from "./art/belts.ts";
import { float, puff, ring } from "./fx.ts";
import { yardSfx } from "./sound.ts";
import { type Aim, S, toolHooks } from "./state.ts";
import { coins, type Did } from "./yard.ts";

/** The colour of the dust a piece lands in, or is taken away in. */
export const DUST = "#cbb894";

/** Whether the rules refused something done (`did`, as `doNow` gave it): if so, it is said why, with its sound. */
export function refused(did: Did): boolean {
  if (!("refused" in did)) return false;
  yardSfx.no();
  toolHooks.said(`${did.why}.`);
  return true;
}

/** An aim at a tile: why it cannot be, what it costs, and for a tunnel its far mouth; of the yard and the purse as they are now. */
export const aimed = (x: number, y: number, why: string | null, cost: number, far = -1): Aim => ({
  x,
  y,
  why,
  cost,
  far,
  yard: S.world,
  rev: S.world.rev,
  coins: coins(),
});

/** What something just built took from the purse, or gave back, rising from its tile. */
export function paid(x: number, y: number, cost: number): void {
  if (cost !== 0) float(x * TILE + 8, y * TILE - 2, cost > 0 ? `-${cost}` : `+${-cost}`, GOLD[cost > 0 ? 0 : 2], 0.9);
}

/** A piece lands: dust, a ring under anything but a belt, and (unless `quiet`) its sound. */
export function landed(x: number, y: number, belt: boolean, n = 0, quiet = false): void {
  const px = x * TILE + 8;
  const py = (y + 1) * TILE - 2;
  puff(px, py, belt ? 3 : 7, DUST, belt ? 4 : 7);
  if (!belt) ring(px, py - 4, CREAM, 9);
  if (quiet) return;
  if (belt) yardSfx.belt(n);
  else yardSfx.place();
}
