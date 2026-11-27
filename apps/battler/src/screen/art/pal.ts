/** The colours that mean something on the table: each trait. The letters' colours are `@sequoia-leaf/figures`'. */
import { BARK, CORAL, EARTH, GOLD, GREEN, LEAF, PAPER, SKY, STONE, WATER } from "@sequoia-leaf/kit/palette.ts";
import type { TraitId } from "@sequoia-leaf/raid/content/traits.ts";

/** A colour for each trait: its chip, its icon's ground, and what its abilities look like in the air. */
export const TRAIT_COLOUR: Readonly<Record<TraitId, string>> = {
  ember: CORAL,
  moss: GREEN[4],
  mist: WATER[3],
  burrow: EARTH[2],
  feather: "#e9d8b8",
  crab: "#b0483a",
  gnome: SKY[4],
  // The gold that ties the four raids' colours (its icon); each true form's ring is its raid's own.
  graid: GOLD[2],
  // Eggshell: what every Grooter creature wears a piece of.
  grooter: PAPER[2],
  // The pond in winter: the penguins' backs.
  huddle: WATER[2],
  // Russet: a red panda's, up the tree.
  canopy: BARK[3],
  bulwark: STONE[3],
  fang: "#f4a08c",
  slinger: GOLD[0],
  sage: SKY[3],
  mender: LEAF,
  sneak: SKY[2],
  chorus: "#e88fb4",
  greg: GREEN[3],
  rooted: GREEN[2],
  stowaway: BARK[4],
  // The stone of a tool's head.
  crafter: STONE[2],
};
