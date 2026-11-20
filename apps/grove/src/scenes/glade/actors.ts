/**
 * The glade's window onto the guild's cast (`../../art/cast/`): the gnome heralds who trumpet a
 * level-up, the Mossmote who wanders the clearing, and the spirits cones give. Cast sprites draw in
 * the palette's character ramps, straight into the glade's surface in their place in the drawing
 * order. Everything the glade needs from the cast passes through here, so a change to the cast
 * touches this file only.
 */

import { type CastMember, type Frame, frameAt, GNOME, MOSSMOTE } from "../../art/cast/cast.ts";
import type { Surface } from "../../engine/raster.ts";
import { spirit } from "../../game/spirits.ts";

export type { CastMember, Frame };

/** Draws a frame with its ground point at (x, y), facing left when `flip`. */
export function blitFrame(s: Surface, f: Frame, x: number, y: number, flip = false): void {
  const ax = flip ? f.sprite.w - 1 - f.ax : f.ax;
  s.blit(f.sprite, Math.round(x) - ax, Math.round(y) - f.ay, { flip });
}

export type HeraldPose = "march" | "stand" | "toot" | "cheer";

/** The gnome herald, facing right, in `pose`, `ms` into it. */
export function heraldFrame(pose: HeraldPose, ms: number): Frame {
  const p = GNOME.poses;
  const raise = p["raise"]?.[0];
  const pick =
    pose === "march"
      ? frameAt(p["march"] ?? GNOME.idle, ms)
      : pose === "toot"
        ? p["toot"]?.[1]
        : pose === "cheer"
          ? frameAt(GNOME.happy, ms)
          : raise;
  return pick ?? frameAt(GNOME.idle, ms);
}

/**
 * The Mossmote, `ms` in: on the move it hops (the hop part of its loop), at rest it sits and
 * now and then hops on the spot.
 */
export function wandererFrame(ms: number, moving: boolean): Frame {
  if (!moving) return frameAt(MOSSMOTE.idle, ms);
  const sit = MOSSMOTE.idle[0]?.ms ?? 0;
  const loop = MOSSMOTE.idle.reduce((sum, f) => sum + f.ms, 0);
  return frameAt(MOSSMOTE.idle, sit + (ms % Math.max(1, loop - sit)));
}

/** A spirit's idle loop, `ms` in. */
export const spiritFrame = (id: string, ms: number): Frame => frameAt(spirit(id).member.idle, ms);
