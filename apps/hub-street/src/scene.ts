/**
 * The grove itself, painted once into a few long canvases and then only slid past each other: the
 * dusk sky, three depths of far forest, the great trunks behind the street, the street's own ground
 * and trunks, and the dark things that pass in front. Painted again only when the window changes.
 */
import { bands, C, clamp, dice, disc, type G, mix, oval, rect, rgba, type Sprite, sprite } from "./art.ts";
import { TRUNKS, WW } from "./world.ts";

/** The view's measurements, in art pixels. */
export interface Frame {
  readonly vw: number;
  readonly h: number;
  /** The line feet walk on, the line buildings stand on, the horizon, and where the strings are tied. */
  readonly wy: number;
  readonly by: number;
  readonly hz: number;
  readonly sy: number;
}

export function frameFor(vw: number, h: number): Frame {
  const wy = h - Math.max(52, Math.round(h * 0.2));
  return {
    vw,
    h,
    wy,
    by: wy - 8,
    hz: wy - 32,
    sy: wy - 114 - clamp(Math.round((h - 253) * 0.25), 0, 40),
  };
}

/** How fast each depth slides, as a share of the street's own movement. */
export const DEPTH = { sun: 0.03, cloud: 0.05, far: 0.1, mid: 0.22, near: 0.42, back: 0.68, front: 1.32 } as const;

export const layerWidth = (f: Frame, depth: number): number => Math.ceil(f.vw + (WW - f.vw) * depth) + 4;

// ---------- sky ----------

export function paintSky(f: Frame): Sprite {
  const s = sprite(f.vw + 2, f.h);
  const hz = f.hz;
  const tones = [C.sky0, C.sky1, C.sky2, C.sky3, C.sky4, C.sky5, C.sky6];
  // Each of the guild's seven dusk colours, and a half-step between each pair, low on the picture
  // where the light is: the top third of a tall window is simply night.
  const start = Math.max(0, hz - Math.max(150, hz * 0.6));
  const stops: [number, string][] = [[0, C.sky0]];
  for (let i = 0; i < 13; i++) {
    const a = tones[Math.floor(i / 2)] ?? C.sky6;
    const b = tones[Math.ceil(i / 2)] ?? C.sky6;
    const t = i / 13;
    stops.push([start + (hz - start) * (1 - (1 - t) ** 1.25), i % 2 ? mix(a, b, 0.5) : a]);
  }
  stops.push([hz + 8, C.gold2]);
  bands(s.g, s.w, stops);
  rect(s.g, 0, hz + 8, s.w, f.h - hz - 8, C.sky1);
  // The first stars, high up where the sky has gone dark.
  const r = dice(77);
  for (let i = 0; i < Math.round(s.w * 0.14); i++) {
    const y = Math.floor(r() * Math.max(18, start + (hz - start) * 0.22));
    rect(s.g, Math.floor(r() * s.w), y, 1, 1, r() < 0.3 ? C.gold3 : C.sky4);
  }
  return s;
}

/** A long flat evening cloud, lit from underneath. */
export function paintCloud(seed: number, tone: string, under: string): Sprite {
  const r = dice(seed);
  const w = 46 + Math.floor(r() * 50);
  const s = sprite(w, 11);
  const lumps = 4 + Math.floor(r() * 3);
  for (let i = 0; i < lumps; i++) {
    const cx = 10 + ((w - 20) * i) / (lumps - 1);
    oval(s.g, cx, 5, 8 + r() * 6, 2 + Math.floor(r() * 3), tone);
  }
  rect(s.g, 4, 6, w - 8, 2, tone);
  // Underlit: the bottom row of the cloud is washed with the sunset.
  const img = s.g.getImageData(0, 0, s.w, s.h);
  for (let x = 0; x < s.w; x++)
    for (let y = s.h - 1; y > 0; y--) {
      if ((img.data[(y * s.w + x) * 4 + 3] ?? 0) > 0) {
        rect(s.g, x, y, 1, 1, under);
        break;
      }
    }
  return s;
}

export function paintSun(): Sprite {
  const s = sprite(221, 91);
  const cx = 110;
  const cy = 45;
  oval(s.g, cx, cy, 110, 34, rgba(C.sky5, 0.1));
  oval(s.g, cx, cy, 82, 28, rgba(C.gold1, 0.1));
  oval(s.g, cx, cy, 54, 23, rgba(C.gold1, 0.12));
  disc(s.g, cx, cy, 26, rgba(C.gold2, 0.2));
  disc(s.g, cx, cy, 20, rgba(C.gold2, 0.3));
  disc(s.g, cx, cy, 15, C.gold2);
  disc(s.g, cx, cy, 11, C.gold3);
  return s;
}

// ---------- far forest ----------

function conifer(g: G, cx: number, base: number, h: number, half: number, tiers: number, colour: string): void {
  g.fillStyle = colour;
  for (let i = 0; i < h; i++) {
    const t = i / h;
    const saw = (t * tiers) % 1;
    const w = Math.max(0, Math.round(half * t * (0.45 + 0.55 * saw)));
    g.fillRect(cx - w, base - h + i, w * 2 + 1, 1);
  }
}

/** A depth of forest as flat shapes of one colour: hills, firs, and the thin stems of far redwoods. */
export function paintFar(f: Frame, depth: number, colour: string, tall: number, seed: number, stems: boolean): Sprite {
  const w = layerWidth(f, depth);
  const s = sprite(w, f.h);
  const g = s.g;
  const r = dice(seed);
  const base = f.hz + 4;
  // A rolling line of ground, and everything under it.
  g.fillStyle = colour;
  for (let x = 0; x < w; x++) {
    const hill = Math.round(Math.sin(x * 0.021 + seed) * 3 + Math.sin(x * 0.007 + seed * 2) * 4);
    g.fillRect(x, base - 4 + hill, 1, f.h);
  }
  const scale = f.h / 253;
  const step = stems ? 15 : 11;
  for (let x = -6; x < w + 6; x += step) {
    const cx = Math.round(x + r() * step * 0.6);
    const h = Math.round(tall * (0.55 + r() * 0.45) * (0.7 + scale * 0.3));
    conifer(g, cx, base, h, Math.max(3, Math.round(h * (0.16 + r() * 0.05))), 4 + Math.floor(r() * 3), colour);
  }
  if (stems) {
    // Redwoods far off: bare stems that run out of the top of the picture.
    for (let x = 20; x < w; x += 58 + Math.floor(r() * 44)) {
      const sw = 5 + Math.floor(r() * 6);
      rect(g, x, 0, sw, base, colour);
      for (let y = 10; y < f.hz * 0.5; y += 13 + Math.floor(r() * 9)) {
        const reach = 9 + Math.floor(r() * 12);
        oval(g, x + sw / 2 + (r() < 0.5 ? -reach : reach) * 0.6, y, reach, 3, colour);
      }
    }
  }
  return s;
}

// ---------- trunks ----------

export interface Tone {
  readonly deep: string;
  readonly dark: string;
  readonly mid: string;
  readonly light: string;
  readonly hi: string;
}
export const LIT: Tone = { deep: C.bark0, dark: C.bark1, mid: C.bark2, light: C.bark3, hi: C.bark4 };
const BACK: Tone = {
  deep: mix(C.bark0, C.sky0, 0.75),
  dark: mix(C.bark0, C.sky0, 0.6),
  mid: mix(C.bark1, C.sky0, 0.55),
  light: mix(C.bark1, C.sky1, 0.45),
  hi: mix(C.bark2, C.sky1, 0.45),
};
const SHADE: Tone = {
  deep: "#130a16",
  dark: "#1a0e1b",
  mid: "#24121f",
  light: "#2f1724",
  hi: "#3d1e29",
};

/**
 * A redwood trunk: a column shaded round, scored top to bottom with long plates of bark, and
 * spreading at the foot.
 */
export function trunk(
  g: G,
  cx: number,
  w: number,
  top: number,
  base: number,
  seed: number,
  tone: Tone,
  flare = 12,
): void {
  const r = dice(seed);
  const half = w / 2;
  const rows = Math.max(1, Math.round(base - top));
  const flareH = Math.min(38, rows * 0.4);
  interface Groove {
    readonly u: number;
    readonly wob: Int8Array;
    readonly on: Uint8Array;
  }
  const grooves: Groove[] = [];
  for (let x = -half + 3; x < half - 2; x += 4 + Math.floor(r() * 4)) {
    const wob = new Int8Array(rows);
    const on = new Uint8Array(rows);
    let off = 0;
    let run = 0;
    let lit = true;
    for (let y = 0; y < rows; y++) {
      if (run-- <= 0) {
        lit = !lit || r() < 0.25;
        run = lit ? 18 + Math.floor(r() * 46) : 2 + Math.floor(r() * 7);
        if (r() < 0.6) off = clamp(off + (r() < 0.5 ? -1 : 1), -2, 2);
      }
      wob[y] = off;
      on[y] = lit ? 1 : 0;
    }
    grooves.push({ u: x / half, wob, on });
  }
  for (let j = 0; j < rows; j++) {
    const y = Math.round(top) + j;
    const t = clamp((y - (base - flareH)) / flareH, 0, 1);
    const k = 1 + (flare / half) * t * t * t;
    const hw = half * k;
    const left = Math.round(cx - hw);
    const right = Math.round(cx + hw);
    rect(g, left, y, right - left, 1, tone.mid);
    rect(g, Math.round(cx - hw * 0.5), y, Math.round(hw * 0.5), 1, tone.light);
    rect(g, left, y, Math.max(2, Math.round(hw * 0.24)), 1, tone.dark);
    rect(g, left, y, Math.max(1, Math.round(hw * 0.07)), 1, tone.deep);
    const shade = Math.max(2, Math.round(hw * 0.34));
    rect(g, right - shade, y, shade, 1, tone.dark);
    const edge = Math.max(1, Math.round(hw * 0.1));
    rect(g, right - edge, y, edge, 1, tone.deep);
    for (const gr of grooves) {
      if (!gr.on[j]) continue;
      const x = Math.round(cx + gr.u * hw) + (gr.wob[j] ?? 0);
      if (x <= left || x >= right - 1) continue;
      const outer = gr.u < -0.55 || gr.u > 0.4;
      rect(g, x, y, 1, 1, outer ? tone.deep : tone.dark);
      if ((j + Math.round(gr.u * 40)) % 9 < 6) {
        rect(g, x + 1, y, 1, 1, outer ? tone.mid : gr.u > -0.5 && gr.u < 0.02 ? tone.hi : tone.light);
      }
    }
  }
  // A few cracks across the grain.
  for (let i = 0; i < rows / 14; i++) {
    const y = Math.round(top) + Math.floor(r() * (rows - flareH));
    const x = Math.round(cx + (r() * 1.5 - 0.75) * half);
    rect(g, x, y, 2 + Math.floor(r() * 2), 1, tone.dark);
  }
}

/** A bough of needles: a branch reaching out and drooping, hung with soft clumps. */
export function bough(
  g: G,
  x0: number,
  y0: number,
  dir: 1 | -1,
  len: number,
  seed: number,
  tones: readonly [string, string, string],
  wood: string,
): void {
  const r = dice(seed);
  const droop = 0.005 + r() * 0.006;
  const beat = 0.42 + r() * 0.2;
  const start = r() * 6;
  for (let i = 0; i < len; i++) {
    const x = x0 + dir * i;
    const y = Math.round(y0 + i * i * droop);
    rect(g, x, y, 1, 2, wood);
    if (i < 3) continue;
    // Needles hang from the branch in sprays: long in the middle of each spray, short between
    // sprays, and thinning toward the tip of the branch.
    const lobe = Math.abs(Math.sin(i * beat + start));
    const taper = Math.sin(Math.min(1, i / len) * Math.PI * 0.8 + 0.3);
    const hang = Math.max(1, Math.round((2 + 7 * lobe) * (0.4 + 0.6 * taper)));
    rect(g, x, y + 1, 1, hang, tones[0]);
    rect(g, x, y - 1, 1, Math.max(2, hang - 1), tones[1]);
    if (lobe > 0.3) rect(g, x, y - 2, 1, 2, tones[2]);
    if (lobe > 0.75 && i % 2 === 0) rect(g, x, y - 3, 1, 1, tones[2]);
  }
}

/** The great trunks behind the street, in shade, with a hedge of undergrowth at their feet. */
export function paintBack(f: Frame): Sprite {
  const w = layerWidth(f, DEPTH.back);
  const s = sprite(w, f.h);
  const g = s.g;
  const r = dice(4242);
  const leaf: [string, string, string] = [
    mix(C.green0, C.sky0, 0.62),
    mix(C.green0, C.sky0, 0.5),
    mix(C.green1, C.sky0, 0.5),
  ];
  for (let x = 60; x < w; x += 176 + Math.floor(r() * 70)) {
    const tw = 36 + Math.floor(r() * 26);
    trunk(g, x, tw, 0, f.wy - 10, 900 + x, BACK, 7);
    const top = Math.max(26, f.h * 0.22);
    for (let y = 8; y < top; y += 17) {
      bough(g, x - tw / 2 + 2, y + Math.floor(r() * 6), -1, 20 + Math.floor(r() * 18), x + y, leaf, BACK.deep);
      bough(g, x + tw / 2 - 2, y + Math.floor(r() * 6), 1, 20 + Math.floor(r() * 18), x + y + 5, leaf, BACK.deep);
    }
  }
  // Undergrowth: a low bank of rounded bushes, evenly kept.
  const bush = mix(C.green0, C.sky0, 0.5);
  const bushLit = mix(C.green1, C.sky0, 0.45);
  for (let x = -6; x < w + 12; x += 13) {
    const ry = 6 + Math.floor(r() * 5);
    const y = f.wy - 14 - Math.floor(r() * 3);
    oval(g, x, y, 10, ry, bush);
    oval(g, x - 2, y - 2, 6, Math.max(2, ry - 4), bushLit);
  }
  rect(g, 0, f.wy - 14, w, f.h, bush);
  return s;
}

// ---------- the street's own ground and trunks ----------

function paintGround(g: G, f: Frame): void {
  const r = dice(31);
  const wy = f.wy;
  // The verge behind the path.
  rect(g, 0, wy - 13, WW, 7, C.green1);
  for (let x = 0; x < WW; x++) {
    const n = r();
    if (n < 0.45) rect(g, x, wy - 14, 1, 1, C.green1);
    if (n < 0.1) rect(g, x, wy - 15, 1, 1, C.green2);
    if (n > 0.86) rect(g, x, wy - 12 + Math.floor(r() * 4), 1, 1, C.green2);
    if (n > 0.95) rect(g, x, wy - 12 + Math.floor(r() * 4), 1, 1, C.green0);
  }
  // The path: packed earth, a lighter worn middle, and flat stones laid in two offset rows.
  rect(g, 0, wy - 7, WW, 18, C.earth1);
  rect(g, 0, wy - 7, WW, 1, C.earth0);
  rect(g, 0, wy + 8, WW, 3, C.earth0);
  const stone = mix(C.earth1, C.earth2, 0.55);
  const stoneTop = mix(C.earth2, C.gold3, 0.12);
  for (let row = 0; row < 2; row++) {
    const y = wy - 4 + row * 6;
    for (let x = row * 7 - 4; x < WW;) {
      const w = 9 + Math.floor(r() * 4);
      rect(g, x + 1, y, w - 2, 1, stoneTop);
      rect(g, x, y + 1, w, 2, stone);
      rect(g, x + 1, y + 3, w - 2, 1, C.earth0);
      if (r() < 0.18) rect(g, x + 2 + Math.floor(r() * (w - 4)), y + 1, 1, 1, C.earth2);
      x += w + 3;
    }
  }
  for (let x = 0; x < WW; x++) {
    const n = r();
    if (n < 0.3) rect(g, x, wy - 7, 1, 1, C.green1);
    if (n > 0.97) rect(g, x, wy - 6 + Math.floor(r() * 15), 1, 1, n > 0.99 ? C.gold0 : C.earth0);
  }
  // The verge in front, falling away into shade.
  rect(g, 0, wy + 11, WW, 7, C.green1);
  rect(g, 0, wy + 16, WW, f.h - wy - 16, C.green0);
  for (let x = 0; x < WW; x++) {
    const n = r();
    if (n < 0.5) rect(g, x, wy + 10, 1, 1, C.green1);
    if (n < 0.12) rect(g, x, wy + 9, 1, 1, C.green2);
    if (n > 0.85) rect(g, x, wy + 12 + Math.floor(r() * 4), 1, 1, C.green2);
    if (n > 0.5) rect(g, x, wy + 15, 1, 1, C.green0);
  }
  const deep = mix(C.green0, C.sky0, 0.6);
  rect(g, 0, wy + 22, WW, f.h, deep);
  for (let x = 0; x < WW; x++) if (r() < 0.5) rect(g, x, wy + 20 + Math.floor(r() * 2), 1, 2, deep);
}

const LEAF: readonly [string, string, string] = [C.green0, C.green1, C.green2];

/** The street layer's fixed parts: its ground and its trunks. Buildings are painted over this by places.ts. */
export function paintStreetBase(f: Frame): Sprite {
  const s = sprite(WW, f.h);
  paintGround(s.g, f);
  TRUNKS.forEach((t, i) => {
    trunk(s.g, t.x, t.w, 0, f.wy - 6, 100 + i * 17, LIT, i === 2 ? 16 : 12);
    const r = dice(600 + i);
    const top = Math.max(34, f.h * 0.2);
    for (let y = 5; y < top; y += 11) {
      bough(s.g, t.x - t.w / 2 + 3, y + Math.floor(r() * 5), -1, 26 + Math.floor(r() * 22), i * 31 + y, LEAF, C.bark0);
      bough(s.g, t.x + t.w / 2 - 3, y + Math.floor(r() * 5), 1, 26 + Math.floor(r() * 22), i * 37 + y, LEAF, C.bark0);
    }
    // Moss where the roots meet the ground.
    for (let k = 0; k < 5; k++) {
      const x = t.x - t.w / 2 - 8 + Math.floor(r() * (t.w + 16));
      oval(s.g, x, f.wy - 8, 3 + Math.floor(r() * 3), 1, C.green1);
      rect(s.g, x - 1, f.wy - 9, 2, 1, C.green2);
    }
  });
  return s;
}

// ---------- what passes in front ----------

export function paintFrontTrunk(f: Frame, seed: number, w: number): Sprite {
  const s = sprite(w + 40, f.h);
  trunk(s.g, s.w / 2, w, 0, f.h + 6, seed, SHADE, 16);
  return s;
}

/** A run of dark needles hanging from the top of the picture, and one of dark growth along its foot. */
export function paintFringe(width: number): { top: Sprite; foot: Sprite } {
  const top = sprite(width, 34);
  const r = dice(5150);
  const tones: [string, string, string] = ["#150b18", "#1b1220", mix(C.green0, "#150b18", 0.6)];
  for (let x = -10; x < width + 10; x += 26) {
    bough(top.g, x, -2 + Math.floor(r() * 5), 1, 24 + Math.floor(r() * 14), x + 3, tones, "#150b18");
  }
  // The foot repeats without a seam: its swells are whole waves of the tile's width.
  const foot = sprite(width, 30);
  const dark = "#150b18";
  const mid = mix(C.green0, "#150b18", 0.62);
  const wave = (x: number): number =>
    Math.sin((x / width) * Math.PI * 8) * 3 + Math.sin((x / width) * Math.PI * 22 + 1) * 1.5;
  for (let x = 0; x < width; x++) {
    const y = Math.round(10 + wave(x));
    rect(foot.g, x, y, 1, 30 - y, dark);
    if (x % 3 === 0) rect(foot.g, x, y - 1 - (r() < 0.4 ? 1 : 0), 1, 2, dark);
    if (x % 5 === 2 && r() < 0.6) rect(foot.g, x, y + 1 + Math.floor(r() * 3), 1, 1, mid);
  }
  return { top, foot };
}

/** A fern: fronds arching out from one root, each a curve of small leaflets. */
export function paintFern(seed: number, size: number, tones: readonly [string, string, string]): Sprite {
  const r = dice(seed);
  const s = sprite(size * 2 + 3, size + 3);
  const g = s.g;
  const cx = size + 1;
  const fronds = 6;
  for (let i = 0; i < fronds; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const rank = Math.floor(i / 2);
    const reach = size * (1 - rank * 0.27) * (0.85 + r() * 0.15);
    const rise = size * (0.45 + rank * 0.28);
    const tone = tones[Math.min(2, rank)] ?? tones[0];
    for (let k = 0; k <= reach; k++) {
      const t = k / reach;
      const x = Math.round(cx + side * k);
      const y = Math.round(s.h - 1 - Math.sin(t * Math.PI * 0.62) * rise);
      rect(g, x, y, 1, 1, tone);
      if (k % 2 === 0 && k > 1) rect(g, x, y + 1, 1, Math.max(1, Math.round(2 * (1 - t))), tone);
      if (k % 2 === 1 && k > 1) rect(g, x, y - 1, 1, 1, tones[Math.min(2, rank + 1)] ?? tone);
    }
  }
  rect(g, cx, s.h - 3, 1, 3, tones[0]);
  return s;
}

export function paintMushroom(big: boolean, shade: number): Sprite {
  const cap = mix(C.sky5, C.ink, shade);
  const capDark = mix("#c9453a", C.ink, shade);
  const stem = mix(C.gold3, C.ink, shade + 0.1);
  if (big) {
    const s = sprite(9, 8);
    oval(s.g, 4, 3, 4, 3, cap);
    rect(s.g, 0, 4, 9, 1, capDark);
    rect(s.g, 3, 5, 3, 3, stem);
    rect(s.g, 2, 1, 1, 1, stem);
    rect(s.g, 5, 2, 2, 1, stem);
    rect(s.g, 7, 3, 1, 1, stem);
    return s;
  }
  const s = sprite(5, 5);
  rect(s.g, 1, 0, 3, 1, cap);
  rect(s.g, 0, 1, 5, 2, cap);
  rect(s.g, 0, 2, 5, 1, capDark);
  rect(s.g, 2, 3, 1, 2, stem);
  rect(s.g, 1, 1, 1, 1, stem);
  rect(s.g, 3, 0, 1, 1, stem);
  return s;
}

export function paintFlower(colour: string): Sprite {
  const s = sprite(5, 8);
  rect(s.g, 2, 3, 1, 5, C.green2);
  rect(s.g, 3, 5, 1, 1, C.green3);
  rect(s.g, 1, 6, 1, 1, C.green3);
  rect(s.g, 1, 1, 3, 3, colour);
  rect(s.g, 2, 0, 1, 5, colour);
  rect(s.g, 0, 2, 5, 1, colour);
  rect(s.g, 2, 2, 1, 1, C.gold2);
  return s;
}

/** The darkening toward the edges of the picture, drawn small and stretched. */
export function paintVignette(): Sprite {
  const s = sprite(64, 64);
  const grad = s.g.createRadialGradient(32, 30, 18, 32, 32, 46);
  grad.addColorStop(0, "rgba(26,15,30,0)");
  grad.addColorStop(1, "rgba(26,15,30,0.62)");
  s.g.fillStyle = grad;
  s.g.fillRect(0, 0, 64, 64);
  return s;
}
