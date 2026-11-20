/**
 * The cast of Sequoia Grove: every spirit, critter and folk as hand-placed pixels in the engine's own
 * format, with a small registry the glade, the cards and the spirit book can read.
 *
 * Every sprite here is drawn in the cast's palette (`palette-cast.ts`): blit it into a cast surface
 * and lay that over the glade with `composeCast`, never into the glade's own surface.
 */

import type { Sprite } from "../../engine/raster.ts";
import { CHICKAREE, CRAB, CRAB_NUMBERED, EMBERKIT, FOG_OWL, MOSSMOTE, SLUG } from "./critters.ts";
import { CINFY, GNOME } from "./folk.ts";
import { GLORP_IDS, type GlorpId, GLORPS } from "./glorps.ts";
import type { Frame } from "./kit.ts";
import { WHITE_FOX } from "./legend.ts";
import { GREG, MOTH, ROCK, WORM } from "./raid.ts";

export type { Frame } from "./kit.ts";
export { frameAt } from "./kit.ts";
export { C } from "../../engine/palette.ts";
export {
  CHICKAREE,
  CINFY,
  CRAB,
  CRAB_NUMBERED,
  EMBERKIT,
  FOG_OWL,
  GLORPS,
  GNOME,
  GREG,
  MOSSMOTE,
  MOTH,
  ROCK,
  SLUG,
  WHITE_FOX,
  WORM,
};

/** Which family a member belongs to: the gacha lines, plus the grove's folk who are never pulled. */
export type Line = "glorp" | "critter" | "raid" | "legend" | "folk";

export interface CastMember {
  /** Stable id, lower case: `glorp`, `crab`, `white-fox`. */
  readonly id: string;
  /** As shown on cards and in the spirit book. */
  readonly name: string;
  readonly line: Line;
  /** One line for the spirit book. */
  readonly note: string;
  /** Glade size, looping: 2 to 4 drawings with holds. Each frame knows its ground point. */
  readonly idle: readonly Frame[];
  /** The affectionate explosion: a happy pose and its confetti, played once. */
  readonly happy: readonly Frame[];
  /** About 32 by 32, for cards, tooltips and the spirit book. */
  readonly portrait: Sprite;
  /** Anything else it does: `rave`, `sleep`, `march`, `raise`, `toot`, `sweat`, `eat`. */
  readonly poses: Readonly<Record<string, readonly Frame[]>>;
}

const GLORP_NOTES: Record<GlorpId, string> = {
  glarp: "Tucked a blossom behind one ear and forgot it was there.",
  glerp: "Tongue out. Has been for some time.",
  glirp: "Growing something. Will not say what.",
  glorp: "The original. Has seen something and cannot unsee it.",
  glurp: "Blows a bubble, watches it go, blows another.",
  glyrp: "Content. Suspiciously content.",
  gleep: "Ready for bed at all hours.",
};

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export const CAST: readonly CastMember[] = [
  ...GLORP_IDS.map((id): CastMember => ({
    id,
    name: capital(id),
    line: "glorp",
    note: GLORP_NOTES[id],
    idle: GLORPS[id].idle,
    happy: GLORPS[id].happy,
    portrait: GLORPS[id].portrait,
    poses: {},
  })),
  {
    id: "chickaree",
    name: "Chickaree",
    line: "critter",
    note: "Plants seedlings round your tree. Keeps one cone back.",
    ...CHICKAREE,
  },
  { id: "crab", name: "Crab", line: "critter", note: "Keeps the shop. Rule 2: no crabellions.", ...CRAB },
  { id: "crab-08", name: "Crab No. 08", line: "critter", note: "Whereabouts unknown.", ...CRAB_NUMBERED },
  {
    id: "mossmote",
    name: "Mossmote",
    line: "critter",
    note: "A puff of moss that hops. Leaves a little green where it lands.",
    ...MOSSMOTE,
  },
  { id: "slug", name: "Banana Slug", line: "critter", note: "Spreads moss. Wears the leaf with confidence.", ...SLUG },
  {
    id: "fog-owl",
    name: "Fog Owl",
    line: "critter",
    note: "Brings the morning mist. Refills a care charge.",
    ...FOG_OWL,
  },
  { id: "emberkit", name: "Emberkit", line: "critter", note: "Keeps the campfire lit and warm.", ...EMBERKIT },
  { id: "rock", name: "Rock", line: "raid", note: "The Canyon Colossus, in spirit. Stoic. Mossy.", ...ROCK },
  {
    id: "worm",
    name: "Worm",
    line: "raid",
    note: "Nest of the Grootslangs, in spirit. Delighted to see you.",
    ...WORM,
  },
  { id: "greg", name: "Greg", line: "raid", note: "The Nameless Anomaly, in spirit. He eats offerings.", ...GREG },
  { id: "moth", name: "Moth", line: "raid", note: "The Wartorn Palace, in spirit. Fuzzy.", ...MOTH },
  {
    id: "white-fox",
    name: "The White Fox",
    line: "legend",
    note: "Nexus of Light. Sleeps by the campfire.",
    ...WHITE_FOX,
  },
  { id: "gnome", name: "Gnome Herald", line: "folk", note: "Announces level-ups and rare finds, at volume.", ...GNOME },
  { id: "cinfy", name: "Cinfy", line: "folk", note: "Treasurer. Runs the shop. Knows what you borrowed.", ...CINFY },
];

export function castMember(id: string): CastMember | undefined {
  return CAST.find((m) => m.id === id);
}
