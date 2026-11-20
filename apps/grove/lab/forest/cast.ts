/**
 * The forest's cast, at the forest's scale: the crab colony, Cinfy the treasurer, gnome heralds,
 * glorps by the campfire, a duck family on the Swamp, the grove cat and an owl.
 *
 * These are placeholders drawn for the forest. Another artist is drawing the cast in
 * `../sprites/`; when `../sprites/cast.ts` lands, this module is the adapter: re-export their
 * frames under these names (scaled to the forest if need be) and every motion in `life.ts` and
 * `events.ts` keeps working, since nothing else in the forest names a character's pixels.
 */

import { ix, R } from "../pixel/palette.ts";
import { fromRows, type Sprite } from "../pixel/raster.ts";

// ---------------------------------------------------------------------------------------------
// A colony crab: small enough for a dozen to share a pond's shore.

const CR = {
  K: ix(R.CRAB, 1),
  d: ix(R.CRAB, 2),
  M: ix(R.CRAB, 3),
  L: ix(R.CRAB, 4),
  l: ix(R.CRAB, 5),
  h: ix(R.CRAB, 6),
  e: ix(R.INK, 0),
  w: ix(R.CREAM, 7),
};

const CRAB_ROWS = {
  idle: [".........", "h.......h", "Lh.e.e.hL", ".KlhhhlK.", "KLLlllLLK", ".KdLLLdK.", "K.K...K.K"],
  step: [".........", "h.......h", "Lh.e.e.hL", ".KlhhhlK.", "KLLlllLLK", ".KdLLLdK.", ".K.K.K.K."],
  up: ["h.......h", "L.......L", ".L.e.e.L.", ".KlhhhlK.", "KLLlllLLK", ".KdLLLdK.", ".K.K.K.K."],
  blink: [".........", "h.......h", "Lh.L.L.hL", ".KlhhhlK.", "KLLlllLLK", ".KdLLLdK.", "K.K...K.K"],
};
export const CRAB = {
  idle: fromRows(CRAB_ROWS.idle, CR),
  step: fromRows(CRAB_ROWS.step, CR),
  up: fromRows(CRAB_ROWS.up, CR),
  blink: fromRows(CRAB_ROWS.blink, CR),
};

// ---------------------------------------------------------------------------------------------
// Cinfy: the guild's treasurer, a hamster in round spectacles and a bow tie, clutching the ledger.
// Seen from the chest up over the counter.

const CI = {
  K: ix(R.FUR, 1),
  O: ix(R.FUR, 5),
  o: ix(R.FUR, 6),
  c: ix(R.FUR, 7),
  C: ix(R.CREAM, 6),
  g: ix(R.METAL, 7),
  E: ix(R.INK, 0),
  n: ix(R.ROSE, 3),
  r: ix(R.ROSE, 5),
  b: ix(R.CRAB, 3),
  W: ix(R.CREAM, 7),
  w: ix(R.CREAM, 4),
  B: ix(R.WOOD, 3),
  s: ix(R.WATER, 6),
};

const CINFY_ROWS = [
  "..KK.....KK..",
  ".KoOK...KOoK.",
  ".KOOOKKKOOOK.",
  "KOOOOOOOOOOOK",
  "KOgggOOOgggOK",
  "KOgEgOcOgEgOK",
  "KOgggcncgggOK",
  "KcCCcccccCCcK",
  "KCrCccKccCrCK",
  ".KCCcccccCCK.",
  "..KKbbKbbKK..",
  ".KoKKbbbKKoK.",
  "KoBWWWWWWWBoK",
  "KoBWwwwwwwBoK",
  "KOBWWWWWWWBOK",
];

/** Eyes darting: the pupils move to the left or right of their lenses. */
const darted = (dir: number): string[] =>
  CINFY_ROWS.map((row, y) => (y === 5 ? (dir < 0 ? "KOEggOcOEggOK" : "KOggEOcOggEOK") : row));

export const CINFY = {
  idle: fromRows(CINFY_ROWS, CI),
  left: fromRows(darted(-1), CI),
  right: fromRows(darted(1), CI),
  /** Nervous: a bead of sweat at the temple. */
  sweat: fromRows(
    CINFY_ROWS.map((row, y) => (y === 3 ? "KOOOOOOOOOOsK" : y === 4 ? "KOgggOOOgggsK" : row)),
    CI,
  ),
};

// ---------------------------------------------------------------------------------------------
// A gnome herald with a long trumpet hung with the guild's pennant (gold, an orange sun).

const GN = {
  K: ix(R.INK, 3),
  H: ix(R.CRAB, 3),
  h: ix(R.CRAB, 5),
  f: ix(R.FUR, 7),
  e: ix(R.INK, 0),
  W: ix(R.CREAM, 7),
  w: ix(R.CREAM, 5),
  T: ix(R.MOSS, 5),
  t: ix(R.MOSS, 3),
  g: ix(R.SHROOM, 4),
  G: ix(R.SHROOM, 6),
  o: ix(R.CRAB, 5),
  b: ix(R.WOOD, 2),
};

const GNOME_ROWS = [
  "...K..........",
  "..KhK.........",
  "..KHK.........",
  ".KhHHK.....GG.",
  ".KHHHK....GgG.",
  "KHHHHHK..Gg...",
  "KWffffK.Gg....",
  "KWfefeK.g.....",
  ".WWfffWgg.....",
  ".WWWWWg.......",
  ".KTWWgT.......",
  "KTTTgTTK......",
  "KTtgoTtK......",
  ".KKgggK.......",
  ".bb..bb.......",
];
/** The bell bounces as he blows. */
const GNOME_BLOW = GNOME_ROWS.map((row, y) =>
  y === 3 ? ".KhHHK....GGG." : y === 4 ? ".KHHHK...GgGG." : y === 5 ? "KHHHHHK..Gg..." : row,
);

export const GNOME = {
  rest: fromRows(GNOME_ROWS, GN),
  blow: fromRows(GNOME_BLOW, GN),
};

// ---------------------------------------------------------------------------------------------
// Glorps: the guild's own blob family, one per vowel colour. Here, three of them by the fire.

const glorp = (ramp: number): Sprite =>
  fromRows(["..KKK..", ".KhLLK.", "KhLLLLK", "KLeLeLK", "KLLLLdK", ".KKKKK."], {
    K: ix(ramp, 1),
    h: ix(ramp, 6),
    L: ix(ramp, 4),
    d: ix(ramp, 3),
    e: ix(R.INK, 0),
  });

export const GLORPS: readonly Sprite[] = [glorp(R.ROSE), glorp(R.WATER), glorp(R.SHROOM)];

// ---------------------------------------------------------------------------------------------
// A duck and her ducklings, paddling on the Swamp, after the welcome scenes' duck parade.

const DU = {
  K: ix(R.INK, 3),
  W: ix(R.CREAM, 7),
  w: ix(R.CREAM, 4),
  o: ix(R.CRAB, 5),
  e: ix(R.INK, 0),
  y: ix(R.FUR, 7),
  Y: ix(R.SHROOM, 5),
};

export const DUCK = fromRows(
  [".....KK...", "....KWWK..", "....KWeWoo", "....KWWK..", "KK.KWWWK..", "KWKWWWWWK.", "KwWWWWwWK.", ".KwwwwwK.."],
  DU,
);

export const DUCKLING = fromRows(["..KK.", ".KyeYo", "KyyyK.", ".KYK.."], DU);

// ---------------------------------------------------------------------------------------------
// The grove cat, a ginger loaf by the fire. Tap for a dad joke.

const CA = {
  K: ix(R.FUR, 1),
  O: ix(R.FUR, 5),
  o: ix(R.FUR, 6),
  c: ix(R.FUR, 7),
  e: ix(R.INK, 0),
  n: ix(R.ROSE, 4),
};

export const CAT = {
  loaf: fromRows(
    ["K.K.......", "KoK.......", "KOOK......", "KeOeKKKK..", "KcncOOOOK.", ".KcOoOoOOK", ".KcOOOOOOK", "..KKKKKKKo"],
    CA,
  ),
  blink: fromRows(
    ["K.K.......", "KoK.......", "KOOK......", "KKOKKKKK..", "KcncOOOOK.", ".KcOoOoOOK", ".KcOOOOOOK", "..KKKKKKK."],
    CA,
  ),
};

// ---------------------------------------------------------------------------------------------
// An owl on one of the Great Sequoia's limbs, out at night.

const OW = {
  K: ix(R.FUR, 1),
  B: ix(R.FUR, 3),
  b: ix(R.FUR, 4),
  c: ix(R.CREAM, 3),
  y: ix(R.GLOW, 5),
  e: ix(R.INK, 0),
  n: ix(R.SHROOM, 4),
};

export const OWL = {
  open: fromRows([".K...K.", "KBBBBBK", "BycBcyB", "BeyneyB", "BbcccbB", ".BbcbB.", "..B.B.."], OW),
  shut: fromRows([".K...K.", "KBBBBBK", "BBcBcBB", "BBBnBBB", "BbcccbB", ".BbcbB.", "..B.B.."], OW),
};
