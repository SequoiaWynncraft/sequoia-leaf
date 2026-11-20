/**
 * Hand-placed pixel art: the companions, the cone and its opening, the lantern. One character per
 * pixel; the legends map characters to palette indices. `?sheet` draws them all large for review.
 */

import { ix, R } from "./palette.ts";
import { fromRows, type Sprite } from "./raster.ts";

// ---------------------------------------------------------------------------------------------
// The Chickaree: a Douglas squirrel sitting up, hugging a sequoia cone. Dark olive-brown back, a
// rusty belly, a pale eye ring and the tail's pale fringe, as the real ones have.

const SQ = {
  K: ix(R.INK, 3),
  D: ix(R.FUR, 1),
  M: ix(R.FUR, 2),
  L: ix(R.FUR, 3),
  l: ix(R.FUR, 4),
  O: ix(R.FUR, 5),
  o: ix(R.FUR, 6),
  c: ix(R.FUR, 7),
  E: ix(R.INK, 0),
  W: ix(R.CREAM, 7),
  T: ix(R.CREAM, 2),
  t: ix(R.CREAM, 1),
  n: ix(R.CONE, 2),
  N: ix(R.CONE, 4),
  h: ix(R.CONE, 6),
  p: ix(R.FUR, 6),
  r: ix(R.ROSE, 4),
};

const SQUIRREL_IDLE = [
  "...........K..K...",
  "...KKK....KDKKDK..",
  "..KtTTK..KDMMMMDK.",
  ".KtDDMTKKMLLLLLMK.",
  ".KTDMMDTKMLLcEWLoK",
  ".KTDMDDTKMLLLccooE",
  ".KTDMDDKKLLrccccK.",
  "..KTDMDKMLLOoooK..",
  "..KTDMKMLLKnhnpK..",
  "...KTDKMLOKhNhNK..",
  "...KTDKMLOpnhnhK..",
  "...KTDKMLOKNhNKo..",
  "..KTDMKMLOoKKKoK..",
  "..KTDDKMLLOoooK...",
  "...KKKKDMMLLLKK...",
  "......KKDKKKDK....",
];

/** Rows built from another frame's tail (columns 0 to 7) and head (8 on), the head moved down. */
function withHead(rows: readonly string[], headFrom: readonly string[], drop: number, upTo: number): string[] {
  return rows.map((row, y) => {
    if (y > upTo) return row;
    const src = headFrom[y - drop] ?? "..................";
    return row.slice(0, 8) + (y - drop < 0 ? ".........." : src.slice(8));
  });
}

/** Nibbling: the head dips onto the cone, the muzzle at its tip. */
const SQUIRREL_NIBBLE = withHead(SQUIRREL_IDLE, SQUIRREL_IDLE, 1, 7).map((row, y) =>
  y === 8 ? "..KTDMKMLLKncopK.." : row,
);

/** The tail flicked: its top curls further over the back. */
const FLICK_TAIL = ["....KKK.", "...KtTTK", "..KtTDMK", ".KtDDMTK"];
const SQUIRREL_FLICK = SQUIRREL_IDLE.map((row, y) =>
  y < FLICK_TAIL.length ? (FLICK_TAIL[y] ?? "") + row.slice(8) : row,
);

const blink = (rows: readonly string[]): string[] => rows.map((r) => r.replace("cEW", "cKK"));

export const SQUIRREL = {
  idle: fromRows(SQUIRREL_IDLE, SQ),
  blink: fromRows(blink(SQUIRREL_IDLE), SQ),
  nibble: fromRows(SQUIRREL_NIBBLE, SQ),
  flick: fromRows(SQUIRREL_FLICK, SQ),
};

/** The Chickaree as a spirit, just out of the cone: eyes happy-shut, paws clasped, no cone. */
const SPIRIT_CHEER = [
  "...........K..K...",
  "...KKK....KDKKDK..",
  "..KtTTK..KDMMMMDK.",
  ".KtDDMTKKMLLLKLMK.",
  ".KTDMMDTKMLLKLKLoK",
  ".KTDMDDTKMLLLccooE",
  ".KTDMDDKKLLrccccK.",
  "..KTDMDKMLLOoooK..",
  "..KTDMKMLLOoppoK..",
  "...KTDKMLOoooooK..",
  "...KTDKMLOoooooK..",
  "...KTDKMLOoooooK..",
  "..KTDMKMLOooooK...",
  "..KTDDKMLLOoooK...",
  "...KKKKDMMLLLKK...",
  "......KKDKKKDK....",
];

export const SPIRIT = fromRows(SPIRIT_CHEER, SQ);

// ---------------------------------------------------------------------------------------------
// The crab: the guild's bounty crab, who keeps the shop. Red-orange shell lit along its top, eyes
// up on stalks, big claws, a little blush.

const CR = {
  K: ix(R.CRAB, 0),
  d: ix(R.CRAB, 1),
  D: ix(R.CRAB, 2),
  M: ix(R.CRAB, 3),
  L: ix(R.CRAB, 4),
  l: ix(R.CRAB, 5),
  h: ix(R.CRAB, 6),
  H: ix(R.CRAB, 7),
  E: ix(R.INK, 0),
  W: ix(R.CREAM, 7),
  r: ix(R.ROSE, 4),
};

const CRAB_IDLE = [
  ".................",
  ".....K.....K.....",
  "....KWK...KWK....",
  "....KEK...KEK....",
  ".KK..K.....K..KK.",
  "KhlK.KKKKKKK.KlhK",
  "KlLKKhHhhhhhLKKLlK",
  ".KMKhHlllllllLKMK.",
  "..KLlllLLLLLLLMK..",
  "..KMLrLKLLLKLrMK..",
  "...KMMLLKKKLMMDK..",
  "..K.KDMMMMMMMDK.K.",
  ".K.K.KKKKKKKKK.K.K",
];

const CRAB_SNAP_L = [
  ".................",
  "KK...K.....K.....",
  "KhK.KWK...KWK....",
  ".KlKKEK...KEK....",
  ".KlK.K.....K..KK.",
  "KhlK.KKKKKKK.KlhK",
  "KlLKKhHhhhhhLKKLlK",
  ".KMKhHlllllllLKMK.",
  "..KLlllLLLLLLLMK..",
  "..KMLrLKLLLKLrMK..",
  "...KMMLLKKKLMMDK..",
  "..K.KDMMMMMMMDK.K.",
  ".K.K.KKKKKKKKK.K.K",
];

const CRAB_WAVE = [
  "KK...............KK",
  "KhK..K.....K....KhK",
  ".KlKKWK...KWK..KlK.",
  ".KlKKEK...KEK..KlK.",
  "..KLKK.....K..KLK..",
  "..KMKKKKKKKKK.KMK..",
  "...KKhHhhhhhLKK....",
  "...KhHlllllllLK....",
  "..KLlllLLLLLLLMK...",
  "..KMLrLKKKKKLrMK...",
  "...KMMLKdddKMMDK...",
  "..K.KDMMMMMMMDK.K..",
  ".K.K.KKKKKKKKK.K.K.",
];

const crabBlink = (rows: readonly string[]): string[] => rows.map((r) => r.replace(/KEK/g, "KKK"));

export const CRAB = {
  idle: fromRows(CRAB_IDLE, CR),
  blink: fromRows(crabBlink(CRAB_IDLE), CR),
  snap: fromRows(CRAB_SNAP_L, CR),
  wave: fromRows(CRAB_WAVE, CR),
};

// ---------------------------------------------------------------------------------------------
// The giant sequoia cone: small, egg-shaped, rhombic scales in two browns, lit from the fire.

const CO = {
  K: ix(R.CONE, 0),
  d: ix(R.CONE, 1),
  n: ix(R.CONE, 3),
  N: ix(R.CONE, 4),
  h: ix(R.CONE, 6),
  H: ix(R.CONE, 7),
  s: ix(R.WOOD, 3),
  // Rarity light leaking between the scales.
  x: ix(R.RARITY, 5),
  X: ix(R.RARITY, 7),
  y: ix(R.RARITY, 3),
};

export const CONE = {
  shut: fromRows(
    ["..KKK..", ".KhNnK.", "KhNdhNK", "KNdhNdK", "KdhNdhK", "KhNdhNK", "KNdhNdK", ".KdNdK.", "..KsK.."],
    CO,
  ),
  cracked: fromRows(
    ["..KKK..", ".KhxnK.", "KhNxhNK", "KxdhxdK", "KdhxdhK", "KhxdhxK", "KNdxNdK", ".KdxdK.", "..KsK.."],
    CO,
  ),
  parting: fromRows(
    [
      "...K.K...",
      "..KhxnK..",
      ".KhNXhNK.",
      "KNdxXxNdK",
      "KdhxXxdhK",
      "KhNxXxhNK",
      ".KNxXxNK.",
      "..KdxdK..",
      "...KsK...",
    ],
    CO,
  ),
  open: fromRows(
    [
      "K..K.K..K",
      "hK.xXx.Kh",
      ".hNxXxNh.",
      "KNyXXXyNK",
      "dhxXXXxhd",
      "KhyXXXyhK",
      ".KNxXxNK.",
      "..KdxdK..",
      "...KsK...",
    ],
    CO,
  ),
  /** Spent: open and charred, kept by the fire after a reveal. */
  spent: fromRows(
    [
      "K..K.K..K",
      "dK.KdK.Kd",
      ".dNKdKNd.",
      "KNdKKKdNK",
      "ddKdKdKdd",
      "KdNKdKNdK",
      ".KNdKdNK.",
      "..KdKdK..",
      "...KsK...",
    ],
    CO,
  ),
};

// ---------------------------------------------------------------------------------------------
// The lantern: an iron frame round warm glass, hung on a hook.

const LA = {
  K: ix(R.METAL, 1),
  m: ix(R.METAL, 3),
  M: ix(R.METAL, 4),
  g: ix(R.GLOW, 3),
  G: ix(R.GLOW, 5),
  C: ix(R.GLOW, 7),
};

export const LANTERN = fromRows(
  [
    "...K...",
    "..KmK..",
    ".KMMMK.",
    "KMMMMMK",
    ".KgGgK.",
    ".KGCGK.",
    ".KGCGK.",
    ".KGCGK.",
    ".KgGgK.",
    "KMMMMMK",
    ".KKKKK.",
  ],
  LA,
);
export const LANTERN_DIM = fromRows(
  ["..K..", ".KmK.", "KMMMK", ".KMK.", "KgggK", "KgGgK", "KgGgK", "KgggK", "KMMMK", ".KKK."],
  LA,
);

/** Everything hand-drawn, for the review sheet. */
export const SHEET: [string, Sprite][] = [
  ["squirrel", SQUIRREL.idle],
  ["blink", SQUIRREL.blink],
  ["nibble", SQUIRREL.nibble],
  ["flick", SQUIRREL.flick],
  ["spirit", SPIRIT],
  ["crab", CRAB.idle],
  ["crab blink", CRAB.blink],
  ["crab snap", CRAB.snap],
  ["crab wave", CRAB.wave],
  ["cone", CONE.shut],
  ["cracked", CONE.cracked],
  ["parting", CONE.parting],
  ["open", CONE.open],
  ["spent", CONE.spent],
  ["lantern", LANTERN],
];
