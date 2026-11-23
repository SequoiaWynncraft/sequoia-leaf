/**
 * The colours the raid's pictures are typed in: one letter a colour. Every one is a colour the
 * town is drawn in: a tone of the kit's dusk palette (`KIT`), or one its own creatures already
 * have (`TOWNS_OWN`). Also the colours of the bases: a figure's price.
 */
import { BARK, CORAL, CREAM, EARTH, GOLD, GREEN, INK, LEAF, SKY, STONE, WATER } from "@sequoia-leaf/kit/palette.ts";

/** The kit's palette, a letter to a tone. */
const KIT = {
  k: INK,
  w: CREAM,
  y: GOLD[1],
  Y: GOLD[2],
  o: GOLD[0],
  r: CORAL,
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
  A: WATER[0],
  a: WATER[1],
  u: WATER[2],
  U: WATER[3],
} as const;

/** What the town's own creatures are drawn in besides (`apps/town`: `folkart.ts`, `campart.ts`, `sprites.ts`). */
export const TOWNS_OWN = {
  // A crab's shell in shade, and the shade of a gnome's red hat.
  R: "#b0483a",
  // A gnome: its nose, its face, the shade in its beard.
  h: "#f4a08c",
  c: "#e9d8b8",
  C: "#cbb894",
  // The black cat: its stripe, its fur, its chest.
  x: "#2b2530",
  X: "#3a3340",
  H: "#55495c",
  // The white fox: its coat and the shade on it.
  j: "#f3ede0",
  J: "#cfc6d6",
  // A cat's nose, a glorp's cheek, the worm in its pot.
  M: "#e88fb4",
  // The blue glorp: its body, its shade, its shine.
  i: "#6fb0e8",
  I: "#4a7fc0",
  z: "#b6e2f7",
} as const;

/** The letters everything that stands on the board is typed in. */
export const FIGURE_PAL: Readonly<Record<string, string>> = { ...KIT, ...TOWNS_OWN };
/** The same, and white for the table's small pictures (an item's shine, a spark). */
export const PAL: Readonly<Record<string, string>> = { ...FIGURE_PAL, W: "#ffffff" };

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
