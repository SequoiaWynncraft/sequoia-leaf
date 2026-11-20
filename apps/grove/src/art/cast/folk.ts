/**
 * The grove's folk: the gnome herald who marches in to announce level-ups and rare finds, and Cinfy,
 * the guild bank as a nervous hamster treasurer who runs the shop and guards the vault everyone
 * "borrows" from.
 */

import { C, ix } from "../../engine/palette.ts";
import type { Sprite } from "../../engine/raster.ts";
import { art, explode, type Frame, frame, type Legend } from "./kit.ts";

export interface FolkArt {
  idle: Frame[];
  happy: Frame[];
  portrait: Sprite;
  poses: Record<string, Frame[]>;
}

// The herald: red hat, Sequoia-purple tabard with a gold buckle, a brass trumpet hung with the guild's
// banner, a gold pennant with an orange sun.
const GN: Legend = {
  h: ix(C.CRAB, 2),
  H: ix(C.CRAB, 3),
  k: ix(C.CRAB, 5),
  B: ix(C.CREAM, 6),
  b: ix(C.CREAM, 3),
  s: ix(C.CREAM, 4),
  S: ix(C.ROSE, 5),
  n: ix(C.ROSE, 4),
  e: ix(C.INK, 0),
  T: ix(C.VIOLET, 4),
  t: ix(C.VIOLET, 2),
  u: ix(C.VIOLET, 6),
  l: ix(C.WOOD, 1),
  g: ix(C.GOLD, 6),
  o: ix(C.WOOD, 2),
  q: ix(C.GOLD, 2),
  a: ix(C.GOLD, 4),
  A: ix(C.GOLD, 6),
  W: ix(C.GOLD, 7),
  P: ix(C.GOLD, 5),
  p: ix(C.GOLD, 3),
  z: ix(C.CRAB, 5),
  x: ix(C.CREAM, 6),
};

// Cinfy: a golden hamster in spectacles, cheeks stuffed, a purple ledger with a gold clasp.
const CI: Legend = {
  j: ix(C.SHROOM, 0),
  k: ix(C.SHROOM, 1),
  d: ix(C.SHROOM, 2),
  m: ix(C.SHROOM, 3),
  b: ix(C.SHROOM, 4),
  l: ix(C.SHROOM, 5),
  h: ix(C.SHROOM, 6),
  c: ix(C.CREAM, 5),
  C: ix(C.CREAM, 3),
  e: ix(C.INK, 0),
  n: ix(C.INK, 2),
  r: ix(C.ROSE, 4),
  g: ix(C.METAL, 7),
  G: ix(C.CREAM, 7),
  v: ix(C.VIOLET, 3),
  V: ix(C.VIOLET, 5),
  P: ix(C.CREAM, 6),
  y: ix(C.GOLD, 6),
  o: ix(C.SHROOM, 3),
  s: ix(C.WATER, 5),
  S: ix(C.WATER, 6),
};

const GNOME_STAND = [
  "..h............",
  "..hk...........",
  "...hk..........",
  "...hHk.........",
  "...hHHk........",
  "..hHHHHk.......",
  ".hHHHHHHk......",
  "hhhHHHHHHk.....",
  ".bBssesnn......",
  ".bBBBssnn......",
  ".bBBBBBB.......",
  "tbBBBBBBu......",
  "tTbBBBBussqaAAW",
  "tTglllgTu.PPPPA",
  ".tTuTuTTu.PzzP.",
  ".tTTTTTTu.PPPp.",
  "..oo..oo...Pp..",
  "..ooo.ooo......",
];

/** Marching: the other foot forward. */
const GNOME_STEP = [
  "..h............",
  "..hk...........",
  "...hk..........",
  "...hHk.........",
  "...hHHk........",
  "..hHHHHk.......",
  ".hHHHHHHk......",
  "hhhHHHHHHk.....",
  ".bBssesnn......",
  ".bBBBssnn......",
  ".bBBBBBB.......",
  "tbBBBBBBu......",
  "tTbBBBBussqaAAW",
  "tTglllgTu.PPPPA",
  ".tTuTuTTu.PzzP.",
  ".tTTTTTTu.PPPp.",
  "...oo.oo...Pp..",
  "...oooooo......",
];

/** The trumpet up, the guild's pennant hanging from it: gold, with the orange sun. */
const GNOME_RAISE = [
  "..h............",
  "..hk...........",
  "...hk..........",
  "...hHk......W..",
  "...hHHk....AW..",
  "..hHHHHk..aAW..",
  ".hHHHHHHk.a....",
  "hhhHHHHHHkq....",
  ".bBssesnqqPPPP.",
  ".bBBBssnsuPzzP.",
  ".bBBBBBBu.PPPp.",
  "tbBBBBBBu..Pp..",
  "tTbBBBBuu......",
  "tTglllgTu......",
  ".tTuTuTTu......",
  ".tTTTTTTu......",
  "..oo..oo.......",
  "..ooo.ooo......",
];

/** Toot: cheeks full, eyes shut, the notes away. */
const GNOME_TOOT = [
  "..h.........xx.",
  "..hk........x..",
  "...hk......xx..",
  "...hHk......WW.",
  "...hHHk....AWW.",
  "..hHHHHk..aAWW.",
  ".hHHHHHHk.a....",
  "hhhHHHHHHkq....",
  ".bBssksSqqPPPP.",
  ".bBBBSSSsuPzzP.",
  ".bBBBBBBu.PPPp.",
  "tbBBBBBBu..Pp..",
  "tTbBBBBuu......",
  "tTglllgTu......",
  ".tTuTuTTu......",
  ".tTTTTTTu......",
  "..oo..oo.......",
  "..ooo.ooo......",
];

const CINFY_IDLE = [
  "..jj.......jj..",
  ".jrrjjjjjjjrrj.",
  ".jlhlllllllllj.",
  "jlhgggbbbgggbmj",
  "jllgegbgbgegbmj",
  "jhlbebbbbbebbmj",
  "jlrrbccnccbrrmj",
  "jlrrbcnbncbrrmj",
  "jllcvVVVVvcllmj",
  "jlllvPPPPvlllmj",
  "jllcvVVyVvcllmj",
  ".jlcvvvvvvcmj..",
  "..jjljjjjjljj..",
];

/** Sweating: a bead on the brow, drops flying, mouth wobbling. */
const CINFY_SWEAT = [
  "S.jj.......jj.s",
  ".jrrjjjjjjjrrjS",
  ".jlhllslllllljs",
  "jlhgggbSbgggbmj",
  "jllgegbgbgegbmj",
  "jhlbebbbbbebbmj",
  "jlrrbcnbncbrrmj",
  "jlrrbncncnbrrmj",
  "jllcvVVVVvcllmj",
  "jlllvPPPPvlllmj",
  "jllcvVVyVvcllmj",
  ".jlcvvvvvvcmj..",
  "..jjljjjjjljj..",
];

/** Eyes down to the ledger, checking the sums. */
const CINFY_COUNT = [
  "..jj.......jj..",
  ".jrrjjjjjjjrrj.",
  ".jlhlllllllllj.",
  "jlhgggbbbgggbmj",
  "jllgbgbgbgbgbmj",
  "jhlbbebbbbebbmj",
  "jlrrbccnccbrrmj",
  "jlrrbcnbncbrrmj",
  "jllcvVVVVvcllmj",
  "jlllvPPPPvlllmj",
  "jllcvVVyVvcllmj",
  ".jlcvvvvvvcmj..",
  "..jjljjjjjljj..",
];

const CINFY_BLINK = [
  "..jj.......jj..",
  ".jrrjjjjjjjrrj.",
  ".jlhlllllllllj.",
  "jlhgggbbbgggbmj",
  "jllgkgbgbgkgbmj",
  "jhlbbbbbbbbbbmj",
  "jlrrbccnccbrrmj",
  "jlrrbcnbncbrrmj",
  "jllcvVVVVvcllmj",
  "jlllvPPPPvlllmj",
  "jllcvVVyVvcllmj",
  ".jlcvvvvvvcmj..",
  "..jjljjjjjljj..",
];

/** Relief: the books balance. */
const CINFY_HAPPY = [
  "..jj.......jj..",
  ".jrrjjjjjjjrrj.",
  ".jlhlllllllllj.",
  "jlhgggbbbgggbmj",
  "jllgkgbgbgkgbmj",
  "jhlbbbbbbbbbbmj",
  "jlrrbncccnbrrmj",
  "jlrrbcnnnccrrmj",
  "jllcvVVVVvcllmj",
  "jlllvPPPPvlllmj",
  "jllcvVVyVvcllmj",
  ".jlcvvvvvvcmj..",
  "..jjljjjjjljj..",
];

/** Portrait: the herald with his trumpet up and the guild's pennant hanging from it. */
const GNOME_PORTRAIT = [
  ".....hh.........................",
  ".....hh.........................",
  ".....hhk................aW......",
  "......hhkk.............aAW......",
  "......hhkk.............aAAW.....",
  ".......hhkkk...........aAqAW....",
  ".......hhHkk...........aAqqAW...",
  ".......hhHHHkk.........aAAqqAW..",
  ".......hhHHHkk.........aAAAAAAW.",
  "......hhHHHHHHkk......aAAAAa....",
  "......hhHHHHHHkk......aA........",
  "....hhHHHHHHHHHHkk...aAA........",
  "....hHHHHHHHHHHHkk..aAA.........",
  "..hhhHHHHHHHHHHHHHkapA....p.....",
  ".hhhhhHHHHHHHHHHHsapPPPPPPPp....",
  ".hhhhhhHHHHHHHHHsqApPPPPPPPp....",
  "...bbBBssssexeSnqq.pPPPzzPPp....",
  "...bbBBBssseeennn..pPPzzzzPp....",
  "...bbBBBBBSSssnnn..pPPzzzzPp....",
  "...bbBBBBBBBsssnn..pPPPzzPPp....",
  "...bbBBBBBBBBBbBB..pPPPPPPPp....",
  "...bbBBBbBBBBBbBB..pPPp.pPPp....",
  "..tbbBBBbBBBbBBBB..pPp...pPp....",
  ".ttbbbBBBBBBbBBBu..pp.....pp....",
  ".ttTbbBBBBBBBBBBu...............",
  ".ttTTbBBBBBBBBBuu...............",
  ".ttTTggllllllggTuuu.............",
  "..ttTTgllllllgTTTuu.............",
  "..ttTTTuuTTuuTTTTuu.............",
  "...ttTTuuTTuuTTTTuu.............",
  "...ttTTTTTTTTTTTTuu.............",
  "....tTTTTTTTTTTTTu..............",
];

/** Portrait: spectacles, eyebrows up, the ledger held close. */
const CINFY_PORTRAIT = [
  "................................",
  "................................",
  "................................",
  "................................",
  "......jj................jj......",
  "....jjrrjj............jjrrjj....",
  "....jrrrrrjjjjjjjjjjjjrrrrrj....",
  "...jlrrrrllkllllllllkllrrrrlj...",
  "...jlllhhkkllllllllllkklllllj...",
  "..jlllhhhlllllllllllllllllllmj..",
  "..jllhhhgggggbbbbbbgggggbbbmmj..",
  ".jlllhhgGbbbbggggggGbbbbgbbmmmj.",
  ".jlllllglbGebgbbbbgbbGebgbbmmmj.",
  ".jlllllglbeebgbbbbgbbeebgbbmmmj.",
  ".jhhhllgbbeebgbbbbgbbeebgbbmmmj.",
  ".jhhhllbgggggbbbbbbgggggbbbmmmj.",
  ".jllllrrbbbccccccccccbbbrrlmmmj.",
  ".jlllrrrrbbccccrrccccbbrrrrmmmj.",
  ".jllllrlrbbcccnncnnccbbrlrlmmmj.",
  ".jlllllrrbbcccnccnccccbrrllmmmj.",
  ".jlllllccvvVVVVVVVVvcccllllmmmj.",
  ".jllllllllvVVVVVVVVvvclllllmmmj.",
  ".jlllllllmvPPCPPPCPvvlmllllmmmj.",
  ".jlllllllvvPCPPCPPPvvllllllmmmj.",
  ".jllllllcvvVVVVyyVVvvclllllmmmj.",
  "..jllllccvvvVVVyyVvvvccllllmmj..",
  "..jjlllccvvvvvvvvvvvvccllllmjj..",
  "....jllccvvvvvvvvvvvvccllmmj....",
  "....jjcccllvvvvvvvvvvlllmmjj....",
  "......jjjlljjjjjjjjjjlljjj......",
  "................................",
  "................................",
];

function gnome(): FolkArt {
  const stand = art(GNOME_STAND, GN);
  const step = art(GNOME_STEP, GN);
  const raise = art(GNOME_RAISE, GN);
  const toot = art(GNOME_TOOT, GN);
  return {
    idle: [
      frame(stand, 1200),
      frame(
        art(
          GNOME_STAND.map((r) => r.replace("ssesnn", "sskknn")),
          GN,
        ),
        140,
      ),
      frame(stand, 900),
    ],
    happy: [explode(toot, "pop", 7, 7, 240, 1), explode(toot, "fling", 7, 6, 440)],
    portrait: art(GNOME_PORTRAIT, GN),
    poses: {
      march: [frame(stand, 220, 1), frame(step, 220), frame(stand, 220, 1), frame(step, 220)],
      raise: [frame(raise, 500)],
      toot: [frame(raise, 260), frame(toot, 260), frame(raise, 120), frame(toot, 420)],
    },
  };
}

function cinfy(): FolkArt {
  const idle = art(CINFY_IDLE, CI);
  const sweat = art(CINFY_SWEAT, CI);
  return {
    idle: [frame(idle, 1000), frame(art(CINFY_COUNT, CI), 500), frame(idle, 700), frame(art(CINFY_BLINK, CI), 130)],
    happy: [explode(art(CINFY_HAPPY, CI), "pop", 7, 6, 220, 1), explode(art(CINFY_HAPPY, CI), "fling", 7, 5, 420)],
    portrait: art(CINFY_PORTRAIT, CI),
    poses: { sweat: [frame(sweat, 140), frame(sweat, 140, 1), frame(sweat, 140), frame(sweat, 140, 1)] },
  };
}

export const GNOME = gnome();
export const CINFY = cinfy();
