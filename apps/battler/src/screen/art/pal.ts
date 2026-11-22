/**
 * The colours the table's pictures are typed in: one letter a colour. The letters are the kit's
 * dusk palette (and the few extra tones the town already draws with); the digits, the signs and a
 * few more letters are brighter tones for the figures a member can own. Also the colours that
 * mean something: a figure's price, and each trait.
 */
import { BARK, CORAL, CREAM, EARTH, GOLD, GREEN, INK, LEAF, SKY, STONE, WATER } from "@sequoia-leaf/kit/palette.ts";
import type { TraitId } from "@sequoia-leaf/raid/content/traits.ts";

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
  // Brighter tones, for the figures a member can own. Each kin has a ramp of its own: shadow,
  // body, light.
  // Ember, and its fire from deep to pale.
  "1": "#b8321f",
  "2": "#f4623a",
  "3": "#ff9b6e",
  "4": "#e85d0c",
  "5": "#ff9a1f",
  "6": "#ffd23f",
  "7": "#fff29a",
  // Pinks: rose, pale, salmon.
  "8": "#e0708c",
  "9": "#ffb3c4",
  "0": "#ff8f86",
  // Moss, down to its lime glint.
  M: "#1e6a43",
  F: "#3da647",
  J: "#86d94f",
  Z: "#d2f58c",
  // Mist, up to ice white.
  I: "#3f6fb5",
  i: "#67b8e6",
  j: "#a9e3f5",
  z: "#e6faff",
  // Crab.
  H: "#8c1832",
  K: "#d8304a",
  Q: "#f76a72",
  // Gnome (their hats), and skin.
  $: "#8f2a6b",
  "&": "#d9479a",
  "*": "#f78fc3",
  "+": "#ffd0a8",
  // Burrow: bright earth, and warm stone.
  O: "#b86f38",
  "%": "#b4906a",
  // Feather: a jay's blue, and fog greys.
  "@": "#2a44b0",
  "=": "#4a8cf0",
  "#": "#585a7c",
  "/": "#8f93b0",
  ":": "#c3c8dc",
  // Soot, a tone over `X`.
  ";": "#5c4a66",
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
