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
const PLUM: Ramp = ["#3a2f52", "#5a4b7c", "#8a78b3"];
/** The five tiers: stone, jade, sapphire, amethyst, gold. Each is its band, its jewel, and how large the jewel is. */
const TIERS = [
  [["#565267", "#8d899f", "#cfcbdc"], ["#6f6b80", "#a9a5ba", "#e6e3ef"], 1],
  [["#2c7a3a", "#4dbb58", "#a4f585"], ["#1f8f4a", "#58e07a", "#d2ffc0"], 2],
  [["#2859a6", "#3d97ee", "#93d6ff"], ["#1c6fd6", "#52b6ff", "#d6f1ff"], 3],
  [["#7a2ba3", "#b957e6", "#eaa6ff"], ["#a12fd6", "#dc7bff", "#fbe0ff"], 3],
  [["#a9641a", "#f2ab2e", "#ffe27c"], ["#e0457a", "#ff8fb0", "#ffe3ec"], 3],
] as const satisfies readonly (readonly [band: Ramp, gem: Ramp, size: number])[];

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

/** A thin brass frame round a panel, and round a tip. */
const panel = (): Grid => frame({ band: BRASS, thick: 4, cut: 2, corner: 5, gem: [BRASS, 1], fill: FIELD, drop: 2 });
/** A quiet plum one, for the small things that sit over the world: the purse, the dock, a counter. */
const plaque = (): Grid => frame({ band: PLUM, thick: 4, cut: 2, corner: 5, fill: FIELD, drop: 2 });
/** A tier's frame: the jewel on each corner grows with the tier. It is drawn over what it holds. */
const tier = ([band, gem, size]: (typeof TIERS)[number]): Grid =>
  frame({ band, thick: 5, cut: 3, corner: 9, gem: [gem, size] });

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

/** A row or a tile that stands up from the panel: flat, a step lighter. And the same picked out in gold. */
const card = (): Grid => ringed(8, [[INK, INK]], RAISED, 1);
const cardLit = (): Grid =>
  ringed(
    8,
    [
      [INK, INK],
      ["#ffc247", "#f5ad35"],
    ],
    "#2b2440",
    1,
  );
/** A hollow that holds something: a figure on a bench, a thing for sale, the trough of a bar. */
const slot = (): Grid => ringed(8, [[INK, LINE]], WELL, 0);
/** The same hollow picked out in gold: the one of a row that is chosen, or where you are. */
const slotLit = (): Grid =>
  ringed(
    8,
    [
      [INK, INK],
      ["#ffc247", "#f5ad35"],
    ],
    RAISED,
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
/** What a button's colour says: gold confirms, blue shows or hides, green buys or grows, wood is plain, coral leaves or removes, slate is quiet. */
const TONES: Readonly<Record<string, Tones>> = {
  gold: { light: "#ffe082", face: "#f5ad35", foot: "#bf6e17" },
  blue: { light: "#7cc6ff", face: "#2f86e0", foot: "#1a4d99" },
  green: { light: "#8ae583", face: "#3ea852", foot: "#216a34" },
  wood: { light: "#b97c48", face: "#84532f", foot: "#54301a" },
  coral: { light: "#f89785", face: "#d9584d", foot: "#98302f" },
  slate: { light: "#74679a", face: "#4b4163", foot: "#2b2440" },
  off: { light: "#453c5c", face: "#332b47", foot: "#221c33" },
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
  panel: panel(),
  shingles: shingles(),
  plaque: plaque(),
  ...Object.fromEntries(TIERS.map((t, i) => [`tier-${i + 1}`, tier(t)])),
  "crest-3": crest(TIERS[2][1]),
  "crest-4": crest(TIERS[3][1]),
  "crest-5": crown(TIERS[4][0], TIERS[4][1]),
  card: card(),
  "card-lit": cardLit(),
  slot: slot(),
  "slot-lit": slotLit(),
  paper: paper(),
  bubble: bubble(),
  tail: tail(),
  hex: hex(0, INK),
  "hex-in": hex(1, "#1a1128"),
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
lines.push("}", ...sizes, "");
await Bun.write(new URL("../src/frames.css", import.meta.url), lines.join("\n"));
console.log(
  `frames.css: ${Object.keys(frames).length} frames, ${Object.keys(TONES).length} buttons, ${sizes.length} icons`,
);
