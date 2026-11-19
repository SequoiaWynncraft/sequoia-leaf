import { blank, recolor, type Sprite, sprite, stamp } from "./sprite.ts";

// A Sequoia grown as a formal upright bonsai: a straight, red, fibrous trunk
// that runs all the way to the tip, flaring into the soil, with needles
// gathered in pads that narrow towards the top into the tall cone a giant
// sequoia has. Branches carry each pad back to the trunk. Light comes from the
// upper left. Every pad is drawn by hand, each a different shape, and placed by
// hand.

const PAD_A = sprite([
  ".......gggg....ggg.........",
  ".....ggHHhhg.ggHhhgg.......",
  "....gHhhhhFFgHhhhFFFgggg...",
  "..ggHhhFFFFFhhhFFFFFFhhFgg.",
  ".gHhhFFFFFFFFFFFFfFFFFFFFGg",
  "gFhFFFFFfFFFFFFFffffFFffGGg",
  "gfFFFfffffffffffffffffGGGGg",
  ".gGffffGGGGffffGGGGGGGGGgg.",
  "..ggGGGGgggGGGGGggggGGgg...",
  "....gggg...ggggg....gg.....",
]);

const PAD_B = sprite([
  "....ggg..gggg.........",
  "..ggHhhggHHhhgg.ggg...",
  ".gHhhhFFhhhhFFFgHhFg..",
  "gHhhFFFFFFFFFFFhhFFFg.",
  "gFFFFFfFFFFFffFFFFfFGg",
  "gfFffffffffffffffGGGGg",
  ".gGGfffGGGGffGGGGGGgg.",
  "..ggGGGgggGGGGgggggg..",
  "....ggg...gggg........",
]);

const PAD_C = sprite([
  "......ggg..gg.....",
  "...gggHhhggHhg....",
  "..gHhhhhFFhhFFgg..",
  ".gHhhFFFFFFFFFFFgg",
  "gFhFFFFfFFFfFFFFGg",
  "gfFfffffffffffGGGg",
  ".gGGffGGGGfGGGGgg.",
  "..gggGGgggGGggg...",
  ".....ggg...gg.....",
]);

const PAD_D = sprite([
  "....ggg.gg....",
  "..ggHhhgHhgg..",
  ".gHhhFFhhFFFg.",
  "gHhFFFFFFFfFGg",
  "gFFfffFFfffGGg",
  ".gGGfGGGGGGgg.",
  "..gggggggg....",
]);

const PAD_E = sprite(["...ggg....", ".ggHhhgg..", "gHhhFFFFg.", "gFFFFfFGGg", ".gfffGGgg.", "..gggg...."]);

const TIP = sprite(["..gg..", ".gHhg.", "gHhFFg", "gFfFGg", ".gGGg.", "..gg.."]);

/** Pads further back are in shade, which gives the crown depth. */
const shaded = (pad: Sprite): Sprite => recolor(pad, { H: "h", h: "F", F: "f", f: "G", G: "g" });

/** A shallow glazed bonsai pot with moss on the soil and little feet. */
const POT = sprite([
  "....MnMnMMnMmMnMMnMmMMnMnMM....",
  "..ommmmmmmmmmmmmmmmmmmmmmmmmo..",
  ".oQQqqqqqqqqqqqqqqqqqqqqqqqqPo.",
  "oQqPPPPPPPPPPPPPPPPPPPPPPPPPPpo",
  "oqPPPPPPPPPPPPPPPPPPPPPPPPPPPpo",
  ".oqPPPPPPPPPPPPPPPPPPPPPPPPppo.",
  ".oPPPPPPPPPPPPPPPPPPPPPPPPPppo.",
  "..opppppppppppppppppppppppppo..",
  "...ooooooooooooooooooooooooo...",
  "...oo.oo...............oo.oo...",
]);

/**
 * A straight trunk centred at `cx` from `top` to `bottom`, tapering from
 * `topWidth` to `baseWidth`, with the last rows flaring into the soil. The left
 * edge catches the light, fibrous grooves run down it, the right side is in shade.
 */
function trunk(
  canvas: readonly [number, number],
  cx: number,
  top: number,
  bottom: number,
  topWidth: number,
  baseWidth: number,
  flare: number,
): Sprite {
  const [width, height] = canvas;
  const rows: string[] = Array.from({ length: height }, () => ".".repeat(width));
  for (let y = top; y <= bottom; y += 1) {
    const t = (y - top) / Math.max(1, bottom - top);
    const fromBase = bottom - y;
    const span = Math.round(topWidth + (baseWidth - topWidth) * t) + Math.max(0, flare - fromBase) * 2;
    const left = cx - Math.floor(span / 2);
    const row = (rows[y] ?? "").split("");
    for (let i = 0; i < span; i += 1) {
      const x = left + i;
      // Deep vertical furrows, broken here and there, like a sequoia's fibrous bark.
      const groove = (x - left) % 3 === 2 && (x * 5 + y) % 9 !== 0;
      row[x] =
        span <= 2
          ? i === 0
            ? "r"
            : "B"
          : i === 0 || i === span - 1
            ? "o"
            : i === 1
              ? "R"
              : i === span - 2
                ? "b"
                : i === 2 && span > 5
                  ? "r"
                  : groove
                    ? "b"
                    : "B";
    }
    rows[y] = row.join("");
  }
  return sprite(rows);
}

/** A branch from the trunk out to a pad: a short bark line, dark below and lit on top. */
function branch(base: Sprite, from: readonly [number, number], to: readonly [number, number]): Sprite {
  const [x0, y0] = from;
  const [x1, y1] = to;
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  const line: string[] = Array.from({ length: base.height }, () => ".".repeat(base.width));
  const put = (x: number, y: number, key: string) => {
    const row = (line[y] ?? "").split("");
    if (row[x] === ".") {
      row[x] = key;
    }
    line[y] = row.join("");
  };
  for (let i = 0; i <= steps; i += 1) {
    const x = Math.round(x0 + ((x1 - x0) * i) / steps);
    const y = Math.round(y0 + ((y1 - y0) * i) / steps);
    put(x, y, "B");
    put(x, y + 1, "b");
  }
  return stamp(base, sprite(line), 0, 0);
}

interface Stage {
  readonly size: readonly [number, number];
  readonly trunk: readonly [top: number, topWidth: number, baseWidth: number, flare: number];
  readonly branches: readonly (readonly [readonly [number, number], readonly [number, number]])[];
  readonly back: readonly (readonly [Sprite, number, number])[];
  readonly front: readonly (readonly [Sprite, number, number])[];
}

function grow(stage: Stage): Sprite {
  const [width, height] = stage.size;
  const potY = height - POT.height;
  const cx = Math.floor(width / 2);
  let tree = blank(width, height);
  for (const [pad, x, y] of stage.back) {
    tree = stamp(tree, shaded(pad), x, y);
  }
  const [top, topWidth, baseWidth, flare] = stage.trunk;
  tree = stamp(tree, trunk(stage.size, cx, top, potY, topWidth, baseWidth, flare), 0, 0);
  for (const [from, to] of stage.branches) {
    tree = branch(tree, from, to);
  }
  for (const [pad, x, y] of stage.front) {
    tree = stamp(tree, pad, x, y);
  }
  return stamp(tree, POT, Math.floor((width - POT.width) / 2), potY);
}

/** A sequoia seedling: a short red stem with a starburst of seed leaves. */
export const SPROUT = stamp(
  stamp(
    blank(40, 30),
    sprite([
      "....g....g....",
      "...gHg..gHg...",
      "g..gFg..gFg..g",
      "gHg.gFggFg.gHg",
      ".gFFgFhhFgFFg.",
      "..ggFhHHhFgg..",
      "....gFhhFg....",
      "......rB......",
      "......rB......",
      "......rB......",
      ".....orBo.....",
    ]),
    13,
    9,
  ),
  POT,
  4,
  20,
);

export const SAPLING = grow({
  size: [40, 46],
  trunk: [6, 1, 4, 1],
  branches: [
    [
      [19, 27],
      [14, 25],
    ],
    [
      [20, 20],
      [25, 18],
    ],
  ],
  back: [[PAD_E, 15, 11]],
  front: [
    [PAD_D, 6, 23],
    [PAD_E, 23, 15],
    [TIP, 17, 4],
  ],
});

export const YOUNG = grow({
  size: [48, 62],
  trunk: [5, 1, 7, 3],
  branches: [
    [
      [23, 41],
      [15, 38],
    ],
    [
      [24, 33],
      [31, 30],
    ],
    [
      [23, 24],
      [17, 22],
    ],
    [
      [24, 17],
      [29, 15],
    ],
  ],
  back: [
    [PAD_D, 17, 27],
    [PAD_E, 19, 14],
  ],
  front: [
    [PAD_C, 3, 34],
    [PAD_C, 26, 26],
    [PAD_D, 9, 19],
    [PAD_E, 26, 11],
    [TIP, 21, 3],
  ],
});

export const ANCIENT = grow({
  size: [64, 86],
  trunk: [5, 2, 13, 5],
  branches: [
    [
      [30, 62],
      [17, 58],
    ],
    [
      [34, 55],
      [45, 51],
    ],
    [
      [30, 46],
      [20, 43],
    ],
    [
      [33, 38],
      [42, 35],
    ],
    [
      [31, 30],
      [23, 27],
    ],
    [
      [33, 22],
      [38, 20],
    ],
  ],
  back: [
    [PAD_B, 21, 46],
    [PAD_C, 23, 32],
    [PAD_D, 25, 19],
    [PAD_E, 27, 9],
  ],
  front: [
    [PAD_A, 2, 53],
    [PAD_B, 37, 44],
    [PAD_B, 7, 38],
    [PAD_C, 35, 29],
    [PAD_C, 12, 23],
    [PAD_D, 34, 15],
    [PAD_E, 21, 11],
    [TIP, 29, 3],
  ],
});

export const TREE_STAGES = [
  { id: "sprout", name: "Sprout", sprite: SPROUT },
  { id: "sapling", name: "Sapling", sprite: SAPLING },
  { id: "young", name: "Young sequoia", sprite: YOUNG },
  { id: "ancient", name: "Ancient", sprite: ANCIENT },
] as const;

/** The same old tree in autumn dress: a seasonal style from the shop. */
export const ANCIENT_AUTUMN = recolor(ANCIENT, { H: "y", h: "Y", F: "A", f: "a", G: "B", g: "b" });
