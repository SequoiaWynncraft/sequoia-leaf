/**
 * The colours the table's pictures are typed in: one letter a colour, all from the kit's dusk
 * palette (and the few extra tones the town already draws with). Also the colours that mean
 * something: a figure's price, and each trait.
 */
import { BARK, CORAL, CREAM, EARTH, GOLD, GREEN, INK, LEAF, SKY, STONE, WATER } from "@sequoia-leaf/kit/palette.ts";

import type { TraitId } from "../../game/content/traits.ts";

export const PAL: Readonly<Record<string, string>> = {
  k: INK,
  w: CREAM,
  W: "#ffffff",
  y: GOLD[1],
  Y: GOLD[2],
  o: GOLD[0],
  r: CORAL,
  R: "#b0483a",
  h: "#f4a08c",
  p: SKY[4],
  v: SKY[3],
  V: SKY[2],
  P: SKY[1],
  q: SKY[0],
  g: GREEN[2],
  G: GREEN[3],
  l: GREEN[4],
  L: LEAF,
  d: GREEN[0],
  D: GREEN[1],
  m: BARK[0],
  b: BARK[1],
  B: BARK[2],
  n: BARK[3],
  N: BARK[4],
  e: EARTH[0],
  E: EARTH[1],
  f: EARTH[2],
  T: STONE[0],
  s: STONE[1],
  S: STONE[2],
  t: STONE[3],
  c: "#e9d8b8",
  C: "#cbb894",
  A: WATER[0],
  a: WATER[1],
  u: WATER[2],
  U: WATER[3],
  x: "#2b2530",
  X: "#3a3340",
};

/** A base's three tones: where the light falls, its face, and its front edge. */
export type Tones = readonly [light: string, face: string, edge: string];

/** What a figure costs, as a colour: stone, green, blue, violet, gold. */
export const TIER_TONES: readonly Tones[] = [
  [STONE[3], STONE[2], STONE[0]],
  [LEAF, GREEN[4], GREEN[2]],
  [WATER[3], WATER[2], WATER[1]],
  ["#d88ad0", SKY[4], SKY[2]],
  [GOLD[2], GOLD[1], "#a3662a"],
];
/** The forest's own pieces stand on dark bark; the summoned on pale bone. */
export const FOREST_TONES: Tones = [BARK[3], BARK[1], BARK[0]];
export const SUMMON_TONES: Tones = ["#ffffff", "#e9d8b8", "#cbb894"];

/** A colour for each trait: its chip, its icon's ground, and what its abilities look like in the air. */
export const TRAIT_COLOUR: Readonly<Record<TraitId, string>> = {
  ember: CORAL,
  moss: GREEN[4],
  mist: WATER[3],
  burrow: EARTH[2],
  feather: "#e9d8b8",
  crab: "#b0483a",
  gnome: SKY[4],
  bulwark: STONE[3],
  fang: "#f4a08c",
  slinger: GOLD[0],
  sage: SKY[3],
  mender: LEAF,
  sneak: SKY[2],
  greg: GREEN[3],
};
