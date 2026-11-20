/**
 * The engine-drawn cast (`../../art/cast/`) for what still draws with it: the Campfire's spirits,
 * its cone reveal, and the spirit cards in the HUD. The glade's world draws the bundle's cast
 * sheets instead (`../../bundle/cast.ts`).
 */

import { type CastMember, type Frame, frameAt } from "../../art/cast/cast.ts";
import type { Surface } from "../../engine/raster.ts";
import { spirit } from "../../game/spirits.ts";

export type { CastMember, Frame };

/** Draws a frame with its ground point at (x, y), facing left when `flip`. */
export function blitFrame(s: Surface, f: Frame, x: number, y: number, flip = false): void {
  const ax = flip ? f.sprite.w - 1 - f.ax : f.ax;
  s.blit(f.sprite, Math.round(x) - ax, Math.round(y) - f.ay, { flip });
}

export type HeraldPose = "march" | "stand" | "toot" | "cheer";

/** A spirit's idle loop, `ms` in. */
export const spiritFrame = (id: string, ms: number): Frame => frameAt(spirit(id).member.idle, ms);
