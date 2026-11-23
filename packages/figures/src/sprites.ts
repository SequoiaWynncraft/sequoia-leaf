/**
 * The figures as pictures ready to draw: each one's typed rows baked once into small canvases
 * (standing, breathing in, using its ability, tipped over, a pale flash for being hit, a dark
 * outline for one not opened yet), all with the one-pixel dark edge, facing right and facing left.
 * Also the bases they stand on and the stars over their heads.
 */
import { GOLD, GREEN, INK, SKY } from "@sequoia-leaf/kit/palette.ts";
import { bitmap, flipped, outlined, rgb } from "@sequoia-leaf/kit/pix.ts";
import { type Ctx, makeCanvas, must } from "@sequoia-leaf/kit/util.ts";
import {
  FIGURE_IDS,
  FIGURES,
  isBossId,
  isFigureId,
  isSummonId,
  type UnitKind,
} from "@sequoia-leaf/raid/content/figures.ts";

import { artOf } from "./figures.ts";
import { FOREST_TONES, PAL, SUMMON_TONES, TIER_TONES, type Tones } from "./pal.ts";

export type Pose = "idle" | "cast" | "fallen";

export interface Frames {
  readonly idle: readonly [HTMLCanvasElement, HTMLCanvasElement];
  readonly cast: HTMLCanvasElement;
  readonly fallen: HTMLCanvasElement;
  readonly flash: HTMLCanvasElement;
  readonly dark: HTMLCanvasElement;
  /** The size of a standing picture, and the pixel in it that stands on the figure's spot. */
  readonly w: number;
  readonly h: number;
  readonly ax: number;
  readonly ay: number;
  /** How tall the figure itself stands above its feet when idle, and when it rears up to cast. */
  readonly tall: number;
  readonly castTall: number;
  /** How wide it is on the ground. */
  readonly wide: number;
  /** The row its head starts at, for a small picture of it. */
  readonly head: number;
  readonly flies: boolean;
}

const widthOf = (rows: readonly string[]): number => rows.reduce((m, r) => Math.max(m, r.length), 1);

/** The same picture a breath later: the row at `at` folds away and everything above sinks a pixel. */
function breathe(rows: readonly string[], at: number): readonly string[] {
  if (at < 0 || at >= rows.length) return rows;
  return ["", ...rows.slice(0, at), ...rows.slice(at + 1)];
}
/** Rearing up: the row at `at` doubles, so everything above rises a pixel. */
function rear(rows: readonly string[], at: number): readonly string[] {
  const row = rows[Math.min(Math.max(at, 0), rows.length - 1)] ?? "";
  const i = Math.min(Math.max(at, 0), rows.length - 1);
  return [...rows.slice(0, i), row, ...rows.slice(i)];
}

/** Every solid pixel of a picture in one colour. */
function tinted(src: HTMLCanvasElement, colour: string): HTMLCanvasElement {
  const { c, g } = makeCanvas(src.width, src.height);
  g.drawImage(src, 0, 0);
  const img = g.getImageData(0, 0, c.width, c.height);
  const [r, gg, b] = rgb(colour);
  for (let i = 0; i < img.data.length; i += 4) {
    if ((img.data[i + 3] ?? 0) < 40) continue;
    img.data[i] = r;
    img.data[i + 1] = gg;
    img.data[i + 2] = b;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** A picture turned a quarter round, the way a carved figure tips over. */
function tipped(src: HTMLCanvasElement, left: boolean): HTMLCanvasElement {
  const { c, g } = makeCanvas(src.height, src.width);
  if (left) {
    g.translate(0, src.width);
    g.rotate(-Math.PI / 2);
  } else {
    g.translate(src.height, 0);
    g.rotate(Math.PI / 2);
  }
  g.drawImage(src, 0, 0);
  return c;
}

const edged = (c: HTMLCanvasElement): HTMLCanvasElement => outlined(c, INK);

function bake(kind: UnitKind): { right: Frames; left: Frames } {
  const art = artOf(kind);
  const at = art.breath ?? Math.floor(art.rows.length * 0.6);
  const lists = {
    a: art.rows,
    b: art.alt ?? (art.flies ? art.rows : breathe(art.rows, at)),
    cast: art.cast ?? rear(art.rows, at),
  };
  const w = Math.max(widthOf(lists.a), widthOf(lists.b), widthOf(lists.cast));
  const h = Math.max(lists.a.length, lists.b.length, lists.cast.length);
  /** A list of rows on a canvas the size of the largest, standing on its bottom edge. */
  const plain = (rows: readonly string[]): HTMLCanvasElement => {
    const { c, g } = makeCanvas(w, h);
    g.drawImage(bitmap(rows, PAL), 0, h - rows.length);
    return c;
  };
  const a = plain(lists.a);
  const idleA = edged(a);
  const base = {
    idle: [idleA, edged(plain(lists.b))] as const,
    cast: edged(plain(lists.cast)),
    flash: tinted(idleA, "#fff8e0"),
    dark: outlined(tinted(a, SKY[0]), SKY[2]),
    w: w + 2,
    h: h + 2,
    ax: 1 + Math.round(widthOf(lists.a) / 2),
    ay: h + 1,
    tall: lists.a.length,
    castTall: lists.cast.length,
    wide: widthOf(lists.a),
    head: art.head ?? 0,
    flies: art.flies === true,
  };
  const right: Frames = { ...base, fallen: tipped(idleA, false) };
  if (art.sym) return { right, left: right };
  const left: Frames = {
    ...base,
    idle: [flipped(base.idle[0]), flipped(base.idle[1])],
    cast: flipped(base.cast),
    flash: flipped(base.flash),
    dark: flipped(base.dark),
    ax: base.w - base.ax,
    fallen: tipped(flipped(idleA), true),
  };
  return { right, left };
}

const baked = new Map<UnitKind, { right: Frames; left: Frames }>();
/** A figure's pictures, facing right or left. */
export function framesOf(kind: UnitKind, left = false): Frames {
  let f = baked.get(kind);
  if (!f) {
    f = bake(kind);
    baked.set(kind, f);
  }
  return left ? f.left : f.right;
}

/** Which of a figure's two standing pictures shows at `t` seconds; `phase` (0 to 1) keeps neighbours out of step. */
export const beatAt = (t: number, phase = 0): 0 | 1 => (Math.floor(t * 1.7 + phase * 2) % 2 === 0 ? 0 : 1);
/** How far over its spot a figure that flies hovers at `t` seconds, in its own pixels: 1 to 3, and 0 for one that stands. */
export const hoverAt = (kind: UnitKind, t: number, phase = 0): number =>
  framesOf(kind).flies ? 2 + Math.round(Math.sin(t * 4 + phase * 6)) : 0;

export interface Shown {
  pose?: Pose;
  /** Which of the two standing pictures. */
  beat?: 0 | 1;
  left?: boolean;
  /** Drawn as a pale flash, for the moment it is hit. */
  flash?: boolean;
  /** Drawn as a dark outline: one not opened yet. */
  dark?: boolean;
  /** With a gold outline round it: one of the trait that is lit. */
  lit?: boolean;
  alpha?: number;
}

const gilt = new Map<HTMLCanvasElement, HTMLCanvasElement>();
/** A picture with a gold outline round its dark edge, one pixel larger all round. */
function gilded(pic: HTMLCanvasElement): HTMLCanvasElement {
  let c = gilt.get(pic);
  if (!c) {
    c = outlined(pic, GOLD[2]);
    gilt.set(pic, c);
  }
  return c;
}

/** Draws a figure with its feet at `x`, `y`. */
export function drawFigure(g: Ctx, kind: UnitKind, x: number, y: number, o: Shown = {}): void {
  const f = framesOf(kind, o.left);
  const px = Math.round(x);
  const py = Math.round(y);
  if (o.alpha !== undefined) g.globalAlpha = o.alpha;
  if (o.pose === "fallen") {
    g.drawImage(f.fallen, px - Math.round(f.fallen.width / 2), py - f.fallen.height + 2);
  } else {
    const pic = o.dark ? f.dark : o.flash ? f.flash : o.pose === "cast" ? f.cast : f.idle[o.beat ?? 0];
    if (o.lit) g.drawImage(gilded(pic), px - f.ax - 1, py - f.ay - 1);
    else g.drawImage(pic, px - f.ax, py - f.ay);
  }
  if (o.alpha !== undefined) g.globalAlpha = 1;
}

/** A figure standing still on a small canvas of its own, for a card or a button. */
export function portrait(kind: UnitKind, o: Shown = {}): HTMLCanvasElement {
  const f = framesOf(kind, o.left);
  // As tall as it stands: a pose that reaches higher would leave the picture empty at the top.
  const { c, g } = makeCanvas(f.w, f.tall + 2);
  drawFigure(g, kind, f.ax, f.tall + 1, o);
  return c;
}
/** How tall the tallest portrait of a figure a member can own is, for a place that shows any of them. */
export const portraitRoom = (): number => Math.max(...FIGURE_IDS.map((kind) => framesOf(kind).tall + 2));

// ---------- bases ----------

/** How the bases are finished: plain, a gold rim, or moss along the front. */
export type BaseLook = "plain" | "gilt" | "moss";

const BASE_ROWS = [
  "...11111111111...",
  ".122222222222221.",
  "12222222222222223",
  "32222222222222223",
  ".333333333333333.",
  "..3333333333333..",
];
const BIG_BASE_ROWS = [
  "....1111111111111111111....",
  "..11222222222222222222211..",
  ".1222222222222222222222221.",
  "122222222222222222222222223",
  "322222222222222222222222223",
  "332222222222222222222222233",
  ".3333333333333333333333333.",
  "..33333333333333333333333..",
  "....3333333333333333333....",
];

const bases = new Map<string, HTMLCanvasElement>();
function baseOf(tones: Tones, big: boolean, look: BaseLook): HTMLCanvasElement {
  const key = `${tones.join()}${big ? "B" : "s"}${look}`;
  let c = bases.get(key);
  if (c) return c;
  const rows = big ? BIG_BASE_ROWS : BASE_ROWS;
  const pic = bitmap(rows, { "1": look === "gilt" ? GOLD[2] : tones[0], "2": tones[1], "3": tones[2] });
  const g = must(pic.getContext("2d"), "2d context");
  const w = pic.width;
  const h = pic.height;
  if (look === "gilt") {
    g.fillStyle = GOLD[1];
    g.fillRect(2, h - 3, w - 4, 1);
  } else if (look === "moss") {
    g.fillStyle = GREEN[3];
    for (let x = 2; x < w - 2; x += 3) g.fillRect(x, h - 2 - (x % 2), 2, 1);
    g.fillStyle = GREEN[4];
    for (let x = 3; x < w - 3; x += 5) g.fillRect(x, h - 3, 1, 1);
  }
  c = outlined(pic, INK);
  bases.set(key, c);
  return c;
}

/** The colours of the base a figure stands on: its price for one a member can own. */
export function tonesOf(kind: UnitKind): Tones {
  if (isFigureId(kind)) return TIER_TONES[FIGURES[kind].tier - 1] ?? FOREST_TONES;
  return isSummonId(kind) ? SUMMON_TONES : FOREST_TONES;
}
/** Whether a figure is one of the big ones. */
export const isBig = (kind: UnitKind): boolean => isBossId(kind);

/**
 * A figure standing on its base, the base's middle at `x`, `y` and the figure on it, `hover` higher
 * as it bobs. Whoever draws one names the base's look: the member's own figures stand on the bases
 * they chose, anyone else's on plain ones.
 */
export function drawStanding(
  g: Ctx,
  kind: UnitKind,
  x: number,
  y: number,
  base: BaseLook,
  o: Shown & { hover?: number } = {},
): void {
  const c = baseOf(tonesOf(kind), isBig(kind), isFigureId(kind) ? base : "plain");
  g.drawImage(c, Math.round(x) - Math.floor(c.width / 2), Math.round(y) - Math.floor(c.height / 2) - 1);
  drawFigure(g, kind, x, y - 2 - (o.hover ?? 0), o);
}

// ---------- stars ----------

const STAR_ROWS = ["..y..", "yyYyy", ".yYy.", ".y.y."];
let star: HTMLCanvasElement | null = null;
let starBright: HTMLCanvasElement | null = null;
/** One to three stars in a row, centred on `x` with their feet at `y`. */
export function drawStars(g: Ctx, stars: number, x: number, y: number, bright = false): void {
  star ??= outlined(bitmap(STAR_ROWS, { y: GOLD[1], Y: GOLD[2] }), INK);
  starBright ??= outlined(bitmap(STAR_ROWS, { y: GOLD[2], Y: "#ffffff" }), INK);
  const pic = bright ? starBright : star;
  const step = pic.width - 1;
  const left = Math.round(x - (step * stars + 1) / 2);
  for (let i = 0; i < stars; i++) g.drawImage(pic, left + i * step, Math.round(y) - pic.height);
}
/** The stars on a small canvas of their own, for a card. */
export function starsPic(stars: number): HTMLCanvasElement {
  const { c, g } = makeCanvas(6 * stars + 1, 6);
  drawStars(g, stars, c.width / 2, 6);
  return c;
}
