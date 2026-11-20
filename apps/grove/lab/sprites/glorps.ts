/**
 * Glorps: the guild's own speechless blob-cats, the common line. One body in seven colours, one per
 * vowel, as the members once lined theirs up like a rainbow. Round, gooey, a little dim: two nub
 * ears, wide eyes, a mouth too small for the situation. Each has one small thing of its own so the
 * seven tell apart without colour.
 *
 * Letters in every glorp legend: `j k` outline (darkest, then lit edge), `d m b l h` shadow to
 * highlight, `w` gloss, `e` eye, `p` blush, `n` mouth. Props add their own.
 */

import { ix, R } from "../pixel/palette.ts";
import type { Sprite } from "../pixel/raster.ts";
import { art, explode, type Frame, frame, type Legend, stamp } from "./kit.ts";
import { C } from "./palette-cast.ts";

interface Tone {
  ramp: number;
  /** Levels for j k d m b l h. */
  levels: readonly [number, number, number, number, number, number, number];
  blush: number;
}

const TONES = {
  glarp: { ramp: R.ROSE, levels: [0, 1, 2, 2, 3, 4, 5], blush: ix(R.CRAB, 4) },
  glerp: { ramp: R.CRAB, levels: [0, 1, 3, 4, 5, 6, 7], blush: ix(R.ROSE, 3) },
  glirp: { ramp: C.GOLD, levels: [1, 2, 3, 4, 5, 6, 7], blush: ix(R.CRAB, 5) },
  glorp: { ramp: C.SAGE, levels: [0, 1, 3, 4, 5, 6, 7], blush: ix(R.ROSE, 4) },
  glurp: { ramp: C.TEAL, levels: [0, 1, 3, 4, 5, 6, 7], blush: ix(R.ROSE, 4) },
  glyrp: { ramp: R.WATER, levels: [0, 0, 1, 2, 3, 4, 5], blush: ix(R.ROSE, 4) },
  gleep: { ramp: C.VIOLET, levels: [0, 1, 3, 4, 5, 6, 7], blush: ix(R.ROSE, 4) },
} as const satisfies Record<string, Tone>;

export type GlorpId = keyof typeof TONES;

function legend(t: Tone): Legend {
  const [j, k, d, m, b, l, h] = t.levels;
  return {
    j: ix(t.ramp, j),
    k: ix(t.ramp, k),
    d: ix(t.ramp, d),
    m: ix(t.ramp, m),
    b: ix(t.ramp, b),
    l: ix(t.ramp, l),
    h: ix(t.ramp, h),
    w: ix(R.CREAM, 7),
    e: ix(R.INK, 0),
    n: ix(R.INK, 2),
    p: t.blush,
    // Props: leaf, petals, sprout, bubble, cap, star.
    f: ix(C.LEAF, 4),
    F: ix(C.LEAF, 6),
    q: ix(R.ROSE, 5),
    Q: ix(R.ROSE, 7),
    y: ix(C.GOLD, 6),
    t: ix(R.ROSE, 3),
    T: ix(R.ROSE, 4),
    o: ix(C.PEARL, 6),
    O: ix(C.PEARL, 7),
    u: ix(C.PEARL, 4),
    s: ix(C.PEARL, 5),
    S: ix(C.PEARL, 7),
    g: ix(R.GLOW, 6),
  };
}

// ---------------------------------------------------------------------------------------------
// Glade size: 15 wide, 13 tall. A gumdrop: narrow at the crown, spread where it sits.

const BODY = [
  "...k.......k...",
  "..khk.....kmj..",
  "..klhkkkkkbmj..",
  ".klhwlbbbbbbmj.",
  ".khlbbbbbbbbmj.",
  "khlbbbbbbbbbbmj",
  "klbbwebbbwebbmj",
  "kbbbeebbbeebbdj",
  "kbbpbbbnbbbpbdj",
  "jmbbbbbbbbbbmdj",
  "jdmlbbbbbbbmmdj",
  ".jddmmmmmmmddj.",
  "..jjjjjjjjjjj..",
];

/** The bob: a row lower, spread to the edges at the base. */
const SQUASH = [
  "...k.......k...",
  "..khk.....kmj..",
  "..klhkkkkkbmj..",
  ".klhwlbbbbbbmj.",
  "khlbbbbbbbbbbmj",
  "klbbwebbbwebbmj",
  "kbbbeebbbeebbdj",
  "kbbpbbbnbbbpbdj",
  "jmbbbbbbbbbbmdj",
  "jdmlbbbbbbbmmdj",
  "jjddmmmmmmmddjj",
  ".jjjjjjjjjjjjj.",
];

/** Eyes shut: the catchlight row goes to body, the lower row stays as the closed line. */
const blink = (rows: readonly string[]): string[] => rows.map((r) => r.replace("bwebbbweb", "bbbbbbbbb"));

/** Happy: stretched a row taller, ears perked, eyes squeezed into arcs, mouth open. */
const HAPPY = [
  "...k.......k...",
  "..khk.....kmj..",
  "..klk.....kbj..",
  "..klhkkkkkbmj..",
  ".klhwlbbbbbbmj.",
  ".khlbbbbbbbbmj.",
  "khlbbebbbebbbmj",
  "klbbebebebebbmj",
  "kbbpbbnnnbbpbdj",
  "kbbbbbbtbbbbbdj",
  "jmbbbbbbbbbbmdj",
  "jdmlbbbbbbbmmdj",
  ".jddmmmmmmmddj.",
  "..jjjjjjjjjjj..",
];

// ---------------------------------------------------------------------------------------------
// The props: overlays stamped onto each pose relative to its crown (the ear tips' row), eyes (the
// catchlight row) and mouth rows, so one prop fits the body, the squash and the happy pose. "." in an
// overlay leaves the pose's pixel.

interface Pose {
  rows: readonly string[];
  eyes: number;
  mouth: number;
  happy: boolean;
}

interface Overlay {
  at: "crown" | "eyes" | "mouth";
  /** Rows above (negative) or below the anchor row. */
  dy: number;
  rows: readonly string[];
  /** Left out of the happy pose, whose face is its own. */
  calm?: boolean;
}

/** Glarp: a pale blossom tucked behind its left ear. */
const GLARP: Overlay[] = [{ at: "crown", dy: -2, rows: ["..q", ".qyQ", "..Q"] }];
/** Glerp: a blep, the tongue just out. */
const GLERP: Overlay[] = [{ at: "mouth", dy: 0, rows: ["......nnn", "......TT", "......tT"], calm: true }];
/** Glirp: a seedling on its crown, two leaves. */
const GLIRP: Overlay[] = [{ at: "crown", dy: -2, rows: [".....FF.ff", "......Fff", ".......f", ".......f"] }];
/** Glorp: the stare. Whites showing, pupils too small and pointing apart. */
const GLORP: Overlay[] = [{ at: "eyes", dy: 0, rows: ["....ww...ww", "....we...ew"], calm: true }];
/** Glurp: a bubble rising off its crown. */
const GLURP: Overlay[] = [{ at: "crown", dy: -4, rows: ["......sS", ".....s..u", ".....s..u...S", "......uu"] }];
/** Glyrp: content. Eyes shut, a cat's mouth. */
const GLYRP: Overlay[] = [
  { at: "eyes", dy: 0, rows: ["....bb...bb"], calm: true },
  { at: "mouth", dy: 0, rows: [".....n.n.n", "......n.n"], calm: true },
];
/** Gleep: a nightcap flopped over its ears, a star on the tip, eyes heavy. */
const GLEEP: Overlay[] = [
  { at: "crown", dy: -2, rows: ["......usSS", "....ussssSS", "...usssssssSg", "..ussssssssSSg", "..uuuuuuuuuuuj"] },
  { at: "eyes", dy: 0, rows: ["....kk...kk"], calm: true },
];

const PROPS: Record<GlorpId, readonly Overlay[]> = {
  glarp: GLARP,
  glerp: GLERP,
  glirp: GLIRP,
  glorp: GLORP,
  glurp: GLURP,
  glyrp: GLYRP,
  gleep: GLEEP,
};

/** A pose with its prop: rows added on top for anything that rises above the ears, then stamped. */
function dressed(pose: Pose, overlays: readonly Overlay[]): string[] {
  const rise = Math.max(0, ...overlays.filter((o) => o.at === "crown").map((o) => -o.dy));
  const blank = ".".repeat(pose.rows[0]?.length ?? 0);
  let rows = [...Array.from({ length: rise }, () => blank), ...pose.rows];
  for (const o of overlays) {
    if (o.calm && pose.happy) continue;
    const anchor = o.at === "crown" ? 0 : o.at === "eyes" ? pose.eyes : pose.mouth;
    rows = stamp(rows, o.rows, 0, rise + anchor + o.dy);
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Portrait, 32 by 32: the same glorp large, for cards, tooltips and the spirit book.

const PORTRAIT = [
  "................................",
  "................................",
  "................................",
  ".......k................k.......",
  "......khk..............kmj......",
  "......klmk............kmbj......",
  ".....klbmbk..........kbmbdj.....",
  ".....kbbbbbkkkkkkkkkkbbbbbj.....",
  ".....klhhlbbbbbbbbbbbbbbmdj.....",
  "....klhwwhbbbbbbbbbbbbbbbmdj....",
  "....khwhbbbbbbbbbbbbbbbbbmdj....",
  "...klhbbbbbbbbbbbbbbbbbbbbmdj...",
  "...klbbbbbbbbbbbbbbbbbbbbbmdj...",
  "...klbbbbbbbbbbbbbbbbbbbbbmdj...",
  "..kbbbbbbbbbbbbbbbbbbbbbbbbmdj..",
  "..kbbbbbbweebbbbbbbbweebbbbmdj..",
  "..kbbbbbbeeebbbbbbbbeeebbbmmdj..",
  "..kbbbbbbeeebbbbbbbbeeebbbmmdj..",
  "..kbbbbbbbeebbbbbbbbbeebbbmmdj..",
  "..kbbbppbbbbbbbbbbbbbbbbppmmdj..",
  "..jbbbbbbbbbbbbnnbbbbbbbbmmmdj..",
  "..jbbbbbbbbbbbbbbbbbbbbbbmmddj..",
  "..jbbbbbbbbbbbbbbbbbbbbbmmmddj..",
  "..jbbbbbbbbbbbbbbbbbbbbmmmmddj..",
  "..jmbbbbbbbbbbbbbbbbbbmmmmdddj..",
  "..jmmbbbbbbbbbbbbbbbmmmmmmdddj..",
  "...jdmlllbbbbbbbbbmmmmmmmdddj...",
  "...jddmmlllllbbbmmmmmmmmddddj...",
  "....jjddddmmmmmmmmmmddddddjj....",
  "......jjjjjjjjjjjjjjjjjjjj......",
  "................................",
  "................................",
];

/**
 * Each glorp's own thing at portrait size: stamps at (x, y) over the portrait. Eyes sit in rows 15
 * to 18 (columns 9 to 11 and 20 to 22), the mouth at row 20, the crown's top edge at row 7.
 */
const PORTRAIT_PROPS: Record<GlorpId, readonly (readonly [number, number, readonly string[]])[]> = {
  glarp: [[1, 1, [".qQ..", "qQQqQ", ".qyQq", "qQqQ.", ".q..."]]],
  glerp: [[15, 20, ["nn", "TT", "tT"]]],
  glirp: [
    [11, 0, ["......fF.", "..FFf.fFFF", ".FFFFf.FFf", "..ffFf.f..", "....f.f..."]],
    [15, 4, ["f", "f", "f"]],
  ],
  glorp: [
    [8, 15, ["wwww", "wwww", "wwew", "wwee"]],
    [20, 15, ["wwww", "wwww", "weww", "eeww"]],
    [15, 20, ["nn", "nn"]],
  ],
  glurp: [
    [21, 0, ["..sSS.", ".s...S", "s....u", "s....u", ".u..u.", "..uu.."]],
    [18, 5, [".S", "su"]],
    [15, 20, ["nn", "nn"]],
  ],
  glyrp: [
    [9, 15, ["bbb", "bbb", "ebe", "beb"]],
    [20, 15, ["bbb", "bbb", "ebe", "beb"]],
    [13, 20, ["n.nn.n", ".n..n."]],
  ],
  gleep: [
    [
      6,
      2,
      [
        "............uussS",
        "........uusssssSSS",
        ".....uussssssssSSSg",
        "...ussssssssssssSSgg",
        "..usssssssssssssSSSg",
        ".usssssssssssssssSS.",
        "uuuuuuuuuuuuuuuuuuj.",
      ],
    ],
    [9, 15, ["kkk", "bbb"]],
    [20, 15, ["kkk", "bbb"]],
  ],
};

// ---------------------------------------------------------------------------------------------

export interface GlorpArt {
  idle: Frame[];
  happy: Frame[];
  portrait: Sprite;
}

function build(id: GlorpId): GlorpArt {
  const lg = legend(TONES[id]);
  const prop = PROPS[id];
  const body = dressed({ rows: BODY, eyes: 6, mouth: 8, happy: false }, prop);
  const squash = dressed({ rows: SQUASH, eyes: 5, mouth: 7, happy: false }, prop);
  const happy = dressed({ rows: HAPPY, eyes: 6, mouth: 8, happy: true }, prop);
  const rise = body.length - BODY.length;
  const idle = art(body, lg);
  const shut = art(id === "glyrp" ? body : blink(body), lg);
  const happyS = art(happy, lg);
  return {
    idle: [frame(idle, 900), frame(art(squash, lg), 260), frame(idle, 1300), frame(shut, 140)],
    happy: [explode(happyS, "pop", 7, 8 + rise, 220, 1), explode(happyS, "fling", 7, 7 + rise, 420)],
    portrait: art(
      PORTRAIT_PROPS[id].reduce<string[]>((rows, [x, y, add]) => stamp(rows, add, x, y), [...PORTRAIT]),
      lg,
    ),
  };
}

export const GLORP_IDS: readonly GlorpId[] = ["glarp", "glerp", "glirp", "glorp", "glurp", "glyrp", "gleep"];

export const GLORPS: Record<GlorpId, GlorpArt> = {
  glarp: build("glarp"),
  glerp: build("glerp"),
  glirp: build("glirp"),
  glorp: build("glorp"),
  glurp: build("glurp"),
  glyrp: build("glyrp"),
  gleep: build("gleep"),
};
