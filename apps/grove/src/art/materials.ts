/**
 * Building materials: bark, logs, sawn boards, stone and roof slates.
 *
 * Each has a ramp of six or seven colours that turns as it lightens (plum in the furrows, tan on
 * the lit edges) and is drawn as shapes with a light side and a shade side, never as noise: a bark
 * ridge has a lit left edge and fibres along it, a board has a lip, a body and a seam, a stone has
 * a rim. The drawings are two or four blocks wide, so no board end or stone repeats on the next
 * block.
 */
import { ihash } from "../engine/rand.ts";
import { macro, pn, type Put } from "./macro.ts";
import { addTile, type Paint, TILES } from "./tiles.ts";

export const BARK = ["#2a191d", "#402422", "#583128", "#6f4233", "#88553f", "#a26d4e", "#b98864"] as const;
export const CHAR = ["#141012", "#1d1719", "#281f20", "#342829", "#423233", "#51403d", "#62504a"] as const;
export const PLANK = ["#3a2420", "#5a3a2b", "#7a5338", "#946a45", "#ab8155", "#c39b6b"] as const;
export const STONE = ["#262230", "#3d3845", "#575260", "#736e7a", "#908b93", "#aaa6aa"] as const;
export const SLATE = ["#1e1926", "#2d2638", "#3e344b", "#51455f", "#665874", "#7f718c"] as const;
const MOSS = ["#2f2c12", "#454015", "#5a5119", "#6f651f"] as const;
const HEART = ["#7f4636", "#955640", "#a9694d", "#c8a078", "#b48a66"] as const;

const mod = (v: number, n: number): number => ((v % n) + n) % n;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

// ---------- bark ----------

/**
 * Fibrous ridges between furrows. Standing, the ridges run up the drawing and are lit on their
 * left; lying, they run along it, are lit on top, and every sixteen rows is one round log: paler
 * along its top, darker underneath, a furrow where it rests on the next.
 */
function ridges(S: number, put: Put, seed: number, lying: boolean): void {
  const A = lying ? 16 : S;
  const gaps = lying ? [5, 4, 4, 3] : [3, 7, 4, 9, 3, 6, 5, 8, 3, 6, 4, 6];
  const home: number[] = [];
  gaps.reduce((at, g) => (home.push(at), at + g), lying ? 15 : 1);
  const K = home.length;
  const wide = home.map((_, i) => !lying && ihash(i, 1, 0, seed) < 0.25);
  const rest = home.map((_, i) => {
    if ((lying && i === 0) || ihash(i, 2, 0, seed) > 0.5) return null;
    return [Math.floor(ihash(i, 3, 0, seed) * S), 12 + Math.floor(ihash(i, 4, 0, seed) * 11)] as const;
  });
  const at = new Int16Array(K);
  for (let l = 0; l < S; l++) {
    const held = l - (l % 3);
    for (let i = 0; i < K; i++) {
      const gone = rest[i] && mod(l - rest[i]![0], S) < rest[i]![1];
      const drift =
        lying && i === 0 ? 0 : Math.round((pn(held / 8, i, seed + 1, S / 8, K) - 0.5) * (lying ? 2.4 : 4.6));
      at[i] = gone ? -1 : mod(home[i]! + drift, A);
    }
    for (let a = 0; a < A; a++) {
      let dl = A;
      let dr = A;
      let li = 0;
      for (let i = 0; i < K; i++) {
        if (at[i]! < 0) continue;
        const d = mod(a - at[i]!, A);
        if (d < dl) {
          dl = d;
          li = i;
        }
        dr = Math.min(dr, mod(at[i]! - a, A));
      }
      const e = wide[li] ? 1 : 0;
      const d = dl - e;
      const w = dl + dr - 1 - e;
      let t: number;
      if (d <= 0) t = lying ? 1 : dl === 0 && ihash(li, Math.floor(l / 6), 5, seed) < 0.45 ? 0 : 1;
      else if (d === 1) {
        const run = ihash(li, Math.floor((l + li * 5) / 4), 6, seed);
        t = w === 1 ? 4 : lying ? (run < 0.3 ? 5 : 4) : run < 0.22 ? 6 : run > 0.8 ? 4 : 5;
      } else if (dr === 1) t = 2;
      else {
        const fibre = ihash(li * 31 + d, Math.floor((l + d * 7 + li * 3) / 9), 7, seed);
        t = d === 2 && w >= 5 ? 4 : fibre < 0.18 ? 2 : fibre < 0.72 ? 3 : 4;
        const seg = Math.floor(l / 16);
        if (ihash(li, seg, 8, seed) < 0.35) {
          const crack = seg * 16 + Math.floor(ihash(li, seg, 9, seed) * 14);
          if (l === crack) t = 1;
          else if (l === crack + 1) t = Math.min(6, t + 1);
        }
      }
      if (lying) {
        if (a === 15) t = 0;
        else if (a <= 1 && t > 1) t = Math.min(6, t + 1);
        else if (a >= 12 && t > 1) t--;
        for (let k = 0; k < S; k += 16) put(l, a + k, t);
      } else put(a, l, t);
    }
  }
}
macro("bark_m", 4, BARK, (S, put) => ridges(S, put, 301, false));
macro("bark_char_m", 4, CHAR, (S, put) => ridges(S, put, 302, false));
macro("log_side_m", 4, BARK, (S, put) => ridges(S, put, 303, true));

/**
 * A sawn log end, drawn by hand: bark round the rim, a pale band of sapwood, heartwood in uneven
 * rings round a pith that sits off centre, and two drying cracks.
 */
const LOG_END = [
  "abcbbabbbcbbabba",
  "bbsssstssssstsbb",
  "bsshhhhhhhhhhssb",
  "cshhhrrrrrrhhhsb",
  "bshhrhhhhhhrrhsc",
  "bthrhhhrrrhhhrsb",
  "bshrhhrhhhrhhrsb",
  "ashrhrhpphhrhrtb",
  "bshrhrhpxhhrhrsb",
  "bshrhhrhhxrhhrsa",
  "cshhrhhrrrxhrhsb",
  "bshhhrhhhhhrhhsb",
  "bthhhhrrrrrhhhsb",
  "bsshhhhhhhhhhssc",
  "bbsssssstsssssbb",
  "abbcbbabbbbcbbba",
];
const rows = (art: readonly string[], key: Record<string, string>): Paint => {
  if (art.length !== 16 || art.some((r) => r.length !== 16)) throw new Error("a hand-drawn tile is 16 rows of 16");
  return (x, y) => key[art[y]![x]!] ?? null;
};
const LOG_END_B = [
  "babbcbbabbbbcbab",
  "absstsssssssstba",
  "bsshhhhhhhhhhssb",
  "bshhrrrrrrhhhhsc",
  "cshrhhhhhhrrhhsb",
  "bshrhrrrrhhhrhsb",
  "bthrhrpphrhhrhsb",
  "bshrhrpphrxxxxtb",
  "ashrhhrrrhhhrhsb",
  "bshhrhhhhhhrhhsb",
  "bshhhrrrrrrhhhsa",
  "cshhhhhhhhhhhhsb",
  "bshhrrrrhrrrhhsb",
  "bsshhhhhhhhhhstb",
  "absssstsssssssba",
  "bbabbbbcbbabbbab",
];
const END_KEY = {
  a: BARK[1],
  b: BARK[2],
  c: BARK[3],
  s: HEART[3],
  t: HEART[4],
  h: HEART[2],
  r: HEART[1],
  p: HEART[0],
  x: HEART[0],
};
const ENDS_DRAWN: Paint[] = [
  rows(LOG_END, END_KEY),
  rows(LOG_END_B, END_KEY),
  rows(
    LOG_END_B.map((r) => [...r].reverse().join("")),
    END_KEY,
  ),
  rows([...LOG_END].reverse(), END_KEY),
];
addTile("log_top", ENDS_DRAWN[0]!);
// Sixteen tiles, as a wide drawing is cut, so that neighbouring logs in a pile show different ends.
for (let row = 0; row < 4; row++)
  for (let col = 0; col < 4; col++)
    addTile(`log_top_m@${col},${row}`, ENDS_DRAWN[(col * 3 + row * 5 + (col & row)) % 4]!);

// ---------- sawn boards ----------

const ENDS = [5, 21, 12, 28, 2, 17, 9, 25];
const DARKER = [0, 0, 1, 0, 0, 1, 0, 0];
const KNOTS: Record<number, number> = { 1: 9, 4: 22, 6: 14 };
/** Boards four pixels high and two blocks long: a lit lip, two rows of grain, a seam. */
macro("planks_m", 2, PLANK, (S, put) => {
  for (let Y = 0; Y < S; Y++)
    for (let X = 0; X < S; X++) {
      const b = Y >> 2;
      const r = Y & 3;
      const base = 3 - DARKER[b]!;
      const dx = mod(X - ENDS[b]!, S);
      let t: number;
      if (r === 3) {
        const near = dx <= 2 || dx >= S - 2;
        const run = ihash(Math.floor((X + b * 9) / 4), b, 3, 311);
        t = dx === 0 ? 0 : near || run < 0.4 ? base - 2 : base - 1;
      } else if (dx === 0) t = 1;
      else if (r === 0) {
        const run = ihash(Math.floor((X + b * 5) / 5), b, 1, 311);
        t = dx === 1 ? base + 2 : run < 0.25 ? base + 2 : run > 0.78 ? base : base + 1;
      } else {
        const run = ihash(Math.floor((X + b * 3 + r * 4) / (r === 1 ? 6 : 8)), b * 4 + r, 2, 311);
        t = dx === S - 1 ? base - 1 : run < 0.3 ? base - 1 : run > 0.9 ? base + 1 : base;
        if (r === 1 && (dx === 2 || dx === S - 3)) t = 1;
        const k = KNOTS[b];
        if (k !== undefined && Math.abs(X - k) <= 1) t = X === k && r === 1 ? 1 : base - 1;
      }
      put(X, Y, clamp(t, 0, 5));
    }
});

// ---------- stone ----------

/** Fitted stones: rounded blocks in staggered rows, each with a lit rim above and to the left. */
function stones(S: number, put: Put, seed: number, moss: number): void {
  const N = S / 8;
  const pts: [number, number][] = [];
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++)
      pts.push([
        (i + 0.5 + (j & 1) * 0.5) * 8 + (ihash(i, j, 1, seed) - 0.5) * 4.4,
        (j + 0.5) * 8 + (ihash(i, j, 2, seed) - 0.5) * 3.6,
      ]);
  const wrap = (d: number): number => d - S * Math.round(d / S);
  const cell = new Int16Array(S * S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let d1 = 99;
      let d2 = 99;
      let own = 0;
      pts.forEach(([px, py], i) => {
        const d = (Math.abs(wrap(x + 0.5 - px) * 0.8) ** 3 + Math.abs(wrap(y + 0.5 - py)) ** 3) ** (1 / 3);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          own = i;
        } else if (d < d2) d2 = d;
      });
      cell[y * S + x] = d2 - d1 < 0.95 ? -1 : own;
    }
  const of = (x: number, y: number): number => cell[mod(y, S) * S + mod(x, S)]!;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const c = of(x, y);
      let t: number;
      if (c < 0) {
        const open = [of(x - 1, y), of(x + 1, y), of(x, y - 1), of(x, y + 1)].filter((n) => n < 0).length;
        t = open >= 3 ? 0 : 1;
      } else {
        const h = ihash(c, 0, 3, seed);
        const base = h < 0.25 ? 2 : h < 0.75 ? 3 : 4;
        const above = of(x, y - 1) !== c;
        const left = of(x - 1, y) !== c;
        const below = of(x, y + 1) !== c;
        const right = of(x + 1, y) !== c;
        if ((above || left) && !(below || right)) t = above || ihash(x, y, 4, seed) < 0.6 ? base + 1 : base;
        else if ((below || right) && !(above || left)) t = base - 1;
        else t = ihash(x >> 1, y, 5 + c, seed) < 0.1 ? base - 1 : base;
      }
      const m = pn(x / 4, y / 4, seed + 9, S / 4, S / 4) + pn(x / 2, y / 2, seed + 10, S / 2, S / 2) * 0.4;
      if (moss && m > 1.25 - moss)
        put(x, y, 6 + (m > 1.42 - moss ? (ihash(x, y, 6, seed) < 0.3 ? 3 : 2) : c < 0 ? 0 : 1));
      else put(x, y, t);
    }
}
macro("stone_m", 2, STONE, (S, put) => stones(S, put, 321, 0));
macro("stone_mossy_m", 2, [...STONE, ...MOSS], (S, put) => stones(S, put, 321, 0.42));

// ---------- roof slates ----------

const SHIFT = [0, 4, 1, 5, 0, 3, 7, 4];
/** Slates in courses four pixels deep, each slate its own tone, a shadow under every lap, moss on a few. */
macro("slate_m", 2, [...SLATE, ...MOSS], (S, put) => {
  for (let Y = 0; Y < S; Y++)
    for (let X = 0; X < S; X++) {
      const c = Y >> 2;
      const r = Y & 3;
      const sx = mod(X + SHIFT[c]!, S);
      const k = sx >> 3;
      const lx = sx & 7;
      const h = ihash(k, c, 1, 331);
      const base = h < 0.22 ? 2 : h < 0.74 ? 3 : 4;
      let t: number;
      if (r === 0) t = 1;
      else if (lx === 0) t = r === 3 ? 1 : base - 1;
      else if (r === 3) t = lx === 1 || lx === 7 ? base : base + 1;
      else t = ihash(k * 8 + (lx >> 1), c * 4 + r, 2, 331) < 0.12 ? base - 1 : base;
      const mossy = ihash(k, c, 3, 331) < 0.07;
      const mx = 1 + Math.floor(ihash(k, c, 4, 331) * 3);
      if (mossy && r >= 2 && lx >= mx && lx <= mx + 3 && !(r === 2 && (lx === mx || lx === mx + 3)))
        t = r === 2 ? 8 : 7;
      put(X, Y, t);
    }
});

// ---------- one tile each, for the small things boxes are made of ----------

const first = (name: string): Paint => TILES[`${name}@0,0`]!;
addTile("bark", first("bark_m"));
addTile("bark_char", first("bark_char_m"));
addTile("log_side", first("log_side_m"));
addTile("planks", first("planks_m"));
addTile("stone", first("stone_m"));
addTile("stone_mossy", first("stone_mossy_m"));
addTile("slate", first("slate_m"));

/** A crate: a lit frame of four boards, slats behind it, a brace from corner to corner. */
addTile("crate", (x, y) => {
  const f = Math.min(x, y, 15 - x, 15 - y);
  const lit = y === f || x === f;
  const nail = (x === 2 || x === 13) && (y === 2 || y === 13);
  if (f === 0) return PLANK[(x === 0 || x === 15) && (y === 0 || y === 15) ? 0 : 1];
  if (nail) return PLANK[1];
  if (f === 1) return PLANK[lit ? 5 : 3];
  if (f === 2) return PLANK[lit ? 4 : 3];
  if (f === 3) return PLANK[lit ? 0 : 1];
  const d = x + y - 15;
  if (d === -1) return PLANK[5];
  if (d === 0) return PLANK[4];
  if (d === 1) return PLANK[3];
  if (d === 2) return PLANK[0];
  if (x === 8) return PLANK[0];
  return PLANK[ihash(x, y >> 2, 1, 341) < 0.3 ? 1 : 2];
});
/** A ladder: two rails lit on their left, rungs two pixels deep with their undersides in shade. */
addTile("ladder", (x, y) => {
  if (x === 2 || x === 12) return PLANK[4];
  if (x === 3 || x === 13) return PLANK[2];
  if (x > 3 && x < 12 && (y & 3) === 1) return PLANK[x === 4 ? 2 : 4];
  if (x > 3 && x < 12 && (y & 3) === 2) return PLANK[1];
  return null;
});
/** A lit window in a plank wall: a dark frame, four panes, warm glass. */
addTile("window", (x, y) => {
  if (x < 2 || x > 13 || y < 2 || y > 13) return first("planks_m")(x, y);
  if (x === 2 || y === 2) return PLANK[0];
  if (x === 13 || y === 13) return PLANK[1];
  if (x === 7 || y === 7) return PLANK[1];
  if (x === 8 || y === 8) return PLANK[2];
  const glow = ihash(x >> 1, y >> 1, 1, 81);
  return glow < 0.3 ? "#ffe9b0" : glow < 0.8 ? "#f5b95e" : "#d49045";
});
