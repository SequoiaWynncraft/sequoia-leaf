/**
 * The paintbox: the guild's colours, a seeded dice, and the few pixel tools everything is drawn
 * with. Nothing here knows about the street; it only knows how to put clean pixels on a canvas.
 */

export const C = {
  ink: "#1a0f1e",
  sky0: "#2a1733",
  sky1: "#3d2050",
  sky2: "#5a296e",
  sky3: "#7a348a",
  sky4: "#b84d84",
  sky5: "#e67967",
  sky6: "#f5b95e",
  gold0: "#d49045",
  gold1: "#f5b95e",
  gold2: "#ffd98a",
  gold3: "#fff3cf",
  bark0: "#3b1f19",
  bark1: "#542a1f",
  bark2: "#6f3826",
  bark3: "#8a4a30",
  bark4: "#a35d3b",
  green0: "#24482a",
  green1: "#2f5c34",
  green2: "#3b7340",
  green3: "#4b8c4a",
  green4: "#62a658",
  earth0: "#593d29",
  earth1: "#79553a",
  earth2: "#966c4a",
  stone0: "#525252",
  stone1: "#6e6d6d",
  stone2: "#888788",
  stone3: "#a6a6a6",
} as const;

export type G = CanvasRenderingContext2D;

export interface Sprite {
  readonly c: HTMLCanvasElement;
  readonly g: G;
  readonly w: number;
  readonly h: number;
}

export function sprite(w: number, h: number): Sprite {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const g = c.getContext("2d");
  if (!g) throw new Error("this browser gives no 2d canvas");
  g.imageSmoothingEnabled = false;
  return { c, g, w: c.width, h: c.height };
}

/** A dice that rolls the same way every time for the same seed, so the street is the same street. */
export function dice(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One of a list. The list must not be empty. */
export function pick<T>(list: readonly T[], roll: number): T {
  const item = list[Math.min(list.length - 1, Math.floor(roll * list.length))];
  if (item === undefined) throw new Error("picked from an empty list");
  return item;
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function channels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const two = (v: number): string =>
  Math.round(clamp(v, 0, 255))
    .toString(16)
    .padStart(2, "0");

/** A colour part-way between two others. */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  return `#${two(lerp(ar, br, t))}${two(lerp(ag, bg, t))}${two(lerp(ab, bb, t))}`;
}
export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = channels(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function rect(g: G, x: number, y: number, w: number, h: number, colour: string): void {
  g.fillStyle = colour;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** A filled oval made of whole pixel rows, so its edge is clean. */
export function oval(g: G, cx: number, cy: number, rx: number, ry: number, colour: string): void {
  g.fillStyle = colour;
  for (let dy = -ry; dy <= ry; dy++) {
    const k = ry === 0 ? 1 : Math.sqrt(Math.max(0, 1 - (dy * dy) / ((ry + 0.5) * (ry + 0.5))));
    const half = Math.round(rx * k);
    g.fillRect(Math.round(cx - half), Math.round(cy + dy), half * 2 + 1, 1);
  }
}
export const disc = (g: G, cx: number, cy: number, r: number, colour: string): void => oval(g, cx, cy, r, r, colour);

/** The outline of an oval, one pixel thick. */
export function ovalRing(g: G, cx: number, cy: number, rx: number, ry: number, colour: string): void {
  g.fillStyle = colour;
  const steps = Math.max(12, Math.round((rx + ry) * 3));
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    g.fillRect(Math.round(cx + Math.cos(a) * rx), Math.round(cy + Math.sin(a) * ry), 1, 1);
  }
}

/** A straight pixel line. */
export function line(g: G, x0: number, y0: number, x1: number, y1: number, colour: string, thick = 1): void {
  g.fillStyle = colour;
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    g.fillRect(Math.round(lerp(x0, x1, t)), Math.round(lerp(y0, y1, t)), thick, thick);
  }
}

/** The letters used in the small pictures below, and the colour each stands for. */
const KEY: Record<string, string> = {
  k: C.ink,
  K: C.sky0,
  p: C.sky2,
  v: C.sky3,
  m: C.sky4,
  c: C.sky5,
  o: C.gold1,
  d: C.gold0,
  y: C.gold2,
  w: C.gold3,
  b: C.bark1,
  B: C.bark0,
  n: C.bark3,
  N: C.bark2,
  t: C.bark4,
  h: C.green0,
  g: C.green2,
  G: C.green4,
  f: C.green3,
  e: C.earth1,
  E: C.earth0,
  u: C.earth2,
  s: C.stone1,
  S: C.stone3,
  z: C.stone0,
  x: C.stone2,
  r: "#c9453a",
  l: "#9fd0e8",
  L: "#5b8fc4",
};

/** Paints a small picture written as rows of letters; a dot or a space is left clear. */
export function stamp(g: G, x: number, y: number, rows: readonly string[], swap: Record<string, string> = {}): void {
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const ch = row.charAt(i);
      const colour = swap[ch] ?? KEY[ch];
      if (!colour) continue;
      g.fillStyle = colour;
      g.fillRect(x + i, y + j, 1, 1);
    }
  });
}
export function stamped(rows: readonly string[], swap: Record<string, string> = {}): Sprite {
  const s = sprite(Math.max(...rows.map((r) => r.length)), rows.length);
  stamp(s.g, 0, 0, rows, swap);
  return s;
}

/** A copy of a sprite facing the other way. */
export function flipped(src: Sprite): Sprite {
  const s = sprite(src.w, src.h);
  s.g.translate(src.w, 0);
  s.g.scale(-1, 1);
  s.g.drawImage(src.c, 0, 0);
  s.g.setTransform(1, 0, 0, 1, 0, 0);
  return s;
}

/** A copy of a sprite washed with one colour, keeping its shape: for shade, and for silhouettes. */
export function washed(src: Sprite, colour: string, strength: number): Sprite {
  const s = sprite(src.w, src.h);
  s.g.drawImage(src.c, 0, 0);
  s.g.globalCompositeOperation = "source-atop";
  s.g.globalAlpha = strength;
  s.g.fillStyle = colour;
  s.g.fillRect(0, 0, src.w, src.h);
  s.g.globalAlpha = 1;
  s.g.globalCompositeOperation = "source-over";
  return s;
}

/** A soft light as stepped rings, which sits better beside pixel art than a smooth fade. */
export function glow(radius: number, colour: string, peak: number, steps = 5): Sprite {
  const s = sprite(radius * 2 + 1, radius * 2 + 1);
  for (let i = 0; i < steps; i++) {
    const r = Math.round(radius * (1 - i / steps));
    disc(s.g, radius, radius, r, rgba(colour, peak / steps));
  }
  return s;
}

/** Four-by-four ordered dither: whether the pixel at x,y is on, for a level from 0 to 1. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export function dither(x: number, y: number, level: number): boolean {
  return level * 16 > (BAYER[(y & 3) * 4 + (x & 3)] ?? 0) + 0.5;
}

/** Bands of colour down a canvas, each melting into the next through a few dithered rows. */
export function bands(g: G, w: number, stops: readonly (readonly [number, string])[], melt = 3): void {
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (!a || !b) continue;
    const y0 = Math.round(a[0]);
    const y1 = Math.round(b[0]);
    g.fillStyle = a[1];
    g.fillRect(0, y0, w, y1 - y0);
    g.fillStyle = b[1];
    const rows = Math.min(y1 - y0, melt);
    for (let k = 0; k < rows; k++) {
      const y = y1 - rows + k;
      for (let x = 0; x < w; x++) if (dither(x, y, (k + 1) / (rows + 1))) g.fillRect(x, y, 1, 1);
    }
  }
}

// ---------- small pictures for the interface ----------

const ICONS: Record<string, readonly string[]> = {
  leaf: [
    "..........kk",
    ".....kkkkkGk",
    "...kkGGGGGGk",
    "..kGGGGGfGGk",
    ".kGGGGGfGGk.",
    ".kGGGGfGGGk.",
    "kGGGGfGGGGk.",
    "kGGGfGGGGk..",
    "kGGfGGGGk...",
    "kgfgGGkk....",
    "kfkkkk......",
    "kk..........",
  ],
  coin: [
    "....kkkk....",
    "..kkyyyykk..",
    ".kyyoooooyk.",
    ".kyoowwoodk.",
    "kyoowoooodk.",
    "kyoowoooodk.",
    "kyoowoooodk.",
    "kyoowoooodk.",
    ".kyooooooddk",
    ".kdoooooodk.",
    "..kkddddkk..",
    "....kkkk....",
  ],
  sun: [
    ".....o......",
    ".o...o...o..",
    "..o.....o...",
    "....yyy.....",
    "...yywyy....",
    "oo.ywwwy.oo.",
    "...yywyy....",
    "....yyy.....",
    "..o.....o...",
    ".o...o...o..",
    ".....o......",
    "............",
  ],
  scroll: [
    "............",
    ".dwwwwwwwd..",
    ".dwbbbbwwd..",
    "..wwwwwww...",
    "..wbbbbbw...",
    "..wwwwwww...",
    "..wbbbwww...",
    "..wwwwwww...",
    "..wbbbbbw...",
    ".dwwwwwwwd..",
    ".dwwwwwwwd..",
    "............",
  ],
  stall: [
    "............",
    ".mmwwmmwwmm.",
    "mmwwmmwwmmww",
    "mwwmmwwmmwwm",
    ".m.w.m.w.m..",
    ".n........n.",
    ".n..c.G.o.n.",
    ".nnnnnnnnnn.",
    ".nbbnbbnbbn.",
    ".nbbnbbnbbn.",
    ".nnnnnnnnnn.",
    "............",
  ],
  gear: [
    "....oo.oo...",
    ".oo.ooooo.oo",
    ".ooooooooooo",
    "..ooodddooo.",
    "oooodkkkdooo",
    "ooodk...kdoo",
    ".oodk...kdo.",
    "ooodk...kdoo",
    "oooodkkkdooo",
    "..ooodddooo.",
    ".ooooooooooo",
    ".oo.ooooo.oo",
  ],
  fire: [
    ".....c......",
    "....cc......",
    "....coc..c..",
    "...ccoc.cc..",
    "..ccooccoc..",
    "..coooooocc.",
    ".ccoyyoyooc.",
    ".cooywwyooc.",
    ".cooywwyoc..",
    "..bnnbbnnb..",
    ".bnnbnnbnnb.",
    "............",
  ],
  crab: [
    "............",
    ".cc......cc.",
    "c.c......c.c",
    "cc..k..k..cc",
    ".c..c..c..c.",
    ".cccccccccc.",
    "..cccccccc..",
    ".cmccccccmc.",
    "c.cmmmmmmc.c",
    "..c.c..c.c..",
    ".c..c..c..c.",
    "............",
  ],
  camp: [
    "............",
    ".....nn.....",
    "....nttn....",
    "....nttn....",
    "...nttttn...",
    "...ntkktn...",
    "..nttkkttn..",
    "..ntkkkktn..",
    ".nttkkkkttn.",
    ".ntkkkkkktn.",
    "gggggggggggg",
    "............",
  ],
  lantern: [
    ".....kk.....",
    "....kddk....",
    "...kddddk...",
    "...kywwyk...",
    "...kywwyk...",
    "...kyywyk...",
    "...kyyyyk...",
    "...kddddk...",
    "....kddk....",
    "............",
    "............",
    "............",
  ],
  banner: [
    "bbbbbbbbbbbb",
    ".dvvvvvvvvd.",
    ".dvvvoovvvd.",
    ".dvvoooovvd.",
    ".dvvvoovvvd.",
    ".dvoooooovd.",
    ".dvvvoovvvd.",
    ".dvvvoovvvd.",
    ".dvvvvvvvvd.",
    ".dvvvddvvvd.",
    ".dvvd..dvvd.",
    ".dd......dd.",
  ],
  star: [
    ".....y......",
    ".....y......",
    "....yyy.....",
    "....ywy.....",
    "yyyyywyyyyy.",
    ".yywwwwwyy..",
    "..yywwwyy...",
    "..yyyyyyy...",
    ".yyyy.yyyy..",
    ".yy.....yy..",
    "y.........y.",
    "............",
  ],
  heart: [
    "............",
    "..mm...mm...",
    ".mccm.mccm..",
    "mccccmccccm.",
    "mcwcccccccm.",
    "mcccccccccm.",
    ".mcccccccm..",
    "..mcccccm...",
    "...mcccm....",
    "....mcm.....",
    ".....m......",
    "............",
  ],
  note: [
    "............",
    ".....yyyyy..",
    ".....yyyyy..",
    ".....y...y..",
    ".....y...y..",
    ".....y...y..",
    ".....y...y..",
    "..yyyy.yyyy.",
    ".yyyyyyyyyy.",
    ".yyyy..yyyy.",
    "..yy....yy..",
    "............",
  ],
  laugh: [
    "............",
    "w.w..ww..w.w",
    "w.w.w..w.w.w",
    "www.wwww.www",
    "w.w.w..w.w.w",
    "w.w.w..w.w.w",
    "............",
    "............",
    "............",
    "............",
    "............",
    "............",
  ],
  mallow: [
    "..........b.",
    ".........b..",
    "....www.b...",
    "...wwwwwb...",
    "...wwwwb....",
    "...wwwbw....",
    "....tbtt....",
    "....b.......",
    "...b........",
    "..b.........",
    ".b..........",
    "............",
  ],
  wave: [
    "............",
    "....t.t.t...",
    "....t.t.t.t.",
    "....t.t.t.t.",
    "..t.ttttttt.",
    "..t.ttttttt.",
    "..ttttttttt.",
    "...tttttttt.",
    "...ttttttt..",
    "....ttttt...",
    "....ttttt...",
    "............",
  ],
  check: [
    "............",
    "..........G.",
    ".........GG.",
    "........GG..",
    ".......GG...",
    ".G....GG....",
    ".GG..GG.....",
    "..GGGG......",
    "...GG.......",
    "............",
    "............",
    "............",
  ],
  jar: [
    "............",
    "...nnnnnn...",
    "...nttttn...",
    "..llllllll..",
    ".ll......ll.",
    ".l..y.....l.",
    ".l.....y..l.",
    ".l..y.....l.",
    ".l......y.l.",
    ".ll......ll.",
    "..llllllll..",
    "............",
  ],
  cap: [
    ".....b......",
    "....bb......",
    "...bnnnb....",
    "..bnnunnnb..",
    ".bnnunnnnnb.",
    ".bnnnnnnnnb.",
    "bbbbbbbbbbbb",
    ".toooooooot.",
    ".toooyooodt.",
    "..tooooodt..",
    "...ttddtt...",
    "............",
  ],
  soundOn: [
    "............",
    ".....w...w..",
    "....ww....w.",
    ".wwwww.w..w.",
    ".wwwww..w.w.",
    ".wwwww..w.w.",
    ".wwwww..w.w.",
    ".wwwww.w..w.",
    "....ww....w.",
    ".....w...w..",
    "............",
    "............",
  ],
  soundOff: [
    "............",
    ".....w......",
    "....ww......",
    ".wwwww.c..c.",
    ".wwwww..cc..",
    ".wwwww..cc..",
    ".wwwww.c..c.",
    ".wwwww......",
    "....ww......",
    ".....w......",
    "............",
    "............",
  ],
  person: [
    "............",
    "....tttt....",
    "...tttttt...",
    "...tttttt...",
    "...tttttt...",
    "....tttt....",
    "..vvvvvvvv..",
    ".vvvvvvvvvv.",
    ".vvvvvvvvvv.",
    ".vvvvvvvvvv.",
    ".vvvvvvvvvv.",
    "............",
  ],
  whistle: [
    "............",
    "............",
    ".........k..",
    "..ccccccckk.",
    ".cccccccccc.",
    ".ccmccccccc.",
    ".cckccccc...",
    ".ccccccc....",
    "..ccccc.....",
    "............",
    "............",
    "............",
  ],
  scarf: [
    "............",
    "..mmmmmmmm..",
    ".mwmmwmmwmm.",
    ".mmmmmmmmmm.",
    "..mmmmmmmm..",
    "......mmm...",
    "......mwm...",
    "......mmm...",
    "......mwm...",
    "......mmm...",
    "......m.m...",
    "............",
  ],
  poem: [
    "............",
    "..wwwwwwww..",
    "..wkkkkkww..",
    "..wwwwwwww..",
    "..wkkkwwww..",
    "..wwwwwwww..",
    "..wkkkkkkw..",
    "..wwwwwwww..",
    "..wkkkkwww.n",
    "..wwwwwww.n.",
    "..wwwwww.n..",
    "........k...",
  ],
  bucket: [
    "............",
    "..ssssssss..",
    ".s........s.",
    ".sGfGGfGGGs.",
    ".xGGfGGGfGx.",
    ".xssssssssx.",
    ".xxxxxxxxxx.",
    "..xxxxxxxx..",
    "..xzzzzzzx..",
    "..xxxxxxxx..",
    "...xxxxxx...",
    "............",
  ],
};

const iconCache = new Map<string, Sprite>();
export function iconSprite(name: string): Sprite {
  const had = iconCache.get(name);
  if (had) return had;
  const s = stamped(ICONS[name] ?? ICONS["star"] ?? []);
  iconCache.set(name, s);
  return s;
}

const urlCache = new Map<HTMLCanvasElement, string>();
/** A canvas as an image for the page, shown with hard pixel edges at whatever size the page gives it. */
export function picture(src: Sprite, cssHeight: number, cls = "pix"): HTMLImageElement {
  const img = document.createElement("img");
  let url = urlCache.get(src.c);
  if (!url) {
    url = src.c.toDataURL();
    urlCache.set(src.c, url);
  }
  img.src = url;
  img.className = cls;
  img.alt = "";
  img.draggable = false;
  img.style.height = `${cssHeight}px`;
  img.style.width = `${Math.round((cssHeight * src.w) / src.h)}px`;
  return img;
}
export const icon = (name: string, cssHeight = 24): HTMLImageElement => picture(iconSprite(name), cssHeight);
