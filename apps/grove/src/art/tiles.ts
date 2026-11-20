/**
 * Every texture in the game, 16x16.
 *
 * The world's blocks wear a texture pack: REFI Textures, an openly licensed pack in Minecraft's look (see
 * `assets/pack/LICENSE.md`), built into `pack.gen.ts` by `bun run pack`. Each block shows its one
 * tile, as a block game does. The few things the pack has no texture for are drawn here: the
 * lantern, the flame, the banner, the string lights.
 */
import { ihash, noise2 } from "../engine/rand.ts";
import { DRAWN } from "./drawn.ts";
import { PACK } from "./pack.gen.ts";

export const TILE = 16;
export type Paint = (x: number, y: number) => string | null;

const rows =
  (art: readonly string[], key: Record<string, string>): Paint =>
  (x, y) => {
    const ch = art[y]?.[x] ?? ".";
    return ch === "." ? null : (key[ch] ?? null);
  };

/** A pack tile: its pixels as they were drawn. */
const fromPack = (data: string): Paint => {
  const px = atob(data);
  const two = (i: number): string => px.charCodeAt(i).toString(16).padStart(2, "0");
  return (x, y) => {
    const i = (y * TILE + x) * 4;
    return px.charCodeAt(i + 3) < 128 ? null : `#${two(i)}${two(i + 1)}${two(i + 2)}`;
  };
};

/** One tile for every face of the lantern's small boxes: frame, glass, cap, chain. */
const lantern: Paint = (x, y) => {
  if (y <= 3) return "#2c1e25";
  if (y <= 5) return x >= 6 && x <= 9 ? "#47253b" : "#2c1e25";
  if (x < 5 || x > 10 || y > 13) return "#2c1e25";
  if (x === 5 || x === 10 || y === 6 || y === 13) return "#2c1e25";
  return (x === 7 || x === 8) && y >= 8 && y <= 11 ? "#fff3cf" : y >= 12 ? "#d49045" : "#f5b95e";
};

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

export const TILES: Record<string, Paint> = {
  ...Object.fromEntries(Object.entries(PACK).map(([name, data]) => [name, fromPack(data)])),
  // A tile drawn by hand stands in for the pack's.
  ...Object.fromEntries(Object.entries(DRAWN).map(([name, d]) => [name, rows(d.rows, d.key)])),
  lantern,
  flame: rows(FLAME, { o: "#e67967", y: "#f5b95e", w: "#fff3cf" }),
  cone: (x, y) => ((x + y) & 1 ? ((x ^ y) & 2 ? "#6b3d1f" : "#94582c") : "#3a1f12"),
};

/** A tile with every colour darkened: the charred bark inside a fire scar is the tree's own bark, burnt. */
const dim =
  (paint: Paint, k: number): Paint =>
  (x, y) => {
    const c = paint(x, y);
    if (!c) return null;
    const v = (i: number): string =>
      Math.round(parseInt(c.slice(i, i + 2), 16) * k)
        .toString(16)
        .padStart(2, "0");
    return `#${v(1)}${v(3)}${v(5)}`;
  };
TILES.log_dark = dim(TILES.log!, 0.42);

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

// ---------- relief: how a tile's surface stands up and how much it shines ----------

/**
 * How deep a material's relief is and how smooth it is, by the start of the tile's name. A tile not
 * listed is flat and matt: a skin, a flame, a leaf.
 */
const SURFACE: readonly (readonly [string, number, number])[] = [
  ["cobble", 1.5, 0.16],
  ["stone_bricks", 1.4, 0.3],
  ["bricks", 1.3, 0.14],
  ["log", 0.55, 0.1],
  ["planks", 1.0, 0.18],
  ["roof", 1.0, 0.18],
  ["barrel", 1.0, 0.18],
  ["ladder", 0.9, 0.12],
  ["dirt", 0.45, 0.1],
  ["path", 0.5, 0.1],
  ["podzol", 0.45, 0.1],
  ["grass_top", 0.5, 0.14],
  ["grass_side", 0.6, 0.12],
  ["moss", 0.5, 0.12],
  ["wool", 0.35, 0.04],
  ["window", 0.3, 0.9],
  ["lantern", 0, 0.6],
];

/**
 * A tile's relief as RGBA rows from the top: the way each pixel's surface leans (red to the right,
 * green upward, blue out of the face, 128 being none) and its smoothness in alpha. The relief is
 * read from the drawing itself, dark for a crack and light for a ridge, wrapping at the edges as
 * the tile does. It lets a lamp pick out each stone and board where a flat face would only fade.
 */
export function reliefTile(name: string): Uint8Array {
  const [, bump, smooth] = SURFACE.find(([start]) => name.startsWith(start)) ?? ["", 0, 0.05];
  const px = paintTile(name);
  const height = (x: number, y: number): number => {
    const i = (((y + TILE) % TILE) * TILE + ((x + TILE) % TILE)) * 4;
    return (px[i]! * 0.3 + px[i + 1]! * 0.59 + px[i + 2]! * 0.11) / 255;
  };
  const out = new Uint8Array(TILE * TILE * 4);
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const dx = (height(x + 1, y) - height(x - 1, y)) * bump * 2.2;
      // Rows run down the drawing and up the face.
      const dy = (height(x, y - 1) - height(x, y + 1)) * bump * 2.2;
      const len = Math.hypot(dx, dy, 1);
      out.set(
        [128 - (dx / len) * 127, 128 - (dy / len) * 127, 128 + (1 / len) * 127, Math.round(smooth * 255)],
        (y * TILE + x) * 4,
      );
    }
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

/** The bed of the fire: charred wood with coals glowing through. */
TILES.embers = (x, y) => {
  const hot = noise2(x / 3, y / 3, 81, 0) + ihash(x, y, 1, 82) * 0.3;
  return hot > 0.95 ? "#fff3cf" : hot > 0.75 ? "#f5b95e" : hot > 0.55 ? "#e67967" : hot > 0.4 ? "#763332" : "#230e0c";
};
TILES.bulb = () => "#ffe9b0";
TILES.wire = () => "#241612";
