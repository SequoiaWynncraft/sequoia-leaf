/**
 * Every block texture in the game: 16x16, drawn here from the welcome forest's own colours.
 *
 * One rule keeps the art consistent: everything in the world is a 16x16 tile on a box. A tile is a
 * small function from a pixel to a colour, so it tiles, it can be read in review, and a change is
 * one line. `bun review/atlas.ts` writes them all to a sheet.
 */
import { ihash, noise2 } from "../engine/rand.ts";

export const TILE = 16;
export type Paint = (x: number, y: number) => string | null;

const at = (ramp: readonly string[], i: number): string => ramp[Math.max(0, Math.min(ramp.length - 1, Math.round(i)))]!;
const wrap = (d: number): number => d - 16 * Math.round(d / 16);
const rows =
  (art: readonly string[], key: Record<string, string>): Paint =>
  (x, y) => {
    const ch = art[y]?.[x] ?? ".";
    return ch === "." ? null : (key[ch] ?? null);
  };

// The welcome's ramps.
const BARK = ["#2a110c", "#3b1910", "#471d10", "#602714", "#763332", "#8a3b3c"] as const;
const CHAR = ["#150a09", "#1c0c0a", "#230e0c", "#34150d"] as const;
const LEAF = ["#221d0c", "#2d290e", "#453814", "#5c5017"] as const;
const LEAF_LIT = ["#2d290e", "#453814", "#5c5017", "#857022"] as const;
const LEAF_DARK = ["#1a160a", "#221d0c", "#2d290e", "#3b3311"] as const;
const MOSS = ["#2a240f", "#363210", "#453814", "#524915", "#6a5f1a"] as const;
const DIRT = ["#241612", "#34150d", "#3b1910", "#471d10"] as const;
const STONE = ["#231a20", "#2f2229", "#3d2c35", "#544049"] as const;
const PLANK = ["#3b2412", "#5e3d1a", "#74501f", "#8a6426"] as const;
const SLATE = ["#241a22", "#39212e", "#47253b", "#5a3148"] as const;

/**
 * Redwood bark: long plates between dark furrows, as the welcome's giant trunks are painted. Tone
 * goes by column, so the bark reads as vertical streaks; a furrow steps aside a pixel here and
 * there, and each plate is cracked across once.
 */
const bark = (ramp: readonly string[]): Paint => {
  const n = ramp.length - 1;
  const column = [0, 2, 3, 4, 3, 0, 3, 4, 4, 3, 1, 0, 3, 4, 3, 2];
  const shift = (x: number, y: number): number =>
    x >= 5 && x <= 7 && y >= 6 && y <= 11 ? 1 : x >= 9 && x <= 11 && (y <= 4 || y >= 13) ? -1 : 0;
  const cracks: [number, number, number][] = [
    [7, 2, 4],
    [13, 6, 9],
    [2, 8, 10],
    [10, 12, 14],
    [15, 1, 3],
  ];
  const lights: [number, number, number][] = [
    [3, 1, 4],
    [8, 8, 11],
    [13, 3, 5],
    [7, 14, 15],
    [14, 11, 13],
  ];
  return (x, y) => {
    let tone = column[(x - shift(x, y) + 16) & 15]!;
    if (tone > 0 && cracks.some(([cy, x0, x1]) => y === cy && x >= x0 && x <= x1)) tone = 1;
    if (tone >= 3 && lights.some(([cx, y0, y1]) => x === cx && y >= y0 && y <= y1)) tone = 5;
    return ramp[Math.round((tone / 5) * n)]!;
  };
};

/** Foliage in clumps, each lit from the upper right, with the sky showing between them. */
const leaves = (ramp: readonly string[], seed: number, holes: number): Paint => {
  // Sprays of needles: short strokes climbing to the left or right, each lighter toward its tip.
  const tone = new Int8Array(256).fill(-1);
  for (let i = 0; i < 30; i++) {
    const x = Math.floor(ihash(i, 1, 0, seed) * 16);
    const y = Math.floor(ihash(i, 2, 0, seed) * 16);
    const dir = ihash(i, 3, 0, seed) < 0.5 ? 1 : -1;
    const len = 3 + Math.floor(ihash(i, 4, 0, seed) * 3);
    for (let k = 0; k < len; k++) {
      const px = (x + dir * k + 160) & 15;
      const py = (y - k + 160) & 15;
      const beside = (px + dir + 16) & 15;
      if (tone[py * 16 + beside]! < 1) tone[py * 16 + beside] = k >= len - 2 ? 2 : 1;
      tone[py * 16 + px] = k === len - 1 ? 3 : k >= len - 3 ? 2 : 1;
    }
  }
  return (x, y) => {
    const t = tone[y * 16 + x]!;
    if (t < 0) return ihash(x, y, 7, seed) < holes ? null : ramp[0]!;
    return ramp[t]!;
  };
};

const speckle =
  (ramp: readonly string[], seed: number, scale = 4): Paint =>
  (x, y) => {
    const n = noise2(x / scale, y / scale, seed, 16 / scale) * 0.6 + ihash(x, y, 1, seed) * 0.4;
    return at(ramp, n * (ramp.length - 1) * 1.15 - 0.2);
  };

const mossTop: Paint = (x, y) => {
  const base = speckle(MOSS.slice(1, 4), 21)(x, y)!;
  const tuft = ihash(x, y >> 1, 4, 22);
  if (tuft > 0.93) return MOSS[4]!;
  if (ihash(x, y, 5, 23) > 0.95) return MOSS[0]!;
  return base;
};

const dirt = speckle(DIRT, 31, 2);

/** The redwood floor where no moss grows: a litter of fallen needles, rust on dark earth. */
const duff: Paint = (x, y) => {
  const needle = ihash(x >> 1, y, 1, 36) > 0.9 || ihash(x, y >> 1, 2, 37) > 0.93;
  if (needle) return ihash(x, y, 3, 38) > 0.6 ? "#602714" : "#471d10";
  return speckle(["#241612", "#2c1810", "#34150d"], 39, 3)(x, y);
};

const mossSide: Paint = (x, y) => {
  const edge = 3 + Math.round(noise2(x / 2, 0, 41, 8) * 2.4);
  if (y < edge) return mossTop(x, y);
  if (y === edge) return MOSS[0]!;
  return dirt(x, y);
};

/** Stones fitted together: a few cells, each darker at its seam and lit on its upper left. */
const stone = (seed: number, moss: number): Paint => {
  const pts = Array.from({ length: 7 }, (_, i) => [ihash(i, 1, 0, seed) * 16, ihash(i, 2, 0, seed) * 16] as const);
  return (x, y) => {
    let d1 = 99;
    let d2 = 99;
    let own = 0;
    pts.forEach(([px, py], i) => {
      const d = Math.hypot(wrap(x + 0.5 - px), wrap(y + 0.5 - py) * 1.25);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        own = i;
      } else if (d < d2) d2 = d;
    });
    if (moss && noise2(x / 4, y / 4, seed + 5, 4) + ihash(x, y, 2, seed) * 0.3 > 1.15 - moss) return mossTop(x, y);
    if (d2 - d1 < 0.9) return STONE[0]!;
    const [px, py] = pts[own]!;
    const lit = wrap(x + 0.5 - px) + wrap(y + 0.5 - py) < -1.2;
    return lit ? STONE[3]! : ihash(x, y, 3, seed) < 0.3 ? STONE[1]! : STONE[2]!;
  };
};

/** Boards four pixels high, their ends staggered, a grain line in each. */
const planks: Paint = (x, y) => {
  const board = y >> 2;
  const row = y & 3;
  if (row === 3) return PLANK[0]!;
  const end = (board * 7 + 3) & 15;
  if (x === end) return PLANK[0]!;
  const knot = Math.hypot(x - ((board * 5 + 9) & 15), (row - 1) * 1.6);
  if (board % 2 === 0 && knot < 0.6) return PLANK[0]!;
  if (board % 2 === 0 && knot < 1.7) return PLANK[1]!;
  if (row === 0) return ihash(x >> 1, board, 1, 51) < 0.4 ? PLANK[3]! : PLANK[2]!;
  return ihash(x >> 2, y, 2, 52) < 0.3 ? PLANK[1]! : PLANK[2]!;
};

const logTop: Paint = (x, y) => {
  const d = Math.hypot(x - 7.5, y - 7.5) + (noise2(x / 3, y / 3, 61) - 0.5) * 1.2;
  if (d > 6.9) return BARK[1]!;
  if (d > 6.1) return BARK[3]!;
  if (d < 1) return BARK[3]!;
  return Math.floor(d * 0.95) % 2 ? BARK[3]! : BARK[4]!;
};

/** Roof slates in courses, each course half a slate along from the last. */
const slate: Paint = (x, y) => {
  const course = y >> 2;
  const row = y & 3;
  const sx = (x + (course & 1) * 4) & 7;
  if (row === 0) return SLATE[0]!;
  if (sx === 0) return SLATE[1]!;
  if (row === 3) return ihash(x >> 1, course, 1, 71) < 0.5 ? SLATE[3]! : SLATE[2]!;
  return ihash(x, y, 2, 72) < 0.2 ? SLATE[1]! : SLATE[2]!;
};

const windowPane: Paint = (x, y) => {
  if (x < 2 || x > 13 || y < 2 || y > 13) return planks(x, y);
  if (x === 2 || x === 13 || y === 2 || y === 13 || x === 7 || x === 8 || y === 7 || y === 8) return "#452a14";
  const glow = ihash(x >> 1, y >> 1, 1, 81);
  return glow < 0.3 ? "#ffe9b0" : glow < 0.8 ? "#f5b95e" : "#d49045";
};

/** One tile for every face of the lantern's small boxes: frame, glass, cap, chain. */
const lantern: Paint = (x, y) => {
  if (y <= 3) return "#2c1e25";
  if (y <= 5) return x >= 6 && x <= 9 ? "#47253b" : "#2c1e25";
  if (x < 5 || x > 10 || y > 13) return "#2c1e25";
  if (x === 5 || x === 10 || y === 6 || y === 13) return "#2c1e25";
  return (x === 7 || x === 8) && y >= 8 && y <= 11 ? "#fff3cf" : y >= 12 ? "#d49045" : "#f5b95e";
};

const ladder: Paint = (x, y) => {
  const rail = x === 2 || x === 3 || x === 12 || x === 13;
  const rung = (y & 3) === 1 && x >= 2 && x <= 13;
  if (rail) return x === 3 || x === 13 ? PLANK[1]! : PLANK[2]!;
  if (rung) return PLANK[3]!;
  if ((y & 3) === 2 && x >= 4 && x <= 11) return PLANK[0]!;
  return null;
};

const FERN = [
  "................",
  ".....b....b.....",
  "....bc...cb..b..",
  ".b...cb..bc.cb..",
  ".cb..bc.cb..c...",
  "..cb..cbcb.cb...",
  "b..cb.bcc.cb..b.",
  "cb..cbbcbbc..bc.",
  ".cb..ccbcc..bc..",
  "..ccb.cbc.bcc...",
  "...ccbbcbbcc....",
  "....cccbccc.....",
  ".....ccacc......",
  "......cac.......",
  "......aaa.......",
  ".......a........",
];
const SPROUT = [
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  ".......b........",
  "......bcb.......",
  ".....bcccb......",
  "......ccc.......",
  ".....bcacb......",
  "....bccaccb.....",
  "......cac.......",
  ".......a........",
  ".......a........",
];
const SHROOM = [
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  ".....yy.........",
  "....yYYy........",
  "...yYYYYy...y...",
  "...ydssdy..yYy..",
  ".....ss...yYYYy.",
  ".....ss....dsd..",
  ".....ss.....s...",
];
const FLAME = [
  "................",
  "................",
  ".......o........",
  "......oo........",
  "......oyo...o...",
  ".....oyyo..oo...",
  "..o..oyyyo.oyo..",
  "..oo.oywyooyyo..",
  "..oyooywwyoyyo..",
  ".oyyoyywwyyywo..",
  ".oywyywwwwywwyo.",
  ".oywwywwwwwwwyo.",
  ".oywwwwwwwwwwyo.",
  "..oywwwwwwwwyo..",
  "...oyywwwwyyo...",
  "....oooyyooo....",
];

const pathTop: Paint = (x, y) => {
  if (ihash(x, y, 1, 91) > 0.95) return STONE[3]!;
  return speckle(["#3b1910", "#471d10", "#54261a"], 92, 2)(x, y);
};

const GRASS = [
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "....b......b....",
  "..b.c..b...c.b..",
  "..c.c..c.b.c.c..",
  ".bc.cb.c.c.cbc..",
  ".cc.cc.cbc.ccc.b",
  ".cacacacacacacac",
  ".aaaaaaaaaaaaaa.",
];

export const TILES: Record<string, Paint> = {
  bark: bark(BARK),
  bark_char: bark(CHAR),
  log_top: logTop,
  leaves: leaves(LEAF, 11, 0.3),
  leaves_lit: leaves(LEAF_LIT, 12, 0.3),
  leaves_dark: leaves(LEAF_DARK, 13, 0.2),
  moss: mossTop,
  moss_side: mossSide,
  dirt,
  duff,
  path: pathTop,
  stone: stone(101, 0),
  stone_mossy: stone(102, 0.55),
  planks,
  slate,
  window: windowPane,
  lantern,
  ladder,
  fern: rows(FERN, { a: MOSS[0]!, c: MOSS[2]!, b: MOSS[4]! }),
  grass: rows(GRASS, { a: MOSS[1]!, c: MOSS[3]!, b: MOSS[4]! }),
  sprout: rows(SPROUT, { a: BARK[3]!, c: LEAF[2]!, b: LEAF_LIT[3]! }),
  shroom: rows(SHROOM, { y: "#d49045", Y: "#f5b95e", s: "#e0c39a", d: "#9b7724" }),
  flame: rows(FLAME, { o: "#e67967", y: "#f5b95e", w: "#fff3cf" }),
};

/** Every tile's name, in the order of its layer in the texture. Tiles can be added until the texture is built. */
export const tileNames = (): string[] => Object.keys(TILES);
export const addTile = (name: string, paint: Paint): void => {
  TILES[name] = paint;
};
export const tileIndex = (name: string): number => {
  const i = tileNames().indexOf(name);
  if (i < 0) throw new Error(`no tile ${name}`);
  return i;
};

const hex = (c: string): [number, number, number] => [
  parseInt(c.slice(1, 3), 16),
  parseInt(c.slice(3, 5), 16),
  parseInt(c.slice(5, 7), 16),
];

/** A tile as RGBA rows from the top. Clear pixels carry the tile's mean colour, so far-off edges stay clean. */
export function paintTile(name: string): Uint8Array {
  const paint = TILES[name]!;
  const out = new Uint8Array(TILE * TILE * 4);
  const sum = [0, 0, 0];
  let n = 0;
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const c = paint(x, y);
      if (!c) continue;
      const [r, g, b] = hex(c);
      out.set([r, g, b, 255], (y * TILE + x) * 4);
      sum[0]! += r;
      sum[1]! += g;
      sum[2]! += b;
      n++;
    }
  for (let i = 0; i < TILE * TILE; i++) if (!out[i * 4 + 3]) out.set([sum[0]! / n, sum[1]! / n, sum[2]! / n, 0], i * 4);
  return out;
}

// ---------- the campfire's things ----------

/** A flame two tiles tall, drawn afresh for each frame: licks that lean and rise, a pale core, a few sparks. */
const flameAt =
  (frame: number) =>
  (x: number, up: number): string | null => {
    const dx = Math.abs(x - 7.5);
    const lick = Math.sin(x * 1.3 + frame * 1.7) * 2.2 + Math.sin(x * 0.7 - frame * 2.3) * 1.6;
    const top = 23 - dx * dx * 0.42 + lick;
    if (up > top) return up < top + 6 && ihash(x, up, frame, 61) > 0.985 ? "#f5b95e" : null;
    const k = up / Math.max(top, 1);
    if (dx < 3.2 - k * 3 && k < 0.55) return "#fff3cf";
    if (dx < 5 - k * 4.2 && k < 0.8) return "#f7c75a";
    return k > 0.85 ? "#c8452c" : "#f08a3c";
  };
for (let f = 0; f < 4; f++) {
  TILES[`flame${f}_lo`] = (x, y) => flameAt(f)(x, 15 - y);
  TILES[`flame${f}_hi`] = (x, y) => flameAt(f)(x, 31 - y);
}

/** The guild's banner, twelve pixels wide: a gold sun on purple, cut to two points at the foot. */
const bannerAt = (x: number, down: number): string | null => {
  if (x < 2 || x > 13 || down > 27) return null;
  if (down > 22 && Math.abs(x - 7.5) < (down - 22) * 1.15) return null;
  if (x === 2 || x === 13 || down === 0) return "#d49045";
  const r = Math.hypot(x - 7.5, down - 10.5);
  if (r < 2.7) return r < 1.4 ? "#fff3cf" : "#f5b95e";
  const ray =
    (Math.abs(x - 7.5) < 0.6 ||
      Math.abs(down - 10.5) < 0.6 ||
      Math.abs(Math.abs(x - 7.5) - Math.abs(down - 10.5)) < 0.6) &&
    r < 5.2 &&
    r > 3.4;
  if (ray) return "#d49045";
  if (down === 19 && x > 4 && x < 11) return "#d49045";
  return x === 5 || x === 10 ? "#472365" : "#54286a";
};
TILES.banner_top = (x, y) => bannerAt(x, y);
TILES.banner_foot = (x, y) => bannerAt(x, y + 16);

/** A woven rug: rust, with a gold and purple lattice. */
TILES.rug = (x, y) => {
  const d = (x + y) & 7;
  const e = (x - y + 16) & 7;
  if (d === 0 || e === 0) return d === e ? "#f5b95e" : "#d49045";
  if (d === 4 && e === 4) return "#54286a";
  return ihash(x, y, 1, 71) < 0.25 ? "#602714" : "#763332";
};
TILES.crate = (x, y) => {
  if (x === 0 || y === 0 || x === 15 || y === 15) return PLANK[0]!;
  if (x === 1 || y === 1 || x === 14 || y === 14) return PLANK[3]!;
  if (Math.abs(x - y) < 1.5) return PLANK[1]!;
  return planks(x, y);
};
/** The bed of the fire: charred wood with coals glowing through. */
TILES.embers = (x, y) => {
  const hot = noise2(x / 3, y / 3, 81, 0) + ihash(x, y, 1, 82) * 0.3;
  return hot > 0.95 ? "#fff3cf" : hot > 0.75 ? "#f5b95e" : hot > 0.55 ? "#e67967" : hot > 0.4 ? "#763332" : "#230e0c";
};
TILES.bulb = () => "#ffe9b0";
TILES.wire = () => "#241612";
