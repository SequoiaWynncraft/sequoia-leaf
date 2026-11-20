/**
 * The forest's window onto the guild's cast (`../../art/cast/`): the crab colony and No. 08, Cinfy at
 * the stall, the gnome heralds, glorps and the White Fox by the campfire, the Fog Owl at night, and
 * the grove's background folk (the cat and the ducks). Everything the forest draws of a character
 * passes through here, so a change to the cast touches this file only.
 */

import {
  CINFY,
  CRAB,
  CRAB_NUMBERED,
  FOG_OWL,
  type Frame,
  frameAt,
  GLORPS,
  GNOME,
  WHITE_FOX,
} from "../../art/cast/cast.ts";

export { CAT, DUCK, DUCKLING } from "../../art/cast/grove.ts";
export { frameAt };
export type { Frame };

/** A loop's frame `ms` in, or its last frame once a one-shot animation has played. */
export function once(frames: readonly Frame[], ms: number): Frame {
  const total = frames.reduce((sum, f) => sum + f.ms, 0);
  return frameAt(frames, Math.min(Math.max(0, ms), total - 1));
}

/** A colony crab, or No. 08 with the number chalked on its shell. */
export function crabFrames(numbered: boolean): {
  idle: readonly Frame[];
  happy: readonly Frame[];
  rave: readonly Frame[];
} {
  const m = numbered ? CRAB_NUMBERED : CRAB;
  return { idle: m.idle, happy: m.happy, rave: m.poses["rave"] ?? m.idle };
}

/** Cinfy behind the counter: mostly still, a nervous sweat now and then. */
export function cinfyFrame(ms: number, sweating: boolean): Frame {
  return sweating ? frameAt(CINFY.poses["sweat"] ?? CINFY.idle, ms) : frameAt(CINFY.idle, ms);
}

/** A herald on the roots: trumpet raised, or blowing it. */
export function heraldFrame(blowing: boolean, ms: number): Frame {
  const p = GNOME.poses;
  const pick = blowing ? frameAt(p["toot"] ?? GNOME.idle, ms) : p["raise"]?.[0];
  return pick ?? frameAt(GNOME.idle, ms);
}

/** The glorps who sit by the campfire. */
export const FIRESIDE_GLORPS: readonly (readonly Frame[])[] = [GLORPS.glarp.idle, GLORPS.glurp.idle, GLORPS.glirp.idle];

/** The White Fox, asleep by the fire, as the spirit book says. */
export const SLEEPING_FOX: readonly Frame[] = WHITE_FOX.poses["sleep"] ?? WHITE_FOX.idle;

export const OWL: readonly Frame[] = FOG_OWL.idle;
