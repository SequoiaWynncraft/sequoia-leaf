/**
 * The golden-antlered white fox: the legendary spirit, for the Nexus of Light. Our own design, made
 * as a homage. White fur with lilac shadows, antlers of gold whose tips glow, and a tail that runs
 * from white into flame-gold. Awake it sits like a statue; it sleeps curled by the campfire.
 */

import { C, ix } from "../../engine/palette.ts";
import type { Sprite } from "../../engine/raster.ts";
import { art, explode, type Frame, frame, type Legend } from "./kit.ts";

export interface FoxArt {
  idle: Frame[];
  happy: Frame[];
  portrait: Sprite;
  poses: Record<string, Frame[]>;
}

const FX: Legend = {
  j: ix(C.PEARL, 0),
  k: ix(C.PEARL, 1),
  d: ix(C.PEARL, 2),
  m: ix(C.PEARL, 3),
  s: ix(C.PEARL, 4),
  S: ix(C.PEARL, 5),
  p: ix(C.PEARL, 6),
  P: ix(C.PEARL, 7),
  a: ix(C.GOLD, 3),
  A: ix(C.GOLD, 5),
  g: ix(C.GOLD, 6),
  G: ix(C.GLOW, 6),
  q: ix(C.FIRE, 1),
  f: ix(C.FIRE, 3),
  F: ix(C.FIRE, 4),
  y: ix(C.FIRE, 5),
  Y: ix(C.FIRE, 6),
  W: ix(C.FIRE, 7),
  o: ix(C.GLOW, 4),
  e: ix(C.INK, 0),
  n: ix(C.INK, 2),
  r: ix(C.ROSE, 4),
};

const FOX_AWAKE = [
  ".................G..G...",
  ".................A..g.G.",
  ".............m...Ag.Ag..",
  ".............mm...AAA...",
  ".............mrm...a....",
  ".............mrPmmmam...",
  "...W.........mPPPPPPPm..",
  "..WY........mpPPPPoePPm.",
  "..YYF.......mpPPPPPPPPPn",
  ".FYYyF......jSpPPPPPpjj.",
  ".FyYYyq.....jSSpPPPjj...",
  "FyyYYyq....jSpPPPPj.....",
  "FyYYyyq..jjppPPPPPPj....",
  "FyYYyyfjjpPPPppPPPPj....",
  "FyyYyyjpPPPPpppPPPSj....",
  "fFyyyjpPPPPpppSPPPSj....",
  "fFFyFjpPPPpppSSPPSPj....",
  ".fFFFjSpPppSSSSPPSPj....",
  ".ffFfjSppSSSssSPjSPj....",
  "..qffjSSSSsssSSPjSPj....",
  "...qqqjsSssssSSPjSPj....",
  ".......jjjjjjjjjjjjj....",
];

const FOX_BLINK = [
  ".................G..G...",
  ".................A..g.G.",
  ".............m...Ag.Ag..",
  ".............mm...AAA...",
  ".............mrm...a....",
  ".............mrPmmmam...",
  "...W.........mPPPPPPPm..",
  "..WY........mpPPPPmmPPm.",
  "..YYF.......mpPPPPPPPPPn",
  ".FYYyF......jSpPPPPPpjj.",
  ".FyYYyq.....jSSpPPPjj...",
  "FyyYYyq....jSpPPPPj.....",
  "FyYYyyq..jjppPPPPPPj....",
  "FyYYyyfjjpPPPppPPPPj....",
  "FyyYyyjpPPPPpppPPPSj....",
  "fFyyyjpPPPPpppSPPPSj....",
  "fFFyFjpPPPpppSSPPSPj....",
  ".fFFFjSpPppSSSSPPSPj....",
  ".ffFfjSppSSSssSPjSPj....",
  "..qffjSSSSsssSSPjSPj....",
  "...qqqjsSssssSSPjSPj....",
  ".......jjjjjjjjjjjjj....",
];

/** The flame of the tail flickers the other way. */
const FOX_TAIL = [
  ".................G..G...",
  ".................A..g.G.",
  ".............m...Ag.Ag..",
  ".............mm...AAA...",
  ".............mrm...a....",
  ".............mrPmmmam...",
  "..W..........mPPPPPPPm..",
  "..YW........mpPPPPoePPm.",
  "..YYF.......mpPPPPPPPPPn",
  ".FYYyF......jSpPPPPPpjj.",
  ".FyYYyq.....jSSpPPPjj...",
  "FyyYYyq....jSpPPPPj.....",
  "FyYYyyq..jjppPPPPPPj....",
  "FyYYyyfjjpPPPppPPPPj....",
  "FyyYyyjpPPPPpppPPPSj....",
  "fFyyyjpPPPPpppSPPPSj....",
  "fFFyFjpPPPpppSSPPSPj....",
  ".fFFFjSpPppSSSSPPSPj....",
  ".ffFfjSppSSSssSPjSPj....",
  "..qffjSSSSsssSSPjSPj....",
  "...qqqjsSssssSSPjSPj....",
  ".......jjjjjjjjjjjjj....",
];

const FOX_HAPPY = [
  ".................G..G...",
  ".................A..g.G.",
  ".............m...Ag.Ag..",
  ".............mm...AAA...",
  ".............mrm...a....",
  ".............mrPmmmam...",
  "...W.........mPPPPPPPm..",
  "..WY........mpPPPPmPPPm.",
  "..YYF.......mpPPPPPPPPPn",
  ".FYYyF......jSpPPPPPpjj.",
  ".FyYYyq.....jSSpPPPjj...",
  "FyyYYyq....jSpPPPPj.....",
  "FyYYyyq..jjppPPPPPPj....",
  "FyYYyyfjjpPPPppPPPPj....",
  "FyyYyyjpPPPPpppPPPSj....",
  "fFyyyjpPPPPpppSPPPSj....",
  "fFFyFjpPPPpppSSPPSPj....",
  ".fFFFjSpPppSSSSPPSPj....",
  ".ffFfjSppSSSssSPjSPj....",
  "..qffjSSSSsssSSPjSPj....",
  "...qqqjsSssssSSPjSPj....",
  ".......jjjjjjjjjjjjj....",
];

/** Curled by the campfire, the flame of its tail laid over its nose like a blanket. */
const FOX_SLEEP = [
  "..................G..G..",
  "..................A.gA..",
  ".................mAgA...",
  "..........jjjj..mPma....",
  "......jjjjpPPPjmrPmm....",
  "....jjpPPPPPPPPmrPPPm...",
  "...jpPPPPPPPPPPPPPPPPm..",
  "..jpPPPPSSSpPPPPkPPPPPm.",
  ".jpPPPpSPPPSpPPPPkkPPPPn",
  ".jpPPSPPPPPPSpPPPPPPPWY.",
  "jSpPSPPPPPPPPSpPPPPYYWY.",
  "jSppSPPPPPPPPSpPPjyYYYW.",
  "FySpSpPPPPPPPSSpjyyYYyF.",
  "FyYSSppPPPPppSSjyyYYyFq.",
  "qfyYYyySSSSSSyyyYYYyyFq.",
  ".qfFyyyyFFFFyyyyyyFFq...",
  "..qqqfffffffffffffqq....",
];

/** Breathing in: the curl swells a pixel. */
const FOX_SLEEP_BREATHE = [
  "........................",
  "..................G..G..",
  "..................A.gA..",
  ".................mAgA...",
  "......jjjjjjjj..mPma....",
  "....jjpPPPPPPPjmrPmm....",
  "...jpPPPPPPPPPPmrPPPm...",
  "..jpPPPPPPPPPPPPPPPPPm..",
  "..jpPPPPSSSpPPPPkPPPPPm.",
  ".jpPPPpSPPPSpPPPPkkPPPPn",
  ".jpPPSPPPPPPSpPPPPPPPWY.",
  "jSpPSPPPPPPPPSpPPPPYYWY.",
  "jSppSPPPPPPPPSpPPjyYYYW.",
  "FySpSpPPPPPPPSSpjyyYYyF.",
  "FyYSSppPPPPppSSjyyYYyFq.",
  "qfyYYyySSSSSSyyyYYYyyFq.",
  ".qfFyyyyFFFFyyyyyyFFq...",
];

/** Portrait: the fox face on, antlers rising between its ears, the flame of its tail curled up beside it. */
const FOX_PORTRAIT = [
  "..........G..........G..........",
  "..........A..........g.G........",
  "........G.A...G......AA.........",
  ".........gA...A.....gA..........",
  "...........A.gA..G..A...........",
  "...........gA.....gA............",
  "......m.....A......A.....m......",
  ".....mPm.....a....a.....mPm.....",
  ".....mrPm....aA..Aa....mPrm.....",
  ".....mrrPm....a..a....mPrrm.....",
  "....mrrrPmmmmmmmmmmmmmPrrrm.....",
  "..W.mrrrPmpPPPPPPPPPPPmrrrm.....",
  ".WY.mprrPPPPPPPPPPPPPPPPPPrrpm..",
  ".YYW.mpPPPPPPPPPggPPPPPPPPPPm...",
  "FYYY.mpPPPPPPPPPGgPPPPPPPPPPm...",
  "FyYYWmpPPPPPPPPPPgPPPPPPPPPPm...",
  "FyyYYmpPPPkPPPPPPPPPPPPPkPPPm...",
  "FyYYYmpPkoeoPPPPPPPPPPPoeokPm...",
  "fyYPmSpPPPPPPPPPPPPPPPPPPPPPmP..",
  "fyPpmSpPPPPPPPPPPPPPPPPPPPmpPP..",
  "fmpPpSSpPPPPPPPPPPPPPPPPSpPpPm..",
  "fFmPjSSpPPPPPPPPPPPPPPPSSjPpm...",
  "qfFmjjSSpPPPPPPPPPPPPSSjj.jm....",
  "qfFFyFf.jSSpPPPPPPPPPpSSj.......",
  "qffFFFf...jSSpPPPPPPpSSj........",
  "qfffFFfF....SSSpPnnpSSS.........",
  ".qffffFFjSpPPpSpPnPpSpPPpSj.....",
  ".qqffffFjSppPPpSSSSSpPPppSj.....",
  "..qqfffFyjSspPPPpPPPPpSSj.......",
  "...qqffFFjSsppPPPPPPppSj........",
  "....qqqfffjSssppPPPpSsj.........",
  "......qqqqjjSssppppSsjj.........",
];

function fox(): FoxArt {
  const awake = art(FOX_AWAKE, FX);
  const sleep = art(FOX_SLEEP, FX);
  const breathe = art(FOX_SLEEP_BREATHE, FX);
  return {
    idle: [
      frame(awake, 1500),
      frame(art(FOX_BLINK, FX), 160),
      frame(awake, 700),
      frame(art(FOX_TAIL, FX), 300),
      frame(awake, 300),
      frame(art(FOX_TAIL, FX), 300),
    ],
    happy: [explode(art(FOX_HAPPY, FX), "pop", 13, 9, 240, 1), explode(art(FOX_HAPPY, FX), "fling", 13, 8, 460)],
    portrait: art(FOX_PORTRAIT, FX),
    poses: { sleep: [frame(sleep, 1400), frame(breathe, 1400)] },
  };
}

export const WHITE_FOX = fox();
