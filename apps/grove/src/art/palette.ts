/**
 * The Grove's palette: warm, muted and a little faded, like a cartridge game on
 * an old handheld. Each colour has a one-letter key so sprites can be drawn by
 * hand as rows of letters. `.` is transparent.
 */
export const PALETTE = {
  // Outlines: a deep plum-brown instead of black, so nothing looks harsh.
  o: "#2b1d26",
  O: "#4a3140",
  // Sequoia bark: red-brown, fibrous.
  b: "#5a2d23",
  B: "#7e412e",
  r: "#a35838",
  R: "#c97b4f",
  // Needles: blue-green and muted, never neon.
  g: "#1f3a2e",
  G: "#2f5440",
  f: "#456f4d",
  F: "#64905b",
  h: "#8fb36f",
  H: "#c4d896",
  // Glazed pot: dusky blue ceramic.
  p: "#2f4359",
  P: "#476481",
  q: "#6f92ad",
  Q: "#adcbd6",
  // Soil and moss.
  m: "#4a352a",
  M: "#5f7d3f",
  n: "#86a356",
  // Cream menus and paper.
  c: "#f6ecd4",
  C: "#e6d2a8",
  k: "#bf9f72",
  K: "#8b6a4a",
  // Warm accents: lanterns, autumn, gold for the rarest things.
  y: "#f3d06a",
  Y: "#e3a33c",
  a: "#c8663a",
  A: "#e58e55",
  // Blossom pink, dusk purple, sky blue.
  s: "#e9a6ab",
  S: "#f6cfcf",
  v: "#7d5e9c",
  V: "#a98bc7",
  w: "#9fcfe0",
  W: "#e3f2f2",
  // Plain light and dark for eyes and glints.
  x: "#fffaf0",
  z: "#140d12",
} as const;

export type ColorKey = keyof typeof PALETTE;

/** The guild's ranks, lowest to highest, as the rarity of everything you can collect. */
export const RARITIES = [
  { id: "leafkin", name: "Leafkin", color: "#b9ad9a" },
  { id: "sapling", name: "Sapling", color: "#7fb069" },
  { id: "sprite", name: "Sprite", color: "#5f8fc7" },
  { id: "dryad", name: "Dryad", color: "#7cc6d6" },
  { id: "druid", name: "Druid", color: "#c6d26a" },
  { id: "treant", name: "Treant", color: "#a98bc7" },
  { id: "yggdrasil", name: "Yggdrasil", color: "#f3d06a" },
] as const;

export type RarityId = (typeof RARITIES)[number]["id"];
