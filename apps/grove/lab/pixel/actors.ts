/**
 * The glade's window onto the guild's cast (`../sprites/cast.ts`): the gnome heralds who trumpet a
 * level-up, the Mossmote who wanders the clearing, and the spirit each rank's cone gives.
 *
 * Cast sprites are drawn in the cast's own palette, so they go into a cast surface and are laid
 * over the glade with the cast's colour table (`castLut`, and `layCast` in scene.ts), never into
 * the glade's surface. Everything the glade needs from the cast passes through here, so a change
 * to the cast touches this file only.
 */

import {
  buildCastLut,
  CAST,
  type CastMember,
  castMember,
  type Frame,
  frameAt,
  GNOME,
  MOSSMOTE,
  occlude,
} from "../sprites/cast.ts";
import type { Lut, RankName, Season, Time } from "./palette.ts";
import type { Surface } from "./raster.ts";

export type { CastMember, Frame };
/** Clears cast pixels under whatever a glade layer draws, for things that stand in front of the cast. */
export { occlude };

/** The cast's colours for a light and season, with `rarity` lighting the RARITY ramp. */
export const castLut = (time: Time, season: Season, rarity: string): Lut => buildCastLut(time, season, rarity);

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

/** The spirit a cone of each rank gives in the demo: the glorps are common, the White Fox legendary. */
const SPIRIT_OF_RANK: Record<RankName, string> = {
  Leafkin: "glorp",
  Sapling: "mossmote",
  Sprite: "chickaree",
  Dryad: "fog-owl",
  Druid: "moth",
  Treant: "greg",
  Yggdrasil: "white-fox",
};

export function spiritOf(rank: RankName): CastMember {
  const m = castMember(SPIRIT_OF_RANK[rank]) ?? CAST[0];
  if (!m) throw new Error("the cast is empty");
  return m;
}

/** A cast member's idle loop, `ms` in. */
export const frameOf = (m: CastMember, ms: number): Frame => frameAt(m.idle, ms);

/** The spirit's number in the guild's book: its place in the cast, from 1. */
export const spiritNumber = (m: CastMember): number => CAST.indexOf(m) + 1;
