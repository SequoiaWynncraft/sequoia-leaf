/**
 * Every texture in the game, 16x16, all of it the game's own.
 *
 * The world's blocks wear the tiles drawn pixel by pixel in `drawn.ts`. Each block shows its one
 * tile, as a block game does. The few things the game shapes its own way are drawn here in code:
 * the lantern, the flame, the banner, the string lights.
 */
import { ihash, noise2 } from "../engine/rand.ts";
import { DRAWN } from "./drawn.ts";

export const TILE = 16;
export type Paint = (x: number, y: number) => string | null;

const rows =
  (art: readonly string[], key: Record<string, string>): Paint =>
  (x, y) => {
    const ch = art[y]?.[x] ?? ".";
    return ch === "." ? null : (key[ch] ?? null);
  };

/**
 * The world's one tone: quiet and a little deep, as the lawn is. A drawn tile keeps its drawing,
 * but its colours are pulled in toward their own middle and set a little darker, by how loud that
 * material was drawn: [how much contrast is kept, how light it stays], by the start of its name.
 */
const TONE: readonly (readonly [string, number, number])[] = [
  ["window", 1, 1],
  ["log_seat", 0.7, 0.9],
  ["log_top", 0.75, 0.88],
  ["log", 0.58, 0.8],
  ["leaves", 0.6, 0.88],
  ["cobble", 0.62, 0.84],
  ["stone_bricks", 0.7, 0.86],
  ["grass_side", 0.65, 0.9],
  ["grass_top", 0.55, 0.86],
  ["grass", 0.8, 1],
  ["fern", 0.8, 1],
  ["dirt", 0.7, 0.95],
  ["podzol", 0.7, 0.95],
  ["path", 0.7, 0.95],
  ["mushroom", 0.9, 0.92],
  ["dandelion", 0.9, 0.92],
  ["poppy", 0.9, 0.92],
  ["cornflower", 0.9, 0.92],
  ["daisy", 0.9, 0.9],
  ["sapling", 0.85, 0.92],
  ["wool", 0.8, 0.88],
];
function calm(
  name: string,
  d: { key: Readonly<Record<string, string>>; rows: readonly string[] },
): Record<string, string> {
  const [, keep, level] = TONE.find(([start]) => name.startsWith(start)) ?? ["", 0.7, 0.9];
  const mid = [0, 0, 0];
  let n = 0;
  for (const row of d.rows)
    for (const ch of row) {
      const hex = d.key[ch];
      if (!hex) continue;
      for (let i = 0; i < 3; i++) mid[i]! += parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
      n++;
    }
  return Object.fromEntries(
    Object.entries(d.key).map(([k, hex]) => [
      k,
      `#${[0, 1, 2]
        .map((i) => {
          const m = mid[i]! / Math.max(1, n);
          const v = (m + (parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) - m) * keep) * level;
          return Math.round(Math.max(0, Math.min(255, v)))
            .toString(16)
            .padStart(2, "0");
        })
        .join("")}`,
    ]),
  );
}

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
  ...Object.fromEntries(Object.entries(DRAWN).map(([name, d]) => [name, rows(d.rows, calm(name, d))])),
  lantern,
  flame: rows(FLAME, { o: "#e67967", y: "#f5b95e", w: "#fff3cf" }),
  cone: (x, y) => ((x + y) & 1 ? ((x ^ y) & 2 ? "#6b3d1f" : "#94582c") : "#3a1f12"),
};

/**
 * The lawn's greens, darkest first. A lawn is not tiled from a drawing: the game colours every pixel
 * of it by where it lies in the world, from these, so no patch of grass is ever the same as another.
 */
export interface Ground {
  /** Six colours, darkest first. */
  readonly ramp: readonly string[];
  /** Where the grain's value passes from one colour to the next, so each keeps its share of the ground. */
  readonly cuts: readonly number[];
  /** A rare other thing lying in it (a pebble), and how much of the ground it covers. */
  readonly speck: string;
  readonly rate: number;
}
const light = (hex: string): number =>
  (parseInt(hex.slice(1, 3), 16) * 0.2126 +
    parseInt(hex.slice(3, 5), 16) * 0.7152 +
    parseInt(hex.slice(5, 7), 16) * 0.0722) /
  255;
const grey = (hex: string): boolean => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return Math.max(...c) - Math.min(...c) < 14;
};
/** The value below which a share `q` of the grain falls; the grain is close to a bell round a half. */
const quantile = (q: number): number => {
  const x = 2 * Math.min(0.999, Math.max(0.001, q)) - 1;
  const l = Math.log(1 - x * x);
  const t = 2 / (Math.PI * 0.147) + l / 2;
  return 0.5 + 0.165 * Math.SQRT2 * Math.sign(x) * Math.sqrt(Math.sqrt(t * t - l / 0.147) - t);
};
/** Reads a ground's colours and their shares off its drawn tile: what the artist chose, laid out by the world. */
function ground(name: string): Ground {
  const d = DRAWN[name]!;
  const count = new Map<string, number>();
  for (const row of d.rows) for (const ch of row) count.set(d.key[ch]!, (count.get(d.key[ch]!) ?? 0) + 1);
  const specks = [...count].filter(([hex]) => grey(hex)).sort((a, b) => b[1] - a[1]);
  const body = [...count].filter(([hex]) => !grey(hex)).sort((a, b) => light(a[0]) - light(b[0]));
  const total = body.reduce((n, [, k]) => n + k, 0);
  const ramp = body.map(([hex]) => hex);
  const cuts: number[] = [];
  let sum = 0;
  for (const [, k] of body.slice(0, -1)) cuts.push(quantile((sum += k) / total));
  while (ramp.length < 6) {
    ramp.push(ramp[ramp.length - 1]!);
    cuts.push(2);
  }
  return {
    ramp: ramp.slice(0, 6),
    cuts: cuts.slice(0, 5),
    speck: specks[0]?.[0] ?? ramp[0]!,
    rate: specks.reduce((n, [, k]) => n + k, 0) / 256,
  };
}
/** The grounds the world colours pixel by pixel: the lawn, the forest floor, the path, bare earth. */
export const GROUNDS: readonly Ground[] = ["grass_top", "podzol_top", "path", "dirt"].map(ground);

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
    if (dx < 2.4 - k * 3 && k < 0.45) return "#ffe9a0";
    if (dx < 5 - k * 4.2 && k < 0.8) return "#f8bd4a";
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
