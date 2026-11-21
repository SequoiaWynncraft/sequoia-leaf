/**
 * The small drawing kit everything is made with: the guild's dusk palette, sprites written as rows
 * of letters, and noise that is the same every time it is asked.
 */

export type Cv = HTMLCanvasElement;
export type G2 = CanvasRenderingContext2D;

/** One letter per colour, so a sprite can be written as rows of text. `.` is see-through. */
export const INK = {
  // sky and shade
  a: "#2a1733",
  b: "#3d2050",
  c: "#5a296e",
  d: "#7a348a",
  e: "#b84d84",
  f: "#e67967",
  g: "#f5b95e",
  // gold and light
  h: "#d49045",
  i: "#ffd98a",
  j: "#fff3cf",
  // bark
  k: "#3b1f19",
  l: "#542a1f",
  m: "#6f3826",
  n: "#8a4a30",
  o: "#a35d3b",
  // greens
  p: "#24482a",
  q: "#2f5c34",
  r: "#3b7340",
  s: "#4b8c4a",
  t: "#62a658",
  // earth and stone
  u: "#593d29",
  v: "#79553a",
  w: "#966c4a",
  x: "#525252",
  y: "#6e6d6d",
  z: "#888788",
  A: "#a6a6a6",
  // the few colours the shared set lacks
  B: "#1a0f1e", // the darkest line
  R: "#c8473f", // post-box red
  D: "#8f2c3a",
  C: "#6fb0e8", // a cool blue, for a glorp and for water lights
  E: "#4a7fc0",
  F: "#b6e2f7",
  K: "#e8d5a8", // canvas and fur in shade
  L: "#c9ae84",
  M: "#e67fb0", // pink
  N: "#f7b6d2",
  O: "#ef9a3c", // ginger
  Q: "#c76e2a",
  G: "#a8e89a", // glass-green glow
} as const;
const INK_BY_LETTER: Record<string, string> = INK;

export function canvas(w: number, h: number): [Cv, G2] {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  return [c, g];
}

/** A sprite and where its feet are (the point that sits on the ground). */
export interface Spr {
  c: Cv;
  w: number;
  h: number;
  ax: number;
  ay: number;
}

/** Rows of letters into a sprite. `swap` recolours: `{C: "#e67fb0"}` paints every C pink. */
export function sprite(rows: readonly string[], swap: Record<string, string> = {}, ax?: number, ay?: number): Spr {
  const h = rows.length;
  const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const [c, g] = canvas(w, h);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!;
      if (ch === "." || ch === " ") continue;
      const col = swap[ch] ?? INK_BY_LETTER[ch];
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
  });
  return { c, w, h, ax: ax ?? Math.floor(w / 2), ay: ay ?? h };
}

/** Wraps a drawn canvas as a sprite standing on its bottom middle. */
export function asSprite(c: Cv, ax?: number, ay?: number): Spr {
  return { c, w: c.width, h: c.height, ax: ax ?? Math.floor(c.width / 2), ay: ay ?? c.height };
}

export function flip(s: Spr): Spr {
  const [c, g] = canvas(s.w, s.h);
  g.translate(s.w, 0);
  g.scale(-1, 1);
  g.drawImage(s.c, 0, 0);
  return { c, w: s.w, h: s.h, ax: s.w - 1 - s.ax, ay: s.ay };
}

/** Draws a sprite with its feet at (x, y). */
export function put(g: G2, s: Spr, x: number, y: number): void {
  g.drawImage(s.c, Math.round(x) - s.ax, Math.round(y) - s.ay);
}

export function R(g: G2, x: number, y: number, w: number, h: number, col: string): void {
  g.fillStyle = col;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

export function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  const f = (x: number, y: number): string =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, "0");
  return `#${f(ar, br)}${f(ag, bg)}${f(ab, bb)}`;
}

/** A repeatable random stream. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The same number between 0 and 1 for the same place, every time. */
export function hash(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Soft noise: neighbouring places get neighbouring values. */
export function noise(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const TAU = Math.PI * 2;

/** One of a list, by a random number already drawn (or a fresh one). */
export function pick<T>(list: readonly T[], r: number = Math.random()): T {
  return list[Math.min(list.length - 1, Math.floor(r * list.length))]!;
}

/** A soft round glow in one colour, kept for reuse: light is added with these. */
const glows = new Map<string, Cv>();
export function glow(radius: number, colour: string): Cv {
  const r = Math.max(2, Math.round(radius / 2) * 2);
  const key = `${r}|${colour}`;
  const had = glows.get(key);
  if (had) return had;
  const [c, g] = canvas(r * 2, r * 2);
  const [cr, cg, cb] = rgb(colour);
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, `rgba(${cr},${cg},${cb},1)`);
  grad.addColorStop(0.25, `rgba(${cr},${cg},${cb},0.72)`);
  grad.addColorStop(0.55, `rgba(${cr},${cg},${cb},0.3)`);
  grad.addColorStop(0.8, `rgba(${cr},${cg},${cb},0.09)`);
  grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, r * 2, r * 2);
  glows.set(key, c);
  return c;
}

/** The same sprite with a dark line drawn round it, so it reads against busy ground. */
export function outlined(s: Spr, colour = "#2a1733"): Spr {
  const w = s.w + 2;
  const h = s.h + 2;
  const [c, g] = canvas(w, h);
  g.drawImage(s.c, 1, 1);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) solid[i] = d[i * 4 + 3]! > 40 ? 1 : 0;
  const [r, gg, b] = rgb(colour);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (solid[i]) continue;
      const near =
        (x > 0 && solid[i - 1]) ||
        (x < w - 1 && solid[i + 1]) ||
        (y > 0 && solid[i - w]) ||
        (y < h - 1 && solid[i + w]);
      if (!near) continue;
      d[i * 4] = r;
      d[i * 4 + 1] = gg;
      d[i * 4 + 2] = b;
      d[i * 4 + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return { c, w, h, ax: s.ax + 1, ay: s.ay + 1 };
}
