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
const rows =
  (art: readonly string[], key: Record<string, string>): Paint =>
  (x, y) => {
    const ch = art[y]?.[x] ?? ".";
    return ch === "." ? null : (key[ch] ?? null);
  };

// The welcome's ramps.
const BARK = ["#2a110c", "#3b1910", "#471d10", "#602714", "#763332", "#8a3b3c"] as const;
const LEAF = ["#221d0c", "#2d290e", "#453814", "#5c5017"] as const;
const LEAF_LIT = ["#2d290e", "#453814", "#5c5017", "#857022"] as const;
const LEAF_DARK = ["#1a160a", "#221d0c", "#2d290e", "#3b3311"] as const;
const MOSS = ["#2a240f", "#363210", "#453814", "#524915", "#6a5f1a"] as const;
const DIRT = ["#241612", "#34150d", "#3b1910", "#471d10"] as const;
const STONE = ["#231a20", "#2f2229", "#3d2c35", "#544049"] as const;

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

/** One tile for every face of the lantern's small boxes: frame, glass, cap, chain. */
const lantern: Paint = (x, y) => {
  if (y <= 3) return "#2c1e25";
  if (y <= 5) return x >= 6 && x <= 9 ? "#47253b" : "#2c1e25";
  if (x < 5 || x > 10 || y > 13) return "#2c1e25";
  if (x === 5 || x === 10 || y === 6 || y === 13) return "#2c1e25";
  return (x === 7 || x === 8) && y >= 8 && y <= 11 ? "#fff3cf" : y >= 12 ? "#d49045" : "#f5b95e";
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
  leaves: leaves(LEAF, 11, 0.3),
  leaves_lit: leaves(LEAF_LIT, 12, 0.3),
  leaves_dark: leaves(LEAF_DARK, 13, 0.2),
  moss: mossTop,
  moss_side: mossSide,
  dirt,
  duff,
  path: pathTop,
  lantern,
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
/** The bed of the fire: charred wood with coals glowing through. */
TILES.embers = (x, y) => {
  const hot = noise2(x / 3, y / 3, 81, 0) + ihash(x, y, 1, 82) * 0.3;
  return hot > 0.95 ? "#fff3cf" : hot > 0.75 ? "#f5b95e" : hot > 0.55 ? "#e67967" : hot > 0.4 ? "#763332" : "#230e0c";
};
TILES.bulb = () => "#ffe9b0";
TILES.wire = () => "#241612";
