/**
 * The forest critters: the Chickaree and the crab redrawn, the Mossmote, the banana slug, the Fog Owl
 * and the Emberkit. Outlines are selective: the darkest shade of each local colour along the shadow
 * side and the ground, a lighter one (or none) where the light catches an edge.
 */

import { C, ix } from "../../engine/palette.ts";
import type { Sprite } from "../../engine/raster.ts";
import { art, chalk, edit, explode, type Frame, frame, type Legend, stamp } from "./kit.ts";

export interface CritterArt {
  idle: Frame[];
  happy: Frame[];
  portrait: Sprite;
  poses: Record<string, Frame[]>;
}

// ---------------------------------------------------------------------------------------------
// The Chickaree: a Douglas squirrel sitting up, hugging a sequoia cone. Dark olive-brown back, a
// rusty-orange front, the pale eye ring, and a plume of tail with a pale fringe curling over.

const SQ: Legend = {
  j: ix(C.FUR, 0),
  k: ix(C.FUR, 1),
  D: ix(C.FUR, 2),
  M: ix(C.FUR, 3),
  L: ix(C.FUR, 4),
  o: ix(C.FUR, 5),
  O: ix(C.FUR, 6),
  c: ix(C.FUR, 7),
  e: ix(C.INK, 0),
  w: ix(C.CREAM, 7),
  t: ix(C.CREAM, 1),
  T: ix(C.CREAM, 3),
  u: ix(C.CREAM, 5),
  q: ix(C.CONE, 1),
  n: ix(C.CONE, 3),
  N: ix(C.CONE, 5),
  h: ix(C.CONE, 7),
  r: ix(C.ROSE, 4),
  p: ix(C.INK, 2),
};

const SQ_IDLE = [
  "..........j.......",
  "..jjjj...jLjjj....",
  ".jTuuTj.jMLLLLj...",
  "jTMLLMTjjMLLcewj..",
  "jTMMLLMDjMLLLcLLLp",
  "jTDMMLMDjDMLrOOOj.",
  ".jTDMMDjjDMOOOOj..",
  "..jTDMDjjDMLOOOj..",
  "...jTDDjDMLOOOOj..",
  "...jTDjDMLLOqqOj..",
  "...jTDjDMLLqhNNqj.",
  "..jTDDjDMLchNNnqc.",
  "..jTDjDMLLqNhNnqj.",
  "..jTDjDMLOOqNnqOj.",
  "...jTjjDMLOOqqOj..",
  "...jjjDDMMLLLLj...",
  "......jjkjjjkjj...",
];

const SQ_BLINK = SQ_IDLE.map((r) => r.replace("cewj", "kkkj"));
/** Nibbling: the head dips to the cone, the muzzle at its tip. */
const SQ_NIBBLE = edit(SQ_IDLE, {
  0: "..................",
  1: "..jjjj....j.......",
  2: ".jTuuTj..jLjjj....",
  3: "jTMLLMTjjMLLLLj...",
  4: "jTMMLLMDjMLLcewj..",
  5: "jTDMMLMDjMLLLcLLLp",
  6: ".jTDMMDjjDMLrOOOj.",
  7: "..jTDMDjjDMOOOOj..",
});
/** The tail flicked: its curl lifts and opens. */
const SQ_FLICK = edit(SQ_IDLE, {
  0: "jjjj......j.......",
  1: "TuuTj....jLjjj....",
  2: "jMLuTj...MLLLLj...".replace("...M", ".jjM"),
  3: ".jTMLMTjjMLLcewj..",
});
/** Happy: cone tossed up, paws up, eyes shut in a grin. */
const SQ_HAPPY = edit(SQ_IDLE, {
  3: "jTMLLMTjjMLLkLkj..",
  5: "jTDMMLMDjDMLrOnOj.",
  8: "...jTDDjDMLOOOOjc.",
  9: "...jTDjDMLLOOOOjc.",
  10: "...jTDjDMLOOOOOj..",
  11: "..jTDDjDMLOOOOOj..",
  12: "..jTDjDMLOOOOOOj..",
  13: "..jTDjDMLOOOOOOOj.",
  14: "...jTjjDMLOOOOOj..",
});

/** Portrait: the Chickaree with its cone, eye ring and tail fringe. */
const SQ_PORTRAIT = [
  "................jkLj............",
  "..jjjjjj........jMLLjjjj........",
  "jjuuuuuujj....jjLLLLLLLLjj......",
  "jTTuuuuTTj....jMMLLLLLccccL.....",
  "TTTuuuuTTTj..jMMMLLLLLcwecLj....",
  "TuMLLLLMTTTjjjMMMLLLLLceeecj....",
  "TMMMLLLLMMTDDjMMMLMLLLcceecLj...",
  "TMMMLLLLMMMDDDMMMLLLLLccccLLLLLp",
  "TMMMMMLLLMMDDDMMLMLLLLLccLLLLLpp",
  "TDMMMLLLLMMDDDDDMMLLLLrOOOOOOjj.",
  "TTDDMMMLLMDDDDDMDMMLLrOOOOOOOj..",
  "TuDDMMMMMMDDDjDDDMMOOOOOOOOOOj..",
  "jTTTDDMMDDDDDjDDDMMOOOOOOOOOj...",
  "jjTTDDMMMDDDjDDLDMMLLOOOOOOOj...",
  "..jTTTDMMDMDjDDDMMLLLOOOOOOOj...",
  "..jTTTDDDDDDDDDDMMLLOOOOOOOOj...",
  "...juTTDDDDDDDMLLLLOOOOOOOOOj...",
  "...jTTTDDDDMDDMMLLLOOOOOOOOOj...",
  "...jTTTDDDDDDMMLLLLOOOqqqqOOOj..",
  "...jTTTDDDDDDMLLLLLqOqhNhNqOOj..",
  "..jTTTDDDMDDDMMLLLLqqhNnhNnqOqj.",
  "..juTTDDDDDDDMMLLLccqNhNnhNqOcc.",
  ".jTTTDDDDDDDMMLLLcLcqhNnhNnqccc.",
  ".jTTTDDDDDMDMMLLLOOOqNnhNnhqcLj.",
  ".jTTTDDDDDDMMLLLLOOOqnhNnhnqOqj.",
  ".jTuTDDDDDDMMLLOOOOOOqNnhnqOOOj.",
  "..jTTTDDDDDDMMLOOOOOOOqnnqOOOj..",
  "..jTTTTTjDDDMMLLOOOOoOOOOoOOjj..",
  "...jTTTTDDDDDMMMLLOOOooooOOj....",
  "...jTTTTDDDDDMMMLLLLLLLLLLOj....",
  "....jjjjDDDDDMMMMLLLLLLLLLj.....",
  "........jjDDDMMMMLLLLLLLLjj.....",
];

function chickaree(): CritterArt {
  const idle = art(SQ_IDLE, SQ);
  const happy = art(SQ_HAPPY, SQ);
  return {
    idle: [
      frame(idle, 1400),
      frame(art(SQ_BLINK, SQ), 130),
      frame(idle, 900),
      frame(art(SQ_NIBBLE, SQ), 220),
      frame(idle, 160),
      frame(art(SQ_NIBBLE, SQ), 220),
      frame(idle, 1100),
      frame(art(SQ_FLICK, SQ), 360),
    ],
    happy: [explode(happy, "pop", 11, 8, 220, 1), explode(happy, "fling", 11, 7, 420)],
    portrait: art(SQ_PORTRAIT, SQ),
    poses: {},
  };
}

export const CHICKAREE = chickaree();

// ---------------------------------------------------------------------------------------------
// The crab: the guild's bounty crab, who keeps the shop and lives in a colony by the pond. Eyes up
// on stalks, mitten claws, a carapace tall enough for a chalked number, a smile on its front rim.

const CR: Legend = {
  j: ix(C.CRAB, 0),
  k: ix(C.CRAB, 1),
  D: ix(C.CRAB, 2),
  M: ix(C.CRAB, 3),
  L: ix(C.CRAB, 4),
  l: ix(C.CRAB, 5),
  h: ix(C.CRAB, 6),
  H: ix(C.CRAB, 7),
  w: ix(C.CREAM, 7),
  e: ix(C.INK, 0),
  r: ix(C.ROSE, 4),
  x: ix(C.CREAM, 6),
  y: ix(C.CREAM, 3),
};

const CRAB_IDLE = [
  "......j.....j......",
  ".....jwj...jwj.....",
  ".....jej...jej.....",
  ".jj...k.....k...jj.",
  "jhlj..k.....k..jhlj",
  "jlLj.jjjjjjjjj.jlLj",
  ".jMjjhhllllllLLjMj.",
  "..jhhlllLLLLLLLMj..",
  ".jhlllLLLLLLLLLMMj.",
  ".jllLLLLLLLLLLLLMj.",
  ".jlLLLLLLLLLLLLMMj.",
  ".jLLrLLjLLLjLLrMDj.",
  "..jMLLLLjjjLLLMDj..",
  "...jjDDDDDDDDDjj...",
  ".j.j.j.......j.j.j.",
];

/** One claw up and open: a snap. */
const CRAB_SNAP = [
  "......j.....j......",
  "jj...jwj...jwj.....",
  "jhj..jej...jej.....",
  ".jlj..k.....k...jj.",
  ".jlj..k.....k..jhlj",
  "jlLj.jjjjjjjjj.jlLj",
  ".jMjjhhllllllLLjMj.",
  "..jhhlllLLLLLLLMj..",
  ".jhlllLLLLLLLLLMMj.",
  ".jllLLLLLLLLLLLLMj.",
  ".jlLLLLLLLLLLLLMMj.",
  ".jLLrLLjLLLjLLrMDj.",
  "..jMLLLLjjjLLLMDj..",
  "...jjDDDDDDDDDjj...",
  ".j.j.j.......j.j.j.",
];

/** Crab rave: claws up, mouth open, bouncing. */
const CRAB_RAVE_A = [
  ".jj...j.....j...jj.",
  "jhlj.jwj...jwj.jhlj",
  "jlLj.jej...jej.jlLj",
  ".jMj..k.....k..jMj.",
  "..jMj.k.....k.jMj..",
  "...jjjjjjjjjjjjj...",
  "...jhhlllllllLLj...",
  "..jhhlllLLLLLLLMj..",
  ".jhlllLLLLLLLLLMMj.",
  ".jllLLLLLLLLLLLLMj.",
  ".jlLLLLLLLLLLLLMMj.",
  ".jLLrLLjjjjjLLrMDj.",
  "..jMLLLLjrrjLLMDj..",
  "...jjDDDDDDDDDjj...",
  "..j.j.j.....j.j.j..",
];

/** The other beat: leaning, one eye squeezed shut. */
const CRAB_RAVE_B = [
  "jj...........j...jj",
  "hlj..j.....jwj..jhl",
  "lLj.jwj....jej..jlL",
  "jMj.jej.....k...jMj",
  ".jMj.k.....k...jMj.",
  "..jMjjjjjjjjjjjMj..",
  "...jhhlllllllLLj...",
  "..jhhlllLLLLLLLMj..",
  ".jhlllLLLLLLLLLMMj.",
  ".jllLLLLLLLLLLLLMj.",
  ".jlLLLLLLLLLLLLMMj.",
  ".jLLrLLjjjjjLLrMDj.",
  "..jMLLLLjrrjLLMDj..",
  "...jjDDDDDDDDDjj...",
  ".j.j.j.......j.j.j.",
];

const crabBlink = (rows: readonly string[]): string[] =>
  rows.map((r) => r.replaceAll("jwj", "jkj").replaceAll("jej", "jjj"));

/** A numbered crab: its number chalked on the carapace, centred, its top at row `top`. */
export function numberedRows(rows: readonly string[], n: number, top = 6, size: 1 | 2 = 1): string[] {
  const mark =
    size === 2 ? chalk(n).flatMap((r) => [r, r].map((line) => line.replaceAll(/./g, (c) => c + c))) : chalk(n);
  const w = mark[0]?.length ?? 3;
  return stamp(rows, mark, Math.floor(((rows[0]?.length ?? 19) - w) / 2), top);
}

/** Portrait: claws up, eyes up, room on the carapace for a number. */
const CRAB_PORTRAIT = [
  "................................",
  "................................",
  "..........jjj......jjj..........",
  ".........jwwHj....jwwHj.........",
  ".jj.jj...jweej....jweej...jj.jj.",
  "jhhjlhj..jweej....jweej..jhhjlhj",
  "jhllLlj...jjj......jjj...jhllLlj",
  "jhlLLLj...lk.......lk....jhlLLLj",
  "jlLLLMj...lk.......lk....jlLLLMj",
  ".jLLMDj...lk.......lk....jLLMDj.",
  "..jMMj....lk.......lk.....jMMj..",
  "...jMMj.jjjjjjjjjjjjjjjj.jMMj...",
  "....jMjjjhhhhllllllllLLjjjMj....",
  ".....jjhhhllllllllllLLLMMjj.....",
  ".....jhhllllllLLLLLLLLLLMMj.....",
  "....jhlllLLLLLLLLLLLLLLLMMMj....",
  "....jhllLLLLLLLLLLLLLLLLMMMj....",
  "...jhlLLLLLLLLLLLLLLLLLLLMMMj...",
  "...jhlLLLLLLLLLLLLLLLLLLLMMMj...",
  "..jlLLLLLLLLLLLLLLLLLLLLLLMMMj..",
  "..jlLLLLLLLLLLLLLLLLLLLLLLMMMj..",
  "..jLLLLLLLLLLLLLLLLLLLLLLLLMMj..",
  "..jLLrrLLLLLjLLLLLLjLLLLLrrMDj..",
  "..jMLrrLLLLLLjjjjjjLLLLLLrrMDj..",
  "...jMLLLLLLLLLLLLLLLLLLLLLDDj...",
  "....jMMLLLLLLLLLLLLLLLLLLDDj....",
  ".....jjMMMMLLLLLLLLLLMMDDjj.....",
  ".......jjjDDDDDDDDDDDDjjj.......",
  "......jj.jj..........jj.jj......",
  ".....jj.jj............jj.jj.....",
  ".....j..j..............j..j.....",
  "................................",
];

function crab(n: number | null): CritterArt {
  const dress = (rows: readonly string[]): string[] => (n === null ? [...rows] : numberedRows(rows, n));
  const idle = art(dress(CRAB_IDLE), CR);
  const raveA = art(dress(CRAB_RAVE_A), CR);
  const raveB = art(dress(CRAB_RAVE_B), CR);
  return {
    idle: [
      frame(idle, 1300),
      frame(art(dress(crabBlink(CRAB_IDLE)), CR), 120),
      frame(idle, 700),
      frame(art(dress(CRAB_SNAP), CR), 180),
      frame(idle, 160),
      frame(art(dress(CRAB_SNAP), CR), 180),
    ],
    happy: [explode(raveA, "pop", 9, 8, 220, 1), explode(raveB, "fling", 9, 7, 420)],
    portrait: art(n === null ? CRAB_PORTRAIT : numberedRows(CRAB_PORTRAIT, n, 12, 2), CR),
    poses: {
      rave: [frame(raveA, 200, 1), frame(raveB, 200), frame(raveA, 200, 1), frame(art(dress(CRAB_RAVE_B), CR), 200)],
    },
  };
}

export const CRAB = crab(null);
/** No. 08, whereabouts unknown. */
export const CRAB_NUMBERED = crab(8);

// ---------------------------------------------------------------------------------------------
// The Mossmote: a puff of moss that hops. Lit tufts along its crown instead of an outline, beady
// eyes, a blush.

const MO: Legend = {
  j: ix(C.LEAF, 0),
  k: ix(C.LEAF, 1),
  d: ix(C.LEAF, 2),
  m: ix(C.LEAF, 3),
  b: ix(C.LEAF, 4),
  l: ix(C.LEAF, 5),
  h: ix(C.LEAF, 6),
  H: ix(C.LEAF, 7),
  e: ix(C.INK, 0),
  w: ix(C.CREAM, 7),
  p: ix(C.ROSE, 4),
};

// ---------------------------------------------------------------------------------------------
// The banana slug: plump, muted ochre with a few dark spots, eyes up on stalks, and a leaf worn as a
// hat with its stem cocked back.

const SL: Legend = {
  j: ix(C.SHROOM, 0),
  k: ix(C.SHROOM, 1),
  d: ix(C.SHROOM, 2),
  m: ix(C.SHROOM, 3),
  b: ix(C.SHROOM, 4),
  l: ix(C.SHROOM, 5),
  h: ix(C.SHROOM, 6),
  s: ix(C.SHROOM, 1),
  e: ix(C.INK, 0),
  w: ix(C.CREAM, 7),
  n: ix(C.INK, 2),
  p: ix(C.ROSE, 4),
  r: ix(C.ROSE, 3),
  g: ix(C.LEAF, 2),
  f: ix(C.LEAF, 4),
  F: ix(C.LEAF, 5),
  G: ix(C.LEAF, 6),
};

// ---------------------------------------------------------------------------------------------
// The Fog Owl: round, pale and misty, with amber eyes that glow. Chevrons on its breast, a wisp of
// teal mist at its feet.

const OW: Legend = {
  j: ix(C.PEARL, 0),
  k: ix(C.PEARL, 2),
  d: ix(C.PEARL, 3),
  u: ix(C.PEARL, 3),
  s: ix(C.PEARL, 4),
  S: ix(C.PEARL, 5),
  p: ix(C.PEARL, 6),
  P: ix(C.PEARL, 7),
  a: ix(C.GLOW, 3),
  A: ix(C.GLOW, 5),
  e: ix(C.INK, 0),
  y: ix(C.GOLD, 4),
  t: ix(C.TEAL, 5),
  T: ix(C.TEAL, 6),
};

// ---------------------------------------------------------------------------------------------
// The Emberkit: a fox kit whose fur is warm redwood bark, ears and tail tipped with live embers.

const KI: Legend = {
  j: ix(C.CONE, 0),
  k: ix(C.CONE, 1),
  d: ix(C.CONE, 2),
  m: ix(C.CONE, 3),
  b: ix(C.CONE, 4),
  l: ix(C.CONE, 5),
  h: ix(C.CONE, 6),
  H: ix(C.CONE, 7),
  q: ix(C.CREAM, 2),
  c: ix(C.CREAM, 4),
  C: ix(C.CREAM, 6),
  e: ix(C.INK, 0),
  w: ix(C.CREAM, 7),
  n: ix(C.INK, 2),
  r: ix(C.ROSE, 4),
  f: ix(C.FIRE, 3),
  F: ix(C.FIRE, 5),
  G: ix(C.FIRE, 6),
  W: ix(C.FIRE, 7),
};

const MOSS_IDLE = [
  "...h..hl..h.",
  "..lhl.hhlhl.",
  ".khhllhlllbk",
  "khllllllllbj",
  "klbwlllbwlmj",
  "jbbebbbbebmj",
  "jbpbbmmbbpmj",
  "jdbbbmbbbmdj",
  ".jddmmmmddj.",
  "..jjjjjjjj..",
];

/** Gathering for the hop. */
const MOSS_SQUASH = [
  "...h..hl..h.",
  ".klhl.hhlhlk",
  "khhllhllllbj",
  "klbwlllbwlmj",
  "jbbebbbbebmj",
  "jbpbbmmbbpmj",
  "jddbbmbbmddj",
  "jjddmmmmddjj",
  ".jjjjjjjjjj.",
];

/** Up: a row taller and a pixel narrower. */
const MOSS_AIR = [
  "....h.hl.h..",
  "...lhlhhlhl.",
  "..khhllllbk.",
  ".khlllllllbj",
  ".klbwllbwlmj",
  ".jbbebbbebmj",
  ".jbpbbbbbpmj",
  ".jdbbbmbbmdj",
  ".jdbbmmbbmdj",
  "..jddmmmddj.",
  "...jjjjjjj..",
];

const MOSS_HAPPY = [
  "...h..hl..h.",
  "..lhl.hhlhl.",
  ".khhllhlllbk",
  "khllllllllbj",
  "klblelllelmj",
  "jbebebbebemj",
  "jbpbbeebbpmj",
  "jdbbbmbbbmdj",
  ".jddmmmmddj.",
  "..jjjjjjjj..",
];

const SLUG_IDLE = [
  "......g.....e..e..",
  "......gFFG..m..m..",
  ".....fFFFGG.m..m..",
  "......fffjjjjjjj..",
  "......jjjhhhhhllj.",
  "....jsbbbbbbbbbbmj",
  "..jjbbbbbbsbbbbpmj",
  ".jbbbbbbsbbbbbbbnj",
  "jbbbbbbbbbbbsbbmj.",
  "jllllllllllllllj..",
  "jjjjjjjjjjjjjjj...",
];

/** Gliding: the tail drawn out a pixel. */
const SLUG_STRETCH = [
  "......g.....e..e..",
  "......gFFG..m..m..",
  ".....fFFFGG.m..m..",
  "......fffjjjjjjj..",
  "......jjjhhhhhllj.",
  "....jsbbbbbbbbbbmj",
  ".jjjbbbbbbsbbbbpmj",
  "jbbbbbbbsbbbbbbbnj",
  "jbbbbbbbbbbbsbbmj.",
  "jllllllllllllllj..",
  "jjjjjjjjjjjjjjj...",
];

/** Eye stalks swung forward, curious. */
const SLUG_LOOK = [
  "......g......e..e.",
  "......gFFG...m.m..",
  ".....fFFFGG.m..m..",
  "......fffjjjjjjj..",
  "......jjjhhhhhllj.",
  "....jsbbbbbbbbbbmj",
  "..jjbbbbbbsbbbbpmj",
  ".jbbbbbbsbbbbbbbnj",
  "jbbbbbbbbbbbsbbmj.",
  "jllllllllllllllj..",
  "jjjjjjjjjjjjjjj...",
];

/** Eyes drawn in. */
const SLUG_BLINK = [
  "......g.....m..m..",
  "......gFFG..m..m..",
  ".....fFFFGG.m..m..",
  "......fffjjjjjjj..",
  "......jjjhhhhhllj.",
  "....jsbbbbbbbbbbmj",
  "..jjbbbbbbsbbbbpmj",
  ".jbbbbbbsbbbbbbbnj",
  "jbbbbbbbbbbbsbbmj.",
  "jllllllllllllllj..",
  "jjjjjjjjjjjjjjj...",
];

/** Mouth open, delighted. */
const SLUG_HAPPY = [
  "......g.....e..e..",
  "......gFFG..m..m..",
  ".....fFFFGG.m..m..",
  "......fffjjjjjjj..",
  "......jjjhhhhhllj.",
  "....jsbbbbbbbbbbmj",
  "..jjbbbbbbsbbbbpnj",
  ".jbbbbbbsbbbbbbbrj",
  "jbbbbbbbbbbbsbbmj.",
  "jllllllllllllllj..",
  "jjjjjjjjjjjjjjj...",
];

const OWL_IDLE = [
  "..k.......k..",
  "..ks.....sj..",
  "..kSkkkkksj..",
  ".kSSSSSSSssj.",
  ".kSpppSpppsj.",
  "kpaAapPpaAapj",
  "kpaeapypaeapj",
  "kSaaapypaaaSj",
  ".kSpppppppsj.",
  ".kdSsSsSsSdj.",
  ".kdsusssusdj.",
  ".jdssusssudj.",
  "..jdsssssdj..",
  "...jjyjyjj...",
];

const OWL_BLINK = [
  "..k.......k..",
  "..ks.....sj..",
  "..kSkkkkksj..",
  ".kSSSSSSSssj.",
  ".kSpppSpppsj.",
  "kpppppPpppppj",
  "kpddppypddppj",
  "kSppppypppSSj",
  ".kSpppppppsj.",
  ".kdSsSsSsSdj.",
  ".kdsusssusdj.",
  ".jdssusssudj.",
  "..jdsssssdj..",
  "...jjyjyjj...",
];

/** Both eyes slid to look the other way. */
const OWL_LOOK = [
  "..k.......k..",
  "..ks.....sj..",
  "..kSkkkkksj..",
  ".kSSSSSSSssj.",
  ".kSpppSpppsj.",
  "kpaAapPpaAapj",
  "kpeaapypeaapj",
  "kSaaapypaaaSj",
  ".kSpppppppsj.",
  ".kdSsSsSsSdj.",
  ".kdsusssusdj.",
  ".jdssusssudj.",
  "..jdsssssdj..",
  "...jjyjyjj...",
];

const OWL_HAPPY = [
  "..k.......k..",
  "..ks.....sj..",
  "..kSkkkkksj..",
  ".kSSSSSSSssj.",
  ".kSpppSpppsj.",
  "kpPaPpPpPaPpj",
  "kpapapypapapj",
  "kSppppypppSSj",
  ".kSpppppppsj.",
  ".kdSsSsSsSdj.",
  ".kdsusssusdj.",
  ".jdssusssudj.",
  "..jdsssssdj..",
  "...jjyjyjj...",
];

/** A wisp of morning mist drifting at its feet. */
const OWL_MIST = ["tt......Tt..."];

const KIT_IDLE = [
  "..G.........G.G....",
  ".GFG.......jFjFj...",
  ".fFf.......jfjfj...",
  "jmlhj.....jbhlhbj..",
  "jmbhlj....jhllelhj.",
  "jdmblj....jlllCCCCn",
  ".jdbbj....jbcCCCCj.",
  "..jdbjjjjjjhccccj..",
  "...jdlhhllllbcCcj..",
  "...jlhlmllmlbcCcj..",
  "...jbllbbbbbbcccj..",
  "...jdbbmbbbmbbccj..",
  "....jdbdddddddbj...",
  "....jbj.....jbj....",
  "....jjj.....jjj....",
];

/** The ember at the tail's tip flares. */
const KIT_TAIL = [
  ".G..........G.G....",
  ".FGG.......jFjFj...",
  ".fFf.......jfjfj...",
  "jmlhj.....jbhlhbj..",
  "jmbhlj....jhllelhj.",
  "jdmblj....jlllCCCCn",
  ".jdbbj....jbcCCCCj.",
  "..jdbjjjjjjhccccj..",
  "...jdlhhllllbcCcj..",
  "...jlhlmllmlbcCcj..",
  "...jbllbbbbbbcccj..",
  "...jdbbmbbbmbbccj..",
  "....jdbdddddddbj...",
  "....jbj.....jbj....",
  "....jjj.....jjj....",
];

/** An ear flicked back. */
const KIT_EAR = [
  "..G..........G.G...",
  ".GFG.......jFjjFj..",
  ".fFf.......jfj.fj..",
  "jmlhj.....jbhlhbj..",
  "jmbhlj....jhllelhj.",
  "jdmblj....jlllCCCCn",
  ".jdbbj....jbcCCCCj.",
  "..jdbjjjjjjhccccj..",
  "...jdlhhllllbcCcj..",
  "...jlhlmllmlbcCcj..",
  "...jbllbbbbbbcccj..",
  "...jdbbmbbbmbbccj..",
  "....jdbdddddddbj...",
  "....jbj.....jbj....",
  "....jjj.....jjj....",
];

const KIT_HAPPY = [
  "..G.........G.G....",
  ".GFG.......jFjFj...",
  ".fFf.......jfjfj...",
  "jmlhj.....jbhlhbj..",
  "jmbhlj....jhllkhhj.",
  "jdmblj....jlllCCCCn",
  ".jdbbj....jbcCrCCj.",
  "..jdbjjjjjjhccccj..",
  "...jdlhhllllbcCcj..",
  "...jlhlmllmlbcCcj..",
  "...jbllbbbbbbcccj..",
  "...jdbbmbbbmbbccj..",
  "....jdbdddddddbj...",
  "....jbj.....jbj....",
  "....jjj.....jjj....",
];

/** Portrait: the Mossmote, a tuft or two higher than the rest. */
const MOSS_PORTRAIT = [
  "................................",
  "................................",
  "................................",
  "................................",
  "................................",
  "................................",
  "................................",
  "................................",
  "................................",
  "..........hh.....hl.....hh......",
  "..........hh....hhhlHh.hhh......",
  ".........lhhl...hhhhlHhhhl......",
  "........lhhhlll.hhhhllhhll......",
  ".......khhhhllllhhhllllllbk.....",
  ".....kkhhhhlllllhhllllllbbbk....",
  ".....khhhlllllllllllllllbbbj....",
  "....klhlllllllllllllllllbbbj....",
  "....klllllllllllllllllllmmmj....",
  "....kllbbbwebllllbbbweblmmmj....",
  "....jbbbbbeebbbbbbbbeebbmmmj....",
  "....jbbbbbeebbbbbbbbeebbmmmj....",
  "....jbbbppbbbbbmmmbbbbbpmmmj....",
  "....jbbbppbbbbmmmmbbbbpmmmmj....",
  "....jbdbbbbbbbmmbbbbbbmmmdmj....",
  ".....jdddbbbbmmmbbbbbbmdddj.....",
  ".....jjdddddmmmmmmmmdddddjj.....",
  ".......jddddmmmmmmmmddddj.......",
  ".......jjdddmmmmmmmmdddjj.......",
  ".........jjjjjjjjjjjjjj.........",
  "................................",
  "................................",
  "................................",
];

/** Portrait: the slug's front half, leaf hat on, eyes up. */
const SLUG_PORTRAIT = [
  "................................",
  "................................",
  "................................",
  "................................",
  ".......g............we..we......",
  "........g...........ee..ee......",
  ".........FFFGGG.....mm..mm......",
  "........FFFFgGGGG...mm..mm......",
  "......ffFFFFFgGGGG..mm..mm......",
  "......fffFFFFFgGGG..mm..mm......",
  ".......fffffffff....mm..mm......",
  "........ffffffff....mm..mm......",
  ".....jjjhhhhllllllllllhhmj......",
  "...jjbbbhhhllllllllllhhhhmj.....",
  ".jjbbbbblllllllllllllhhhhhmj....",
  "jbbbbbbbblllllllllllhhhhhhmj....",
  "jbbbbbssbbbbbbbbbbbbppbbbbmj....",
  "jbbbbbssbbbbbbbbbbbbppbnbnmj....",
  "jbbbbbbbbbbbssbbbbbbbbbbnbmj....",
  "jbbbbbbbbbbbssbbbbbbbbbbbmj.....",
  "jbssbbbbbbbbbbbbbbbbbbbmjj......",
  "jbssbbbbbbbbbbbbbbbbbmj.........",
  "jlllllllllllllllllllbjj.........",
  "jlllllllllllllllllllj...........",
  "jlllllllllllllllllljj...........",
  "jjjjjjjjjjjjjjjjjjj.............",
  "................................",
  "................................",
  "................................",
  "................................",
  "................................",
  "................................",
];

/** Portrait: the Fog Owl, amber eyes aglow, mist curling at its feet. */
const OWL_PORTRAIT = [
  "................................",
  "................................",
  "................................",
  "........k..............j........",
  ".......kk..............kj.......",
  ".......kss............ssj.......",
  ".......ksss..........sssj.......",
  ".......kSSSkkkkkkkkkksssj.......",
  "......kSSSSSSSSSSSSSsssssj......",
  "......kSSSSSSSSSSSSSSssssj......",
  ".....kSSSSSSSSSSSSSSSsssssj.....",
  ".....kSSSSppppSSSSppppssssj.....",
  "....kpSSSppppppSSppppppssspj....",
  "....kpppaAAapppPPpppaAAapppj....",
  "...kpppaAAAAappPPppaAAAAapppj...",
  "...kpppaAPeAappyyppaAPeAapppj...",
  "...kpppaAeeAappyyppaAeeAapppj...",
  "...kSSSaAAAAapppyppaAAAAaSSSj...",
  "....kSSpaaaappppppppaaaapSSj....",
  "....kSSSSppppppppppppppsssSj....",
  ".....kSSSSpppppppppppppsssj.....",
  ".....kddSSSssSSssSSssSSdddj.....",
  ".....kdddSusuSSssSSusuSdddj.....",
  ".....kdddssussssssssussdddj.....",
  ".....kdddsssssusussssssdddj.....",
  ".....jdddssssssusssssusuddj.....",
  "......jdddsusussssssssuddj......",
  "......jjddssussssssssdddjj......",
  ".tTT....jddssssssssssddj..tt....",
  "T..tt...jjsssyyssyysssjj.T..TT..",
  "..tt......jjjyyjjyyjjj......Tt..",
  "................................",
];

/** Portrait: the Emberkit face on, ember-tipped ears, the torch of its tail curled up beside it. */
const KIT_PORTRAIT = [
  "................................",
  ".......G................G.......",
  "......jGj..............jGj......",
  "......jFFj............jFFj......",
  ".....jfddj............jddfj.....",
  ".....jbddbj..........jbddbj.....",
  "....jhbddbj..........jbddbmj....",
  "....jhbbddbj........jbddbbmj....",
  "........jjjjjjjjjjjjjjjj........",
  "......jjhlllllllmllllllbjj......",
  "..G..jhhllllllmlllmlllllbbj.....",
  ".GFG.jhhlllllmlllmllllllbbj.....",
  "FGWGFhhhlllllllmllllllllbbbj....",
  "fFGFfhhhllllllllllllllllmmmj....",
  ".fFfjhhhjeejlllllllljeejmmmj....",
  "jhlbjhhjweeejlllllljweeejmmj....",
  "jhlljccjeeeejlllllljeeeejccj....",
  "jhlljccjeeewjlllllljeeewjccj....",
  "jhhljcrcjeejCCCCCCCCjeejcrcj....",
  "jhhlljcccccCCCCnnCCCCcccccj.....",
  "jhhlljlccccccCCnnCCccccccmj.....",
  "jhhllljlqcCCCCnCCnCCCCcqmj......",
  ".jhhllljjqcCCCCCCCCCCcqjj.......",
  ".jhhlllbjjqqcCCCCCcqqjj.........",
  ".jhhlllbjjjjqqqqqqqjjjj.........",
  "..jhhllbjhhlCCCCCCCClmmj........",
  "..jhhllbjhhCCCCCCCCCCmmj........",
  "...jhlljhhlcCCCCCCCCclmmj.......",
  "....jjjjhhlcCCCCCCCCclmmj.......",
  ".......jhhllcCCCCCCcllmmj.......",
  ".......jhhllccCCCCccllmmj.......",
  ".......jjjjjjccccccjjjjjj.......",
];

function mossmote(): CritterArt {
  const idle = art(MOSS_IDLE, MO);
  const squash = art(MOSS_SQUASH, MO);
  const air = art(MOSS_AIR, MO);
  const happy = art(MOSS_HAPPY, MO);
  return {
    idle: [
      frame(idle, 900),
      frame(squash, 140),
      frame(air, 150, 3),
      frame(air, 130, 4),
      frame(air, 110, 2),
      frame(squash, 150),
    ],
    happy: [explode(happy, "pop", 6, 5, 220, 2), explode(happy, "fling", 6, 4, 420)],
    portrait: art(MOSS_PORTRAIT, MO),
    poses: {},
  };
}

function slug(): CritterArt {
  const idle = art(SLUG_IDLE, SL);
  return {
    idle: [
      frame(idle, 1100),
      frame(art(SLUG_STRETCH, SL), 500),
      frame(idle, 700),
      frame(art(SLUG_LOOK, SL), 900),
      frame(idle, 500),
      frame(art(SLUG_BLINK, SL), 160),
    ],
    happy: [explode(art(SLUG_HAPPY, SL), "pop", 10, 5, 220, 1), explode(art(SLUG_HAPPY, SL), "fling", 10, 4, 420)],
    portrait: art(SLUG_PORTRAIT, SL),
    poses: {},
  };
}

function fogOwl(): CritterArt {
  const withMist = (rows: readonly string[], dx: number): Sprite =>
    art(stamp([...rows, ".".repeat(13)], [shift(OWL_MIST[0] ?? "", dx)], 0, rows.length - 1), OW);
  return {
    idle: [
      frame(withMist(OWL_IDLE, 0), 1200),
      frame(withMist(OWL_BLINK, 0), 140),
      frame(withMist(OWL_IDLE, 1), 900),
      frame(withMist(OWL_LOOK, 1), 1100),
    ],
    happy: [explode(art(OWL_HAPPY, OW), "pop", 6, 6, 220, 1), explode(art(OWL_HAPPY, OW), "fling", 6, 5, 420)],
    portrait: art(OWL_PORTRAIT, OW),
    poses: {},
  };
}

/** A row slid sideways, wrapping, for mist that drifts. */
function shift(row: string, dx: number): string {
  const n = row.length;
  const k = ((dx % n) + n) % n;
  return row.slice(n - k) + row.slice(0, n - k);
}

function emberkit(): CritterArt {
  const idle = art(KIT_IDLE, KI);
  return {
    idle: [
      frame(idle, 1000),
      frame(art(KIT_TAIL, KI), 180),
      frame(idle, 900),
      frame(art(KIT_EAR, KI), 200),
      frame(idle, 300),
      frame(art(KIT_TAIL, KI), 180),
    ],
    happy: [explode(art(KIT_HAPPY, KI), "pop", 9, 7, 220, 2), explode(art(KIT_HAPPY, KI), "fling", 9, 6, 420)],
    portrait: art(KIT_PORTRAIT, KI),
    poses: {},
  };
}

export const MOSSMOTE = mossmote();
export const SLUG = slug();
export const FOG_OWL = fogOwl();
export const EMBERKIT = emberkit();
