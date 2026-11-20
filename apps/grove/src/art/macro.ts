/**
 * Textures that run across blocks. A plain tile repeats on every block, so a trunk or a lawn shows
 * its grid. A macro texture is one drawing several blocks wide, cut into tiles; each block shows
 * the piece that belongs to where it stands, so bark furrows run on up the trunk, moss lies in
 * patches wider than a block and foliage sprays cross from one block into the next.
 *
 * Also here: the ragged edges laid over a seam between two kinds of ground, moss climbing a
 * trunk's foot, and the small things scattered on the forest floor.
 */
import { ihash } from "../engine/rand.ts";
import { addTile } from "./tiles.ts";

const CLEAR = 255;
const smooth = (t: number): number => t * t * (3 - 2 * t);
/** Value noise that wraps after `px` cells across and `py` down. */
function pn(x: number, y: number, seed: number, px: number, py: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const h = (a: number, b: number): number => ihash(((a % px) + px) % px, ((b % py) + py) % py, 0, seed);
  const a = h(x0, y0);
  const b = h(x0 + 1, y0);
  const c = h(x0, y0 + 1);
  const d = h(x0 + 1, y0 + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

type Put = (x: number, y: number, tone: number) => void;
/** Registers an n-by-n block drawing as n*n tiles, row by row, named `name@col,row`. */
function macro(
  name: string,
  n: number,
  colours: readonly string[],
  drawing: (size: number, put: Put, at: (x: number, y: number) => number) => void,
): void {
  const S = n * 16;
  const tone = new Uint8Array(S * S);
  const wrap = (v: number): number => ((v % S) + S) % S;
  drawing(
    S,
    (x, y, t) => {
      tone[wrap(y) * S + wrap(x)] = t;
    },
    (x, y) => tone[wrap(y) * S + wrap(x)]!,
  );
  for (let row = 0; row < n; row++)
    for (let col = 0; col < n; col++)
      addTile(`${name}@${col},${row}`, (x, y) => {
        const t = tone[(row * 16 + y) * S + col * 16 + x]!;
        return t === CLEAR ? null : colours[t]!;
      });
}
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

// ---------- redwood bark, four blocks wide and tall ----------

const BARK = ["#2a110c", "#3b1910", "#471d10", "#602714", "#763332", "#8a3b3c"];
macro("bark_m", 4, BARK, (S, put) => {
  // Furrows run the height of the drawing, each drifting a few pixels on its way; fibrous plates lie between.
  const K = 12;
  const home = Array.from({ length: K }, (_, i) => Math.round((i * S) / K + (ihash(i, 1, 0, 201) - 0.5) * 3));
  const wide = home.map((_, i) => ihash(i, 2, 0, 201) < 0.3);
  const shade = home.map((_, i) => Math.floor(ihash(i, 3, 0, 201) * 3) - 1);
  for (let Y = 0; Y < S; Y++) {
    const f = home.map((b, i) => (((b + Math.round((pn(Y / 8, i * 3.7, 202, 8, 64) - 0.5) * 5)) % S) + S) % S);
    for (let X = 0; X < S; X++) {
      let dl = S;
      let dr = S;
      let li = 0;
      for (let i = 0; i < K; i++) {
        const a = (((X - f[i]!) % S) + S) % S;
        if (a < dl) {
          dl = a;
          li = i;
        }
        dr = Math.min(dr, (((f[i]! - X) % S) + S) % S);
      }
      const edge = wide[li] ? 2 : 1;
      let t: number;
      if (dl < edge) t = 0;
      else if (dl === edge) t = 1;
      else if (dr === 1) t = 2;
      else {
        t = 3 + shade[li]!;
        const fibre = pn(X, Y / 8, 203, 64, 8);
        if (fibre > 0.7) t++;
        else if (fibre < 0.22) t--;
        t = clamp(t, 2, 5);
        // A plate is cracked across here and there: a dark line, a lit lip under it.
        const seg = Y >> 3;
        if (ihash(li, seg, 1, 204) < 0.3) {
          const cy = seg * 8 + Math.floor(ihash(li, seg, 0, 204) * 7);
          if (Y === cy) t = 1;
          else if (Y === cy + 1) t = Math.min(5, t + 1);
        }
      }
      put(X, Y, t);
    }
  }
});

// ---------- moss, four blocks wide: patches, tufts, a few needles and flowers ----------

const MOSS = ["#2a240f", "#363210", "#453814", "#524915", "#6a5f1a", "#857a22", "#763332", "#f5d9a0", "#241612"];
macro("moss_m", 4, MOSS, (S, put) => {
  for (let Y = 0; Y < S; Y++)
    for (let X = 0; X < S; X++) {
      const v = pn(X / 8, Y / 8, 211, 8, 8) * 0.6 + pn(X / 4, Y / 4, 212, 16, 16) * 0.3 + ihash(X, Y, 1, 213) * 0.1;
      put(X, Y, ihash(X, Y, 2, 214) > 0.97 ? 0 : v < 0.38 ? 1 : v < 0.6 ? 2 : 3);
    }
  for (let i = 0; i < 110; i++) {
    const x = Math.floor(ihash(i, 1, 0, 215) * S);
    const y = Math.floor(ihash(i, 2, 0, 215) * S);
    if (ihash(i, 3, 0, 215) < 0.5) {
      put(x, y, 3);
      put(x - 1, y - 1, 4);
      put(x + 1, y - 1, 4);
      put(x - 1, y - 2, 5);
      put(x + 2, y - 2, 5);
    } else {
      put(x, y, 4);
      put(x, y - 1, 4);
      put(x + 1, y - 2, 5);
    }
  }
  for (let i = 0; i < 16; i++) {
    const x = Math.floor(ihash(i, 1, 0, 216) * S);
    const y = Math.floor(ihash(i, 2, 0, 216) * S);
    const d = ihash(i, 3, 0, 216) < 0.5 ? 1 : -1;
    for (let k = 0; k < 3; k++) put(x + k * d, y + k, 6);
  }
  for (let i = 0; i < 7; i++) {
    const x = Math.floor(ihash(i, 1, 0, 217) * S);
    const y = Math.floor(ihash(i, 2, 0, 217) * S);
    put(x, y, 7);
    put(x, y + 1, 4);
    put(x + 1, y, 5);
  }
});

// ---------- the bare floor: dark earth under a litter of needles, two blocks wide ----------

const DUFF = ["#241612", "#2c1810", "#34150d", "#471d10", "#602714", "#3d2c35"];
macro("duff_m", 2, DUFF, (S, put) => {
  for (let Y = 0; Y < S; Y++)
    for (let X = 0; X < S; X++) put(X, Y, Math.floor(pn(X / 4, Y / 4, 221, 8, 8) * 2.2 + ihash(X, Y, 1, 222) * 0.8));
  for (let i = 0; i < 20; i++) {
    const x = Math.floor(ihash(i, 1, 0, 223) * S);
    const y = Math.floor(ihash(i, 2, 0, 223) * S);
    const dx = [1, 1, 0, 1][i & 3]!;
    const dy = [0, 1, 1, -1][i & 3]!;
    const len = 2 + Math.floor(ihash(i, 3, 0, 223) * 3);
    for (let k = 0; k < len; k++) put(x + dx * k, y + dy * k, ihash(i, 4, 0, 223) < 0.2 ? 4 : 3);
  }
  for (let i = 0; i < 4; i++) put(Math.floor(ihash(i, 1, 0, 224) * S), Math.floor(ihash(i, 2, 0, 224) * S), 5);
});

// ---------- foliage, three blocks wide: fans of needles, each lighter toward its tip ----------

function foliage(name: string, ramp: readonly string[], seed: number, holes: number): void {
  macro(name, 3, ramp, (S, put, at) => {
    for (let Y = 0; Y < S; Y++) for (let X = 0; X < S; X++) put(X, Y, ihash(X, Y, 1, seed) < holes ? CLEAR : 0);
    for (let i = 0; i < 150; i++) {
      const x = Math.floor(ihash(i, 1, 0, seed + 1) * S);
      const y = Math.floor(ihash(i, 2, 0, seed + 1) * S);
      const dir = ihash(i, 3, 0, seed + 1) < 0.5 ? 1 : -1;
      const len = 4 + Math.floor(ihash(i, 4, 0, seed + 1) * 5);
      for (let k = 0; k < len; k++) {
        // The stem climbs at a slant; a needle sticks out to each side of it in turn.
        const px = x + dir * Math.floor(k * 0.75);
        const py = y - k;
        const tip = k >= len - 2;
        if (k % 2 === 0 && at(px - dir, py) < 2) put(px - dir, py, 1);
        if (k % 2 === 1 && at(px + dir, py) < 2) put(px + dir, py + 1, tip ? 2 : 1);
        put(px, py, tip ? 3 : 2);
      }
    }
  });
}
foliage("leaves_m", ["#221d0c", "#2d290e", "#453814", "#5c5017"], 231, 0.2);
foliage("leaves_lit_m", ["#2d290e", "#453814", "#5c5017", "#857022"], 241, 0.2);
foliage("leaves_dark_m", ["#1a160a", "#221d0c", "#2d290e", "#3b3311"], 251, 0.12);

// ---------- seams and small things ----------

/** Moss creeping over the edge of the next block's bare ground, seen from above: ragged, never a straight line. */
for (const v of [0, 1])
  addTile(`moss_fringe${v}`, (x, y) => {
    const depth = 2 + Math.round(pn(x / 4, v * 5, 261, 4, 16) * 3.4) + (ihash(x, v, 1, 262) < 0.2 ? 1 : 0);
    if (y >= depth) return null;
    return y === depth - 1 ? MOSS[1]! : ihash(x, y, 2, 263 + v) < 0.3 ? MOSS[3]! : MOSS[2]!;
  });
/** Moss climbing the foot of a trunk. */
for (const v of [0, 1])
  addTile(`moss_creep${v}`, (x, y) => {
    const height = 2 + Math.round(pn(x / 4, v * 7, 271, 4, 16) * 7);
    const up = 15 - y;
    if (up >= height) return null;
    return up === height - 1 ? MOSS[4]! : ihash(x, y, 2, 272 + v) < 0.3 ? MOSS[3]! : MOSS[2]!;
  });

const sprinkle = (
  name: string,
  count: number,
  seed: number,
  stamp: (put: (x: number, y: number, c: string) => void, i: number) => void,
): void => {
  const px = new Map<number, string>();
  for (let i = 0; i < count; i++) {
    const ox = 2 + Math.floor(ihash(i, 1, 0, seed) * 11);
    const oy = 2 + Math.floor(ihash(i, 2, 0, seed) * 11);
    stamp((x, y, c) => px.set(((oy + y) & 15) * 16 + ((ox + x) & 15), c), i);
  }
  addTile(name, (x, y) => px.get(y * 16 + x) ?? null);
};
sprinkle("d_needles", 9, 281, (put, i) => {
  const d = i & 1 ? 1 : -1;
  for (let k = 0; k < 3; k++) put(k * d, i % 3 === 0 ? 0 : k, i % 4 === 0 ? "#763332" : "#602714");
});
sprinkle("d_pebbles", 3, 282, (put, i) => {
  put(0, 0, "#544049");
  put(1, 0, "#3d2c35");
  put(0, 1, "#3d2c35");
  put(1, 1, "#231a20");
  if (i === 0) {
    put(2, 0, "#3d2c35");
    put(2, 1, "#231a20");
  }
});
sprinkle("d_clover", 8, 283, (put, i) => {
  put(0, 0, "#6a5f1a");
  put(1, 0, "#857a22");
  put(0, 1, "#524915");
  put(1, 1, "#6a5f1a");
  if (i < 2) put(1, -1, "#f5d9a0");
});
addTile("cone_t", (x, y) => ((x + y) & 1 ? ((x ^ y) & 2 ? "#6b3d1f" : "#94582c") : "#3a1f12"));
