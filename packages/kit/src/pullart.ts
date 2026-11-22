/**
 * The art of a pull: a member's card in its three finishes, and a banner's key art, both drawn
 * from the member's skin sheet (`portrait.ts`) and the town's painted scenery (`scenery.ts`).
 *
 * A finish is what a pull's rarity is: nobody is rarer than anybody else, and the same member comes
 * in all three. `leaf` is bark and dusk green with one star; `lantern` gold and plum with lanterns
 * and a warm rim of light on the figure, two stars; `aurora` gold with a gleam running round it, a
 * night sky with an aurora, twinkling stars and redwoods, a leaf-green rim, three stars.
 *
 * `card` and `keyArt` take a time in seconds, so a page can draw them every frame; at time 0 a card
 * is a still. Everything that moves is a plain function of that time.
 */

import { BARK, CREAM, GOLD, GREEN, INK, LEAF, SKY, WATER } from "./palette.ts";
import { bitmap, ell, outlined, R, rgb } from "./pix.ts";
import { figure, type Pixels, type Pose, type Rim, type Sheet, skinOf, toCanvas } from "./portrait.ts";
import {
  at,
  DEEP,
  dither,
  drawFern,
  lanternTree,
  paintGrass,
  paintSunset,
  paintTrunk,
  paperLantern,
} from "./scenery.ts";
import { widthOf, write } from "./text.ts";
import { type Ctx, makeCanvas, vnoise } from "./util.ts";

export type Finish = "leaf" | "lantern" | "aurora";
export const FINISHES: readonly Finish[] = ["leaf", "lantern", "aurora"];

export const CARD_W = 64;
export const CARD_H = 88;
/** The top of the band the name is written on. */
const BAND = 63;
/**
 * How far the bust stands down behind the band: far enough that the finish's sky shows over the
 * head, and the band hides where the bust is cut.
 */
const SINK = 10;

/** The rim of light each finish puts on the figure. */
export const RIMS: Readonly<Record<Finish, Rim | null>> = {
  leaf: null,
  lantern: { colour: GOLD[2], amount: 0.35 },
  aurora: { colour: LEAF, amount: 0.35 },
};
export const STARS: Readonly<Record<Finish, number>> = { leaf: 1, lantern: 2, aurora: 3 };

// ---------- moving things, as plain functions of time ----------

/** How long the gleam takes to run once round an aurora card's frame, in seconds. */
export const GLEAM_LAP = 3.2;

/**
 * The gleam on an aurora frame at `t` seconds, at `u` of the way round (clockwise from the top left
 * corner): 2 at its bright head, 1 along the short tail behind it, else 0. `n` is how many pixels
 * the way round is, so the head and tail are a fixed number of pixels long.
 */
export function gleam(t: number, u: number, n: number): 0 | 1 | 2 {
  const head = (((t / GLEAM_LAP) % 1) + 1) % 1;
  const behind = ((((head - u) % 1) + 1) % 1) * n;
  return behind < 4 ? 2 : behind < 12 ? 1 : 0;
}

/** How far round its ring a pixel of the card's frame is, from the top left corner clockwise, in [0, 1). */
export function roundFrame(x: number, y: number, ring: number, w = CARD_W, h = CARD_H): number {
  const right = w - 1 - ring;
  const bottom = h - 1 - ring;
  const across = right - ring;
  const down = bottom - ring;
  const all = 2 * (across + down);
  let d: number;
  if (y === ring) d = x - ring;
  else if (x === right) d = across + (y - ring);
  else if (y === bottom) d = across + down + (right - x);
  else d = 2 * across + down + (bottom - y);
  return d / all;
}

/** How bright one of the aurora card's stars is at `t`, in [0, 1]. */
export function twinkle(t: number, i: number): number {
  return 0.5 + 0.5 * Math.sin(t * (1.1 + i * 0.37) + i * 2.1);
}

// ---------- the small capitals ----------

/** Small capitals, three or so pixels wide and five tall, for a card's title. */
const SMALL: Readonly<Record<string, readonly string[]>> = {
  A: [".x.", "x.x", "xxx", "x.x", "x.x"],
  B: ["xx.", "x.x", "xx.", "x.x", "xx."],
  C: [".xx", "x..", "x..", "x..", ".xx"],
  D: ["xx.", "x.x", "x.x", "x.x", "xx."],
  E: ["xxx", "x..", "xx.", "x..", "xxx"],
  F: ["xxx", "x..", "xx.", "x..", "x.."],
  G: [".xx", "x..", "x.x", "x.x", ".xx"],
  H: ["x.x", "x.x", "xxx", "x.x", "x.x"],
  I: ["xxx", ".x.", ".x.", ".x.", "xxx"],
  J: ["..x", "..x", "..x", "x.x", ".x."],
  K: ["x.x", "x.x", "xx.", "x.x", "x.x"],
  L: ["x..", "x..", "x..", "x..", "xxx"],
  M: ["x...x", "xx.xx", "x.x.x", "x...x", "x...x"],
  N: ["x..x", "xx.x", "x.xx", "x..x", "x..x"],
  O: [".x.", "x.x", "x.x", "x.x", ".x."],
  P: ["xx.", "x.x", "xx.", "x..", "x.."],
  Q: [".x.", "x.x", "x.x", "xx.", ".xx"],
  R: ["xx.", "x.x", "xx.", "x.x", "x.x"],
  S: [".xx", "x..", ".x.", "..x", "xx."],
  T: ["xxx", ".x.", ".x.", ".x.", ".x."],
  U: ["x.x", "x.x", "x.x", "x.x", "xxx"],
  V: ["x.x", "x.x", "x.x", "x.x", ".x."],
  W: ["x...x", "x...x", "x.x.x", "xx.xx", "x...x"],
  X: ["x.x", "x.x", ".x.", "x.x", "x.x"],
  Y: ["x.x", "x.x", ".x.", ".x.", ".x."],
  Z: ["xxx", "..x", ".x.", "x..", "xxx"],
  "0": ["xxx", "x.x", "x.x", "x.x", "xxx"],
  "1": [".x.", "xx.", ".x.", ".x.", "xxx"],
  "2": ["xx.", "..x", ".x.", "x..", "xxx"],
  "3": ["xx.", "..x", ".x.", "..x", "xx."],
  "4": ["x.x", "x.x", "xxx", "..x", "..x"],
  "5": ["xxx", "x..", "xx.", "..x", "xx."],
  "6": [".xx", "x..", "xxx", "x.x", "xxx"],
  "7": ["xxx", "..x", ".x.", ".x.", ".x."],
  "8": ["xxx", "x.x", "xxx", "x.x", "xxx"],
  "9": ["xxx", "x.x", "xxx", "..x", "xx."],
  "-": ["...", "...", "xxx", "...", "..."],
  ".": [".", ".", ".", ".", "x"],
  "'": ["x", "x", ".", ".", "."],
  _: ["...", "...", "...", "...", "xxx"],
  " ": ["..", "..", "..", "..", ".."],
};

const glyph = (ch: string): readonly string[] => SMALL[ch] ?? SMALL[" "] ?? [];

/** The letters of a line of small capitals (titles are plain letters, so one character is one letter). */
const letters = (text: string): string[] => text.toUpperCase().split("");

/** How wide a line of small capitals is, one clear pixel between letters. */
export function smallWidth(text: string): number {
  const chars = letters(text);
  return chars.reduce((w, ch) => w + (glyph(ch)[0]?.length ?? 0), 0) + Math.max(0, chars.length - 1);
}

/** Writes small capitals centred on `cx`, with a one-pixel drop shadow. */
function small(g: Ctx, text: string, cx: number, y: number, colour: string, shadow: string): void {
  const x0 = Math.round(cx - smallWidth(text) / 2);
  for (const [col, dx] of [
    [shadow, 1],
    [colour, 0],
  ] as const) {
    let x = x0 + dx;
    for (const ch of letters(text)) {
      const rows = glyph(ch);
      rows.forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx++) if (row.charAt(rx) === "x") R(g, x + rx, y + ry + dx, 1, 1, col);
      });
      x += (rows[0]?.length ?? 0) + 1;
    }
  }
}

// ---------- pictures made once ----------

const STAR_ROWS = ["...y...", "..yYy..", "yyYYYyy", ".yYYYy.", ".yYyYy.", "yy...yy"];
let star: HTMLCanvasElement | null = null;
const starPicture = (): HTMLCanvasElement => (star ??= outlined(bitmap(STAR_ROWS, { y: GOLD[1], Y: GOLD[2] }), INK));

const once = new Map<string, HTMLCanvasElement>();
function kept(key: string, make: () => HTMLCanvasElement): HTMLCanvasElement {
  let c = once.get(key);
  if (!c) {
    c = make();
    once.set(key, c);
  }
  return c;
}

/** A figure with its finish's rim, kept per sheet so a page can draw cards every frame. */
interface Made {
  c: HTMLCanvasElement;
  p: Pixels;
}
const figures = new WeakMap<Sheet, Map<string, Made>>();
function figureOf(sheet: Sheet, s: number, pose: Pose, rim: Rim | null): Made {
  let mine = figures.get(sheet);
  if (!mine) {
    mine = new Map();
    figures.set(sheet, mine);
  }
  const key = `${s}/${pose}/${rim ? `${rim.colour}/${rim.amount}` : "-"}`;
  let made = mine.get(key);
  if (!made) {
    const p = figure(skinOf(sheet), { s, pose, rim });
    made = { c: toCanvas(p), p };
    mine.set(key, made);
  }
  return made;
}

// ---------- the card's backdrops (60 by 84, inside the frame) ----------

const IN_W = CARD_W - 4;
const IN_H = CARD_H - 4;

/** Writes a picture a pixel at a time into one image, quicker than a rectangle per pixel. */
function pixels(w: number, h: number, fn: (x: number, y: number) => string | null): HTMLCanvasElement {
  const { c, g } = makeCanvas(w, h);
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const col = fn(x, y);
      if (col === null) continue;
      const [r, gg, b] = rgb(col);
      const i = (y * w + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = gg;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return c;
}

function leafBackdrop(): HTMLCanvasElement {
  return kept("leaf", () => {
    const { c, g } = makeCanvas(IN_W, IN_H);
    R(g, 0, 0, IN_W, IN_H, GREEN[1]);
    drawFern(g, 3, 46, 40, [DEEP[2]], 17);
    drawFern(g, 58, 40, 36, [DEEP[2]], 23);
    return c;
  });
}

/** Where the lantern card's three lanterns hang (inside the frame), and how long each one's cord is. */
const LANTERNS: readonly (readonly [number, number, string, string])[] = [
  [3, 3, SKY[5], GOLD[1]],
  [51, 1, GOLD[1], GOLD[2]],
  [0, 22, SKY[4], GOLD[2]],
];

/** A glow a pixel at a time: rings out from the middle, dithered where one meets the next. */
function glowAt(x: number, y: number, cx: number, cy: number, r: number, ramp: readonly string[]): string | null {
  const d = Math.hypot(x + 0.5 - cx, (y + 0.5 - cy) * 1.1) / r;
  if (d >= 1) return null;
  const v = (1 - d) * ramp.length + dither(x, y) - 0.5;
  return v < 0.5 ? null : at(ramp, v - 0.5);
}

function lanternBackdrop(t: number): HTMLCanvasElement {
  const glows = LANTERNS.map(([x, y], i) => ({ cx: x + 3.5, cy: y + 6, r: 11 + 0.7 * Math.sin(t * 2.3 + i * 2) }));
  const base = pixels(IN_W, IN_H, (x, y) => {
    for (const gl of glows) {
      const c = glowAt(x, y, gl.cx, gl.cy, gl.r, [SKY[2], SKY[3], SKY[4]]);
      if (c) return c;
    }
    const v = y / IN_H;
    return v > 0.55 && dither(x, y) < (v - 0.55) / 0.3 ? SKY[2] : SKY[1];
  });
  const g = base.getContext("2d");
  if (!g) return base;
  for (const [x, y, col, core] of LANTERNS) {
    R(g, x + 3, 0, 1, y + 1, BARK[0]);
    g.drawImage(
      kept(`lantern/${col}`, () => paperLantern(col, core)),
      x,
      y,
    );
  }
  return base;
}

/** The aurora card's stars: where they are inside the frame. */
const NIGHT_STARS: readonly (readonly [number, number])[] = [
  [5, 3],
  [17, 1],
  [33, 2],
  [47, 1],
  [56, 4],
  [4, 19],
  [57, 17],
  [3, 34],
];

/**
 * The aurora's three bands, nearest first: leaf green, the pond's blue, rose. Each is a line that
 * is bright where it is strongest, with curtains of rays hanging under it in its colour and then
 * its shade: its middle row, how far it swings, how fast it drifts, and how long its rays hang.
 */
const AURORA: readonly {
  row: number;
  swing: number;
  wave: number;
  drift: number;
  hang: number;
  cols: readonly [string, string, string];
}[] = [
  { row: 7, swing: 2.6, wave: 0.09, drift: 0.45, hang: 11, cols: [GREEN[1], GREEN[3], LEAF] },
  { row: 4.5, swing: 2.2, wave: 0.14, drift: -0.35, hang: 6, cols: [WATER[1], WATER[2], WATER[3]] },
  { row: 2, swing: 1.6, wave: 0.19, drift: 0.3, hang: 3, cols: [SKY[2], SKY[3], SKY[4]] },
];

/** The aurora card's sky at `t`: one colour for a pixel, or null for the night behind. */
export function auroraAt(x: number, y: number, t: number): string | null {
  for (let k = 0; k < AURORA.length; k++) {
    const b = AURORA[k];
    if (!b) continue;
    const [shade, dim, bright] = b.cols;
    const top = Math.round(
      b.row + b.swing * Math.sin(x * b.wave + t * b.drift + k * 1.7) + 0.7 * Math.sin(x * 0.31 - t * 0.6 + k * 2.9),
    );
    const dy = y - top;
    if (dy === 0) return vnoise(x / 5 + t * 0.5, k * 3, 44) > 0.45 ? bright : dim;
    // Curtains: rays of different lengths, with gaps between them.
    const n = vnoise(x / 2.2 + k * 7, t * 0.4, 40 + k);
    if (n < 0.3) continue;
    const hang = 1 + b.hang * (n - 0.3) * 1.4;
    if (dy > 0 && dy < hang) return dy < hang * 0.5 ? dim : shade;
  }
  return null;
}

function auroraBackdrop(t: number): HTMLCanvasElement {
  const trunks = kept("aurora/trunks", () => {
    const { c, g } = makeCanvas(IN_W, IN_H);
    const left = paintTrunk(6, IN_H + 6, 4, 150);
    const right = paintTrunk(5, IN_H + 6, 9, 150);
    g.drawImage(left.c, -left.ax + 1, IN_H - left.ay + 3);
    g.drawImage(right.c, IN_W - 2 - right.ax, IN_H - right.ay + 6);
    return c;
  });
  // The stars as they are at `t`, each a point, or a small cross while it is brightest.
  const stars = new Map<number, string>();
  NIGHT_STARS.forEach(([x, y], i) => {
    const b = twinkle(t, i);
    if (b > 0.78)
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const)
        stars.set((y + dy) * IN_W + x + dx, GOLD[2]);
    stars.set(y * IN_W + x, b > 0.78 ? CREAM : b > 0.35 ? GOLD[2] : SKY[3]);
  });
  const sky = pixels(IN_W, IN_H, (x, y) => {
    const lit = auroraAt(x, y, t);
    if (lit) return lit;
    const point = stars.get(y * IN_W + x);
    if (point) return point;
    const v = y / IN_H;
    if (v < 0.4) return INK;
    return v > 0.7 && dither(x, y) < (v - 0.7) / 0.4 ? SKY[1] : dither(x, y) < (v - 0.4) / 0.3 ? SKY[0] : INK;
  });
  const g = sky.getContext("2d");
  if (!g) return sky;
  g.drawImage(trunks, 0, 0);
  return sky;
}

function backdrop(finish: Finish, t: number): HTMLCanvasElement {
  return finish === "leaf" ? leafBackdrop() : finish === "lantern" ? lanternBackdrop(t) : auroraBackdrop(t);
}

// ---------- the frame and the band ----------

/** The colours of a finish's frame: its outer ring, then its inner ring lit (top and left) and shaded. */
const FRAME: Readonly<Record<Finish, readonly [string, string, string]>> = {
  leaf: [BARK[0], BARK[4], BARK[2]],
  lantern: [GOLD[0], GOLD[2], GOLD[1]],
  aurora: [GOLD[0], GOLD[2], GOLD[1]],
};
const BAND_FILL: Readonly<Record<Finish, string>> = { leaf: BARK[1], lantern: SKY[0], aurora: INK };

function drawFrame(g: Ctx, finish: Finish, t: number): void {
  const [outer, lit, shade] = FRAME[finish];
  for (let y = 0; y < CARD_H; y++)
    for (let x = 0; x < CARD_W; x++) {
      const ring = Math.min(x, y, CARD_W - 1 - x, CARD_H - 1 - y);
      if (ring > 1) {
        x = Math.max(x, CARD_W - 3);
        continue;
      }
      if (ring === 0 && (x === 0 || x === CARD_W - 1) && (y === 0 || y === CARD_H - 1)) continue;
      let col = ring === 0 ? outer : x === 1 || y === 1 ? lit : shade;
      if (finish === "aurora") {
        const shine = gleam(t, roundFrame(x, y, ring), 2 * (CARD_W + CARD_H));
        if (shine === 2) col = CREAM;
        else if (shine === 1) col = ring === 0 ? GOLD[1] : GOLD[2];
      }
      R(g, x, y, 1, 1, col);
    }
}

/**
 * The member's name as it fits the band: in the font, bold, else regular; else (a name of up to
 * sixteen letters is far wider than a card) in small capitals; else cut short in them.
 */
export function fitName(
  name: string,
  room: number,
  measure: (text: string, bold: boolean) => number,
): { text: string; how: "bold" | "regular" | "small" } {
  if (measure(name, true) <= room) return { text: name, how: "bold" };
  if (measure(name, false) <= room) return { text: name, how: "regular" };
  let cut = name;
  while (cut.length > 1 && smallWidth(cut) > room) cut = cut.slice(0, -1);
  return { text: cut === name ? name : `${cut.slice(0, -1)}.`, how: "small" };
}

function drawBand(g: Ctx, o: CardOptions): void {
  const [, lit] = FRAME[o.finish];
  R(g, 2, BAND, IN_W, CARD_H - 2 - BAND, BAND_FILL[o.finish]);
  R(g, 2, BAND, IN_W, 1, lit);
  R(g, 2, BAND + 1, IN_W, 1, INK);
  const n = STARS[o.finish];
  const st = starPicture();
  const gap = 1;
  const all = n * st.width + (n - 1) * gap;
  for (let i = 0; i < n; i++) g.drawImage(st, Math.round(CARD_W / 2 - all / 2) + i * (st.width + gap), BAND - 4);
  small(g, o.title, CARD_W / 2, BAND + 7, GOLD[1], INK);
  // The font's widths count the clear pixel after the last letter, where the shadow falls.
  const fit = fitName(o.name, IN_W - 1, (text, bold) => widthOf(g, text, 1, bold));
  if (fit.how === "small") small(g, fit.text, CARD_W / 2, BAND + 15, CREAM, INK);
  else
    write(g, fit.text, CARD_W / 2, BAND + 12, {
      bold: fit.how === "bold",
      align: "center",
      colour: CREAM,
      shadow: INK,
    });
}

// ---------- the card ----------

export interface CardOptions {
  name: string;
  /** The line over the name, in small capitals: for example a guild rank. */
  title: string;
  finish: Finish;
  /** Seconds, for a page drawing it every frame; 0 is a still. */
  t?: number;
}

/**
 * A member's card, 64 by 88 art pixels: a frame two pixels thick with its corners cut, the
 * finish's backdrop, the member's bust at `s` 4 centred and standing on the band along the bottom,
 * the finish's stars on the band's edge, the title in small capitals and the name under it.
 */
export function card(sheet: Sheet, o: CardOptions): HTMLCanvasElement {
  const t = o.t ?? 0;
  const { c, g } = makeCanvas(CARD_W, CARD_H);
  g.drawImage(backdrop(o.finish, t), 2, 2);
  const fig = figureOf(sheet, 4, "bust", RIMS[o.finish]).c;
  g.save();
  g.beginPath();
  g.rect(2, 2, IN_W, IN_H);
  g.clip();
  g.drawImage(fig, Math.round(CARD_W / 2 - fig.width / 2), BAND + SINK - fig.height);
  g.restore();
  drawBand(g, o);
  drawFrame(g, o.finish, t);
  return c;
}

// ---------- key art ----------

export interface KeyArtOptions {
  w: number;
  h: number;
  finish: Finish;
  pose: Pose;
}

/** The clearing behind a key art, painted once for each size. */
function clearing(w: number, h: number): HTMLCanvasElement {
  return kept(`clearing/${w}x${h}`, () => {
    const { c, g } = makeCanvas(w, h);
    const horizon = Math.round(h * 0.58);
    g.drawImage(paintSunset(w, h, horizon, Math.round(w * 0.57)), 0, 0);
    g.drawImage(paintGrass(w, h, horizon), 0, 0);

    // The great lantern tree behind, right of the middle, with a lantern for a raid or two.
    const tree = lanternTree();
    const tx = Math.round(w * 0.7) - 33;
    const ty = horizon + 12 - 81;
    g.drawImage(tree, tx, ty);
    for (const [lx, ly, col, core] of [
      [12, 52, SKY[5], GOLD[1]],
      [44, 50, GOLD[1], GOLD[2]],
      [27, 57, SKY[4], GOLD[2]],
    ] as const) {
      R(g, tx + lx + 3, ty + ly - 4, 1, 5, BARK[0]);
      g.drawImage(paperLantern(col, core), tx + lx, ty + ly);
    }

    // The enormous trunks at both sides, their feet in the near grass.
    const left = paintTrunk(17, h + 30, 3, 70);
    g.drawImage(left.c, 6 - left.ax, horizon + 26 - left.ay);
    const right = paintTrunk(15, h + 30, 8, 70);
    g.drawImage(right.c, w - 5 - right.ax, horizon + 20 - right.ay);

    // A string of lights across the top, tied to the trunks.
    const x0 = 22;
    const x1 = w - 20;
    const y0 = Math.round(h * 0.12);
    const y1 = Math.round(h * 0.09);
    const sag = Math.round(h * 0.13);
    const along = (x: number): number => {
      const u = (x - x0) / (x1 - x0);
      return Math.round(y0 + (y1 - y0) * u + sag * 4 * u * (1 - u));
    };
    let last = along(x0);
    for (let x = x0; x <= x1; x++) {
      const y = along(x);
      R(g, x, Math.min(y, last), 1, Math.abs(y - last) + 1, SKY[0]);
      last = y;
    }
    // Bulbs as the town hangs them, each with a little round glow about it.
    const bulbs = [GOLD[2], SKY[5], CREAM, SKY[4]];
    for (let i = 0, x = x0 + 6; x < x1 - 3; i++, x += 11) {
      const y = along(x) + 1;
      const col = bulbs[i % bulbs.length] ?? CREAM;
      g.fillStyle = `${col}50`;
      g.fillRect(x - 1, y, 1, 2);
      g.fillRect(x + 2, y, 1, 2);
      g.fillRect(x, y - 1, 2, 1);
      g.fillRect(x, y + 2, 2, 1);
      R(g, x, y, 2, 2, col);
    }
    return c;
  });
}

/** The lowest row of a figure and the middle of what stands on it, for its shadow. */
function feetOf(p: Pixels): { x: number; y: number; half: number } {
  const ink = rgb(INK);
  for (let y = p.h - 2; y > 0; y--) {
    let x0 = -1;
    let x1 = -1;
    for (let x = 0; x < p.w; x++) {
      const i = (y * p.w + x) * 4;
      if ((p.data[i + 3] ?? 0) === 0) continue;
      if (p.data[i] === ink[0] && p.data[i + 1] === ink[1] && p.data[i + 2] === ink[2]) continue;
      if (x0 < 0) x0 = x;
      x1 = x;
    }
    if (x0 >= 0) return { x: (x0 + x1 + 1) / 2, y, half: (x1 - x0 + 1) / 2 };
  }
  return { x: p.w / 2, y: p.h - 1, half: p.w / 4 };
}

/**
 * A banner's key art, `w` by `h` art pixels: the dusk clearing (giant trunks either side, the
 * sunset band, a string of lights across the top), the great lantern tree behind, and the member
 * full-length in `pose`, a little left of the middle, at the largest `s` that leaves a fifth of
 * the height clear above them, with the finish's rim of light and a soft shadow under their feet.
 */
export function keyArt(sheet: Sheet, o: KeyArtOptions): HTMLCanvasElement {
  const { w, h } = o;
  const { c, g } = makeCanvas(w, h);
  g.drawImage(clearing(w, h), 0, 0);
  const ground = h - Math.max(3, Math.round(h * 0.03));
  const room = ground - Math.ceil(h / 5);
  let s = 8;
  let fig = figureOf(sheet, s, o.pose, RIMS[o.finish]);
  while (s > 1 && fig.p.h - 1 > room) {
    s--;
    fig = figureOf(sheet, s, o.pose, RIMS[o.finish]);
  }
  const feet = feetOf(fig.p);
  const fx = Math.round(w * 0.42 - feet.x);
  const fy = ground - feet.y;
  // The shadow lies on the ground the feet stand on, which goes back up and to the right of
  // their fronts as the boxes do.
  const cx = fx + feet.x + s * 0.6;
  const cy = ground - s * 0.8;
  const rx = feet.half + 3 * s;
  ell(g, cx, cy, rx, Math.max(2, s * 1.7), "rgba(26,15,30,0.3)");
  ell(g, cx, cy, rx * 0.72, Math.max(1.5, s * 1.2), "rgba(26,15,30,0.32)");
  g.drawImage(fig.c, fx, fy);
  return c;
}
