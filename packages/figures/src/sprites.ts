/**
 * The figures as pictures ready to draw: each one's typed rows baked once into small canvases
 * (standing, breathing in, using its ability, tipped over, a pale flash and a sore edge for being
 * hit, a dark outline for one not opened yet), all with the one-pixel dark edge, facing right and
 * facing left. A fight bends them as they move (`Bend`): squashed, stretched, leaned and turned.
 * Also the bases they stand on and the stars over their heads.
 *
 * A banner's member has no typed rows: it is a person, their skin's pieces on a rig (`rig.ts`), in
 * the same pictures as everyone else here (`person`), from whoever it is said to be (`wear`), and
 * until then nobody yet. A fight poses one a stance at a time (`Shown.act`). It is called by that
 * member's name (`nameOf`). So are the grooters the Commodore calls (`CALLED`): summoned, and
 * people all the same.
 */
import { CORAL, GOLD, GREEN, INK, SKY } from "@sequoia-leaf/kit/palette.ts";
import { bitmap, flipped, outlined, rgb } from "@sequoia-leaf/kit/pix.ts";
import { bake as walking, type Body, NOBODY, paintSkin } from "@sequoia-leaf/kit/skin.ts";
import { type Ctx, makeCanvas, must } from "@sequoia-leaf/kit/util.ts";
import { type Catalog, everyShared } from "@sequoia-leaf/raid/content/catalog.ts";
import {
  figureIn,
  GROOTER_IDS,
  isBossId,
  isFigureId,
  isSummonId,
  specOf,
  type UnitKind,
} from "@sequoia-leaf/raid/content/figures.ts";
import { isMemberId, type MemberId } from "@sequoia-leaf/raid/content/members.ts";
import type { Form } from "@sequoia-leaf/raid/fight/types.ts";

import { artOf, type Carried, carrying } from "./figures.ts";
import { FOREST_TONES, PAL, SUMMON_TONES, TIER_TONES, type Tones } from "./pal.ts";
import { handOf, REST, RIG, rigPic, type Stance } from "./rig.ts";

export type Pose = "idle" | "cast" | "fallen";

export interface Frames {
  readonly idle: readonly [HTMLCanvasElement, HTMLCanvasElement];
  readonly cast: HTMLCanvasElement;
  readonly fallen: HTMLCanvasElement;
  readonly flash: HTMLCanvasElement;
  /** Its edge in the sore colour of a figure just hit. */
  readonly hurt: HTMLCanvasElement;
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
  /** How many of its rows a small picture of it shows (`portrait`): all of them, or its top rows for one as tall as Seqwawa. */
  readonly room: number;
  readonly flies: boolean;
  /** How many things it carries when it has all of them (`Shown.carries`): Clutch's eggs. */
  readonly carries: number;
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

/** The same picture with its edge (every solid pixel beside a clear one) in another colour. */
function reEdged(src: HTMLCanvasElement, colour: string): HTMLCanvasElement {
  const { c, g } = makeCanvas(src.width, src.height);
  g.drawImage(src, 0, 0);
  const img = g.getImageData(0, 0, c.width, c.height);
  const solid = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < c.width && y < c.height && (img.data[(y * c.width + x) * 4 + 3] ?? 0) >= 40;
  const [r, gg, b] = rgb(colour);
  const edge: number[] = [];
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++)
      if (solid(x, y) && !(solid(x - 1, y) && solid(x + 1, y) && solid(x, y - 1) && solid(x, y + 1)))
        edge.push((y * c.width + x) * 4);
  for (const i of edge) {
    img.data[i] = r;
    img.data[i + 1] = gg;
    img.data[i + 2] = b;
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
/** The pale colour a figure flashes when it is hit. */
const FLASH = "#fff8e0";

/**
 * A person as one of the raid's figures: their skin's pieces on a rig (`rig.ts`), at the size the
 * town draws them (a pixel of theirs is a pixel of any figure's). These are the pictures anyone
 * who only shows them needs (standing, a breath later, arms up for their ability, lying where they
 * fell); a fight poses them itself, a stance at a time (`Shown.act`).
 */
/** A person using their ability, for anyone who only shows them: both arms up. */
const CASTING: Stance = { ...REST, arm: 6, offArm: 6, nod: -1 };
function person(body: Body): { right: Frames; left: Frames } {
  const facing = (left: boolean): Frames => {
    const a = rigPic(body, { ...REST, left });
    return {
      idle: [a, rigPic(body, { ...REST, left, nod: 1 })],
      cast: rigPic(body, { ...CASTING, left }),
      fallen: rigPic(body, { ...REST, left, lie: true, arm: 3, offArm: 1, leg: 1 }),
      flash: tinted(a, FLASH),
      hurt: reEdged(a, CORAL),
      dark: tinted(a, SKY[0]),
      w: RIG.w,
      h: RIG.h,
      ax: RIG.ax,
      ay: RIG.ay,
      tall: RIG.tall,
      castTall: RIG.tall,
      wide: RIG.wide,
      head: 0,
      room: RIG.tall,
      flies: false,
      carries: 0,
    };
  };
  return { right: facing(false), left: facing(true) };
}

/** The grooters the Commodore calls, in turn: summoned figures that are people, each the member Leaf names for that place. */
export const CALLED = GROOTER_IDS;
/** Anyone on the stump drawn as a person from a member's skin: a banner's member, or a grooter called. */
export type PersonId = MemberId | (typeof CALLED)[number];
export const isPersonId = (v: unknown): v is PersonId => isMemberId(v) || CALLED.some((id) => id === v);

/**
 * What a person carries in their leading hand, hanging from it wherever the hand is (`handOf`):
 * the Commodore's brass hand bell, his Chorus instrument.
 */
const IN_HAND: Readonly<Partial<Record<PersonId, readonly string[]>>> = {
  commodore: ["..n..", ".yYy.", "yyYyy", "..o.."],
};
const inHand = new Map<PersonId, HTMLCanvasElement>();
/** The thing a person carries, edged, made the first time it is asked for; null for one with nothing in hand. */
function inHandOf(kind: UnitKind): HTMLCanvasElement | null {
  if (!isPersonId(kind)) return null;
  const rows = IN_HAND[kind];
  if (!rows) return null;
  let c = inHand.get(kind);
  if (!c) {
    c = edged(bitmap(rows, PAL));
    inHand.set(kind, c);
  }
  return c;
}

/** Who each person on the stump is, once somebody has said (`wear`): their name, the figure they are drawn from, and how many times it has been said. */
const worn = new Map<UnitKind, { readonly name: string; readonly body: Body; readonly said: number }>();
/** What anyone on the stump is called: a person by the name they were given (`wear`), everyone else as the catalogue names them. */
export const nameOf = (cat: Catalog, kind: UnitKind): string => worn.get(kind)?.name ?? specOf(cat, kind).name;
/**
 * A word for how a figure is shown now, which changes when its name or its pictures do: for whoever
 * keeps something drawn of it. Nobody (an empty place) is shown as nothing.
 */
export const shownAs = (kind: UnitKind | null): string => (kind ? `${kind}/${worn.get(kind)?.said ?? 0}` : "");

/** The body of a figure that is a person on a rig, which a stance poses; null for one drawn from typed rows. */
export function rigOf(kind: UnitKind): Body | null {
  if (!isPersonId(kind)) return null;
  return worn.get(kind)?.body ?? (NOBODY_YET.body ??= walking(paintSkin(NOBODY)));
}
const NOBODY_YET: { body?: Body } = {};

function bake(kind: UnitKind, form: Form, carried: Carried | null): { right: Frames; left: Frames } {
  const body = rigOf(kind);
  if (body) return person(body);
  const art = artOf(kind, form);
  const at = art.breath ?? Math.floor(art.rows.length * 0.6);
  // What it carries is laid over its pictures: all of it, unless the fight says how many it has now.
  const { prop } = art;
  const now = carried ?? { n: prop?.at.length ?? 0, rock: -1 };
  const carry = (rows: readonly string[], cast = false): readonly string[] =>
    prop ? carrying(rows, prop.rows, cast ? prop.castAt : prop.at, now) : rows;
  const lists = {
    a: carry(art.rows),
    b: carry(art.alt ?? (art.flies ? art.rows : breathe(art.rows, at))),
    cast: carry(art.cast ?? rear(art.rows, at), true),
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
    flash: tinted(idleA, FLASH),
    hurt: reEdged(idleA, CORAL),
    dark: outlined(tinted(a, SKY[0]), SKY[2]),
    w: w + 2,
    h: h + 2,
    ax: 1 + (art.feet ?? Math.round(widthOf(lists.a) / 2)),
    ay: h + 1,
    tall: lists.a.length,
    castTall: lists.cast.length,
    wide: widthOf(lists.a),
    head: art.head ?? 0,
    room: Math.min(lists.a.length, art.room ?? lists.a.length),
    flies: art.flies === true,
    carries: prop?.at.length ?? 0,
  };
  const right: Frames = { ...base, fallen: tipped(idleA, false) };
  if (art.sym) return { right, left: right };
  const left: Frames = {
    ...base,
    idle: [flipped(base.idle[0]), flipped(base.idle[1])],
    cast: flipped(base.cast),
    flash: flipped(base.flash),
    hurt: flipped(base.hurt),
    dark: flipped(base.dark),
    ax: base.w - base.ax,
    fallen: tipped(flipped(idleA), true),
  };
  return { right, left };
}

const baked = new Map<string, { right: Frames; left: Frames }>();
/** Has a person on the stump be somebody from now on: called by their name, and drawn from their figure. */
export function wear(kind: PersonId, name: string, body: Body): void {
  worn.set(kind, { name, body, said: (worn.get(kind)?.said ?? 0) + 1 });
  baked.delete(kind);
}
/**
 * A figure's pictures, facing right or left, as itself or (one of Graid's five) in its true form,
 * carrying all it carries, or as much as `carried` says.
 */
export function framesOf(kind: UnitKind, left = false, form: Form = "plain", carried?: Carried): Frames {
  const key = `${kind}${form === "true" ? " true" : ""}${carried ? ` ${carried.n}/${carried.rock}` : ""}`;
  let f = baked.get(key);
  if (!f) {
    f = bake(kind, form, carried ?? null);
    baked.set(key, f);
  }
  return left ? f.left : f.right;
}

/** Which of a figure's two standing pictures shows at `t` seconds; `phase` (0 to 1) keeps neighbours out of step. */
export const beatAt = (t: number, phase = 0): 0 | 1 => (Math.floor(t * 1.7 + phase * 2) % 2 === 0 ? 0 : 1);
/** How far over its spot a figure that flies hovers at `t` seconds, in its own pixels: 1 to 3, and 0 for one that stands. */
export const hoverAt = (kind: UnitKind, t: number, phase = 0, form: Form = "plain"): number =>
  framesOf(kind, false, form).flies ? 2 + Math.round(Math.sin(t * 4 + phase * 6)) : 0;

/**
 * A figure bent as it moves, in whole pixels: wider and taller than its picture (less for negative
 * numbers), its feet kept where they are; its top leaned `lean` pixels to the right (rows slide
 * over, the lower less); turned about its feet by `turn`.
 */
export interface Bend {
  readonly sx: number;
  readonly sy: number;
  readonly lean: number;
  readonly turn: number;
}

export interface Shown {
  pose?: Pose;
  /** As itself, or (one of Graid's five) in its true form. */
  form?: Form;
  /** Which of the two standing pictures. */
  beat?: 0 | 1;
  left?: boolean;
  /** Drawn as a pale flash, for the moment it is hit, or in the sore colour just after. */
  flash?: boolean;
  hurt?: boolean;
  bend?: Bend;
  /** Drawn as a dark outline: one not opened yet. */
  dark?: boolean;
  /** With a gold outline round it: one of the trait that is lit. */
  lit?: boolean;
  alpha?: number;
  /** For a person on a rig (`rigOf`): the stance they are in, in place of `pose`, `beat`, `left` and `bend`. */
  act?: Stance;
  /** How much of what it carries it has now (Clutch's eggs); all of it unless said. */
  carries?: Carried;
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

/** Draws a picture whose feet are `ax`, `ay` in it at `px`, `py`, bent if it is. */
function place(g: Ctx, pic: HTMLCanvasElement, px: number, py: number, ax: number, ay: number, b?: Bend): void {
  if (!b || (b.sx === 0 && b.sy === 0 && b.lean === 0 && b.turn === 0)) {
    g.drawImage(pic, px - ax, py - ay);
    return;
  }
  g.save();
  g.translate(px, py);
  if (b.turn !== 0) g.rotate(b.turn);
  if (b.lean !== 0) g.transform(1, 0, -b.lean / Math.max(4, ay), 1, 0, 0);
  const w = Math.max(1, pic.width + b.sx);
  const h = Math.max(1, pic.height + b.sy);
  g.drawImage(pic, -Math.round((ax * w) / pic.width), -Math.round((ay * h) / pic.height), w, h);
  g.restore();
}

const struck = new WeakMap<HTMLCanvasElement, { flash: HTMLCanvasElement; hurt: HTMLCanvasElement }>();
/** A posed picture as it is drawn when hit: pale, and with the sore edge; made the first time each is asked for. */
function struckOf(pic: HTMLCanvasElement): { flash: HTMLCanvasElement; hurt: HTMLCanvasElement } {
  let s = struck.get(pic);
  if (!s) {
    s = { flash: tinted(pic, FLASH), hurt: reEdged(pic, CORAL) };
    struck.set(pic, s);
  }
  return s;
}

/** The picture a figure is drawn as now. */
function shownPic(kind: UnitKind, f: Frames, o: Shown): HTMLCanvasElement {
  if (o.dark) return f.dark;
  const body = o.act ? rigOf(kind) : null;
  if (body && o.act) {
    const posed = rigPic(body, o.act);
    return o.flash ? struckOf(posed).flash : o.hurt ? struckOf(posed).hurt : posed;
  }
  return o.flash ? f.flash : o.hurt ? f.hurt : o.pose === "cast" ? f.cast : f.idle[o.beat ?? 0];
}

/** Draws a figure with its feet at `x`, `y`. */
export function drawFigure(g: Ctx, kind: UnitKind, x: number, y: number, o: Shown = {}): void {
  const f = framesOf(kind, o.left, o.form, o.carries);
  const px = Math.round(x);
  const py = Math.round(y);
  if (o.alpha !== undefined) g.globalAlpha = o.alpha;
  if (o.pose === "fallen" && !o.act) {
    g.drawImage(f.fallen, px - Math.round(f.fallen.width / 2), py - f.fallen.height + 2);
  } else {
    const pic = shownPic(kind, f, o);
    const bend = o.act ? undefined : o.bend;
    if (o.lit) place(g, gilded(pic), px, py, f.ax + 1, f.ay + 1, bend);
    else place(g, pic, px, py, f.ax, f.ay, bend);
    // What a person carries hangs from their hand, its handle in it.
    const held = o.dark ? null : inHandOf(kind);
    if (held) {
      const hand = handOf(o.act ?? { ...(o.pose === "cast" ? CASTING : REST), left: o.left ?? false });
      g.drawImage(held, px + hand.x - Math.floor(held.width / 2), py + hand.y - 1);
    }
  }
  if (o.alpha !== undefined) g.globalAlpha = 1;
}

/**
 * A figure standing still on a small canvas of its own, for a card or a button: as tall as it stands
 * (a pose that reaches higher would leave the picture empty at the top), or for one as tall as
 * Seqwawa its top rows (`room`), its base cut off at the bottom edge.
 */
export function portrait(kind: UnitKind, o: Shown = {}): HTMLCanvasElement {
  const f = framesOf(kind, o.left, o.form);
  const { c, g } = makeCanvas(f.w, f.room + 2);
  drawFigure(g, kind, f.ax, f.tall + 1, o);
  return c;
}
/** How tall the tallest portrait of a figure a member can own is, for a place that shows any of them. */
export const portraitRoom = (): number => Math.max(...everyShared().map((kind) => framesOf(kind).room + 2));

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

/** The colours of the base a figure stands on: its price, as the catalogue has it, for one a member can own. */
export function tonesOf(cat: Catalog, kind: UnitKind): Tones {
  if (isFigureId(kind)) return TIER_TONES[figureIn(cat, kind).tier - 1] ?? FOREST_TONES;
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
  cat: Catalog,
  kind: UnitKind,
  x: number,
  y: number,
  base: BaseLook,
  o: Shown & { hover?: number } = {},
): void {
  const c = baseOf(tonesOf(cat, kind), isBig(kind), isFigureId(kind) ? base : "plain");
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
