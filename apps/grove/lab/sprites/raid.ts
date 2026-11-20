/**
 * The raid spirits: chibi forest spirits of the guild's nicknames for the raid bosses, our own
 * designs, each to be featured on its raid's banner. Rock (The Canyon Colossus), Worm (Nest of the
 * Grootslangs), Greg (The Nameless Anomaly) and Moth (The Wartorn Palace).
 */

import { ix, R } from "../pixel/palette.ts";
import type { Sprite } from "../pixel/raster.ts";
import { art, explode, type Frame, frame, type Legend } from "./kit.ts";
import { C } from "./palette-cast.ts";

export interface SpiritArt {
  idle: Frame[];
  happy: Frame[];
  portrait: Sprite;
  poses: Record<string, Frame[]>;
}

/** Portrait, 32 by 32. */
const ROCK_PORTRAIT = [
  "................................",
  "................................",
  "................................",
  "................................",
  "................................",
  "................................",
  ".............FGGF...............",
  "...........FFGGGGFF.............",
  ".........fFFGGGGGFFFf...........",
  "........fffFGGGGGGFfff..........",
  ".......kfffFFFFFfffffbjjj.......",
  ".....kkffffffFFFfffbbbbbbjj.....",
  ".....kllhhlfffbbbbbbbbbbmmj.....",
  "....kllhhhllfbbbbbbbbbbbmmmjj...",
  "....khhhhllbbbbbbbbbbbbbmmmmj...",
  "...khhhhlbbbbbbbbbbbbbbbbmmmmj..",
  "...khhhllbbbbbbbbbbbbbbbbmmmmj..",
  "..klhllbbbbbbbbbbbbbbOobbbmmmj..",
  "..kllllbbOoobbbbbbbbOOoobbmmmj..",
  "..kllbbbOooobbbbbbbbOOoobbmmmj..",
  "..kbbbbboooebbbbbbbbeeoobbdddj..",
  "..kbbbbbboebbbbbbbbbbeobbbdddj..",
  "..jbbbbbbbbbbbnnnnnnbbbbbbdddj..",
  "..jbbbbbbbbbbbnnnnnnbbbbbbdddj..",
  "..jbmbbbbbbbbbbbbbbbbbbbbmdddj..",
  "...jmmbbbbbbbbbbbbbbbbbmmddddj..",
  "...jjbddmmmbbbbbbbbbbmmmmddddj..",
  ".....jddmmmmbbbbbbbbmmmmddddj...",
  ".....jjmmmmmbbbbbbbbmmmmdddjj...",
  ".......jjjjjjjjjjjjjjjjjjjj.....",
  "................................",
  "................................",
];

/** Portrait: Worm up out of its burrow, delighted. */
const WORM_PORTRAIT = [
  "................................",
  "................................",
  ".............jjjjjj.............",
  "...........jjhhhllljj...........",
  "...........jhhhhllllj...........",
  ".........jjhhhhlllllbjj.........",
  ".........jhhhllllllbbbj.........",
  "........jhhllllllbbbbbbj........",
  "........jlllwebbbbwebbbj........",
  "........jllleebbbbeebbbj........",
  "........jbbbeebbbbeebbbj........",
  "........jppbbbbbbbbbbppj........",
  "........jppbnbbbbbbnbppj........",
  "........jbbbbnbbbbnbbbbj........",
  "........jddbbbnnnnbbbddj........",
  ".........jdddbddddbddddj........",
  ".........jdddddddddddddj........",
  "..........jddddddddddddj........",
  "..........jbbbllllbbbbbj........",
  "..........jbbbllllbbbbbj........",
  "..........jddddddddddddj........",
  "..........jddddddddddddj........",
  "..........jbbbllllbbbbdj........",
  "........jjjubbllllbbbbOjj.......",
  ".......qjjuuOOOOOOOOOOOOOOjjq...",
  ".....qquuuOOOOOOOOOOOOOOOOooqq..",
  ".....quuuOOOOOOOOOOOOOOOooooq...",
  "...qquuOOOOOOOOOOOOOOOOooooooqq.",
  "...quuuOOOOOOOOOOOOOOooooooooqqq",
  ".qquuuOOOOOOOOOOOOOOoooooooooqqq",
  "qqquuuOOOOOOOOOOOOOOooooooooqqq.",
  "qqqqqqqqqqqqqqqqqqqqqqqqqqqqq...",
];

/** Portrait: Greg, content, his star above him. */
const GREG_PORTRAIT = [
  "................................",
  "...............g................",
  "..............gxg...............",
  "...............g................",
  "................................",
  "................................",
  "................................",
  "...........jjjjjjjjjj...........",
  "........jjhhllllbbbbbjjj........",
  "......jjhhllllllbbbbbbbmjj......",
  ".....jlhbbbbbbbbbbbbbbbbmmj.....",
  "....jlhbbbbbbbbbbbbbbbbbbmmj....",
  "....jhlbbbbbbbbbbbbbbbbbbmmj....",
  "...jlhbbEbbbEbbbbbbEbbbEbbmmj...",
  "...jllbbbEEEbbbbbbbbEEEbbbmmj...",
  "...jllbbbbbbbbbbbbbbbbbbbbmmj...",
  "...jllpppbbWbbbbbbbbWbbpppmmj...",
  "...jllpppbbbWbbbbbbWbbbpppmmj...",
  "...jbbbbbbbbbWWWWWWbbbbbbbmmj...",
  "...jbbbbbbbbbbbbbbbbbbbbbbmmj...",
  "...jbbbbbbbbbbbbbbbbbbbbbbmmj...",
  "...jbbbbbbbllnccCCcllbbbbSmmj...",
  "....jbbbbbblccCcncclbbbbbmmj....",
  "....jbbSbbbbcnccccnbbbbbbmmj....",
  "....jbbbbbbbjcccncjbbbbbbmmj....",
  ".....jmmmmmmmjjjjjmmmmSmmmj.....",
  "......jjmmmmmmmmmmmmmmmmjj......",
  "........jjjjjjjjjjjjjjjj........",
  ".........jmmj......jmmj.........",
  ".........jjjj......jjjj.........",
  "................................",
  "................................",
];

/** Portrait, 32 by 32. */
const MOTH_PORTRAIT = [
  "................................",
  "................................",
  "................................",
  ".......kk..............kk.......",
  ".......kkk............kkk.......",
  "........kkk..........kkk........",
  ".........kkk........kkk.........",
  "jjjj......k.kggggggk.k......jjjj",
  "jrrrjj.....kkggggggkk.....jjrrrj",
  "rrrrrrjj...kkggGGggkk...jjrrrrrr",
  "rrrrrRRRjj.kgggGGgggk.jjRRRrrrrr",
  "rrrrRRRrrrjggeeGGeeggjrrrRRRrrrr",
  "rrrRRRRrrrrggeeGGeeggrrrrRRRRrrr",
  "rrrRRRyyrrrggggggggggrrryyRRRrrr",
  "jrrrRyyyyrrRggggggggRrryyyyRrrrj",
  "jrrrryyyyRRRcccCCcccRRRyyyyrrrrj",
  ".jrrryyyRRRRcccCCcccRRRRyyyrrrj.",
  ".jrrrRRRRRrrccccccccrrRRRRRrrrj.",
  "..jrrRRRRrrrccccccccrrrRRRRrrj..",
  "..jjRRRRrrrrggggggggrrrrRRRRjj..",
  "....jjjRrrrrggggggggrrrrRjjj....",
  "....jjRRRrrrcccggcccrrrRRRjj....",
  ".....jRRrRrrcccggcccrrRrRRj.....",
  ".....jRrRrRRggggggggRRrRrRj.....",
  "......jrrRRRggggggggRRRrrj......",
  "......jjRRRjjggggggjjRRRjj......",
  "........jjjjjjggggjjjjjj........",
  "..............jggj..............",
  "...............jj...............",
  "................................",
  "................................",
  "................................",
];

// ---------------------------------------------------------------------------------------------
// Rock: a stoic little boulder, moss on its crown, two pebbles for eyes under a heavy brow.

const RO: Legend = {
  j: ix(R.STONE, 1),
  k: ix(R.STONE, 2),
  d: ix(R.STONE, 3),
  m: ix(R.STONE, 4),
  b: ix(R.STONE, 5),
  l: ix(R.STONE, 6),
  h: ix(R.STONE, 7),
  n: ix(R.STONE, 2),
  o: ix(R.CREAM, 3),
  O: ix(R.CREAM, 5),
  e: ix(R.INK, 0),
  f: ix(C.LEAF, 3),
  F: ix(C.LEAF, 5),
  G: ix(C.LEAF, 6),
};

// ---------------------------------------------------------------------------------------------
// Worm: a cheerful segmented worm up out of its burrow.

const WO: Legend = {
  j: ix(R.ROSE, 0),
  k: ix(R.ROSE, 1),
  d: ix(R.ROSE, 2),
  m: ix(R.ROSE, 2),
  b: ix(R.ROSE, 3),
  l: ix(R.ROSE, 4),
  h: ix(R.ROSE, 5),
  e: ix(R.INK, 0),
  w: ix(R.CREAM, 7),
  n: ix(R.ROSE, 0),
  p: ix(R.CRAB, 4),
  r: ix(R.CRAB, 3),
  q: ix(R.WOOD, 1),
  o: ix(R.WOOD, 3),
  O: ix(R.WOOD, 4),
  u: ix(R.WOOD, 5),
};

// ---------------------------------------------------------------------------------------------
// Greg: a round little pocket of night, stars inside, cheeks full. He eats offerings and is content.
// Features are pale, so they read on his dark.

const GR: Legend = {
  j: ix(C.VIOLET, 0),
  d: ix(C.VIOLET, 1),
  m: ix(C.VIOLET, 2),
  b: ix(C.VIOLET, 3),
  l: ix(C.VIOLET, 4),
  h: ix(C.VIOLET, 6),
  S: ix(C.PEARL, 7),
  g: ix(R.GLOW, 4),
  x: ix(R.GLOW, 7),
  W: ix(C.PEARL, 7),
  E: ix(C.PEARL, 7),
  p: ix(R.ROSE, 3),
  c: ix(R.WOOD, 5),
  C: ix(R.WOOD, 7),
  n: ix(R.WOOD, 1),
};

// ---------------------------------------------------------------------------------------------
// Moth: a fuzzy rosy moth, front on, wings spread, feathered antennae.

const MT: Legend = {
  j: ix(R.ROSE, 0),
  r: ix(R.ROSE, 3),
  R: ix(R.ROSE, 4),
  y: ix(C.GOLD, 6),
  k: ix(C.GOLD, 2),
  g: ix(C.GOLD, 5),
  G: ix(C.GOLD, 7),
  c: ix(R.CREAM, 5),
  C: ix(R.CREAM, 7),
  e: ix(R.INK, 0),
};

const ROCK_IDLE = [
  ".....FGF......",
  "...fFGGGFf....",
  "..kffFFffbjj..",
  ".klhlfbbbbbmj.",
  ".khlbbbbbbbmmj",
  "khlbkkbbbkkbmj",
  "klbOobbbbOobmj",
  "kbboebbbbeobdj",
  "jbbbbbnnnbbbdj",
  "jmbbbbbbbbbmdj",
  ".jdmmbbbbmmddj",
  "..jjjjjjjjjjj.",
];

/** A slow, stoic blink. */
const ROCK_BLINK = [
  ".....FGF......",
  "...fFGGGFf....",
  "..kffFFffbjj..",
  ".klhlfbbbbbmj.",
  ".khlbbbbbbbmmj",
  "khlbkkbbbkkbmj",
  "klbbbbbbbbbbmj",
  "kbbkkbbbbkkbdj",
  "jbbbbbnnnbbbdj",
  "jmbbbbbbbbbmdj",
  ".jdmmbbbbmmddj",
  "..jjjjjjjjjjj.",
];

/** The moss on its crown stirs. */
const ROCK_MOSS = [
  "......FGF.....",
  "...fFGGGFf....",
  "..kffFFffbjj..",
  ".klhlfbbbbbmj.",
  ".khlbbbbbbbmmj",
  "khlbkkbbbkkbmj",
  "klbOobbbbOobmj",
  "kbboebbbbeobdj",
  "jbbbbbnnnbbbdj",
  "jmbbbbbbbbbmdj",
  ".jdmmbbbbmmddj",
  "..jjjjjjjjjjj.",
];

/** Rock, cracking a smile. */
const ROCK_HAPPY = [
  ".....FGF......",
  "...fFGGGFf....",
  "..kffFFffbjj..",
  ".klhlfbbbbbmj.",
  ".khlbbbbbbbmmj",
  "khlbbbbbbbbbmj",
  "klbObbbbbbObmj",
  "kbobobbbbobodj",
  "jbbbnbbbnbbbdj",
  "jmbbbnnnbbbmdj",
  ".jdmmbbbbmmddj",
  "..jjjjjjjjjjj.",
];

const WORM_IDLE = [
  "......jjjj......",
  ".....jhhllj.....",
  "....jhlllbbj....",
  "....jlebbebj....",
  "....jpebbepj....",
  "....jbnbbnbj....",
  "....jdbnnbdj....",
  ".....jdddddj....",
  ".....jbllbbj....",
  ".....jdddddj....",
  ".....jbllbbj....",
  "...quuOjjjjOoq..",
  "..quOOOOOOOOooq.",
  ".quOOOOOOOooooqq",
  "qqqqqqqqqqqqqqq.",
];

/** Swaying: the head leans a pixel over. */
const WORM_SWAY = [
  ".......jjjj.....",
  "......jhhllj....",
  ".....jhlllbbj...",
  ".....jlebbebj...",
  ".....jpebbepj...",
  ".....jbnbbnbj...",
  ".....jdbnnbdj...",
  ".....jdddddj....",
  ".....jbllbbj....",
  ".....jdddddj....",
  ".....jbllbbj....",
  "...quuOjjjjOoq..",
  "..quOOOOOOOOooq.",
  ".quOOOOOOOooooqq",
  "qqqqqqqqqqqqqqq.",
];

const WORM_BLINK = [
  "......jjjj......",
  ".....jhhllj.....",
  "....jhlllbbj....",
  "....jlkbbkbj....",
  "....jpkbbkpj....",
  "....jbnbbnbj....",
  "....jdbnnbdj....",
  ".....jdddddj....",
  ".....jbllbbj....",
  ".....jdddddj....",
  ".....jbllbbj....",
  "...quuOjjjjOoq..",
  "..quOOOOOOOOooq.",
  ".quOOOOOOOooooqq",
  "qqqqqqqqqqqqqqq.",
];

/** Eyes squeezed shut in a grin. */
const WORM_HAPPY = [
  "......jjjj......",
  ".....jhhllj.....",
  "....jhlllbbj....",
  "....jlebbebj....",
  "....jebbbbej....",
  "....jpnbbnpj....",
  "....jdbnnbdj....",
  ".....jdddddj....",
  ".....jbllbbj....",
  ".....jdddddj....",
  ".....jbllbbj....",
  "...quuOjjjjOoq..",
  "..quOOOOOOOOooq.",
  ".quOOOOOOOooooqq",
  "qqqqqqqqqqqqqqq.",
];

const GREG_IDLE = [
  "...........g....",
  "..........gxg...",
  "...........g....",
  "....jjjjjjjj....",
  "..jjhhllllbbjj..",
  ".jhhlbbbbbbbbmj.",
  ".jhlbbbbbbbbbmj.",
  "jhbEbbEbbEbbEbmj",
  "jlbbEEbbbbEEbbmj",
  "jbppbbbbbbbbppmj",
  "jbppbbWbbWbbppmj",
  "jbbbbbbWWbbbbbmj",
  "jmbbbccCcbbbbbdj",
  "jmbbccncccbbSbdj",
  ".jmbbcccncbbbdj.",
  ".jjmmmmmmmmmmjj.",
  "..jjjj....jjjj..",
];

/** Chewing: mouth working, his star bobbing. */
const GREG_CHEW = [
  "............g...",
  "...........gxg..",
  "............g...",
  "....jjjjjjjj....",
  "..jjhhllllbbjj..",
  ".jhhlbbbbbbbbmj.",
  ".jhlbbbbbbbbbmj.",
  "jhbEbbEbbEbbEbmj",
  "jlbbEEbbbbEEbbmj",
  "jbppbbbWWbbbppmj",
  "jbppbbWbbWbbppmj",
  "jbbbbbbWWbbbbbmj",
  "jmbbbccCcbbbbbdj",
  "jmbbccncccbbSbdj",
  ".jmbbcccncbbbdj.",
  ".jjmmmmmmmmmmjj.",
  "..jjjj....jjjj..",
];

/** The offering, up to his mouth. */
const GREG_BITE = [
  "...........g....",
  "..........gxg...",
  "...........g....",
  "....jjjjjjjj....",
  "..jjhhllllbbjj..",
  ".jhhlbbbbbbbbmj.",
  ".jhlbbbbbbbbbmj.",
  "jhbEbbEbbEbbEbmj",
  "jlbbEEbbbbEEbbmj",
  "jbppbbcCcbbbppmj",
  "jbppbcCccnbbppmj",
  "jbbbbcnccbbbbbmj",
  "jmbbbbcccbbbbbdj",
  "jmbbbbbbbbbbSbdj",
  ".jmbbbbbbbbbbdj.",
  ".jjmmmmmmmmmmjj.",
  "..jjjj....jjjj..",
];

/** All gone. A paw on his belly. Satisfied. */
const GREG_FULL = [
  "..........g.....",
  ".........gxg....",
  "..........g.....",
  "....jjjjjjjj....",
  "..jjhhllllbbjj..",
  ".jhhlbbbbbbbbmj.",
  ".jhlbbbbbbbbbmj.",
  "jhbEbbEbbEbbEbmj",
  "jlbbEEbbbbEEbbmj",
  "jbppbbbbbbbbppmj",
  "jbppbbWbbWbbppmj",
  "jbbbbbbWWbbbbbmj",
  "jmbbbbbbbbbbbbdj",
  "jmbbbbllllbbSbdj",
  ".jmbblbbbblbbdj.",
  ".jjmmmmmmmmmmjj.",
  "..jjjj....jjjj..",
];

const MOTH_IDLE = [
  "....k.......k....",
  ".....k.....k.....",
  "jjj...kgggk...jjj",
  "jrrjj.kgGgk.jjrrj",
  "jrRRrjgeGegjrRRrj",
  "jrRyyrjgggjryyRrj",
  ".jryyRjcCcjRyyrj.",
  ".jrRRrjcccjrRRrj.",
  "..jjjrjgggjrjjj..",
  "...jRrjcgcjrRj...",
  "...jrRjgggjRrj...",
  "....jjjjgjjjj....",
  "........j........",
];

/** Wings drawn up and in. */
const MOTH_FLAP = [
  "....k.......k....",
  "....k.......k....",
  ".....k.ggg.k.....",
  "..jjjjkgGgkjjjj..",
  ".jrRRrgeGegrRRrj.",
  ".jRyyrjgggjryyRj.",
  "..jyyRjcCcjRyyj..",
  "..jrRrjcccjrRrj..",
  "...jjrjgggjrjj...",
  "...jRrjcgcjrRj...",
  "...jrRjgggjRrj...",
  "....jjjjgjjjj....",
  "........j........",
];

const MOTH_HAPPY = [
  "...k.........k...",
  "....k.......k....",
  "jjj..k.ggg.k..jjj",
  "jrrjj.kgGgk.jjrrj",
  "jrRRrjgkGkgjrRRrj",
  "jrRyyrjgrgjryyRrj",
  ".jryyRjcCcjRyyrj.",
  ".jrRRrjcccjrRRrj.",
  "..jjjrjgggjrjjj..",
  "...jRrjcgcjrRj...",
  "...jrRjgggjRrj...",
  "....jjjjgjjjj....",
  "........j........",
];

function rock(): SpiritArt {
  const idle = art(ROCK_IDLE, RO);
  const happy = art(ROCK_HAPPY, RO);
  return {
    idle: [frame(idle, 1600), frame(art(ROCK_BLINK, RO), 260), frame(idle, 1200), frame(art(ROCK_MOSS, RO), 400)],
    happy: [explode(happy, "pop", 7, 6, 220, 1), explode(happy, "fling", 7, 5, 420)],
    portrait: art(ROCK_PORTRAIT, RO),
    poses: {},
  };
}

function worm(): SpiritArt {
  const idle = art(WORM_IDLE, WO);
  const sway = art(WORM_SWAY, WO);
  return {
    idle: [frame(idle, 500), frame(sway, 500), frame(idle, 500), frame(art(WORM_BLINK, WO), 120)],
    happy: [explode(art(WORM_HAPPY, WO), "pop", 8, 5, 220, 1), explode(art(WORM_HAPPY, WO), "fling", 8, 4, 420)],
    portrait: art(WORM_PORTRAIT, WO),
    poses: {},
  };
}

function greg(): SpiritArt {
  const idle = art(GREG_IDLE, GR);
  const chew = art(GREG_CHEW, GR);
  const full = art(GREG_FULL, GR);
  return {
    idle: [frame(idle, 900), frame(chew, 220), frame(idle, 220), frame(chew, 220)],
    happy: [explode(full, "pop", 7, 6, 220, 1), explode(full, "fling", 7, 5, 420)],
    portrait: art(GREG_PORTRAIT, GR),
    poses: {
      eat: [frame(idle, 600), frame(chew, 200), frame(art(GREG_BITE, GR), 500), frame(chew, 200), frame(full, 1200)],
    },
  };
}

function moth(): SpiritArt {
  const idle = art(MOTH_IDLE, MT);
  const flap = art(MOTH_FLAP, MT);
  return {
    idle: [frame(idle, 700), frame(flap, 120), frame(idle, 160), frame(flap, 120)],
    happy: [explode(art(MOTH_HAPPY, MT), "pop", 8, 6, 220, 2), explode(art(MOTH_HAPPY, MT), "fling", 8, 5, 420, 1)],
    portrait: art(MOTH_PORTRAIT, MT),
    poses: {},
  };
}

export const ROCK = rock();
export const WORM = worm();
export const GREG = greg();
export const MOTH = moth();
