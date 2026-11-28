/**
 * The redwoods on the screen: felling one from its card, which rises a little and fades where it
 * stood over a short moment, with a puff of dust along its foot; and how much of each shows, its
 * trunk and the shade at its foot, as the yard has it (`redwoodAt`).
 */
import { at, redwoodAt, standingTree } from "@sequoia-leaf/factory";
import type { Pen } from "@sequoia-leaf/kit/pix.ts";

import { TILE } from "./art/belts.ts";
import { type Art, SHADE } from "./art/index.ts";
import type { Sprite } from "./art/pal.ts";
import { DUST, puff } from "./fx.ts";
import { yardSfx } from "./sound.ts";
import { S, toolHooks } from "./state.ts";
import { doNow } from "./yard.ts";

/** How long a redwood felled takes to go, in seconds, and how many pixels it rises as it does. */
export const FELLING = { seconds: 0.4, rise: 6 } as const;

/** Fells the redwood on a tile at the price its card showed. Says the rules' reason when it is not done, with its sound. Gives back whether it was. */
export function fellAt(x: number, y: number, price: number): boolean {
  const tree = standingTree(S.world, at(S.world, x, y));
  const did = doNow({ do: "fell", x, y, price });
  if ("refused" in did) {
    yardSfx.no();
    toolHooks.said(`${did.why}.`);
    return false;
  }
  // The moments of those felled before are over or ending: only the newest is kept going.
  for (const t of S.felling.keys()) if (treeShows(t) <= 0) S.felling.delete(t);
  S.felling.set(tree, S.t);
  const { w } = S.world.land;
  const first = S.world.land.trees[tree]?.[0] ?? 0;
  const foot = (Math.floor(first / w) + 2) * TILE - 2;
  for (let k = 0; k < 4; k++) puff((first % w) * TILE + 5 + k * 7, foot, 4, DUST, 7);
  yardSfx.fell();
  return true;
}

/** How much of a redwood shows now: all of it while it stands, less and less in the moment it is felled, then none. */
export function treeShows(tree: number): number {
  const w = S.world;
  if (redwoodAt(w, w.land.trees[tree]?.[0] ?? -1)) return 1;
  const began = S.felling.get(tree);
  return began === undefined ? 0 : Math.max(0, 1 - (S.t - began) / FELLING.seconds);
}

/** Stands each redwood that shows in a picture of `wide` by `high` at (`cx`, `cy`) of the yard: one being felled higher, and fainter. */
export function eachTrunk(
  art: Art,
  cx: number,
  cy: number,
  wide: number,
  high: number,
  stand: (s: Sprite, x: number, y: number, z: number, a: number) => void,
): void {
  for (const tr of art.trunks) {
    const shows = treeShows(tr.tree);
    const x = tr.x - cx;
    const y = tr.y - cy - Math.round((1 - shows) * FELLING.rise);
    if (shows > 0 && x >= -40 && x <= wide + 40 && y >= -4 && y <= high + 80) stand(tr.s, x, y, tr.y, shows);
  }
}

/** Lays the shade at the foot of each redwood that shows, on the floor of a picture of `wide` by `high` at (`cx`, `cy`). */
export function drawShades(g: Pen, art: Art, cx: number, cy: number, wide: number, high: number): void {
  for (const tr of art.trunks) {
    const shows = treeShows(tr.tree);
    const x = tr.x + SHADE.x - cx;
    const y = tr.y + SHADE.y - cy;
    if (shows <= 0 || x < -art.shade.width || x > wide || y < -art.shade.height || y > high) continue;
    g.pic(art.shade, x, y, shows);
  }
}
