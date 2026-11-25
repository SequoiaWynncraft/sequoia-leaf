/**
 * The marks over the pieces in hand, drawn into their picture once for each place they are aimed
 * (`inHand`, in `scene.ts`): gold over each piece that can go and coral over each that cannot, with a
 * line where the pieces end; and for a plan of the whole yard, coral corners over each piece it would
 * take up, as the spade marks what it takes, so that what goes is seen before Place is pressed. The
 * plan zoomed out marks them too (`far.ts`).
 */
import { boxOf, tilesOf, type Yard } from "@sequoia-leaf/factory";
import { CORAL, GOLD } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import type { Ctx } from "@sequoia-leaf/kit/util.ts";

import { TILE } from "./art/belts.ts";
import { isWhole } from "./plans.ts";
import type { Group } from "./state.ts";

/** A box of tiles: its corner, and how many across and down. */
interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The tiles a plan of the whole yard in hand would take up; none for anything else in hand. */
export const takenUp = (grp: Group): readonly number[] => (isWhole(grp.as) ? grp.tiles : []);

/** The box the pieces in hand are drawn in: theirs, and for a plan of the whole yard, the pieces it would take up too. */
export function heldBox(w: Yard, grp: Group): Box {
  const box = boxOf(grp.at);
  const up = takenUp(grp);
  if (up.length === 0) return box;
  const W = w.land.w;
  let [x0, y0, x1, y1] = grp.at.length > 0 ? [box.x, box.y, box.x + box.w - 1, box.y + box.h - 1] : [W, w.land.h, 0, 0];
  for (const i of up) {
    x0 = Math.min(x0, i % W);
    x1 = Math.max(x1, i % W);
    y0 = Math.min(y0, Math.floor(i / W));
    y1 = Math.max(y1, Math.floor(i / W));
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Coral corners round a tile in the picture, as the spade's aim has them. */
function corners(h: Ctx, x: number, y: number): void {
  for (const [px, py, dx, dy] of [
    [x - 1, y - 1, 1, 1],
    [x + TILE, y - 1, -1, 1],
    [x - 1, y + TILE, 1, -1],
    [x + TILE, y + TILE, -1, -1],
  ] as const) {
    R(h, dx > 0 ? px : px - 3, py, 4, 1, CORAL);
    R(h, px, dy > 0 ? py : py - 3, 1, 4, CORAL);
  }
}

/** Draws the marks over the pieces in hand into their picture (`h`), whose corner tile is at (`ox`, `oy`) in it. */
export function heldMarks(h: Ctx, w: Yard, grp: Group, ox: number, oy: number): void {
  const W = w.land.w;
  const own = new Set(tilesOf(w, grp.at));
  grp.at.forEach((p, k) => {
    const ok = grp.why[k] === null;
    for (const i of tilesOf(w, [p])) {
      if (i < 0) continue;
      const x = (i % W) * TILE + ox;
      const y = Math.floor(i / W) * TILE + oy;
      h.fillStyle = ok ? "rgba(255,196,84,0.34)" : "rgba(238,92,74,0.62)";
      h.fillRect(x, y, TILE, TILE);
      h.fillStyle = ok ? GOLD[2] : CORAL;
      if (!own.has(i - W)) h.fillRect(x, y, TILE, 1);
      if (!own.has(i + W)) h.fillRect(x, y + TILE - 1, TILE, 1);
      if (i % W === 0 || !own.has(i - 1)) h.fillRect(x, y, 1, TILE);
      if (i % W === W - 1 || !own.has(i + 1)) h.fillRect(x + TILE - 1, y, 1, TILE);
    }
  });
  for (const i of takenUp(grp)) corners(h, (i % W) * TILE + ox, Math.floor(i / W) * TILE + oy);
}
