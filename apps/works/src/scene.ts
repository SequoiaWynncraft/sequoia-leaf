/**
 * Drawing a frame of the yard. Like the town it is drawn small, one art pixel to a pixel, with
 * dusk laid over it and the lamps and fires cutting holes in the dusk. The page shows that small
 * picture itself and its styles enlarge it by a whole number; the words are written in the guild's
 * font on a canvas of their own over it.
 *
 * The lamplight is also the yard's power: the depot's lamps and every joined pylon's light the
 * ground exactly as far as power reaches, and dim together when the yard is short of it.
 *
 * Most of a frame is what the last one showed, so what stays is kept and only what moved is drawn:
 * the floor as one picture, each kind of belt laid in one go, everything that stands up on a
 * picture that is mended where something changed, and the lines between pylons on another.
 */

import {
  BACK,
  condition,
  type Dir,
  DRAW,
  DX,
  DY,
  FIXED,
  GIVES,
  holderOf,
  isFilled,
  isItem,
  type Kind,
  litAt,
  litOf,
  NONE,
  openOf,
  PACE,
  piecesTiles,
  REACH,
  REACHES,
  SHUTS,
  STATES,
  tilesOf,
  TROUBLE,
  type Yard,
} from "@sequoia-leaf/factory";
import { CORAL, CREAM, GOLD, INK, SKY } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import { bubble, bubbleSize, wrap } from "@sequoia-leaf/kit/signs.ts";
import { widthOf, write } from "@sequoia-leaf/kit/text.ts";
import { clamp, type Ctx, hash, makeCanvas, must, type Pt } from "@sequoia-leaf/kit/util.ts";

import { walkers } from "./actors.ts";
import { type Arms, beltTile, marksOf, PAINTS, ride, STEPS, TILE, woodOf } from "./art/belts.ts";
import { BEYOND, glint, type Ground } from "./art/ground.ts";
import type { Art } from "./art/index.ts";
import { DEPOT as DEPOT_ART, lookOf } from "./art/machines.ts";
import type { Sprite } from "./art/pal.ts";
import { type Box, boxAt, boxIn, drawnFrom, pieceBox, waysOutOf } from "./big.ts";
import { drawPlan, drawPlanMarks } from "./far.ts";
import { bits, floaters, rings } from "./fx.ts";
import { heldBox, heldMarks } from "./held.ts";
import { straight } from "./kinds/carrier.ts";
import { pageOf } from "./kinds/index.ts";
import type { Drawn, KindPage } from "./kinds/kind.ts";
import { lampsIn } from "./lamps.ts";
import { armsAt, asIf, type Layout, layout, pylonTop } from "./layout.ts";
import { eachPerson } from "./people.ts";
import { pinMark } from "./pinned.ts";
import { builds, draws, type Group, handGrade, type Mark, S, seenFrom, standsOn, tileNudge } from "./state.ts";
import { cameFrom, dirAt, hooded } from "./tiles.ts";
import { drawShades, eachTrunk } from "./trees.ts";

/** What the frame needs to know about the moment: how far into the next tick it is, and how the yard is going. */
export interface Moment {
  /** Ticks since the yard's last, as a share of one. */
  lead: number;
  /** The share of its plain pace everything works at: 1, or less when the yard is short of power. */
  pace: number;
}

/** How far across its tile a thing moves in a tick on a belt, tunnel, splitter, joiner or sorter of each grade. */
const ALONG = PACE.map((pace) => pace / 8);
/** The power the depot gives at first: a depot that gives more wears its flywheel. */
const DEPOT_FIRST = openOf([]).depot;

/** The milliseconds a frame's parts have taken, counted only while somebody is looking (`on`): `bench`, or the meter. */
export const spent: { on: boolean; at: number; ms: Record<string, number> } = { on: false, at: 0, ms: {} };
/** The time since the last call belongs to `part`; with no part, a frame's work begins here. */
export function lap(part?: string): void {
  if (!spent.on) return;
  const now = performance.now();
  if (part) spent.ms[part] = (spent.ms[part] ?? 0) + now - spent.at;
  spent.at = now;
}

/** The picture. The page shows this canvas itself, and no bigger than the ground and the light that falls past it. */
const buf = makeCanvas(320, 200, true);
export const picture = buf.c;
const dusk = makeCanvas(320, 200, true);
/** Where the picture's corner is in the view, in the yard's pixels: the camera says (`camera.ts`). */
export const corner: Pt = { x: 0, y: 0 };
/** How many times a trouble mark is enlarged: more than once only when the view is zoomed far out. */
let markSize = 1;
/** Counts each time what is kept between frames may have been emptied, so that it is all drawn again. */
let lost = 0;
/** The browser took the kept pictures' memory back, or the page was put away: nothing kept is trusted. */
export const wipe = (): void => void lost++;
/** A picture as big as the ground, kept between frames. */
function sheet(gr: Ground): { c: HTMLCanvasElement; g: Ctx } {
  const made = makeCanvas(gr.w, gr.h, true);
  made.c.addEventListener("contextrestored", wipe);
  return made;
}

function radial(size: number, stops: readonly (readonly [number, string])[]): HTMLCanvasElement {
  const { c, g } = makeCanvas(size, size);
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, col] of stops) gr.addColorStop(at, col);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return c;
}
/** Lamplight that reaches as far as power does: full almost to its edge, then gone. */
const REACHED = radial(128, [
  [0, "rgba(0,0,0,1)"],
  [0.74, "rgba(0,0,0,0.96)"],
  [0.9, "rgba(0,0,0,0.42)"],
  [1, "rgba(0,0,0,0)"],
]);
/** A fire's or a lantern's own soft pool, as in the town. */
const HOLE = radial(64, [
  [0, "rgba(0,0,0,1)"],
  [0.35, "rgba(0,0,0,0.85)"],
  [0.7, "rgba(0,0,0,0.32)"],
  [1, "rgba(0,0,0,0)"],
]);
const WARM = radial(64, [
  [0, "rgba(255,196,120,1)"],
  [0.4, "rgba(255,160,90,0.5)"],
  [1, "rgba(255,140,80,0)"],
]);
const SPARK = radial(32, [
  [0, "rgba(255,236,170,1)"],
  [0.5, "rgba(255,200,110,0.35)"],
  [1, "rgba(255,180,90,0)"],
]);
/** A pool of light at each size it is laid down at, made once: enlarging one every frame costs more than all else in it. */
const pools = new Map<HTMLCanvasElement, Map<number, HTMLCanvasElement>>();
/** Lays a pool of light `r` across each way from a whole pixel, exactly as enlarging it there would. */
function pool(g: Ctx, src: HTMLCanvasElement, x: number, y: number, r: number): void {
  let sizes = pools.get(src);
  if (!sizes) pools.set(src, (sizes = new Map()));
  let at = sizes.get(r);
  const edge = Math.floor(-r);
  if (!at) {
    const made = makeCanvas(Math.ceil(r - edge), Math.ceil(r - edge));
    made.g.drawImage(src, -r - edge, -r - edge, r * 2, r * 2);
    sizes.set(r, (at = made.c));
  }
  g.drawImage(at, x + edge, y + edge);
}

export function sizeBuffers(w: number, h: number, marks: number): void {
  markSize = marks;
  for (const b of [buf, dusk]) {
    if (b.c.width === w && b.c.height === h) continue;
    b.c.width = w;
    b.c.height = h;
    b.g.imageSmoothingEnabled = false;
  }
}

// ---------- things that stand up, far to near ----------

/**
 * One thing to draw: where its corner is in the yard's pixels, how near it stands, how faint it
 * is, and the tiles of the kept picture it lies over (first and last, across and down).
 */
interface Draw {
  c: HTMLCanvasElement;
  x: number;
  y: number;
  z: number;
  a: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** The picture's own number among those that have stood in the yard, or 0 until it is asked for. */
  id: number;
}
const listed: Draw[] = [];
const order: Draw[] = [];
let used = 0;
/** The picture's corner in the yard this frame, to the pixel and as the camera has it. */
let camX = 0;
let camY = 0;
let seenX = 0;
let seenY = 0;

/** Lists a thing to draw: `x`, `y` is its corner in the picture. */
function put(c: HTMLCanvasElement, x: number, y: number, z: number, a = 1): void {
  let d = listed[used];
  if (d) {
    if (d.c !== c) d.id = 0;
    d.c = c;
    d.x = x + camX;
    d.y = y + camY;
    d.z = z;
    d.a = a;
  } else {
    d = { c, x: x + camX, y: y + camY, z, a, x0: 0, x1: 0, y0: 0, y1: 0, id: 0 };
    listed.push(d);
  }
  used++;
}

const known = new Map<HTMLCanvasElement, number>();
const float = new Float64Array(1);
const halves = new Uint32Array(float.buffer);
let stood: {
  c: HTMLCanvasElement;
  g: Ctx;
  cols: number;
  rows: number;
  /** What stood over each tile's worth of the picture when it was last drawn, and now: a sum that changes when anything there does. */
  was: Uint32Array;
  now: Uint32Array;
  torn: Uint8Array;
  lost: number;
} | null = null;

/**
 * Everything listed, far to near, on a picture as big as the ground that is kept between frames.
 * Only the tiles where something listed has changed since the last frame (another pose, a step,
 * come or gone) are wiped and drawn again, with the part of whatever else stands over them.
 */
function standing(gr: Ground): HTMLCanvasElement {
  if (!stood) {
    const cols = Math.ceil(gr.w / TILE);
    const rows = Math.ceil(gr.h / TILE);
    const tiles = (): Uint32Array => new Uint32Array(cols * rows);
    stood = { ...sheet(gr), cols, rows, was: tiles(), now: tiles(), torn: new Uint8Array(cols * rows), lost: -1 };
  }
  const k = stood;
  const { g, cols, rows, now, was, torn } = k;
  if (k.lost !== lost) {
    k.lost = lost;
    was.fill(1);
  }
  now.fill(0);
  for (let n = 0; n < used; n++) {
    const d = listed[n];
    if (!d) continue;
    const x = d.x - gr.x;
    const y = d.y - gr.y;
    d.x0 = clamp(Math.floor(x / TILE), 0, cols - 1);
    d.x1 = clamp(Math.floor((x + d.c.width - 1) / TILE), 0, cols - 1);
    d.y0 = clamp(Math.floor(y / TILE), 0, rows - 1);
    d.y1 = clamp(Math.floor((y + d.c.height - 1) / TILE), 0, rows - 1);
    if (d.id === 0) {
      d.id = known.get(d.c) ?? known.size + 1;
      known.set(d.c, d.id);
    }
    float[0] = d.z;
    let h = Math.imul(d.id ^ Math.imul(d.x, 0x9e3779b1) ^ Math.imul(d.y, 0x85ebca6b), 0xc2b2ae35);
    h ^= (halves[0] ?? 0) ^ Math.imul(halves[1] ?? 0, 0x27d4eb2f) ^ Math.imul(d.a * 255, 0x165667b1);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    for (let ty = d.y0; ty <= d.y1; ty++)
      for (let i = ty * cols + d.x0, end = ty * cols + d.x1; i <= end; i++) now[i] = (now[i] ?? 0) + h;
  }
  let changed = 0;
  for (let i = 0; i < now.length; i++) {
    const tear = now[i] === was[i] ? 0 : 1;
    torn[i] = tear;
    changed += tear;
  }
  k.was = now;
  k.now = was;
  if (changed === 0) return k.c;
  // Few tiles: only they are drawn on. Many (a yard just opened, a long way looked across): all of it.
  const all = changed * 6 >= now.length;
  order.length = 0;
  for (let n = 0; n < used; n++) {
    const d = listed[n];
    if (!d) continue;
    let over = all;
    for (let ty = d.y0; ty <= d.y1 && !over; ty++)
      for (let i = ty * cols + d.x0, end = ty * cols + d.x1; i <= end; i++) if (torn[i] === 1) over = true;
    if (over) order.push(d);
  }
  order.sort((p, q) => p.z - q.z);
  if (all) mend(g, gr, 0, 0, k.c.width, k.c.height);
  else
    for (let i = 0; i < now.length; i++) {
      if (torn[i] !== 1) continue;
      // A run of torn tiles along a row is mended as one.
      let run = 1;
      while ((i + run) % cols !== 0 && torn[i + run] === 1) run++;
      const left = (i % cols) * TILE;
      const top = Math.floor(i / cols) * TILE;
      mend(g, gr, left, top, left + run * TILE, top + TILE);
      i += run - 1;
    }
  g.globalAlpha = 1;
  return k.c;
}

/** Wipes a part of the kept picture, and draws again the part of each thing in `order` that lies in it. */
function mend(g: Ctx, gr: Ground, left: number, top: number, right: number, bottom: number): void {
  g.clearRect(left, top, right - left, bottom - top);
  for (const d of order) {
    const x = d.x - gr.x;
    const y = d.y - gr.y;
    const l = Math.max(x, left);
    const t = Math.max(y, top);
    const wide = Math.min(x + d.c.width, right) - l;
    const high = Math.min(y + d.c.height, bottom) - t;
    if (wide <= 0 || high <= 0) continue;
    g.globalAlpha = d.a;
    g.drawImage(d.c, l - x, t - y, wide, high, l, t, wide, high);
  }
}
const stand = (s: Sprite, x: number, y: number, z: number, a = 1): void => {
  put(s.c, x - s.ax, y - s.ay, z, a);
};

interface Light {
  x: number;
  y: number;
  r: number;
  power: number;
  /** Lamplight that marks power's reach, rather than a fire's own glow. */
  reach: boolean;
}
const lights: Light[] = [];
let lit = 0;
function light(x: number, y: number, r: number, power: number, reach = false): void {
  let l = lights[lit];
  if (l) {
    l.x = x;
    l.y = y;
    l.r = r;
    l.power = power;
    l.reach = reach;
  } else {
    l = { x, y, r, power, reach };
    lights.push(l);
  }
  lit++;
}

/** Things flown a little way: what the depot takes in hops over its sill. */
const hops: { pic: HTMLCanvasElement; x: number; y: number; dx: number; dy: number; t: number }[] = [];

const WORKING = STATES.indexOf("working");
const UNPOWERED = STATES.indexOf("unpowered");

/**
 * What the screen remembers of the piece on each tile between frames, by tile: the kind it is kept
 * for (another kind there is a new piece, remembered afresh), a mill's face, when its condition was
 * last read and what it was (`condition`), since when it has been in trouble, what it last held ready
 * to hand on and whether it was ready, whether a bench's hammer was down, and when it last puffed.
 */
interface Memory {
  for: Uint8Array;
  face: Uint8Array;
  /**
   * Moments of the screen's clock (`S.t`, seconds since the page opened), here and in `since` and
   * `puffAt`: kept within a hundredth of a second for the page's first 36 hours.
   */
  readAt: Float32Array;
  cond: Int16Array;
  since: Float32Array;
  held: Uint8Array;
  ready: Uint8Array;
  struck: Uint8Array;
  puffAt: Float32Array;
}
const memory = (n: number): Memory => ({
  for: new Uint8Array(n).fill(NONE),
  face: new Uint8Array(n),
  readAt: new Float32Array(n),
  cond: new Int16Array(n),
  since: new Float32Array(n),
  held: new Uint8Array(n),
  ready: new Uint8Array(n),
  struck: new Uint8Array(n),
  puffAt: new Float32Array(n),
});
let mem = memory(0);
/** The yard last drawn. */
let drawn: Yard | null = null;

/**
 * Leaf's yard, taken each time Leaf answers, is a new yard. What the screen knew of a piece (how
 * long it has been in trouble, a mill's face) stays with the piece of the same kind on its tile.
 * Another yard altogether (a visit, a yard staged) keeps nothing.
 */
function carry(to: Yard): void {
  const from = drawn;
  drawn = to;
  if (mem.for.length !== to.kind.length) mem = memory(to.kind.length);
  else if (!from || Math.abs(to.tick - from.tick) > 600) mem.for.fill(NONE);
}

/** Makes the tile's memory afresh for a piece it was not kept for: what its kind remembers at first (a new mill's face, `kinds/mill.ts`). */
function memOf(y: Yard, i: number): void {
  const k = y.kind[i] ?? NONE;
  if (mem.for[i] === k) return;
  mem.for[i] = k;
  mem.readAt[i] = -9;
  mem.cond[i] = -1;
  mem.since[i] = -1;
  mem.held[i] = NONE;
  mem.ready[i] = 0;
  mem.struck[i] = 0;
  mem.puffAt[i] = 0;
  mem.face[i] = pageOf(k)?.fresh?.(y, i) ?? 0;
}

/** How the piece on a tile stands (`condition`), read at most twice a second. */
function reading(y: Yard, i: number): number {
  memOf(y, i);
  const at = mem.readAt[i] ?? -9;
  if (S.t - at > 0.5 || S.t < at) {
    mem.readAt[i] = S.t;
    const c = condition(y, i);
    mem.cond[i] = c;
    if (c < TROUBLE) mem.since[i] = -1;
    else if ((mem.since[i] ?? -1) < 0) mem.since[i] = S.t;
  }
  return mem.cond[i] ?? -1;
}

/** Whether trouble has lasted long enough on a tile to say so. */
const troubled = (i: number): boolean =>
  (mem.cond[i] ?? -1) >= TROUBLE && (mem.since[i] ?? -1) >= 0 && S.t - (mem.since[i] ?? 0) > 1.5;

/** What drawing a piece is given (`kinds/kind.ts`): one, filled afresh for each piece. */
const onTile: Drawn = {
  i: 0,
  d: 0,
  grade: 0,
  look: 0,
  span: 0,
  open: true,
  x: 0,
  top: 0,
  w: TILE,
  h: TILE,
  foot: 0,
  cx: 0,
  z: 0,
  a: 1,
  real: true,
  ghost: 0,
  powered: true,
  working: false,
  r: -1,
  out: NONE,
  also: NONE,
  making: NONE,
  work: 0,
  t: 0,
  pace: 1,
  seenX: 0,
  seenY: 0,
  mem,
  stand: (s, x, y, z, a = 1) => stand(s, x, y, z, a),
  put: (c, x, y, z, a = 1) => put(c, x, y, z, a),
};

/**
 * Puts one piece into the frame: the kind `k` facing `d` on tile `i`, at a `grade` (0 for a kind with
 * none), with a tunnel's `span` and a crate `open` or shut. `x`, `top` is its tile's top-left corner
 * in the picture. Its kind draws it (`KindPage.draw`); what lies flat with the floor draws nothing
 * here. A grade above the first wears the grade's mark in the tile's top-left corner. `ghost` draws it
 * as something not yet built: faint, at rest, and with nothing remembered or read of what it holds; a
 * real one (`ghost` 0) is what stands on the tile.
 */
function piece(
  art: Art,
  y: Yard,
  i: number,
  k: number,
  d: Dir,
  grade: number,
  span: number,
  open: boolean,
  x: number,
  top: number,
  now: Moment,
  ghost: number,
): void {
  const real = ghost === 0;
  const page = pageOf(k);
  // A piece of more than one tile standing is drawn once, from its own tile, over every tile it covers.
  if (!page?.draw || (real && !drawnFrom(y, i))) return;
  const c = real ? reading(y, i) : -1;
  const h = y.holders;
  const r = real ? holderOf(y, i) : -1;
  onTile.i = i;
  onTile.d = d;
  onTile.grade = grade;
  onTile.look = lookOf(grade);
  onTile.span = span;
  onTile.open = open;
  boxIn(onTile, k, d, x, top);
  onTile.z = onTile.foot + camY;
  onTile.a = ghost > 0 ? ghost : 1;
  onTile.real = real;
  onTile.ghost = ghost;
  onTile.powered = !real || litAt(y, i);
  onTile.working = c >= 0 && c % TROUBLE === WORKING;
  onTile.r = r;
  onTile.out = r >= 0 ? (h.out[r] ?? NONE) : NONE;
  onTile.also = r >= 0 ? (h.also[r] ?? NONE) : NONE;
  onTile.making = r >= 0 ? (h.making[r] ?? NONE) : NONE;
  onTile.work = r >= 0 ? (h.work[r] ?? 0) : 0;
  onTile.t = S.t;
  onTile.pace = now.pace;
  onTile.seenX = seenX;
  onTile.seenY = seenY;
  onTile.mem = mem;
  const head = page.draw(art, y, onTile);
  if (head === null) return;
  wear(art, page, k, c, head);
}

/**
 * What a piece standing up wears, once its kind has drawn it and said where its head is: its grade's
 * mark, in the same corner of every graded piece (a belt has it in its own tile); the brass pointer on
 * its way out, and whatever it holds there with nowhere to send it; and over its head, trouble that
 * has lasted.
 */
function wear(art: Art, page: KindPage, k: number, c: number, head: number): void {
  const { i, d, x, top, cx, z, a, real, out } = onTile;
  const pip = art.m.pips[onTile.grade - 2];
  if (pip) put(pip, x, top, z + 0.55, a);
  // On each way out (ahead, or each of a piece of more than one tile's), with what it holds to send there.
  for (const way of page.pointer ? waysOutOf(onTile, k, d) : []) {
    const p = (onTile.ghost > 0 || S.picked === i ? art.m.pointerLit : art.m.pointer)[way.d];
    const [ex, ey, wd] = [way.x, way.y, way.d];
    if (p) put(p, ex - Math.floor(p.width / 2), ey - Math.floor(p.height / 2), z + 0.4, a);
    const sends = way.also ? onTile.also : out;
    if (real && isItem(sends) && page.pointer === "holding") {
      const pic = art.item(sends);
      put(
        pic,
        ex - (DX[wd] ?? 0) * 4 - Math.floor(pic.width / 2),
        ey - (DY[wd] ?? 0) * 4 - Math.floor(pic.height / 2) - 2,
        z + 0.5,
      );
    }
  }
  if (!real) return;
  // Trouble that has lasted says so over the machine's head: but over one that shows where power does not reach in its own way.
  if (troubled(i) && !(page.sleeps && !onTile.powered)) {
    const badge = grown(c % TROUBLE === UNPOWERED ? art.bolt : art.bang);
    stand(badge, cx, head - 2 - Math.round(Math.abs(Math.sin(S.t * 4 + i)) * 2), z + 0.6);
  }
}

/** Corners that breathe round a box of tiles: a piece in hand, or one aimed at with the spade. */
const boxCorners = (g: Ctx, b: Box, cx: number, cy: number, col: string): void =>
  corners(g, b.x * TILE - cx, b.y * TILE - cy, b.w * TILE, b.h * TILE, col, true);

const big = new Map<Sprite, Sprite>();
/**
 * A trouble mark as big as the view asks: its own size at every zoom there used to be, and that
 * many times bigger zoomed further out, so that it is as big on the screen as it was at the old furthest.
 */
function grown(s: Sprite): Sprite {
  if (markSize === 1) return s;
  let made = big.get(s);
  if (made?.c.width !== s.c.width * markSize) {
    const { c, g } = makeCanvas(s.c.width * markSize, s.c.height * markSize);
    g.drawImage(s.c, 0, 0, c.width, c.height);
    big.set(s, (made = { c, ax: s.ax * markSize, ay: s.ay * markSize }));
  }
  return made;
}

function pixelRing(g: Ctx, x: number, y: number, rx: number, ry: number, col: string, gap = 1): void {
  const n = Math.max(8, Math.round((rx + ry) * 1.6));
  g.fillStyle = col;
  for (let i = 0; i < n; i += gap) {
    const a = (i / n) * Math.PI * 2;
    g.fillRect(Math.round(x + Math.cos(a) * rx), Math.round(y + Math.sin(a) * ry), 1, 1);
  }
}

/** Gold (or coral) corners round a box in the picture: it is being pointed at. */
function corners(g: Ctx, x: number, y: number, w: number, h: number, col: string, breathe: boolean): void {
  const k = breathe && Math.sin(S.t * 6) > 0 ? 1 : 0;
  const x0 = x - 1 + k;
  const y0 = y - 1 + k;
  const x1 = x + w - k;
  const y1 = y + h - k;
  for (const [px, py, dx, dy] of [
    [x0, y0, 1, 1],
    [x1, y0, -1, 1],
    [x0, y1, 1, -1],
    [x1, y1, -1, -1],
  ] as const) {
    R(g, dx > 0 ? px : px - 3, py, 4, 1, col);
    R(g, px, dy > 0 ? py : py - 3, 1, 4, col);
  }
}

const WIRE = "#2a1519";
/** A line between two pylons: each pixel along its sag in the yard's pixels, which of them no other line crosses, and where its glint last was. */
interface Line {
  xs: Int16Array;
  ys: Int16Array;
  alone: Uint8Array;
  lit: number;
}
let strung: {
  c: HTMLCanvasElement;
  g: Ctx;
  of: Layout | null;
  lost: number;
  lines: Line[];
  /** The pixels more than one stretch of line lies on, as line and place along it, in the order they are drawn. */
  shared: number[];
  /** Where each line was made fast when they were drawn: its two ends, across and down. */
  ends: string;
} | null = null;

/**
 * The sagging lines between pylons, with a glint running along each. The lines are drawn once for
 * each change to the yard and kept, as dark pixels that go on the picture faint; a glint is cut out
 * of the kept line where it is now and put back where it was. A pixel two stretches of line lie on
 * is darker for it, so those few are drawn every frame, in their order.
 */
function wires(g: Ctx, gr: Ground, L: Layout, cx: number, cy: number): void {
  const s = (strung ??= { ...sheet(gr), of: null, lost: -1, lines: [], shared: [], ends: "" });
  const ends = s.of === L ? s.ends : L.wires.join();
  s.of = L;
  if (ends !== s.ends || s.lost !== lost) {
    s.ends = ends;
    s.lost = lost;
    const hits = new Map<number, number>();
    const at = (line: Line, k: number): number => ((line.ys[k] ?? 0) + 4096) * 8192 + (line.xs[k] ?? 0) + 4096;
    s.lines = [];
    for (let w = 0; w + 3 < L.wires.length; w += 4) {
      const [ax = 0, ay = 0, bx = 0, by = 0] = L.wires.subarray(w, w + 4);
      const len = Math.hypot(bx - ax, by - ay);
      const n = Math.max(2, Math.round(len / 1.2));
      const sag = Math.min(9, len * 0.07);
      const line = { xs: new Int16Array(n + 1), ys: new Int16Array(n + 1), alone: new Uint8Array(n + 1), lit: -9 };
      for (let k = 0; k <= n; k++) {
        const u = k / n;
        line.xs[k] = Math.round(ax + (bx - ax) * u);
        line.ys[k] = Math.round(ay + (by - ay) * u + sag * 4 * u * (1 - u));
        hits.set(at(line, k), (hits.get(at(line, k)) ?? 0) + 1);
      }
      s.lines.push(line);
    }
    s.shared = [];
    s.g.clearRect(0, 0, gr.w, gr.h);
    s.g.fillStyle = WIRE;
    s.lines.forEach((line, n) => {
      for (let k = 0; k < line.xs.length; k++) {
        if (hits.get(at(line, k)) !== 1) s.shared.push(n, k);
        else {
          line.alone[k] = 1;
          s.g.fillRect((line.xs[k] ?? 0) - gr.x, (line.ys[k] ?? 0) - gr.y, 1, 1);
        }
      }
    });
  }
  s.g.fillStyle = WIRE;
  for (let n = 0; n < s.lines.length; n++) {
    const line = s.lines[n];
    if (!line) continue;
    // The glint starts from a different place on every line, by where the line is on the screen.
    const ax = L.wires[n * 4] ?? 0;
    const ay = L.wires[n * 4 + 1] ?? 0;
    const spot = Math.floor(((S.t * 0.7 + hash(ax - cx + corner.x, ay - cy + corner.y, 9)) % 1) * (line.xs.length - 1));
    if (spot === line.lit) continue;
    for (let k = line.lit - 1; k <= line.lit + 1; k++)
      if (line.alone[k] === 1) s.g.fillRect((line.xs[k] ?? 0) - gr.x, (line.ys[k] ?? 0) - gr.y, 1, 1);
    for (let k = spot - 1; k <= spot + 1; k++)
      if (line.alone[k] === 1) s.g.clearRect((line.xs[k] ?? 0) - gr.x, (line.ys[k] ?? 0) - gr.y, 1, 1);
    line.lit = spot;
  }
  g.globalAlpha = 0.6;
  blit(g, s.c, cx - gr.x, cy - gr.y, g.canvas.width, g.canvas.height, 0, 0);
  // A pixel at a time, a thousand or more of them on a large yard: the colour is given only when it
  // changes, as reading a colour again for each pixel costs more than drawing it.
  g.fillStyle = GOLD[2];
  for (const line of s.lines)
    for (let k = line.lit - 1; k <= line.lit + 1; k++)
      if (line.alone[k] === 1) g.fillRect((line.xs[k] ?? 0) - cx, (line.ys[k] ?? 0) - cy, 1, 1);
  let fill: string = GOLD[2];
  for (let j = 0; j < s.shared.length; j += 2) {
    const line = s.lines[s.shared[j] ?? 0];
    const k = s.shared[j + 1] ?? 0;
    if (!line) continue;
    const col = Math.abs(k - line.lit) < 2 ? GOLD[2] : WIRE;
    if (col !== fill) {
      g.fillStyle = col;
      fill = col;
    }
    g.fillRect((line.xs[k] ?? 0) - cx, (line.ys[k] ?? 0) - cy, 1, 1);
  }
  g.globalAlpha = 1;
}

function blit(
  g: Ctx,
  src: HTMLCanvasElement,
  sx: number,
  sy: number,
  w: number,
  h: number,
  dx: number,
  dy: number,
): void {
  // Only the part that is both in the source and on the picture.
  const x0 = Math.max(0, sx, sx - dx);
  const y0 = Math.max(0, sy, sy - dy);
  const x1 = Math.min(src.width, sx + w, sx - dx + g.canvas.width);
  const y1 = Math.min(src.height, sy + h, sy - dy + g.canvas.height);
  if (x1 <= x0 || y1 <= y0) return;
  g.drawImage(src, x0, y0, x1 - x0, y1 - y0, dx + x0 - sx, dy + y0 - sy, x1 - x0, y1 - y0);
}

let note: HTMLCanvasElement | null = null;
let noteDone: HTMLCanvasElement | null = null;
function notes(): readonly [HTMLCanvasElement, HTMLCanvasElement] {
  if (!note || !noteDone) {
    const a = makeCanvas(2, 4);
    R(a.g, 0, 0, 2, 4, CREAM);
    R(a.g, 0, 1, 1, 1, "#a35d3b");
    R(a.g, 0, 3, 2, 1, "#cbb894");
    const b = makeCanvas(2, 4);
    R(b.g, 0, 0, 2, 4, GOLD[2]);
    R(b.g, 0, 3, 2, 1, GOLD[0]);
    note = a.c;
    noteDone = b.c;
  }
  return [note, noteDone];
}

// ---------- many pieces at once: the area marked, and the pieces in hand ----------

/** The tiles of the mark last drawn, by tile, to find its edges. */
let masked: { of: Mark["tiles"]; on: Uint8Array; all: readonly number[] } | null = null;

/**
 * The area marked with Select. Every piece in it is lit gold on its tile, with a gold line where
 * the marked pieces end, so they read as one shape however far out the view is; the area itself
 * is a line of dashes that march. While the pieces are in hand to be moved, the tiles they leave
 * are dimmed instead.
 */
function marked(g: Ctx, w: Yard, m: Mark, cx: number, cy: number): void {
  const W = w.land.w;
  if (masked?.of !== m.tiles) {
    const on = new Uint8Array(w.kind.length);
    // Every tile of a piece of more than one, marked by its own.
    const all = m.tiles.flatMap((i) => piecesTiles(w, i));
    for (const i of all) on[i] = 1;
    masked = { of: m.tiles, on, all };
  }
  const { on, all } = masked;
  const leaving = S.group?.as === "move";
  g.globalCompositeOperation = leaving ? "source-over" : "lighter";
  g.fillStyle = leaving ? "rgba(26,15,30,0.5)" : `rgba(255,176,64,${0.26 + 0.07 * Math.sin(S.t * 5)})`;
  // Only where a piece still stands: one may have been taken away since.
  for (const i of all)
    if (w.kind[i] !== NONE) g.fillRect((i % W) * TILE - cx, Math.floor(i / W) * TILE - cy, TILE, TILE);
  g.globalCompositeOperation = "source-over";
  g.fillStyle = leaving ? GOLD[0] : GOLD[2];
  for (const i of all) {
    if (w.kind[i] === NONE) continue;
    const tx = i % W;
    const x = tx * TILE - cx;
    const y = Math.floor(i / W) * TILE - cy;
    if (on[i - W] !== 1) g.fillRect(x, y, TILE, 1);
    if (on[i + W] !== 1) g.fillRect(x, y + TILE - 1, TILE, 1);
    if (tx === 0 || on[i - 1] !== 1) g.fillRect(x, y, 1, TILE);
    if (tx === W - 1 || on[i + 1] !== 1) g.fillRect(x + TILE - 1, y, 1, TILE);
  }
  g.strokeStyle = CREAM;
  g.lineWidth = 1;
  g.setLineDash([3, 3]);
  g.lineDashOffset = -Math.floor(S.t * 10);
  g.strokeRect(
    m.x0 * TILE - cx - 1.5,
    m.y0 * TILE - cy - 1.5,
    (m.x1 - m.x0 + 1) * TILE + 3,
    (m.y1 - m.y0 + 1) * TILE + 3,
  );
  g.setLineDash([]);
}

/** The pieces in hand, drawn once for each place they are aimed at and kept: `for` is the aim it was drawn for, of that yard at that count of its changes. */
const held: {
  c: HTMLCanvasElement;
  g: Ctx;
  for: Group["at"] | null;
  yard: Yard | null;
  rev: number;
  lost: number;
} = {
  ...makeCanvas(1, 1, true),
  for: null,
  yard: null,
  rev: -1,
  lost: -1,
};
held.c.addEventListener("contextrestored", wipe);
/** Room in that picture round the box of tiles, for what stands taller or leans wider than its tile. */
const ROOM = { side: 8, top: 40, bottom: 8 } as const;

/**
 * Draws the pieces in hand where they are aimed, as they would stand (`asIf`, the yard with them
 * set down): belts joined to each other and to the lines already there, machines as built. Gold
 * lies over each piece that can go there and coral over each that cannot. It is drawn afresh only
 * when the aim moves to another tile or the yard changes, so a frame costs one picture however many
 * pieces are in hand.
 */
function inHand(g: Ctx, art: Art, w: Yard, grp: Group, now: Moment, cx: number, cy: number): void {
  const box = heldBox(w, grp);
  if (held.for !== grp.at || held.yard !== w || held.rev !== w.rev || held.lost !== lost) {
    held.for = grp.at;
    held.yard = w;
    held.rev = w.rev;
    held.lost = lost;
    held.c.width = box.w * TILE + ROOM.side * 2;
    held.c.height = box.h * TILE + ROOM.top + ROOM.bottom;
    const h = held.g;
    h.imageSmoothingEnabled = false;
    const ox = ROOM.side - box.x * TILE;
    const oy = ROOM.top - box.y * TILE;
    const mark = used;
    const before = lit;
    const yard = asIf(w, grp);
    for (const p of grp.at) {
      for (const i of tilesOf(yard, [p])) {
        if (i < 0) continue;
        const x = (i % yard.land.w) * TILE + ox;
        const top = Math.floor(i / yard.land.w) * TILE + oy;
        const k = yard.kind[i] ?? NONE;
        const d = p.dir;
        const a = draws(k) ? armsAt(yard, i) : 0;
        const grade = yard.grade[i] ?? 0;
        if (a !== 0) h.drawImage(beltTile(a, d, 0, woodOf(grade), yard.tint[i] ?? 0, marksOf(grade)), x, top);
        const over = pageOf(k)?.top?.(art, yard, i, d, false);
        if (over) h.drawImage(over, x, top);
        const pip = over ? art.m.pips[grade - 2] : undefined;
        if (pip) h.drawImage(pip, x, top);
        if (drawnFrom(yard, i)) piece(art, yard, i, k, d, grade, yard.span[i] ?? 0, p.open ?? true, x, top, now, 1);
      }
    }
    for (const d of listed.slice(mark, used).toSorted((p, q) => p.z - q.z)) h.drawImage(d.c, d.x - camX, d.y - camY);
    used = mark;
    lit = before;
    // Gold over each piece that can go and coral over each that cannot; coral corners over what it takes up.
    heldMarks(h, w, grp, ox, oy);
  }
  g.globalAlpha = 0.88;
  g.drawImage(held.c, box.x * TILE - ROOM.side - cx, box.y * TILE - ROOM.top - cy);
  g.globalAlpha = 1;
  const bad = grp.why.some((r) => r !== null);
  corners(g, box.x * TILE - cx, box.y * TILE - cy, box.w * TILE, box.h * TILE, bad ? CORAL : GOLD[2], true);
}

/**
 * The floor as the yard has it now: the forest's, with the yard's own over every plot it owns and
 * has cleared. It is painted again when those plots are not the ones it was painted for.
 */
let floored: {
  c: HTMLCanvasElement;
  g: Ctx;
  of: Layout | null;
  clearing: number;
  plots: string;
  lost: number;
} | null = null;
function floor(gr: Ground, L: Layout): HTMLCanvasElement {
  const f = (floored ??= { ...sheet(gr), of: null, clearing: 0, plots: "", lost: -1 });
  if (f.of === L && f.clearing === S.clearing.size && f.lost === lost) return f.c;
  const cleared = L.yard.land.plots.filter((plot, n) => L.owned[n] && !S.clearing.has(plot.plot));
  const plots = cleared.map((plot) => plot.plot).join();
  const painted = plots === f.plots && f.lost === lost;
  f.of = L;
  f.clearing = S.clearing.size;
  f.plots = plots;
  f.lost = lost;
  if (painted) return f.c;
  f.g.drawImage(gr.wild, 0, 0);
  for (const plot of cleared) {
    const x = plot.x * TILE - gr.x;
    const y = plot.y * TILE - gr.y;
    f.g.drawImage(gr.owned, x, y, plot.w * TILE, plot.h * TILE, x, y, plot.w * TILE, plot.h * TILE);
  }
  return f.c;
}

/** Tiles that all show the same picture, as one outline in the yard's pixels: the picture fills them in one go. */
interface Tiled {
  tiles: Path2D;
}
/**
 * What lies flat and stays put until the yard changes: every tile that carries, gathered by its
 * shape, way, colour and grade; over those, the splitters' arrowheads, the joiners' tops and the
 * sorters' boards, gathered by picture; over those, the grade's mark of each splitter, joiner and
 * sorter above the first, as a belt wears it in its tile; and where the pieces with a vane are (a splitter).
 */
let laid: {
  of: Layout;
  belts: (Tiled & { arms: Arms; dir: Dir; tint: number; grade: number })[];
  tops: (Tiled & { pic: HTMLCanvasElement })[];
  marks: (Tiled & { pic: HTMLCanvasElement })[];
  vanes: number[];
} | null = null;
function laidOf(L: Layout, art: Art): NonNullable<typeof laid> {
  if (laid?.of === L) return laid;
  const y = L.yard;
  const { land } = y;
  const made: NonNullable<typeof laid> = { of: L, belts: [], tops: [], marks: [], vanes: [] };
  const belts = new Map<number, Path2D>();
  const tops = new Map<HTMLCanvasElement, Path2D>();
  const marks = new Map<HTMLCanvasElement, Path2D>();
  for (let i = 0; i < L.arms.length; i++) {
    const a = L.arms[i] ?? 0;
    const k = y.kind[i] ?? NONE;
    const d = dirAt(y, i);
    const tint = y.tint[i] ?? 0;
    if (a === 0 || k === NONE) continue;
    const here = (tiles: Path2D): void => tiles.rect((i % land.w) * TILE, Math.floor(i / land.w) * TILE, TILE, TILE);
    const top = (pic: HTMLCanvasElement | undefined): void => {
      if (!pic) return;
      let tiles = tops.get(pic);
      if (!tiles) {
        tiles = new Path2D();
        tops.set(pic, tiles);
        made.tops.push({ pic, tiles });
      }
      here(tiles);
    };
    const grade = y.grade[i] ?? 0;
    const key = ((a * 4 + d) * 7 + tint) * 4 + grade;
    let tiles = belts.get(key);
    if (!tiles) {
      tiles = new Path2D();
      belts.set(key, tiles);
      made.belts.push({ arms: a, dir: d, tint, grade, tiles });
    }
    here(tiles);
    // The grade's mark lies over what is laid on the tile, so no arrowhead or board hides it.
    const page = pageOf(k);
    const pip = page?.top ? art.m.tilePips[grade - 2] : undefined;
    if (pip) {
      let on = marks.get(pip);
      if (!on) {
        on = new Path2D();
        marks.set(pip, on);
        made.marks.push({ pic: pip, tiles: on });
      }
      here(on);
    }
    if (page?.laid) page.laid(art, y, i, d, a, top);
    else if (page?.top) top(page.top(art, y, i, d, false));
    if (page?.vane) made.vanes.push(i);
  }
  return (laid = made);
}
/** A picture as something to fill tiles with: side by side, from the yard's own corner. */
const fills = new Map<HTMLCanvasElement, CanvasPattern>();
function lay(g: Ctx, pic: HTMLCanvasElement, tiles: Path2D): void {
  let fill = fills.get(pic);
  if (!fill) fills.set(pic, (fill = must(g.createPattern(pic, "repeat"), "fill")));
  g.fillStyle = fill;
  g.fill(tiles);
}
/** The parts of carried things that lie over the tile to their left or above, to be drawn again over what tops that tile. */
const lapping: { pic: HTMLCanvasElement; x: number; y: number; w: number; h: number }[] = [];

/** Whether a tool is one that the reach of power matters to. */
const wantsPower = (kind: Kind): boolean => (DRAW[kind] ?? 0) > 0 || (GIVES[kind] ?? 0) > 0 || REACHES[kind] === 1;

/**
 * What every layer of a frame reads: the yard and its layout, the picture, where the camera is (the
 * picture's corner in the yard, to the pixel), and the tiles whose pieces may show in it: those in
 * view, and one more round each side (two below) for what stands taller or leans wider than its tile.
 */
interface Frame {
  readonly art: Art;
  readonly now: Moment;
  readonly g: Ctx;
  readonly W: number;
  readonly H: number;
  readonly cx: number;
  readonly cy: number;
  readonly w: Yard;
  readonly L: Layout;
  readonly tx0: number;
  readonly ty0: number;
  readonly tx1: number;
  readonly ty1: number;
  /** How far along its march each grade's belts are (a belt, splitter, joiner or sorter of each grade marches at its own pace). */
  readonly steps: readonly number[];
}

/** The depot's foot and middle, in the picture. */
const depotAt = (f: Frame): { dx: number; dfoot: number } => ({
  dx: f.w.land.depot[0] * TILE + 8 - f.cx,
  dfoot: (f.w.land.depot[1] + 2) * TILE - f.cy,
});

/**
 * The whole yard as it is this moment, small, a layer at a time: the floor, what lies flat and rides
 * on it, everything that stands up, the lamps cut out of the dusk, and last what is being pointed at
 * or is about to be built. Each layer draws only what can show in the picture, judged by how far
 * what it draws reaches.
 */
export function drawYard(art: Art, now: Moment): HTMLCanvasElement {
  const g = buf.g;
  const W = buf.c.width;
  const H = buf.c.height;
  seenX = S.cam.x + corner.x;
  seenY = S.cam.y + corner.y;
  const cx = (camX = Math.round(S.cam.x) + corner.x);
  const cy = (camY = Math.round(S.cam.y) + corner.y);
  const w = S.world;
  const L: Layout = layout(w);
  if (S.view.z < 1) {
    // Further out than a screen pixel for each of the yard's, the yard is its plan (`far.ts`).
    const [dx, dy] = drawPlan(g, w, L, corner.x, corner.y);
    lap("plan");
    drawPlanMarks(g, w, dx, dy);
    lap("marks");
    return buf.c;
  }
  if (w !== drawn) carry(w);
  const { land } = w;
  used = 0;
  lit = 0;
  const f: Frame = {
    art,
    now,
    g,
    W,
    H,
    cx,
    cy,
    w,
    L,
    // Two tiles past the view: the furthest a piece's own tile is from the tiles it covers.
    tx0: Math.max(0, Math.floor(cx / TILE) - 2),
    ty0: Math.max(0, Math.floor(cy / TILE) - 2),
    tx1: Math.min(land.w - 1, Math.ceil((cx + W) / TILE) + 2),
    ty1: Math.min(land.h - 1, Math.ceil((cy + H) / TILE) + 2),
    steps: ALONG.map((along) => Math.floor((w.tick + now.lead) * along * TILE) % STEPS),
  };
  floorLayer(f);
  lap("floor");
  flatLayer(f);
  lap("belts");
  standingLayer(f);
  lap("standing");
  lampLayer(f);
  lap("dusk");
  marksLayer(f);
  lap("marks");
  return buf.c;
}

/** The floor: the forest's everywhere, the yard's own over it where the land is the yard's, the stream's glints and the rings things land with. */
function floorLayer(f: Frame): void {
  const { g, W, H, cx, cy, L, tx0, ty0, tx1, ty1 } = f;
  const { land } = f.w;
  const gr = f.art.ground;
  if (cx < gr.x || cy < gr.y || cx + W > gr.x + gr.w || cy + H > gr.y + gr.h) {
    g.fillStyle = BEYOND;
    g.fillRect(0, 0, W, H);
  }
  blit(g, floor(gr, L), cx - gr.x, cy - gr.y, W, H, 0, 0);
  if (S.clearing.size > 0)
    for (const plot of land.plots) {
      // Bought a moment ago: the cleared ground opens out from the signpost.
      const clearing = S.clearing.get(plot.plot);
      if (!clearing) continue;
      const px = plot.x * TILE;
      const py = plot.y * TILE;
      g.save();
      g.beginPath();
      g.arc(clearing.x - cx, clearing.y - cy, Math.max(1, (S.t - clearing.at) * 260), 0, Math.PI * 2);
      g.clip();
      blit(g, gr.owned, px - gr.x, py - gr.y, plot.w * TILE, plot.h * TILE, px - cx, py - cy);
      g.restore();
    }

  drawShades(g, f.art, cx, cy, W, H);
  for (let ty = ty0; ty <= ty1; ty++)
    for (let tx = tx0; tx <= tx1; tx++)
      if (land.water[ty * land.w + tx] === 1) glint(g, land, tx, ty, tx * TILE - cx, ty * TILE - cy, S.t);

  for (const r of rings) {
    const k = r.life / r.ttl;
    g.globalAlpha = 1 - k;
    pixelRing(g, r.x - cx, r.y - cy, 2 + r.r * k, (2 + r.r * k) * 0.55, r.col);
  }
  g.globalAlpha = 1;
}

/** What lies flat: every belt laid in one go for each shape, what rides on them, the arrowheads, joiners' tops and sorters' boards over those, and each idle splitter's vane. */
function flatLayer(f: Frame): void {
  const { art, now, g, cx, cy, w, L, tx0, ty0, tx1, ty1, steps } = f;
  const { land } = w;
  const step = steps[1] ?? 0;
  // Each kind in one go: its tile, at this step of the march, fills every tile of that kind.
  const flat = laidOf(L, art);
  g.setTransform(1, 0, 0, 1, -cx, -cy);
  for (const kind of flat.belts)
    lay(
      g,
      beltTile(kind.arms, kind.dir, steps[kind.grade] ?? step, woodOf(kind.grade), kind.tint, marksOf(kind.grade)),
      kind.tiles,
    );
  g.setTransform(1, 0, 0, 1, 0, 0);
  let laps = 0;
  for (let ty = ty0; ty <= ty1; ty++)
    for (let tx = tx0; tx <= tx1; tx++) {
      const i = ty * land.w + tx;
      const a = L.arms[i] ?? 0;
      const n = w.item[i] ?? NONE;
      if (a === 0 || !isItem(n)) continue;
      const x = tx * TILE - cx;
      const y = ty * TILE - cy;
      const k = w.kind[i] ?? NONE;
      const d = dirAt(w, i);
      const prog8 = w.prog[i] ?? 0;
      // In from the side it was handed over on, out the way the tile sends it.
      const from = cameFrom(w, i);
      const to: number = pageOf(k)?.rides?.(w, i, a, n) ?? d;
      const prog = Math.min(1, prog8 / 8 + (prog8 < 8 ? now.lead * alongAt(w, i) : 0));
      if (hooded(w, i, prog)) continue;
      const pic = art.item(n);
      const left = x + Math.round(ride(from, to, prog, false)) - (pic.width >> 1);
      const top = y + Math.round(ride(from, to, prog, true)) - (pic.height >> 1) - 1;
      g.drawImage(pic, left, top);
      // A splitter or a joiner to the left or above is topped after this is drawn, and this lies over its top.
      const beside = left < x && tx > 0 ? w.kind[i - 1] : top < y && ty > 0 ? w.kind[i - land.w] : NONE;
      if (pageOf(beside ?? NONE)?.top !== undefined) {
        const over = (lapping[laps++] ??= { pic, x: 0, y: 0, w: 0, h: 0 });
        over.pic = pic;
        over.x = left;
        over.y = top;
        over.w = left < x ? x - left : pic.width;
        over.h = left < x ? pic.height : y - top;
      }
      // A belt whose load has nowhere to go says so, like any machine.
      if (prog8 >= 8) {
        reading(w, i);
        if (troubled(i))
          stand(grown(art.bang), x + 8, y - 4 - Math.round(Math.abs(Math.sin(S.t * 4 + i)) * 2), (ty + 1) * TILE + 0.6);
      }
    }
  // Over what is carried: the arrowheads, the joiners' tops and the sorters' boards, each picture in
  // one go, and over those their grades' marks; then each idle splitter's vane.
  g.setTransform(1, 0, 0, 1, -cx, -cy);
  for (const top of flat.tops) lay(g, top.pic, top.tiles);
  for (const mark of flat.marks) lay(g, mark.pic, mark.tiles);
  g.setTransform(1, 0, 0, 1, 0, 0);
  for (let k = 0; k < laps; k++) {
    const over = lapping[k];
    if (over) g.drawImage(over.pic, 0, 0, over.w, over.h, over.x, over.y, over.w, over.h);
  }
  for (const i of flat.vanes) {
    const a = L.arms[i] ?? 0;
    const tx = i % land.w;
    const ty = (i - tx) / land.w;
    if (a === 0 || w.item[i] !== NONE || tx < tx0 || tx > tx1 || ty < ty0 || ty > ty1) continue;
    const v = pageOf(w.kind[i] ?? NONE)?.vane?.(art, w, i, a);
    if (v) g.drawImage(v, tx * TILE - cx + 5, ty * TILE - cy + 5);
  }
}

/** Everything that stands up, far to near, on the kept picture mended where it changed; then what hops into the depot, the lines between pylons and the bits that fly. */
function standingLayer(f: Frame): void {
  const { art, now, g, W, H, cx, cy, w, L, tx0, ty0, tx1, ty1 } = f;
  const { land } = w;
  const gr = art.ground;
  for (let ty = ty0; ty <= ty1; ty++)
    for (let tx = tx0; tx <= tx1; tx++) {
      const i = ty * land.w + tx;
      const k = w.kind[i] ?? NONE;
      if (k === NONE || FIXED[k] === 1) continue;
      const r = holderOf(w, i);
      const open = SHUTS[k] !== 1 || r < 0 || w.holders.open[r] === 1;
      piece(art, w, i, k, dirAt(w, i), w.grade[i] ?? 0, w.span[i] ?? 0, open, tx * TILE - cx, ty * TILE - cy, now, 0);
    }

  // The depot, with whatever it wears.
  const { dx, dfoot } = depotAt(f);
  const dz = dfoot + cy - 1;
  const ds = art.m.depot;
  const dl = dx - ds.ax;
  const dt = dfoot - ds.ay;
  if (dl < W && dl + ds.c.width > 0 && dt < H && dfoot > -8) {
    stand(ds, dx, dfoot, dz);
    const [paper, done] = notes();
    for (let n = 0; n < w.board.length; n++) {
      const o = w.board[n];
      if (o)
        put(
          isFilled(o.want, o.filled) ? done : paper,
          dl + 2 + DEPOT_ART.board.x + n * 3,
          dt + 3 + DEPOT_ART.board.y,
          dz + 0.1,
        );
    }
    // A depot that gives more than at first wears its flywheel.
    if (w.open.depot > DEPOT_FIRST) {
      const fly = art.m.fly[Math.floor(S.t * 8) % 4];
      if (fly) put(fly, dl + DEPOT_ART.fly.x - 6, dt + DEPOT_ART.fly.y - 6, dz + 0.1);
    }
  }
  eachTrunk(art, cx, cy, W, H, stand);
  for (let n = 0; n + 2 < L.fences.length; n += 3) {
    const fx = L.fences[n] ?? 0;
    const fy = L.fences[n + 1] ?? 0;
    const across = L.fences[n + 2] === 1;
    const x = fx - cx;
    const y = fy - cy;
    if (x < -20 || x > W + 4 || y < -20 || y > H + 12) continue;
    stand(across ? art.m.fenceAcross : art.m.fenceDown, x, y, fy + (across ? 0.5 : TILE - 0.5));
  }
  stand(art.m.gate, L.gate.x - cx, L.gate.y - cy + 1, L.gate.y + 1);
  // A sign is drawn at the foot of its tile, in front of any undergrowth on the same tile.
  for (const sign of L.signs) stand(art.sign(sign.plot.price), sign.x - cx, sign.y - cy, sign.y + 2);

  // Undergrowth over land that is not the yard's, falling away where a plot has just been bought.
  for (let n = 0; n < land.plots.length; n++) {
    const plot = land.plots[n];
    if (!plot) continue;
    const clearing = S.clearing.get(plot.plot);
    if (L.owned[n] && !clearing) continue;
    const px = plot.x * TILE - cx;
    const py = plot.y * TILE - cy;
    if (px > W + 20 || py > H + 20 || px + plot.w * TILE < -20 || py + plot.h * TILE < -20) continue;
    for (const u of art.under[n] ?? []) {
      const x = u.x - cx;
      const y = u.y - cy;
      if (x < -14 || x > W + 14 || y < -2 || y > H + 16) continue;
      if (clearing && Math.hypot(u.x - clearing.x, u.y - clearing.y) < (S.t - clearing.at) * 260) continue;
      const s = art.growth[u.pic];
      if (s) stand(s, x, y, u.y);
    }
  }

  // The gnomes, and the member in their own yard.
  eachPerson(art, cx, cy, put);

  blit(g, standing(gr), cx - gr.x, cy - gr.y, W, H, 0, 0);

  // What the depot takes in hops over the sill and is gone; what a cart stop takes hops into its cart, which rolls under with it.
  for (let n = 0; n < L.intoDepot.length; n++) {
    const i = L.intoDepot[n] ?? 0;
    if (w.kind[i] === NONE) continue;
    memOf(w, i);
    const item = w.item[i] ?? NONE;
    const r = holderOf(w, i);
    const out = r >= 0 ? (w.holders.out[r] ?? NONE) : NONE;
    const has = item !== NONE ? item : out;
    const ready = item !== NONE ? (w.prog[i] ?? 0) / 8 + now.lead * alongAt(w, i) >= 0.85 : out !== NONE;
    const had = mem.held[i] ?? NONE;
    if (isItem(had) && mem.ready[i] === 1 && (has !== had || !ready)) {
      const x = (i % land.w) * TILE + 8;
      const y = Math.floor(i / land.w) * TILE + 8;
      const stop = L.intoStop[n] ?? -1;
      // The way it sends what it had: ahead, unless its kind says (a sorter, the thing it is set to to its side).
      const way = pageOf(w.kind[i] ?? NONE)?.sends?.(w, i, had) ?? dirAt(w, i);
      hops.push({ pic: art.item(had), x: x + DX[way] * 8, y: y + DY[way] * 8, dx: DX[way], dy: DY[way], t: S.t });
      if (stop >= 0) {
        memOf(w, stop);
        mem.puffAt[stop] = S.t;
      }
    }
    mem.held[i] = has;
    mem.ready[i] = ready ? 1 : 0;
  }
  for (let k = hops.length - 1; k >= 0; k--) {
    const h = hops[k];
    if (!h) continue;
    const u = (S.t - h.t) / 0.22;
    if (u >= 1 || u < 0) {
      hops.splice(k, 1);
      continue;
    }
    g.globalAlpha = 1 - u * u;
    g.drawImage(
      h.pic,
      Math.round(h.x + h.dx * u * 7) - (h.pic.width >> 1) - cx,
      Math.round(h.y + h.dy * u * 7 - Math.sin(u * Math.PI) * 4) - (h.pic.height >> 1) - 1 - cy,
    );
    g.globalAlpha = 1;
  }

  wires(g, gr, L, cx, cy);

  for (const b of bits) {
    if (b.glow) continue;
    g.globalAlpha = clamp((b.ttl - b.life) / (b.ttl * 0.4), 0, 1);
    R(g, Math.round(b.x) - cx, Math.round(b.y) - cy, b.size, b.size, b.col);
  }
  g.globalAlpha = 1;
}

/** Every lamp and fire whose light reaches the picture (`lamps.ts`), wherever the pieces that hold them are. */
function lamps(f: Frame): void {
  const { w, L, cx, cy, W, H, now } = f;
  const working = (i: number): boolean => reading(w, i) % TROUBLE === WORKING;
  const kiln = (i: number): boolean => pageOf(w.kind[i] ?? NONE)?.fire?.(w, i, mem) ?? false;
  for (const l of lampsIn(w, L.gate, { x: cx, y: cy, w: W, h: H }, now.pace, working, kiln))
    light(l.x - cx, l.y - cy, l.r, l.power, l.reach);
}

/** Dusk over everything, with every lamp and fire cut out of it; their warm glow; then the bits that glow. */
function lampLayer(f: Frame): void {
  const { g, W, H, cx, cy } = f;
  lamps(f);
  const d = dusk.g;
  d.globalCompositeOperation = "copy";
  d.globalAlpha = 1;
  d.fillStyle = "rgba(32,14,50,0.5)";
  d.fillRect(0, 0, W, H);
  d.globalCompositeOperation = "destination-out";
  for (let k = 0; k < lit; k++) {
    const l = lights[k];
    if (!l || l.x + l.r < 0 || l.x - l.r > W || l.y + l.r < 0 || l.y - l.r > H) continue;
    // A fire flickers by where it is on the screen.
    d.globalAlpha = clamp(l.power * (l.reach ? 0.9 : 0.93 + 0.07 * Math.sin(S.t * 6 + l.x + corner.x)), 0, 1);
    pool(d, l.reach ? REACHED : HOLE, l.x, l.y, l.r);
  }
  d.globalAlpha = 1;
  g.drawImage(dusk.c, 0, 0);
  g.globalCompositeOperation = "lighter";
  for (let k = 0; k < lit; k++) {
    const l = lights[k];
    if (!l || l.reach || l.x + l.r < 0 || l.x - l.r > W || l.y + l.r < 0 || l.y - l.r > H) continue;
    g.globalAlpha = clamp(0.14 * l.power, 0, 0.5);
    pool(g, WARM, l.x, l.y, l.r * 0.9);
  }
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;

  for (const b of bits) {
    if (!b.glow) continue;
    const a = clamp((b.ttl - b.life) / (b.ttl * 0.5), 0, 1);
    g.globalAlpha = a * 0.3;
    g.drawImage(SPARK, Math.round(b.x) - cx - 3, Math.round(b.y) - cy - 3, 7, 7);
    g.globalAlpha = a;
    R(g, Math.round(b.x) - cx, Math.round(b.y) - cy, b.size, b.size, b.col);
  }
  g.globalAlpha = 1;
}

/** What is being pointed at, and what is about to be built: where power reaches, the picked and pointed-at pieces, the area marked, a run, the piece or pieces in hand, and the place a nudge is about. */
function marksLayer(f: Frame): void {
  const { art, now, g, cx, cy, w, tx0, ty0, tx1, ty1, steps } = f;
  const { land } = w;
  const step = steps[1] ?? 0;
  const tool = S.tool;
  const { dx, dfoot } = depotAt(f);
  if (builds(tool) && wantsPower(tool)) {
    // Where power reaches, edged in gold dots, while placing something that it matters to.
    g.fillStyle = GOLD[1];
    const power = litOf(w);
    const on = (tx: number, ty: number): boolean =>
      tx >= 0 && ty >= 0 && tx < land.w && ty < land.h && power[ty * land.w + tx] === 1;
    for (let ty = ty0; ty <= ty1 + 1; ty++)
      for (let tx = tx0; tx <= tx1 + 1; tx++) {
        const here = on(tx, ty);
        if (here !== on(tx, ty - 1))
          for (let k = 0; k < TILE; k += 3) g.fillRect(tx * TILE - cx + k, ty * TILE - cy, 1, 1);
        if (here !== on(tx - 1, ty))
          for (let k = 0; k < TILE; k += 3) g.fillRect(tx * TILE - cx, ty * TILE - cy + k, 1, 1);
      }
  }
  pinMark(g, w, cx, cy, dx - 24, dfoot - 48);
  if (S.hover && tool === null) {
    const i = S.hover.y * land.w + S.hover.x;
    const k = S.hover.x >= 0 && S.hover.y >= 0 && S.hover.x < land.w && S.hover.y < land.h ? w.kind[i] : NONE;
    if (FIXED[k ?? NONE] === 1) corners(g, dx - 24, dfoot - 48, 48, 48, GOLD[2], true);
    else if (k !== NONE) corners(g, S.hover.x * TILE - cx, S.hover.y * TILE - cy, TILE, TILE, GOLD[2], true);
  }
  if (S.mark) marked(g, w, S.mark, cx, cy);
  else if (S.corner) corners(g, S.corner.x * TILE - cx, S.corner.y * TILE - cy, TILE, TILE, GOLD[2], true);
  if (S.run) {
    // A run of belt, shown before it is laid.
    const bad = S.run.why !== null;
    g.globalAlpha = 0.8;
    for (const leg of S.run.legs) {
      const x = leg.x * TILE - cx;
      const y = leg.y * TILE - cy;
      if (!leg.tunnel)
        g.drawImage(
          beltTile(straight(leg.dir), leg.dir, steps[leg.grade] ?? step, woodOf(leg.grade), 0, marksOf(leg.grade)),
          x,
          y,
        );
      else {
        // Its far mouth comes up `span + 1` tiles ahead.
        const far = (leg.span + 1) * TILE;
        const near = art.m.hood[lookOf(leg.grade)]?.[leg.dir];
        const out = art.m.hood[lookOf(leg.grade)]?.[BACK[leg.dir]];
        if (near) g.drawImage(near.c, x + 8 - near.ax, y + TILE + 1 - near.ay);
        if (out && leg.span > 0)
          g.drawImage(out.c, x + DX[leg.dir] * far + 8 - out.ax, y + DY[leg.dir] * far + TILE + 1 - out.ay);
      }
    }
    for (const turn of S.run.turns) {
      const grade = w.grade[turn.y * land.w + turn.x] ?? 1;
      g.drawImage(
        beltTile(straight(turn.dir), turn.dir, steps[grade] ?? step, woodOf(grade), 0, marksOf(grade)),
        turn.x * TILE - cx,
        turn.y * TILE - cy,
      );
    }
    g.globalAlpha = 1;
    const last = S.run.legs.at(-1) ?? S.run.turns.at(-1);
    if (last) corners(g, last.x * TILE - cx, last.y * TILE - cy, TILE, TILE, bad ? CORAL : GOLD[2], true);
  }
  if (S.from && !S.run) corners(g, S.from.x * TILE - cx, S.from.y * TILE - cy, TILE, TILE, GOLD[2], true);
  if (S.aim && tool !== null) {
    const on = standsOn(S.aim);
    const x = on.x * TILE - cx;
    const y = on.y * TILE - cy;
    const bad = S.aim.why !== null;
    if (tool === "remove") boxCorners(g, pieceBox(w, on.y * land.w + on.x), cx, cy, CORAL);
    else if (tool === "paint") {
      // The brush shows its colour on what it would colour, and nothing elsewhere.
      if (!bad) corners(g, x, y, TILE, TILE, PAINTS[S.tint - 1]?.lit ?? CREAM, true);
    } else if (tool === "select") {
      if (S.group) inHand(g, art, w, S.group, now, cx, cy);
    } else if (!S.run) {
      const mark = used;
      // At the grade it would stand at: the one in hand, or the higher one of a piece of its kind it would only turn.
      const grade = S.aim.grade ?? handGrade();
      const page = pageOf(tool);
      if (page?.aimArms) {
        g.globalAlpha = 0.8;
        const a = page.aimArms(S.dir, S.right);
        g.drawImage(beltTile(a, S.dir, steps[grade] ?? step, woodOf(grade), 0, marksOf(grade)), x, y);
        const top = page.top?.(art, null, -1, S.dir, S.right);
        if (top) g.drawImage(top, x, y);
        const pip = top ? art.m.pips[grade - 2] : undefined;
        if (pip) g.drawImage(pip, x, y);
        g.globalAlpha = 1;
      }
      piece(art, w, on.y * land.w + on.x, tool, S.dir, grade, 1, true, x, y, now, bad ? 0.5 : 0.8);
      const far = S.aim.far ?? -1;
      if (far >= 0) {
        const out = page?.far?.(art, grade, S.dir);
        const fx = far % land.w;
        const fy = (far - fx) / land.w;
        if (out) put(out.c, fx * TILE - cx + 8 - out.ax, fy * TILE - cy + TILE + 1 - out.ay, 0, 0.8);
      }
      for (let k = mark; k < used; k++) {
        const p = listed[k];
        if (!p) continue;
        g.globalAlpha = p.a;
        g.drawImage(p.c, p.x - camX, p.y - camY);
      }
      g.globalAlpha = 1;
      used = mark;
      const col = bad ? CORAL : GOLD[2];
      if (REACHES[tool] === 1) {
        const ring = ((REACH.pylon * w.open.reach) / 10_000) * TILE;
        pixelRing(g, x + 8, y + 8, ring, ring, col, 2);
      }
      boxCorners(g, boxAt(tool, S.dir, on.x, on.y), cx, cy, col);
      // And the tile aimed at, which for a tunnel whose way in is set is where it would come up, or cannot.
      corners(g, S.aim.x * TILE - cx, S.aim.y * TILE - cy, TILE, TILE, col, true);
    }
  }
  const nudged = tileNudge();
  if (nudged) {
    // The place a nudge is about: a gold ring that breathes.
    const x = nudged.x * TILE + 8 - cx;
    const y = nudged.y * TILE + 8 - cy;
    const r = 9 + Math.sin(S.t * 5) * 1.5;
    pixelRing(g, x, y, r, r, GOLD[2]);
    pixelRing(g, x, y, r + 1, r + 1, GOLD[0], 2);
  }
}

/** How far across its tile a thing on the piece there moves in a tick, as the frame shows it between ticks: its grade's pace. */
const alongAt = (y: Yard, i: number): number => ALONG[y.grade[i] ?? 0] ?? 0;

// ---------- words, in the guild's font, over the picture ----------

/** A dark plate with a line on it, centred over a point of the canvas. */
function plate(ctx: Ctx, text: string, x: number, y: number, px: number, colour: string): void {
  const wide = ctx.canvas.width;
  const lines = wrap(ctx, text, Math.min(wide - 12 * px, 150 * px), px);
  const w = lines.reduce((m, l) => Math.max(m, widthOf(ctx, l, px)), 0) + 8 * px;
  const h = (lines.length * 11 + 5) * px;
  const left = clamp(Math.round(x - w / 2), 2 * px, Math.max(2 * px, wide - w - 2 * px));
  const top = Math.max(2 * px, Math.round(y - h));
  ctx.fillStyle = INK;
  ctx.fillRect(left - px, top, w + 2 * px, h);
  ctx.fillRect(left, top - px, w, h + 2 * px);
  ctx.fillStyle = "#1f1226";
  ctx.fillRect(left, top, w, h);
  ctx.fillStyle = SKY[2];
  ctx.fillRect(left, top, w, px);
  lines.forEach((line, n) => {
    write(ctx, line, left + 4 * px, top + (3 + n * 11) * px, { px, colour, shadow: false });
  });
}

/** What the words' canvas shows, as a line that changes when any of it does; and each thing on it, to be written. */
let written = "";
const todo: (() => void)[] = [];

/**
 * The words over the yard, on a canvas of their own as big as the screen: written again only when
 * what they say, or where, has changed. `clear` is how far down the interface covers the top of
 * the screen, in the canvas's pixels.
 */
export function drawWords(ctx: Ctx, px: number, clear: number): void {
  const z = S.view.z;
  const cx = seenFrom(S.cam.x);
  const cy = seenFrom(S.cam.y);
  const wide = ctx.canvas.width;
  let key = String(lost);
  todo.length = 0;

  for (const a of walkers) {
    if (!a.say) continue;
    const hx = Math.round((a.x - cx) * z);
    const hy = Math.round((a.y - cy - 18 - (a.carrying ? 7 : 0)) * z);
    const alpha = clamp(a.sayFor / 0.25, 0, 1) * a.alpha;
    key += `|${a.say}|${hx},${hy},${alpha}`;
    todo.push(() => {
      const lines = wrap(ctx, a.say, 100 * px, px);
      const size = bubbleSize(ctx, lines, px);
      ctx.globalAlpha = alpha;
      bubble(
        ctx,
        lines,
        clamp(hx - Math.round(size.w / 2), 2 * px, Math.max(2 * px, wide - size.w - 2 * px)),
        Math.max(2 * px, hy - size.h - 3 * px),
        px,
        hx,
      );
      ctx.globalAlpha = 1;
    });
  }

  // Why the thing in hand cannot go where it is pointed.
  const why = S.run?.why ?? (S.run ? null : S.aim?.why);
  // For pieces in hand, over the first of them that cannot go.
  const stuck = S.group?.at[S.group.why.findIndex((r) => r !== null)];
  const where = S.run ? (S.run.legs.at(-1) ?? S.run.turns.at(-1) ?? S.aim) : (stuck ?? S.aim);
  if (why && where && (builds(S.tool) || S.group)) {
    const x = (where.x * TILE + 8 - cx) * z;
    const y = (where.y * TILE - 4 - cy) * z;
    key += `|${why}|${x},${y}`;
    todo.push(() => plate(ctx, why, x, y, px, "#f4a08c"));
  }

  // A nudge keeps quiet while the member is being told why something cannot go where they pointed.
  const nudged = tileNudge();
  if (nudged && !(why && S.tool !== null)) {
    const { text } = nudged;
    const hx = Math.round((nudged.x * TILE + 8 - cx) * z);
    const hy = Math.round((nudged.y * TILE - 6 - cy) * z);
    const bob = Math.round(Math.sin(S.t * 3)) * px;
    key += `|${text}|${hx},${hy},${bob},${clear}`;
    todo.push(() => {
      const lines = wrap(ctx, text, Math.min(130 * px, wide - 16 * px), px);
      const size = bubbleSize(ctx, lines, px);
      const top = hy - size.h - 4 * px + bob;
      // Under the thing it points at, if there is no room over it; and clear of the interface even
      // then, when the thing itself is under it.
      bubble(
        ctx,
        lines,
        clamp(hx - Math.round(size.w / 2), 2 * px, Math.max(2 * px, wide - size.w - 2 * px)),
        top < clear + 2 * px ? Math.max(hy + 34 * z + bob, clear + 2 * px) : top,
        px,
        hx,
      );
    });
  }

  for (const f of floaters) {
    const at = Math.round((f.x - cx) * z);
    const y = Math.round((f.y - cy) * z);
    const alpha = clamp((f.ttl - f.life) / 0.4, 0, 1);
    key += `|${f.text}|${f.col},${at},${y},${alpha}`;
    todo.push(() => {
      const lines = wrap(ctx, f.text, wide - 12 * px, px, true);
      ctx.globalAlpha = alpha;
      lines.forEach((line, i) => {
        const half = Math.round(widthOf(ctx, line, px, true) / 2) + 2 * px;
        write(ctx, line, clamp(at, half, Math.max(half, wide - half)), y + (i - lines.length) * 11 * px, {
          px,
          bold: true,
          colour: f.col,
          align: "center",
          edge: INK,
        });
      });
      ctx.globalAlpha = 1;
    });
  }

  if (key !== "") key = `${wide},${ctx.canvas.height},${px}${key}`;
  if (key === written) return;
  written = key;
  ctx.clearRect(0, 0, wide, ctx.canvas.height);
  for (const say of todo) say();
}

/** The tops of the pylons and the depot's bracket, for anything that wants to know where the lines run. */
export { pylonTop };
