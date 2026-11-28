/**
 * Draws the kit's frames and small icons as pixel art and writes them into `src/frames.css` as
 * pictures the stylesheet can use (`bun run frames`). Each is a tiny SVG of whole-pixel squares, so
 * it stays sharp at any size and needs no script on the page.
 */
import { EMOTE_ART } from "../src/emotes.ts";
import { ACORN } from "../src/mark.ts";
import { BARK, CORAL, CREAM, GOLD, GREEN, LEAF, PAPER, SKY, STONE } from "../src/palette.ts";

type Grid = (string | null)[][];

const blank = (w: number, h: number): Grid => Array.from({ length: h }, () => Array.from({ length: w }, () => null));

/** A picture typed as rows of letters, each letter a colour in `pal`; anything else is clear. */
function rows(lines: readonly string[], pal: Readonly<Record<string, string>>): Grid {
  const w = lines.reduce((m, l) => Math.max(m, l.length), 1);
  return lines.map((l) => Array.from({ length: w }, (_cell, x) => pal[l.charAt(x)] ?? null));
}

/** A copy one pixel larger all round with a dark edge in the clear pixels that touch the picture. */
function outlined(src: Grid, colour: string): Grid {
  const h = src.length + 2;
  const w = (src[0]?.length ?? 0) + 2;
  const at = (x: number, y: number): string | null => src[y - 1]?.[x - 1] ?? null;
  return Array.from({ length: h }, (_row, y) =>
    Array.from({ length: w }, (_cell, x) => {
      const own = at(x, y);
      if (own) return own;
      return at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1) ? colour : null;
    }),
  );
}

type Ring = readonly [lit: string, shade: string];

/**
 * A box built from the outside in: each ring is a pair of colours, the first for its top and left
 * edges (where the light falls) and the second for its bottom and right. `cut` clips the corners;
 * the first ring follows the clipped corner so the outline stays whole. With no `fill` it is hollow.
 */
function ringed(w: number, h: number, rings: readonly Ring[], fill: string | null, cut: number): Grid {
  const g = blank(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = Math.min(x, w - 1 - x);
      const cy = Math.min(y, h - 1 - y);
      if (cx + cy < cut) continue;
      const d = cx + cy === cut ? 0 : Math.min(cx, cy);
      const ring = rings[d];
      const lit = d === x ? y <= h - 1 - d : y === d && x < w - 1 - d;
      const row = g[y];
      if (row) row[x] = ring ? (lit ? ring[0] : ring[1]) : fill;
    }
  }
  return g;
}

function put(g: Grid, x: number, y: number, c: string): void {
  const row = g[y];
  if (row && x >= 0 && x < row.length) row[x] = c;
}

/** The picture with a hard shadow two pixels deep under it, in the clear pixels beneath whatever is drawn. */
function shadowed(src: Grid): Grid {
  const g = [...src.map((row) => [...row]), ...blank(src[0]?.length ?? 0, 2)];
  g.forEach((row, y) =>
    row.forEach((c, x) => {
      if (!c && (src[y - 1]?.[x] || src[y - 2]?.[x])) row[x] = SHADE;
    }),
  );
  return g;
}

/**
 * The picture as an SVG, one path for each colour, made of rectangles: a run along a row, as tall as
 * the rows under it that repeat it. A colour of eight digits is see-through by its last two.
 */
function svg(g: Grid): string {
  const h = g.length;
  const w = g[0]?.length ?? 0;
  const rects: { c: string; x: number; y: number; w: number; h: number }[] = [];
  const above = new Map<string, number>();
  g.forEach((row, y) => {
    let x = 0;
    while (x < w) {
      const c = row[x];
      if (!c) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < w && row[x + run] === c) run++;
      const key = `${c} ${x} ${run}`;
      const up = rects[above.get(key) ?? -1];
      if (up && up.y + up.h === y) up.h++;
      else {
        above.set(key, rects.length);
        rects.push({ c, x, y, w: run, h: 1 });
      }
      x += run;
    }
  });
  const paths = new Map<string, string>();
  for (const r of rects) paths.set(r.c, `${paths.get(r.c) ?? ""}M${r.x} ${r.y}h${r.w}v${r.h}h-${r.w}z`);
  const body = [...paths]
    .map(([c, d]) => {
      const through = c.length === 9 ? ` fill-opacity='${(parseInt(c.slice(7), 16) / 255).toFixed(2)}'` : "";
      return `<path fill='${c.slice(0, 7)}'${through} d='${d}'/>`;
    })
    .join("");
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}' shape-rendering='crispEdges'>${body}</svg>`;
}

const url = (g: Grid): string =>
  `url("data:image/svg+xml,${svg(g).replaceAll("#", "%23").replaceAll("<", "%3C").replaceAll(">", "%3E")}")`;

// ---------- frames ----------

/** The interface's own colours, as `kit.css` has them: its dark edge, a well, a panel, a raised thing, a quiet line. */
const INK = "#0b0710";
const WELL = "#0f0a19";
const FIELD = "#171025";
const RAISED = "#211834";
const LINE = "#3a2f52";
const SHADE = "#0b071080";

/** A metal, a stone or a gem: its dark, its middle and its light. */
type Ramp = readonly [lo: string, mid: string, hi: string];

const BRASS: Ramp = ["#8a5a22", "#c9923c", "#f6cf7a"];
/** The five tiers' metals: stone, jade, sapphire, amethyst, gold. */
const TIERS = [
  ["#565267", "#8d899f", "#cfcbdc"],
  ["#2c7a3a", "#4dbb58", "#a4f585"],
  ["#2859a6", "#3d97ee", "#93d6ff"],
  ["#7a2ba3", "#b957e6", "#eaa6ff"],
  ["#a9641a", "#f2ab2e", "#ffe27c"],
] as const satisfies readonly Ramp[];
/** The jewels on the crests over the third, fourth and fifth tiers. */
const SAPPHIRE: Ramp = ["#1c6fd6", "#52b6ff", "#d6f1ff"];
const AMETHYST: Ramp = ["#a12fd6", "#dc7bff", "#fbe0ff"];
const ROSE: Ramp = ["#e0457a", "#ff8fb0", "#ffe3ec"];

interface Frame {
  readonly band: Ramp;
  /** How many pixels thick the band is, its dark edges included. */
  readonly thick: 4 | 5;
  /** How many pixels are cut off each corner. */
  readonly cut: number;
  /** How many pixels of corner the picture has each side of its two pixels of plain edge. */
  readonly corner: number;
  /** A jewel on each corner, this many pixels from its middle to its points; none without. */
  readonly gem?: readonly [Ramp, number];
  /** What is inside it; clear without, for a frame drawn over what it holds. */
  readonly fill?: string;
  /** Rows of shadow under it. */
  readonly drop?: number;
}

/**
 * A frame to stretch round a thing: a bevelled band lit from the top left, with its corners cut and
 * nothing along its edges, so they stretch without a mark.
 */
function frame({ band: [lo, mid, hi], thick, cut, corner, gem, fill, drop = 0 }: Frame): Grid {
  const n = corner * 2 + 2;
  const last = n - 1;
  const g = blank(n, n + drop);
  const within = (x: number, y: number): boolean =>
    y >= 0 && y <= last && Math.min(x, last - x) + Math.min(y, last - y) >= cut;
  for (let y = 0; y < n + drop; y++)
    for (let x = 0; x < n; x++) {
      if (!within(x, y)) {
        if (within(x, y - drop)) put(g, x, y, SHADE);
        continue;
      }
      const dx = Math.min(x, last - x);
      const dy = Math.min(y, last - y);
      const d = Math.min(dx, dy, dx + dy - cut);
      if (d >= thick) {
        if (fill) put(g, x, y, fill);
        continue;
      }
      // The top and the left are bright outside and dark inside; the bottom and the right the reverse.
      const lit = d === dy && dy <= dx ? y < n / 2 : d === dx ? x < n / 2 : x < n / 2 && y < n / 2;
      const across = lit ? [hi, mid, lo] : [lo, mid, hi];
      const rings = thick === 5 ? [INK, ...across, INK] : [INK, across[0], across[2], INK];
      put(g, x, y, rings[d] ?? INK);
    }
  if (!gem) return g;
  const [[glo, gmid, ghi], r] = gem;
  for (const cx of [r + 1, last - r - 1])
    for (const cy of [r + 1, last - r - 1]) {
      for (let y = cy - r - 1; y <= cy + r + 1; y++)
        for (let x = cx - r - 1; x <= cx + r + 1; x++) {
          const far = Math.abs(x - cx) + Math.abs(y - cy);
          const side = x - cx + y - cy;
          if (far === r + 1) put(g, x, y, INK);
          else if (far <= r) put(g, x, y, side < 0 ? ghi : side === 0 ? gmid : glo);
        }
      if (r >= 2) put(g, cx - 1, cy - 1, "#ffffff");
    }
  return g;
}

/** The brass frame: a sign or a tip that is picked out wears it in place of its own. */
const brass = (): Grid => frame({ band: BRASS, thick: 4, cut: 2, corner: 5, gem: [BRASS, 1], fill: FIELD, drop: 2 });
/**
 * A tier's frame, every tier built alike and only its colours its own: an ink outline, a flat band of
 * the tier's metal, one lighter line inside it, and the outline's corner cut by a pixel. Five pixels
 * thick, or three (`thin`) for a small thing (`kit.css`); drawn over what it holds, nothing lies on it.
 */
const tier = ([, mid, hi]: Ramp, thin: boolean): Grid => {
  const band: Ring = [mid, mid];
  const rings: Ring[] = [INKED, ...Array.from({ length: thin ? 1 : 3 }, () => band), [hi, hi]];
  const n = rings.length * 2 + 1;
  return ringed(n, n, rings, null, 1);
};

/** The jewel that stands on top of a frame of the third or fourth tier. */
const crest = ([glo, gmid, ghi]: Ramp): Grid =>
  rows(
    [
      "....kkk....",
      "...kGGgk...",
      "..kGwGggk..",
      ".kGGGgggdk.",
      "kGGGgggdddk",
      ".kGgggdddk.",
      "..kggdddk..",
      "...kgddk...",
      "....kdk....",
      ".....k.....",
    ],
    { k: INK, G: ghi, g: gmid, d: glo, w: "#ffffff" },
  );
/** The crown that stands on top of a frame of the fifth. */
const crown = ([lo, mid, hi]: Ramp, [, gmid, ghi]: Ramp): Grid =>
  rows(
    [
      "k......k......k",
      "kk....kGk....kk",
      "khk..khGgk..khk",
      "khhkkhhhgkkhhmk",
      "khhhhhhmmmmmmlk",
      "khGhhhGmmmgmmlk",
      "kmmmmmmmllllllk",
      ".kkkkkkkkkkkkk.",
    ],
    { k: INK, h: hi, m: mid, l: lo, G: ghi, g: gmid },
  );

/** Whether a pixel is in the hexagon standing on its point, 14 by 16, that the icon of a trait or a kind sits in. */
const inHex = (x: number, y: number): boolean =>
  y >= 0 && y < 16 && Math.abs(x - 6.5) < Math.min(7, 1 + 2 * Math.min(y, 15 - y));
/** That hexagon, or what is left of it `inset` pixels in from its edge: the dark inside of the badge. */
function hex(inset: number, colour: string): Grid {
  const g = blank(14, 16);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 14; x++)
      if (inHex(x, y - inset) && inHex(x, y + inset) && inHex(x - inset, y) && inHex(x + inset, y))
        put(g, x, y, colour);
  return g;
}

// ---------- timber, brass and parchment ----------

/** Timber, darkest first and its lit edge last; the brass of a bracket; and a board behind a row of tools. */
const WOOD = [...BARK, "#c98a58"] as const;
const BRACKET: Ramp = ["#a3662a", GOLD[1], GOLD[2]];
const BOARD = "#24130f";
const INKED: Ring = [INK, INK];

/** A flat shape made to stand up: its top and left edges catch the light, its bottom and right are in shade. */
function emboss(g: Grid, cells: readonly (readonly [number, number])[], [lo, mid, hi]: Ramp): void {
  const has = new Set(cells.map(([x, y]) => `${x} ${y}`));
  for (const [x, y] of cells)
    put(
      g,
      x,
      y,
      !has.has(`${x} ${y - 1}`) || !has.has(`${x - 1} ${y}`)
        ? hi
        : !has.has(`${x} ${y + 1}`) || !has.has(`${x + 1} ${y}`)
          ? lo
          : mid,
    );
}

/**
 * A panel's frame as a sample to cut up, corners and one length of each edge: timber, each length a
 * plank with a joint at its start and a peg either side of it, and a brass bracket over each
 * corner. `thin`, for a small screen, it is two pixels thinner, without pegs, its brackets smaller.
 */
function panel(thin: boolean): Grid {
  const [tile, corner, reach, plate] = thin ? [24, 6, 5, 3] : [48, 9, 8, 5];
  const grain: Ring[] = thin
    ? []
    : [
        [WOOD[3], WOOD[2]],
        [WOOD[2], WOOD[3]],
      ];
  const rings = [INKED, [WOOD[4], WOOD[1]], [WOOD[3], WOOD[2]], ...grain, [WOOD[0], WOOD[0]]] as const;
  const far = corner * 2 + tile - 1;
  const g = ringed(far + 1, far + 1, rings, null, 2);
  /** A pixel `a` along each of the four sides and `d` deep. */
  const sides = (a: number, d: number, lit: string, shade: string): void => {
    put(g, corner + a, d, lit);
    put(g, d, corner + a, lit);
    put(g, corner + a, far - d, shade);
    put(g, far - d, corner + a, shade);
  };
  for (const [a, length, d] of [
    [6, 7, 2],
    [17, 4, 3],
    [26, 9, 2],
    [37, 5, 3],
    [9, 3, 3],
    [30, 3, 3],
  ] as const)
    if (a + length < tile - 5 && d <= rings.length - 3)
      for (let i = 0; i < length; i++) sides(a + i, d, WOOD[2], WOOD[1]);
  if (!thin) {
    for (let d = 1; d < rings.length - 1; d++) {
      sides(0, d, WOOD[0], WOOD[0]);
      sides(1, d, d === 1 ? WOOD[4] : WOOD[3], d === 1 ? WOOD[2] : WOOD[3]);
    }
    for (const a of [3, tile - 4]) {
      sides(a, 2, WOOD[5], WOOD[5]);
      sides(a + 1, 2, WOOD[1], WOOD[1]);
      sides(a, 3, WOOD[1], WOOD[1]);
      sides(a + 1, 3, WOOD[0], WOOD[0]);
    }
  }
  for (const fx of [false, true])
    for (const fy of [false, true]) {
      const cells: [number, number][] = [];
      for (let y = 1; y <= reach; y++)
        for (let x = 1; x <= reach; x++)
          if (x + y >= 3 && ((x <= plate && y <= plate) || x <= 2 || y <= 2))
            cells.push([fx ? far - x : x, fy ? far - y : y]);
      emboss(g, cells, BRACKET);
      // The rivet that holds the plate.
      if (!thin) put(g, fx ? far - 3 : 3, fy ? far - 3 : 3, "#5e3a16");
    }
  return shadowed(g);
}

/** A shelf, for a row of tools or places: thin sides, and a thick board along the bottom that sticks out at each end. */
function shelf(): Grid {
  const g = blank(40, 24);
  ringed(34, 20, [INKED, [WOOD[4], WOOD[1]], [WOOD[0], WOOD[0]]], BOARD, 1).forEach((row, y) =>
    row.forEach((c, x) => c && put(g, x + 3, y, c)),
  );
  [INK, WOOD[5], WOOD[4], WOOD[3], WOOD[2], WOOD[1], INK].forEach((c, i) => {
    for (let x = 1; x < 39; x++) put(g, x, 17 + i, c);
  });
  // The board's ends, cut across the grain.
  for (let y = 18; y < 23; y++) {
    put(g, 0, y, INK);
    put(g, 39, y, INK);
    put(g, 1, y, y < 20 ? WOOD[5] : WOOD[4]);
    put(g, 38, y, y < 21 ? WOOD[2] : WOOD[1]);
  }
  for (const x of [11, 12, 13, 14, 15, 25, 26, 27]) put(g, x, 20, WOOD[2]);
  return shadowed(g);
}

/** A sign, for the small things that sit over the world (the purse, a counter): a thin board, a brass nail in each corner. */
function plaque(): Grid {
  const g = ringed(14, 14, [INKED, [WOOD[4], WOOD[1]], [WOOD[3], WOOD[2]], [WOOD[0], WOOD[0]]], FIELD, 1);
  for (const x of [2, 11]) for (const y of [2, 11]) put(g, x, y, x + y === 4 ? GOLD[2] : GOLD[1]);
  return shadowed(g);
}
/** A tip, and a thing's card: a thin wooden rim. */
const tipFrame = (): Grid => shadowed(ringed(12, 12, [INKED, [WOOD[3], WOOD[1]], [WOOD[0], WOOD[0]]], FIELD, 1));

/** The beam under a panel's shingles, a peg at each end. */
const eave = (): Grid =>
  rows(["hhhhhhhhhhhhhh", "mmmmhdmmhdmmmm", "mmmmdkmmdkmmmm", "dddddddddddddd", "kkkkkkkkkkkkkk"], {
    h: WOOD[5],
    m: WOOD[3],
    d: WOOD[1],
    k: INK,
  });
/** The rope a sign hangs on, and its knot on the sign. */
const rope = (): Grid => rows(["kabk", "kbck"], { k: INK, a: PAPER[1], b: PAPER[0], c: "#8a6a3c" });
const knot = (): Grid => rows([".kkkk.", "kyYyok", "kyoook", ".kkkk."], { k: INK, y: PAPER[1], Y: CREAM, o: PAPER[0] });
/** The brass nail a note hangs on. */
const nail = (): Grid => outlined(rows(["hy.", "yyo", ".oo"], { h: GOLD[3], y: GOLD[1], o: BRACKET[0] }), INK);
/** A dowel down and round to the right, pegged at the turn: it ties a thing to the one it follows from. */
const elbow = (): Grid =>
  rows(["kiwdk..", "kiwdk..", "kiwdkkk", "kiwwiii", "kipwwww", "kwddddd", ".kkkkkk"], {
    k: INK,
    i: WOOD[4],
    w: WOOD[3],
    d: WOOD[1],
    p: WOOD[5],
  });

/** A row or a tile that stands up from the panel: a plum board, a step lighter. */
const card = (): Grid => ringed(10, 10, [INKED, ["#30264a", "#181126"]], RAISED, 1);
/** Picked out, it glows warm in a gold edge; chosen, the gold is doubled; locked, it lies flat and dark. */
const cardLit = (): Grid => ringed(10, 10, [INKED, [GOLD[2], GOLD[0]], ["#5a2f66", SKY[0]]], "#3a1f47", 1);
const cardChosen = (): Grid => ringed(10, 10, [INKED, [GOLD[3], GOLD[1]], [GOLD[1], GOLD[0]]], "#3a1f47", 1);
const cardLocked = (): Grid => ringed(10, 10, [INKED], "#1b142b", 1);
/** A hollow that holds something: a figure on a bench, a thing for sale, the trough of a bar. */
const slot = (): Grid => ringed(8, 8, [[INK, LINE]], WELL, 0);
/** The same hollow picked out in gold: the one of a row that is chosen, or where you are. */
const slotLit = (): Grid => ringed(8, 8, [INKED, ["#ffc247", "#f5ad35"]], RAISED, 0);
/** A note: parchment with a corner turned up. */
function paper(): Grid {
  const g = ringed(18, 18, [INKED, [CREAM, PAPER[1]]], PAPER[2], 2);
  for (let y = 12; y < 18; y++)
    for (let x = 12; x < 18; x++) {
      const k = x + y - 24;
      const row = g[y];
      if (row && k >= 5) row[x] = k > 8 ? null : k === 8 ? INK : k >= 6 ? PAPER[0] : "#a98a58";
    }
  return shadowed(g);
}
const bubble = (): Grid => ringed(10, 10, [INKED], CREAM, 2);
/** A small tag: a wooden one, and one picked out in gold. */
const chip = (): Grid => ringed(8, 8, [INKED, [WOOD[3], WOOD[1]]], "#2b1712", 1);
const chipLit = (): Grid => ringed(8, 8, [INKED, [GOLD[2], GOLD[0]]], "#3a1f47", 1);

interface Tones {
  readonly light: string;
  readonly face: string;
  readonly foot: string;
}
/**
 * A button: a lit top edge, its face, a darker foot, the corners notched and a hard shadow under
 * it. Pressed, it has sunk onto its foot: no shadow, and its top edge in shade.
 */
function button(t: Tones, down: boolean): Grid {
  const pal = { k: INK, i: t.light, h: t.face, l: t.foot, s: SHADE };
  return rows(
    down
      ? ["........", "........", ".kkkkkk.", "kllllllk", "khhhhhhk", "khhhhhhk", ".kkkkkk."]
      : [".kkkkkk.", "kiiiiiik", "khhhhhhk", "khhhhhhk", "kllllllk", "kllllllk", "skkkkkks", "ssssssss", ".ssssss."],
    pal,
  );
}
/**
 * A tab standing on a rail: its top corners cut, no foot. The chosen one (`rise`) stands two pixels
 * taller; pressed (`down`), it has sunk a pixel and is in shade. The rail runs a pixel past it each
 * side, so the rails of tabs in a row meet.
 */
function tab(t: Tones, rise: number, down: boolean): Grid {
  const body = ".kihhlk.";
  const top = down ? ["........", "...kk...", "..kllk.."] : ["...kk...", "..kiik..", body];
  return rows(
    [...top, ...Array.from({ length: rise + 1 }, () => (down ? ".kllllk." : body)), "rrrrrrrr", "mmmmmmmm", "kkkkkkkk"],
    {
      k: INK,
      i: t.light,
      h: t.face,
      l: t.foot,
      r: WOOD[5],
      m: WOOD[3],
    },
  );
}
/**
 * What a button's colour says: gold confirms, blue shows or hides, green buys or grows, wood is
 * plain, coral leaves or removes, slate is quiet; and Discord's own blurple signs in with Discord.
 */
const TONES = {
  gold: { light: "#ffe082", face: "#f5ad35", foot: "#bf6e17" },
  blue: { light: "#7cc6ff", face: "#2f86e0", foot: "#1a4d99" },
  green: { light: "#8ae583", face: "#389c4b", foot: "#216a34" },
  wood: { light: "#b97c48", face: "#84532f", foot: "#54301a" },
  coral: { light: "#f89785", face: "#d9584d", foot: "#98302f" },
  slate: { light: "#74679a", face: "#4b4163", foot: "#2b2440" },
  off: { light: "#453c5c", face: "#332b47", foot: "#221c33" },
  discord: { light: "#8c95f7", face: "#5865f2", foot: "#4752c4" },
} satisfies Readonly<Record<string, Tones>>;

// ---------- settings: a slider, a switch, a key ----------

/** The groove a slider runs in, sunk into the panel: its top edge in shade and its bottom catching the light. */
const groove = (): Grid => ringed(8, 8, [INKED, ["#06040a", LINE]], WELL, 1);

/** A slider's knob: a brass peg with a notch down it, standing on the groove with a hard shadow under it. */
const knob = (): Grid =>
  shadowed(
    rows(
      [
        ".kkkkkkkk.",
        "kiiiiiiiyk",
        "kiyyyyyyok",
        "kiyykkyyok",
        "kiyykkyyok",
        "kiyykkyyok",
        "kiyykkyyok",
        "kiyyyyyyok",
        "kyoooooook",
        ".kkkkkkkk.",
      ],
      { k: INK, i: GOLD[3], y: GOLD[1], o: GOLD[0] },
    ),
  );

/** Where the lamps of a switch that is on are lit, in the well left of its block. */
const LAMPS = [
  [4, 6],
  [5, 6],
  [4, 7],
  [5, 7],
  [7, 6],
  [8, 6],
  [7, 7],
  [8, 7],
] as const;

/**
 * A switch: a well with a block in it, at the left in wood while it is off, at the right in gold
 * while it is on, with the well behind it green and its lamps lit. The block has a lit top, a
 * darker foot and a grip of two grooves down its middle.
 */
function toggle(on: boolean): Grid {
  const g = ringed(26, 14, [INKED, ["#06040a", on ? "#3b7340" : LINE]], on ? "#1e4a26" : WELL, 2);
  if (on) for (const [x, y] of LAMPS) put(g, x, y, GREEN[4]);
  const t = on ? TONES.gold : TONES.wood;
  const block = ringed(11, 12, [INKED, [t.light, t.foot]], t.face, 1);
  for (let y = 3; y < 9; y++) {
    put(block, 4, y, t.foot);
    put(block, 6, y, t.foot);
  }
  const at = on ? 14 : 1;
  block.forEach((row, y) =>
    row.forEach((c, x) => {
      if (c) put(g, at + x, 1 + y, c);
    }),
  );
  return g;
}

/** A key as it is printed on a keyboard: a parchment cap with a lit top and a deep foot. */
const cap = (): Grid => button({ light: CREAM, face: PAPER[1], foot: PAPER[0] }, false);

/** The little tail under a speech bubble. */
const tail = (): Grid => rows(["kwwwwk", ".kwwk.", "..kk.."], { k: INK, w: CREAM });

// ---------- icons ----------

const ICON_PAL: Readonly<Record<string, string>> = {
  k: INK,
  w: CREAM,
  y: GOLD[1],
  Y: GOLD[2],
  o: GOLD[0],
  r: CORAL,
  R: "#b0483a",
  p: SKY[4],
  v: SKY[3],
  G: GREEN[3],
  l: GREEN[4],
  L: LEAF,
  d: GREEN[0],
  b: BARK[1],
  B: BARK[2],
  n: BARK[3],
  N: BARK[4],
  s: STONE[1],
  S: STONE[2],
  t: STONE[3],
};

const ICONS: Readonly<Record<string, readonly string[]>> = {
  leaf: [
    "........GG..",
    "......GGllG.",
    "....GGlllwG.",
    "...GllllwlG.",
    "..GlllllwlG.",
    "..GllllwllG.",
    ".GllllwlllG.",
    ".GlllwlllG..",
    ".GllwlllG...",
    ".GlwlGGG....",
    ".Gw.........",
    "Gd..........",
  ],
  coin: [
    "....oooo....",
    "..ooyyyyoo..",
    ".oyyYYYYyyo.",
    ".oyYwyyoYyo.",
    "oyYwyyyyoYyo",
    "oyYyyooyoYyo",
    "oyYyyooyoYyo",
    "oyYyyyyyoYyo",
    ".oyYyyyoYyo.",
    ".oyyYYYYyyo.",
    "..ooyyyyoo..",
    "....oooo....",
  ],
  acorn: ACORN,
  close: [
    "ww......ww",
    "www....www",
    ".www..www.",
    "..wwwwww..",
    "...wwww...",
    "...wwww...",
    "..wwwwww..",
    ".www..www.",
    "www....www",
    "ww......ww",
  ],
  back: [
    "....ww....",
    "...www....",
    "..www.....",
    ".wwwwwwwww",
    "wwwwwwwwww",
    "wwwwwwwwww",
    ".wwwwwwwww",
    "..www.....",
    "...www....",
    "....ww....",
  ],
  sound: [
    "......w.....",
    ".....ww..w..",
    "....www...w.",
    "wwwwwww.w.w.",
    "wwwwwww..ww.",
    "wwwwwww..ww.",
    "wwwwwww..ww.",
    "wwwwwww.w.w.",
    "....www...w.",
    ".....ww..w..",
    "......w.....",
  ],
  mute: [
    "......w.....",
    ".....ww.....",
    "....www.....",
    "wwwwwww.r.r.",
    "wwwwwww.r.r.",
    "wwwwwww..r..",
    "wwwwwww..r..",
    "wwwwwww.r.r.",
    "....www.r.r.",
    ".....ww.....",
    "......w.....",
  ],
  check: [
    ".........ll",
    "........lll",
    ".......lll.",
    "ll....lll..",
    "lll..lll...",
    ".lllllll...",
    "..lllll....",
    "...lll.....",
    "....l......",
  ],
  lock: [
    "...ssss...",
    "..st..ss..",
    "..s....s..",
    "..s....s..",
    ".oooooooo.",
    ".oyyyyyyo.",
    ".oyykkyyo.",
    ".oyykkyyo.",
    ".oyyyyyyo.",
    ".oooooooo.",
  ],
  star: [
    ".....y.....",
    "....yYy....",
    "....yYy....",
    "yyyyYYYyyyy",
    ".yYYYYYYYy.",
    "..yYYYYYy..",
    "..yYYYYYy..",
    ".yYYyoyYYy.",
    ".yYy...yYy.",
    "yy.......yy",
  ],
  heart: EMOTE_ART.heart,
  gear: [
    "....yyyy....",
    ".yy.yyyy.yy.",
    ".yyyyyyyyyy.",
    "..yyyooyyy..",
    "yyyyo..oyyyy",
    "yyyo....oyyy",
    "yyyo....oyyy",
    "yyyyo..oyyyy",
    "..yyyooyyy..",
    ".yyyyyyyyyy.",
    ".yy.yyyy.yy.",
    "....yyyy....",
  ],
  play: ["ww......", "wwww....", "wwwwww..", "wwwwwwww", "wwwwww..", "wwww....", "ww......"],
  hammer: [
    "..ssssss..",
    ".stttttts.",
    ".sttttttss",
    ".sssnnssss",
    "....nN....",
    "....nN....",
    "....nN....",
    "....nN....",
    "....nN....",
    "....bn....",
  ],
  mail: [
    "wwwwwwwwwwww",
    "wCwwwwwwwwCw",
    "wwCCwwwwCCww",
    "wwwwCCCCwwww",
    "wwwwwCCwwwww",
    "wwwwwwwwwwww",
    "wwwwwwwwwwww",
    "wwwwwwwwwwww",
  ],
  gift: [
    "..yy..yy..",
    ".y..yy..y.",
    "..yyyyyy..",
    "rrrryyrrrr",
    "RRRRyyRRRR",
    ".rrryyrrr.",
    ".rrryyrrr.",
    ".rrryyrrr.",
    ".RRRyyRRR.",
  ],
  turn: [
    "...wwww.w.",
    "..ww..www.",
    ".ww..wwww.",
    ".w........",
    ".w......w.",
    ".w......w.",
    "........w.",
    ".wwww..ww.",
    ".www..ww..",
    ".w.wwww...",
  ],
  tray: ["..........", "w........w", "ww......ww", "wwwwwwwwww", "wCCCCCCCCw", "wwwwwwwwww", ".wwwwwwww."],
  home: [
    "....ww....",
    "...wwww...",
    "..wwwwww..",
    ".wwwwwwww.",
    "wwwwwwwwww",
    ".wwwwwwww.",
    ".www..www.",
    ".www..www.",
    ".www..www.",
  ],
  paw: ["..ww..ww..", "..ww..ww..", "ww......ww", "ww.wwww.ww", "..wwwwww..", ".wwwwwwww.", ".wwwwwwww.", "..ww..ww.."],
  // Two heads, one a step behind the other: who is about.
  visit: [
    "........ww..",
    "..ww...wwww.",
    ".wwww..wwww.",
    ".wwww...ww..",
    "..ww........",
    "........www.",
    ".wwww..wwwww",
    "wwwwww.wwwww",
    "wwwwww......",
  ],
  more: ["ww..ww..ww", "ww..ww..ww"],
  up: ["....ww....", "...wwww...", "..wwwwww..", ".wwwwwwww.", "wwwwwwwwww"],
  down: ["wwwwwwwwww", ".wwwwwwww.", "..wwwwww..", "...wwww...", "....ww...."],
  // What folds: an arrow at what it folds, right while shut; square, so that turned it points down while open (`kit.css`).
  fold: [".w.....", ".ww....", ".www...", ".wwww..", ".www...", ".ww....", ".w....."],
  // What a blue button does: an eye shows, an eye struck through hides.
  show: [
    "....wwww....",
    "..wwwwwwww..",
    ".wwwwkkwwww.",
    "wwwwkkkkwwww",
    ".wwwwkkwwww.",
    "..wwwwwwww..",
    "....wwww....",
  ],
  hide: [
    "..........ww",
    "....wwww.ww.",
    "..wwwwwwkk..",
    ".wwwwwwkkww.",
    "wwwwwwkkwwww",
    ".wwwwkkwwww.",
    "..wwkkwwww..",
    "...wkwww....",
    "..ww........",
  ],
  // The emotes besides the heart, drawn once for the page and the canvas alike (`emotes.ts`).
  wave: EMOTE_ART.wave,
  cheer: EMOTE_ART.cheer,
  laugh: EMOTE_ART.laugh,
};

// ---------- the stylesheet ----------

const lines: string[] = [
  "/* Made by tools/frames.ts (bun run frames). Change the drawings there, not here. */",
  ":root {",
];
/** Roof shingles, as on every building in town: the band a panel's title sits on. */
function shingles(): Grid {
  const g = blank(24, 12);
  for (let y = 0; y < 12; y++)
    for (let x = 0; x < 24; x++) {
      const lx = (x + (y >= 6 ? 6 : 0)) % 12;
      const ly = y % 6;
      put(g, x, y, ly === 5 || lx === 11 ? SKY[0] : ly === 0 ? SKY[2] : SKY[1]);
    }
  // A few shingles catch the light.
  for (const [x, y, len] of [
    [1, 1, 3],
    [14, 1, 2],
    [8, 7, 3],
    [20, 7, 2],
  ] as const)
    for (let i = 0; i < len; i++) put(g, x + i, y, SKY[3]);
  return g;
}

const frames: Readonly<Record<string, Grid>> = {
  shingles: shingles(),
  eave: eave(),
  plaque: plaque(),
  tip: tipFrame(),
  brass: brass(),
  rope: rope(),
  knot: knot(),
  nail: nail(),
  elbow: elbow(),
  ...Object.fromEntries(TIERS.map((t, i) => [`tier-${i + 1}`, tier(t, false)])),
  ...Object.fromEntries(TIERS.map((t, i) => [`tier-${i + 1}-thin`, tier(t, true)])),
  "crest-3": crest(SAPPHIRE),
  "crest-4": crest(AMETHYST),
  "crest-5": crown(TIERS[4], ROSE),
  card: card(),
  "card-lit": cardLit(),
  "card-chosen": cardChosen(),
  "card-locked": cardLocked(),
  slot: slot(),
  "slot-lit": slotLit(),
  paper: paper(),
  bubble: bubble(),
  tail: tail(),
  chip: chip(),
  "chip-lit": chipLit(),
  tab: tab(TONES.wood, 0, false),
  "tab-on": tab(TONES.gold, 2, false),
  "tab-down": tab(TONES.wood, 0, true),
  hex: hex(0, INK),
  "hex-in": hex(1, "#1a1128"),
  groove: groove(),
  knob: knob(),
  "switch-off": toggle(false),
  "switch-on": toggle(true),
  cap: cap(),
};
for (const [name, g] of Object.entries(frames)) lines.push(`  --k-f-${name}: ${url(g)};`);
for (const [name, t] of Object.entries(TONES)) {
  lines.push(`  --k-f-btn-${name}: ${url(button(t, false))};`);
  // A button that is off is never pressed.
  if (name !== "off") lines.push(`  --k-f-btn-${name}-down: ${url(button(t, true))};`);
}
const sizes: string[] = [];
for (const [name, art] of Object.entries(ICONS)) {
  const g = outlined(rows(art, ICON_PAL), INK);
  lines.push(`  --k-i-${name}: ${url(g)};`);
  sizes.push(
    `.k-i-${name} {\n  --w: ${g[0]?.length ?? 0};\n  --h: ${g.length};\n  background-image: var(--k-i-${name});\n}`,
  );
}
lines.push("}", ...sizes);

type Sides = readonly [top: number, right: number, bottom: number, left: number];
const units = (n: number): string => (n === 0 ? "0" : `calc(var(--u) * ${n})`);
const sides = (s: readonly number[]): string => s.map(units).join(" ");

/**
 * A frame whose edges repeat, as timber must: cut from a sample into four corners and a length of
 * each edge, and laid behind the thing by its two pseudo-elements (one cannot clip both ways), so
 * that corners are fixed pieces and edges tile from the top left on the art's own grid, never
 * stretched. `cut` is the size of the corner pieces, `pad` how thick the frame is inside the thing's
 * own box, `out` how far the picture reaches outside it.
 */
function repeating(sel: string, g: Grid, cut: Sides, pad: Sides, out: Sides, fill: string): string[] {
  const [T, R, B, L] = cut;
  const w = g[0]?.length ?? 0;
  const [tw, th] = [w - L - R, g.length - T - B];
  const piece = (x: number, y: number, pw: number, ph: number, at: string, how: string): string =>
    `    ${url(g.slice(y, y + ph).map((row) => row.slice(x, x + pw)))}\n      ${at} / ${units(pw)} ${units(ph)} ${how}`;
  const inset = `  inset: ${sides(pad.map((p, i) => -p - (out[i] ?? 0)))};`;
  return [
    `${sel} {\n  border-width: ${sides(pad)};\n  background: ${fill} padding-box;\n}`,
    `${sel}::before {\n${inset}\n  border-width: ${sides([0, R, 0, L])};\n  background:\n${[
      piece(L, 0, tw, T, "0 0", "repeat-x padding-box"),
      piece(L, g.length - B, tw, B, "0 100%", "repeat-x padding-box"),
    ].join(",\n")};\n}`,
    `${sel}::after {\n${inset}\n  border-width: ${sides([T, 0, B, 0])};\n  background:\n${[
      piece(0, 0, L, T, "0 0", "no-repeat border-box"),
      piece(w - R, 0, R, T, "100% 0", "no-repeat border-box"),
      piece(0, g.length - B, L, B, "0 100%", "no-repeat border-box"),
      piece(w - R, g.length - B, R, B, "100% 100%", "no-repeat border-box"),
      piece(0, T, L, th, "0 0", "repeat-y padding-box"),
      piece(w - R, T, R, th, "100% 0", "repeat-y padding-box"),
    ].join(",\n")};\n}`,
  ];
}
/** Where a screen is small (a phone, either way up), ornament thins; `kit.css` says the same of its own. */
const SMALL = "@media (max-width: 760px), (max-height: 500px)";
lines.push(
  ...repeating(".k-panel", panel(false), [9, 9, 11, 9], [6, 6, 6, 6], [0, 0, 2, 0], FIELD),
  `${SMALL} {`,
  ...repeating(".k-panel", panel(true), [6, 6, 8, 6], [4, 4, 4, 4], [0, 0, 2, 0], FIELD).map((rule) =>
    rule.replace(/^/gm, "  "),
  ),
  "}",
  ...repeating(".k-shelf", shelf(), [8, 8, 11, 8], [3, 3, 7, 3], [0, 3, 2, 3], BOARD),
  "",
);
await Bun.write(new URL("../src/frames.css", import.meta.url), lines.join("\n"));
console.log(
  `frames.css: ${Object.keys(frames).length} frames, ${Object.keys(TONES).length} buttons, ${sizes.length} icons`,
);
