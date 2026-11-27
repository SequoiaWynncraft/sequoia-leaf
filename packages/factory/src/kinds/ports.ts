/**
 * The ports most pieces of more than one tile have (`KindDef.ports`), as they face east: a size is
 * tiles across and down, the front the east side, the left the north.
 */
import type { Ports } from "./kind.ts";

type Side = readonly [x: number, y: number, side: number];

/** Every outward tile-side of a box of `w` by `h` tiles, its front's among them, but those `but` leaves out: by side, 0 front, 1 right, 2 back, 3 left. */
function sides(w: number, h: number, but: number): Side[] {
  const out: Side[] = [];
  for (let y = 0; y < h; y++) {
    if (but !== 0) out.push([w - 1, y, 0]);
    out.push([0, y, 2]);
  }
  for (let x = 0; x < w; x++) out.push([x, h - 1, 1], [x, 0, 3]);
  return out;
}

/** Every tile-side round it: what a depot or a store takes things in by. */
export const around = (w: number, h: number): Ports["in"] => sides(w, h, -1);
/** Every tile-side of its back and its two sides, and none of its front: what a maker takes parts in by. */
export const backAndSides = (w: number, h: number): Ports["in"] => sides(w, h, 0);

/** A tile of its front, from its left as it faces: 0 the leftmost. */
export const front = (w: number, fromLeft: number): readonly [number, number] => [w - 1, fromLeft];
