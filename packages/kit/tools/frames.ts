/**
 * Draws the kit's frames and small icons as pixel art and writes them into `src/frames.css` as
 * pictures the stylesheet can use (`bun run frames`). Each is a tiny SVG of whole-pixel squares, so
 * it stays sharp at any size and needs no script on the page.
 */
import { BARK, CORAL, CREAM, GOLD, GREEN, INK, LEAF, PAPER, SKY, STONE } from "../src/palette.ts";

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

/**
 * A square frame built from the outside in: each ring is a pair of colours, the first for its top
 * and left edges (where the light falls) and the second for its bottom and right. `cut` clips the
 * corners; the first ring follows the clipped corner so the outline stays whole.
 */
function ringed(size: number, rings: readonly (readonly [string, string])[], fill: string, cut: number): Grid {
  const g = blank(size, size);
  const last = size - 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = Math.min(x, last - x);
      const cy = Math.min(y, last - y);
      if (cx + cy < cut) continue;
      const d = cx + cy === cut ? 0 : Math.min(cx, cy);
      const ring = rings[d];
      const lit = d === x ? y <= last - d : y === d && x < last - d;
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

/** The picture as an SVG, one path for each colour, made of runs along the rows. */
function svg(g: Grid): string {
  const h = g.length;
  const w = g[0]?.length ?? 0;
  const paths = new Map<string, string>();
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
      paths.set(c, `${paths.get(c) ?? ""}M${x} ${y}h${run}v1h-${run}z`);
      x += run;
    }
  });
  const body = [...paths].map(([c, d]) => `<path fill='${c}' d='${d}'/>`).join("");
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}' shape-rendering='crispEdges'>${body}</svg>`;
}

const url = (g: Grid): string =>
  `url("data:image/svg+xml,${svg(g).replaceAll("#", "%23").replaceAll("<", "%3C").replaceAll(">", "%3E")}")`;

// ---------- frames ----------

const DEEP = "#211228";
const LIT = "#54286a";

/**
 * The big wooden frame round a panel: five pixels of bark with a brass bracket in each corner. The
 * edges are a plank long and repeat, so there is a joint and a little grain to them.
 */
const PLANK = 36;
function panel(): Grid {
  const size = PLANK + 10;
  const g = ringed(
    size,
    [
      [INK, INK],
      [BARK[4], BARK[1]],
      [BARK[3], BARK[2]],
      [BARK[2], BARK[3]],
      [BARK[0], BARK[0]],
    ],
    SKY[0],
    2,
  );
  const last = size - 1;
  /** A pixel `d` deep into the frame and `t` along it, on each of the four sides. */
  const sides = (t: number, d: number, c: readonly [string, string]): void => {
    put(g, 5 + t, d, c[0]);
    put(g, d, 5 + t, c[0]);
    put(g, 5 + t, last - d, c[1]);
    put(g, last - d, 5 + t, c[1]);
  };
  // Grain: short darker strokes in the body of the plank.
  for (const [t, len, d] of [
    [2, 5, 2],
    [11, 3, 3],
    [23, 6, 2],
    [30, 4, 3],
  ] as const)
    for (let i = 0; i < len; i++) sides(t + i, d, d === 2 ? [BARK[2], BARK[1]] : [BARK[1], BARK[2]]);
  // Where two planks meet.
  for (let d = 1; d <= 3; d++) {
    sides(17, d, [BARK[1], BARK[0]]);
    sides(18, d, d === 1 ? [BARK[4], BARK[2]] : [BARK[3], BARK[3]]);
  }
  // Brass brackets.
  const LIP = "#a3662a";
  for (const [fx, fy] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const) {
    const X = (x: number): number => (fx ? last - x : x);
    const Y = (y: number): number => (fy ? last - y : y);
    for (let y = 1; y <= 4; y++)
      for (let x = 1; x <= 4; x++) {
        if (x + y <= 2) continue;
        const arm = y === 1 || x === 1;
        const plate = x <= 3 && y <= 3;
        if (!arm && !plate) continue;
        const lit = (fy ? false : y === 1) || (fx ? false : x === 1);
        const dark = (fy ? y === 1 : y === 3 && plate) || (fx ? x === 1 : x === 3 && plate);
        put(g, X(x), Y(y), lit ? GOLD[2] : dark ? LIP : GOLD[1]);
      }
    put(g, X(2), Y(2), BARK[0]);
  }
  return g;
}

/** Roof shingles, as on every building in town: the band a panel's title sits on. */
function shingles(): Grid {
  const g = blank(24, 12);
  for (let y = 0; y < 12; y++)
    for (let x = 0; x < 24; x++) {
      const rowB = y >= 6;
      const lx = (x + (rowB ? 6 : 0)) % 12;
      const ly = y % 6;
      let c: string = SKY[1];
      if (ly === 0) c = SKY[2];
      if (ly === 5 || lx === 11) c = SKY[0];
      put(g, x, y, c);
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

/** A thin wooden edge, for the small things that sit over the town: the purse, the dock, a card. */
const plaque = (): Grid =>
  ringed(
    12,
    [
      [INK, INK],
      [BARK[4], BARK[1]],
      [BARK[2], BARK[2]],
      [BARK[0], BARK[0]],
    ],
    SKY[0],
    1,
  );

/** A row or a tile that stands up from the panel, and the same picked out in gold. */
const card = (): Grid =>
  ringed(
    8,
    [
      [INK, INK],
      [SKY[2], DEEP],
    ],
    SKY[1],
    1,
  );
const cardLit = (): Grid =>
  ringed(
    8,
    [
      [GOLD[1], GOLD[0]],
      [SKY[3], SKY[1]],
    ],
    LIT,
    1,
  );
/** A hollow that holds something: a figure on a bench, a thing for sale, the trough of a bar. */
const slot = (): Grid =>
  ringed(
    8,
    [
      [INK, SKY[2]],
      [DEEP, DEEP],
    ],
    DEEP,
    0,
  );
const paper = (): Grid =>
  ringed(
    12,
    [
      [INK, INK],
      [CREAM, PAPER[1]],
    ],
    PAPER[2],
    2,
  );
const bubble = (): Grid => ringed(10, [[INK, INK]], CREAM, 2);
const tip = (): Grid =>
  ringed(
    8,
    [
      [INK, INK],
      [SKY[3], SKY[2]],
    ],
    "#1f1226",
    1,
  );

interface Tones {
  readonly light: string;
  readonly face: string;
  readonly shade: string;
  readonly lip: string;
}
/** A button standing up on its lip, and the same pushed down onto it. */
function button(t: Tones, down: boolean): Grid {
  const pal = { k: INK, i: t.light, h: t.face, g: t.shade, l: t.lip };
  return rows(
    down
      ? ["........", "........", ".kkkkkk.", "kggggggk", "khhhhhhk", "khhhhhhk", "kggggggk", ".kkkkkk."]
      : [".kkkkkk.", "kiiiiiik", "khhhhhhk", "khhhhhhk", "kggggggk", "kllllllk", "kllllllk", ".kkkkkk."],
    pal,
  );
}
const TONES: Readonly<Record<string, Tones>> = {
  gold: { light: GOLD[2], face: GOLD[1], shade: GOLD[0], lip: "#a3662a" },
  wood: { light: BARK[4], face: BARK[3], shade: BARK[2], lip: BARK[0] },
  plum: { light: SKY[3], face: SKY[2], shade: SKY[1], lip: DEEP },
  leaf: { light: LEAF, face: GREEN[4], shade: GREEN[3], lip: GREEN[1] },
  coral: { light: "#f4a08c", face: CORAL, shade: "#c4574f", lip: "#7d3340" },
  off: { light: STONE[2], face: STONE[1], shade: STONE[0], lip: "#353338" },
};

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
  acorn: [
    ".....bb.....",
    ".....b......",
    "..BBBBBBBB..",
    ".BnBnBnBnBB.",
    ".BBnBnBnBnB.",
    "..oyyyyyyo..",
    "..oyYyyyyo..",
    "..oyYyyyyo..",
    "..oyyyyyyo..",
    "...oyyyyo...",
    "....oyyo....",
    ".....oo.....",
  ],
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
  heart: [
    ".rr...rr..",
    "rwrr.rrrr.",
    "rwrrrrrrr.",
    "rrrrrrrrr.",
    "rrrrrrrrr.",
    ".rrrrrrr..",
    "..rrrrr...",
    "...rrr....",
    "....r.....",
  ],
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
  more: ["ww..ww..ww", "ww..ww..ww"],
  up: ["....ww....", "...wwww...", "..wwwwww..", ".wwwwwwww.", "wwwwwwwwww"],
  down: ["wwwwwwwwww", ".wwwwwwww.", "..wwwwww..", "...wwww...", "....ww...."],
};

// ---------- the stylesheet ----------

const lines: string[] = [
  "/* Made by tools/frames.ts (bun run frames). Change the drawings there, not here. */",
  ":root {",
];
const frames: Readonly<Record<string, Grid>> = {
  panel: panel(),
  shingles: shingles(),
  plaque: plaque(),
  card: card(),
  "card-lit": cardLit(),
  slot: slot(),
  paper: paper(),
  bubble: bubble(),
  tail: tail(),
  tip: tip(),
};
for (const [name, g] of Object.entries(frames)) lines.push(`  --k-f-${name}: ${url(g)};`);
for (const [name, t] of Object.entries(TONES)) {
  lines.push(`  --k-f-btn-${name}: ${url(button(t, false))};`);
  lines.push(`  --k-f-btn-${name}-down: ${url(button(t, true))};`);
}
const sizes: string[] = [];
for (const [name, art] of Object.entries(ICONS)) {
  const g = outlined(rows(art, ICON_PAL), INK);
  lines.push(`  --k-i-${name}: ${url(g)};`);
  sizes.push(
    `.k-i-${name} {\n  --w: ${g[0]?.length ?? 0};\n  --h: ${g.length};\n  background-image: var(--k-i-${name});\n}`,
  );
}
lines.push("}", ...sizes, "");
await Bun.write(new URL("../src/frames.css", import.meta.url), lines.join("\n"));
console.log(`frames.css: ${Object.keys(frames).length + Object.keys(TONES).length * 2} frames, ${sizes.length} icons`);
