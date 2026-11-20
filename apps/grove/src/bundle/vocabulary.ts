/**
 * The welcome's small things, as the client draws them over a bundle picture: its falling leaf,
 * its firefly mote, its sparkle's life, the stepped pool of light its lanterns spill and its
 * snowflake; and the cast's and props' frames in the scene's season and light. Every scene's
 * moments draw with these, in the welcome's palette (`palette.ts`) through an `Ink` for the light.
 */

import { bayer } from "../engine/dither.ts";
import type { CastFrame, CastSheet } from "./cast.ts";
import type { Ambiance, Ink } from "./palette.ts";
import type { Picture } from "./picture.ts";

/** What drawing needs: the picture under way and the palette in its light. */
export interface Paint {
  pic: Picture;
  ink: Ink;
}

/** The cast's and props' sheets, and the season and light to take their strips in. */
export interface Sheets {
  cast: CastSheet | null;
  props: CastSheet | null;
  season: string;
  ambiance: Ambiance;
}

/** A cast member's frame, or null while the bundle has no sheet for it (nothing is drawn then). */
export function castFrame(s: Sheets, ids: readonly string[], anims: readonly string[], ms: number): CastFrame | null {
  const cast = s.cast;
  if (!cast) return null;
  const id = cast.find(...ids);
  if (!id) return null;
  const entry = cast.entries.get(id);
  const anim = anims.find((a) => entry?.anims.has(a)) ?? anims[0] ?? "idle";
  return cast.frame(id, anim, ms, s.season, s.ambiance);
}

/** A prop's frame (the cone, a drop of raid water, a lantern), or null while the bundle has none. */
export function propFrame(s: Sheets, id: string, anim: string, ms: number): CastFrame | null {
  return s.props?.frame(id, anim, ms, s.season, s.ambiance) ?? null;
}

/** The welcome's falling leaf (welcome/scene.py `LEAF_FRAMES`), `light` and `dark` its two colours. */
const LEAF_FRAMES = [
  ["ll.", ".ld"],
  [".l", "ll", "d."],
] as const;

export function leaf(p: Paint, x: number, y: number, tilt: number, light: number, dark: number): void {
  const rows = LEAF_FRAMES[((tilt % 2) + 2) % 2] ?? LEAF_FRAMES[0];
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const ch = row[c];
      if (ch === "l") p.pic.set(x + c, y + r, light);
      else if (ch === "d") p.pic.set(x + c, y + r, dark);
    }
  });
}

export const NEIGHBOURS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;

/**
 * A firefly-ramp mote, as the welcome draws a firefly: dim, lit, or bright with a soft halo
 * blended into what is round it (welcome/fireflies.py `paint`).
 */
export function mote(p: Paint, x: number, y: number, glow: number): void {
  const { pic, ink } = p;
  if (glow <= 0) return;
  if (glow < 0.22) {
    pic.set(x, y, ink.c("firefly_dim"));
    return;
  }
  if (glow > 0.55)
    for (const [dx, dy] of NEIGHBOURS) pic.blend(x + dx, y + dy, ink.c("firefly"), glow > 0.8 ? 0.45 : 0.3);
  pic.set(x, y, ink.c(glow > 0.8 ? "firefly_core" : "firefly"));
}

/** A sparkle's stage through its life (0 to 1): dot, plus, big plus, plus, dot, as the welcome's stars. */
export const sparkleStage = (u: number, big = true): number => {
  const steps = big ? [0, 1, 2, 1, 0] : [0, 1, 0];
  return steps[Math.min(steps.length - 1, Math.max(0, Math.floor(u * steps.length)))] ?? 0;
};

/** A warm pool of light, as the welcome's lanterns spill theirs: stepped rings, dithered between. */
export function pool(p: Paint, cx: number, cy: number, r: number, colour: number, strength: number): void {
  if (strength <= 0 || r <= 0) return;
  for (let y = Math.floor(cy - r); y <= cy + r; y++)
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const d = Math.hypot(x - cx, (y - cy) * 1.4) / r;
      if (d >= 1) continue;
      const k = d < 0.4 ? 1 : d < 0.7 ? 0.55 : 0.25;
      if (d > 0.65 && bayer(x, y) > 0.5) continue;
      p.pic.light(x, y, colour, strength * k);
    }
}

/** The welcome's snowflake: a bright one nearby, a dim speck further off. */
export function snowflake(p: Paint, x: number, y: number, near: boolean): void {
  p.pic.set(x, y, p.ink.c(near ? "snowflake" : "snowflake_dim"));
}
