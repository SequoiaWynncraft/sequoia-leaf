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
  ALL_ITEMS,
  BACK,
  BELT,
  BENCH,
  BOILER,
  boxOf,
  condition,
  CRATE,
  DEPOT,
  type Dir,
  DRAW,
  DX,
  DY,
  GATHERER,
  GIVES,
  held as holds,
  holderOf,
  isFilled,
  isItem,
  item as thing,
  ITEM_COUNT,
  ITEMS,
  JOINER,
  type Kind,
  LEFT,
  litOf,
  MILL,
  NONE,
  openOf,
  PACE,
  PYLON,
  REACH,
  RECIPE,
  RECIPES,
  RIGHT,
  SORTER,
  SPLITTER,
  STATES,
  STOP,
  STUDY,
  tilesOf,
  TROUBLE,
  TUNNEL,
  WHEEL,
  WORK,
  WORKSHOP,
  type Yard,
} from "@sequoia-leaf/factory";
import { CORAL, CREAM, GOLD, INK, SKY } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import { bubble, bubbleSize, wrap } from "@sequoia-leaf/kit/signs.ts";
import { widthOf, write } from "@sequoia-leaf/kit/text.ts";
import { clamp, type Ctx, hash, makeCanvas, must, type Pt } from "@sequoia-leaf/kit/util.ts";

import { HOP, walkers } from "./actors.ts";
import { armAt, type Arms, arms, beltTile, marksOf, PAINTS, ride, STEPS, TILE, withArm, woodOf } from "./art/belts.ts";
import { BEYOND, glint, type Ground } from "./art/ground.ts";
import type { Art } from "./art/index.ts";
import { DEPOT as DEPOT_ART, lookOf } from "./art/machines.ts";
import type { Sprite } from "./art/pal.ts";
import { drawPlan, drawPlanMarks } from "./far.ts";
import { bits, burst, floaters, puff, rings, smoke } from "./fx.ts";
import { armsAt, asIf, type Layout, layout, pylonTop } from "./layout.ts";
import { builds, draws, type Group, handGrade, type Mark, S, seenFrom } from "./state.ts";

/** What the frame needs to know about the moment: how far into the next tick it is, and how the yard is going. */
export interface Moment {
  /** Ticks since the yard's last, as a share of one. */
  lead: number;
  /** The share of its plain pace everything works at: 1, or less when the yard is short of power. */
  pace: number;
}

/**
 * How far across its tile a thing moves in a tick on a belt, tunnel or sorter of each grade (a sorter
 * has none, and goes at the top grade's pace). A splitter and a joiner are drawn at the first grade's.
 */
const ALONG = PACE.map((pace) => pace / 8);
const FIRST = ALONG[1] ?? 0.25;
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

/** A mill's faces: it saws, fires or presses, by what arrives. */
const FACES = ["saw", "kiln", "press"] as const;
const SAW = 0;
const KILN = 1;
/** The face a mill shows making each thing, and taking each thing in, looked up once by name; `NONE` where none says. */
const FACE_OUT = new Uint8Array(ITEM_COUNT).fill(NONE);
const FACE_IN = new Uint8Array(ITEM_COUNT).fill(NONE);
for (const r of RECIPES) {
  if (r.face === undefined || r.by !== "mill") continue;
  const face = FACES.indexOf(r.face);
  FACE_OUT[thing(r.out)] = face;
  for (const name of ITEMS) if ((r.from[name] ?? 0) > 0) FACE_IN[thing(name)] = face;
}
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

/** Makes the tile's memory afresh for a piece it was not kept for. A new mill's face is guessed from the gatherer that points into it, until something arrives. */
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
  let face = SAW;
  if (k === MILL) {
    const W = y.land.w;
    const x = i % W;
    const z = (i - x) / W;
    for (let d = 0; d < 4; d++) {
      const j = (z + (DY[d] ?? 0)) * W + x + (DX[d] ?? 0);
      const f = y.kind[j] === GATHERER && y.dir[j] === BACK[d] ? (FACE_IN[y.land.deposit[j] ?? NONE] ?? NONE) : NONE;
      if (f !== NONE) face = f;
    }
  }
  mem.face[i] = face;
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

/** The face a mill shows now: of what it makes, holds ready or is told to make, else of what it holds. */
function faceOf(y: Yard, i: number, r: number): number {
  const h = y.holders;
  const making = h.making[r] ?? NONE;
  const out = h.out[r] ?? NONE;
  const n = making !== NONE ? making : out !== NONE ? out : (y.set[i] ?? NONE);
  let f = FACE_OUT[n] ?? NONE;
  if (f === NONE && (h.count[r] ?? 0) > 0)
    for (const k of ALL_ITEMS) if (holds(h, r, k) > 0 && FACE_IN[k] !== NONE) f = FACE_IN[k] ?? NONE;
  if (f !== NONE) mem.face[i] = f;
  return mem.face[i] ?? SAW;
}

const first = <T>(list: readonly T[], i: number): T | undefined => list[clamp(Math.floor(i), 0, list.length - 1)];
/** Whether the stream is on one side of a tile. */
const wet = (y: Yard, i: number, side: Dir): boolean => y.land.water[i + DX[side] + DY[side] * y.land.w] === 1;

/**
 * Puts one piece into the frame: the kind `k` facing `d` on tile `i`, at a `grade` (0 for a kind with
 * none), with a tunnel's `span` and a crate `open` or shut. `x`, `top` is its tile's top-left corner
 * in the picture. A grade above the first is drawn in its own look (`lookOf`), with the grade's mark
 * in the tile's top-left corner. `ghost` draws it as something not yet built: faint, at rest, and
 * with nothing remembered or read of what it holds; a real one (`ghost` 0) is what stands on the tile.
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
  const m = art.m;
  const look = lookOf(grade);
  const foot = top + TILE;
  const cx = x + 8;
  const z = foot + camY;
  const a = ghost > 0 ? ghost : 1;
  const real = ghost === 0;
  const powered = !real || litOf(y)[i] === 1;
  const c = real ? reading(y, i) : -1;
  const working = c >= 0 && c % TROUBLE === WORKING;
  const h = y.holders;
  const r = real ? holderOf(y, i) : -1;
  const out = r >= 0 ? (h.out[r] ?? NONE) : NONE;
  const making = r >= 0 ? (h.making[r] ?? NONE) : NONE;
  const work = r >= 0 ? (h.work[r] ?? 0) : 0;
  const t = S.t;
  let head = foot - 16;
  switch (k) {
    case GATHERER: {
      const hat = Math.floor(hash(i, 3, 7) * 4);
      const left = d === 2 || (d !== 0 && hash(i, 4, 7) > 0.5);
      const p = work / WORK.gather;
      const pose = !powered ? 4 : out !== NONE ? 3 : !working ? 0 : p < 0.2 ? 0 : p < 0.4 ? 1 : p < 0.72 ? 2 : 3;
      const row = (left ? m.gnomeLeft : m.gnome)[hat];
      const s = row?.[pose];
      if (!s) break;
      stand(s, cx, foot - 1, z, a);
      head = foot - 15;
      const gear = m.basket;
      put(gear, left ? x + 15 - gear.width : x, foot - gear.height, z - 0.2, a);
      // From the second grade he has a rake, stood in the ground on his other side.
      if (look > 0) stand(left ? m.rakeLeft : m.rake, x + (left ? 2 : 13), foot - 1, z - 0.1, a);
      const carried = out !== NONE ? out : pose === 3 ? (y.land.deposit[i] ?? NONE) : NONE;
      if (isItem(carried) && real) {
        const pic = art.item(carried);
        put(pic, cx - Math.floor(pic.width / 2), foot - 16 - pic.height, z + 0.1);
        head -= pic.height;
      }
      if (!powered) put(art.zed.c, cx + 3, foot - 19 - Math.round(Math.sin(S.t * 2) * 1.5), z + 0.3);
      break;
    }
    case MILL: {
      const face = real && r >= 0 ? faceOf(y, i, r) : SAW;
      const frames = (face === SAW ? m.saw : face === KILN ? m.kiln : m.press)[look] ?? [];
      const p = making !== NONE ? work / (RECIPE[making]?.work ?? 24) : 0;
      const step = !working
        ? 0
        : face === SAW
          ? 1 + (Math.floor(t * 14) % 2)
          : face === KILN
            ? 1 + (Math.floor(t * 8 + i) % 3)
            : p < 0.3
              ? 0
              : p < 0.6
                ? 1
                : 2;
      const s = first(frames, step);
      if (!s) break;
      stand(s, cx, foot, z, a);
      head = foot - s.c.height + 2;
      if (working && face === KILN) {
        light(cx, foot - 6, 22, 0.8);
        if (S.t > (mem.puffAt[i] ?? 0)) {
          mem.puffAt[i] = S.t + 0.5 + hash(i, Math.floor(S.t), 3) * 0.4;
          smoke(cx + 4 + seenX, foot - 19 + seenY, "#9a82a8");
        }
      }
      if (working && face === SAW && S.t > (mem.puffAt[i] ?? 0)) {
        mem.puffAt[i] = S.t + 0.25;
        puff(cx + 3 + seenX, foot - 8 + seenY, 1, "#cbb894", 4);
      }
      break;
    }
    case BENCH: {
      const p = making !== NONE ? work / (RECIPE[making]?.work ?? 40) : 0;
      const beat = (p * 2) % 1;
      const step = !working ? 0 : beat < 0.55 ? 0 : beat < 0.75 ? 1 : 2;
      const s = first(m.bench[look] ?? [], step);
      if (!s) break;
      stand(s, cx, foot, z, a);
      if (real) {
        if (step === 2 && mem.struck[i] !== 1) burst(cx - 2 + seenX, foot - 9 + seenY, 3, [GOLD[2], CREAM], 22);
        mem.struck[i] = step === 2 ? 1 : 0;
      }
      break;
    }
    case WORKSHOP: {
      const s = m.workshop[look]?.[working || !real ? 1 : 0]?.[working ? Math.floor(t * 6) % 2 : 0];
      if (!s) break;
      stand(s, cx, foot, z, a);
      head = foot - 25;
      if (working) light(cx - 3, foot - 10, 18, 0.7);
      break;
    }
    case CRATE: {
      const s = m.crate[y.open.crate > 32 ? 1 : 0]?.[open ? 1 : 0];
      if (s) stand(s, cx, foot - 1, z, a);
      break;
    }
    case PYLON: {
      const tall = y.open.reach > 100;
      // Short of power the lamps burn low, and gutter.
      const dim = now.pace < 1 && Math.sin(S.t * 9 + i) > 0.86 - now.pace;
      const level = !powered ? 0 : now.pace < 1 ? (dim ? 0 : 1) : 2;
      const s = m.pylon[tall ? 1 : 0]?.[real ? level : 2];
      if (s) stand(s, cx, foot, z, a);
      head = foot - (tall ? 34 : 26);
      if (real && powered) {
        const reach = ((REACH.pylon * y.open.reach) / 10_000) * TILE;
        light(cx, top + 8, reach * 1.2, lamp(now.pace), true);
        light(cx + 5, foot - (tall ? 24 : 16), 14, 0.5 * now.pace);
      }
      break;
    }
    case WHEEL: {
      // It hangs over whichever side the stream is on.
      const lean = wet(y, i, 0) ? 5 : wet(y, i, 2) ? -5 : 0;
      const drop = wet(y, i, 1) ? 4 : wet(y, i, 3) ? -3 : 0;
      const s = first(m.wheel, powered && real ? Math.floor(t * 8) % 4 : 0);
      if (s) stand(s, cx + lean, foot + drop, z + (drop > 0 ? 3 : 0), a);
      head = foot - 20;
      if (real && powered && S.t > (mem.puffAt[i] ?? 0)) {
        mem.puffAt[i] = S.t + 0.3;
        puff(cx + lean + seenX, foot + drop - 1 + seenY, 1, "#93cfd0", 5);
      }
      break;
    }
    case BOILER: {
      const burning = real && powered && r >= 0 && (h.fuel[r] ?? 0) > 0;
      const s = first(m.boiler, burning ? 1 + (Math.floor(t * 7) % 2) : ghost > 0 ? 1 : 0);
      if (s) stand(s, cx, foot, z, a);
      head = foot - 23;
      if (burning) {
        light(cx - 2, foot - 4, 24, 0.85);
        if (S.t > (mem.puffAt[i] ?? 0)) {
          mem.puffAt[i] = S.t + 0.3 + hash(i, Math.floor(S.t * 3), 5) * 0.3;
          smoke(cx + 5 + seenX, foot - 24 + seenY, "#cdb6d8");
        }
      }
      break;
    }
    case TUNNEL: {
      const s = m.hood[look]?.[span > 0 ? d : BACK[d]];
      if (s) stand(s, cx, foot + 1, z - 2, a);
      break;
    }
    case STUDY: {
      // Unlit, the lamp is out; lit, the book lies shut until there is a folio to read, and a page turns for each.
      const p = work / WORK.study;
      const state = !powered ? 0 : !working ? (real ? 1 : 2) : p < 0.6 ? 2 : p < 0.8 ? 3 : 4;
      const s = m.study[look]?.[state];
      if (!s) break;
      stand(s, cx, foot, z, a);
      head = foot - 24;
      if (real && powered) light(cx - 4, foot - 13, 15, 0.6);
      break;
    }
    case STOP: {
      // Its cart takes what it is handed, rolls under, and comes back empty.
      const took = real ? (mem.puffAt[i] ?? 0) : 0;
      const since = took > 0 ? S.t - took : 9;
      const cart = since < 0 || since >= 0.5 ? 0 : since < 0.1 ? 1 : since < 0.22 ? 2 : since < 0.36 ? 3 : 4;
      const s = m.stop[cart];
      if (s) stand(s, cx, foot, z, a);
      head = foot - 20;
      break;
    }
    default:
      // What lies flat (belts, splitters, joiners, sorters) is drawn with the floor.
      return;
  }
  // The grade's mark, in the same corner of every graded piece: a belt has it in its own tile.
  const pip = m.pips[grade - 2];
  if (pip) put(pip, x, top, z + 0.55, a);
  // The brass pointer on its way out, and whatever it is holding with nowhere to send it.
  const hands = k === GATHERER || k === MILL || k === BENCH || k === WORKSHOP || k === CRATE;
  if (hands) {
    const p = (ghost > 0 || S.picked === i ? m.pointerLit : m.pointer)[d];
    const ex = cx + DX[d] * 8;
    const ey = top + 8 + DY[d] * 8;
    if (p) put(p, ex - Math.floor(p.width / 2), ey - Math.floor(p.height / 2), z + 0.4, a);
    if (real && isItem(out) && k !== GATHERER && k !== CRATE) {
      const pic = art.item(out);
      put(pic, ex - DX[d] * 4 - Math.floor(pic.width / 2), ey - DY[d] * 4 - Math.floor(pic.height / 2) - 2, z + 0.5);
    }
  }
  if (!real) return;
  // Trouble that has lasted says so over the machine's head.
  if (troubled(i) && !(k === GATHERER && !powered)) {
    const badge = grown(c % TROUBLE === UNPOWERED ? art.bolt : art.bang);
    stand(badge, cx, head - 2 - Math.round(Math.abs(Math.sin(S.t * 4 + i)) * 2), z + 0.6);
  }
}

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

/** How bright the lamps burn: full while there is power for everything, and visibly lower when there is not. */
const lamp = (pace: number): number => 0.3 + 0.7 * pace * pace;

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
let masked: { of: Mark["tiles"]; on: Uint8Array } | null = null;

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
    for (const i of m.tiles) on[i] = 1;
    masked = { of: m.tiles, on };
  }
  const { on } = masked;
  const leaving = S.group?.as === "move";
  g.globalCompositeOperation = leaving ? "source-over" : "lighter";
  g.fillStyle = leaving ? "rgba(26,15,30,0.5)" : `rgba(255,176,64,${0.26 + 0.07 * Math.sin(S.t * 5)})`;
  // Only where a piece still stands: one may have been taken away since.
  for (const i of m.tiles)
    if (w.kind[i] !== NONE) g.fillRect((i % W) * TILE - cx, Math.floor(i / W) * TILE - cy, TILE, TILE);
  g.globalCompositeOperation = "source-over";
  g.fillStyle = leaving ? GOLD[0] : GOLD[2];
  for (const i of m.tiles) {
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

/** The pieces in hand, drawn once for each place they are aimed at and kept: `for` is the aim it was drawn for, and `rev` the yard's count of changes then. */
const held: { c: HTMLCanvasElement; g: Ctx; for: Group["at"] | null; rev: number; lost: number } = {
  ...makeCanvas(1, 1, true),
  for: null,
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
  const box = boxOf(grp.at);
  if (held.for !== grp.at || held.rev !== S.rev || held.lost !== lost) {
    held.for = grp.at;
    held.rev = S.rev;
    held.lost = lost;
    const tiles = tilesOf(w, grp.at);
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
        const over =
          k === SPLITTER
            ? art.m.splitter[d]
            : k === JOINER
              ? art.m.joiner[d]
              : k === SORTER
                ? art.sorter(d, yard.set[i] ?? NONE)
                : undefined;
        if (over) h.drawImage(over, x, top);
        piece(art, yard, i, k, d, grade, yard.span[i] ?? 0, p.open ?? true, x, top, now, 1);
      }
    }
    for (const d of listed.slice(mark, used).toSorted((p, q) => p.z - q.z)) h.drawImage(d.c, d.x - camX, d.y - camY);
    used = mark;
    lit = before;
    // Gold over each piece that can go and coral over each that cannot, with a line where the pieces end.
    const own = new Set(tiles);
    const W = w.land.w;
    grp.at.forEach((p, k) => {
      const ok = grp.why[k] === null;
      for (const i of tilesOf(w, [p])) {
        if (i < 0) continue;
        const x = (i % W) * TILE + ox;
        const y = Math.floor(i / W) * TILE + oy;
        h.fillStyle = ok ? "rgba(255,196,84,0.34)" : "rgba(238,92,74,0.62)";
        h.fillRect(x, y, TILE, TILE);
        h.fillStyle = ok ? GOLD[2] : CORAL;
        if (!own.has(i - W)) h.fillRect(x, y, TILE, 1);
        if (!own.has(i + W)) h.fillRect(x, y + TILE - 1, TILE, 1);
        if (i % W === 0 || !own.has(i - 1)) h.fillRect(x, y, 1, TILE);
        if (i % W === W - 1 || !own.has(i + 1)) h.fillRect(x + TILE - 1, y, 1, TILE);
      }
    });
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
 * sorters' boards, gathered by picture; and where the splitters are.
 */
let laid: {
  of: Layout;
  belts: (Tiled & { arms: Arms; dir: Dir; tint: number; grade: number })[];
  tops: (Tiled & { pic: HTMLCanvasElement })[];
  splitters: number[];
} | null = null;
function laidOf(L: Layout, art: Art): NonNullable<typeof laid> {
  if (laid?.of === L) return laid;
  const y = L.yard;
  const { land } = y;
  const made: NonNullable<typeof laid> = { of: L, belts: [], tops: [], splitters: [] };
  const belts = new Map<number, Path2D>();
  const tops = new Map<HTMLCanvasElement, Path2D>();
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
    if (k === JOINER) top(art.m.joiner[d]);
    if (k === SORTER) top(art.sorter(d, y.set[i] ?? NONE));
    if (k !== SPLITTER) continue;
    made.splitters.push(i);
    // An arrowhead on each way out that leads somewhere.
    [d, LEFT[d], RIGHT[d]].forEach((side, n) => {
      if (armAt(a, side) === 2) top(art.m.heads[n]?.[d]);
    });
  }
  return (laid = made);
}
/** The way the piece on a tile faces. */
const dirAt = (y: Yard, i: number): Dir => {
  const d = y.dir[i] ?? 0;
  return d === 1 ? 1 : d === 2 ? 2 : d === 3 ? 3 : 0;
};
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
const wantsPower = (kind: Kind): boolean => (DRAW[kind] ?? 0) > 0 || (GIVES[kind] ?? 0) > 0 || kind === PYLON;

/** The whole yard as it is this moment, small. */
export function drawYard(art: Art, now: Moment): HTMLCanvasElement {
  const g = buf.g;
  const W = buf.c.width;
  const H = buf.c.height;
  seenX = S.cam.x + corner.x;
  seenY = S.cam.y + corner.y;
  const cx = (camX = Math.round(S.cam.x) + corner.x);
  const cy = (camY = Math.round(S.cam.y) + corner.y);
  const w = S.world;
  const L: Layout = layout(w, S.rev);
  if (S.view.z < 1) {
    // Further out than a screen pixel for each of the yard's, the yard is its plan (`far.ts`).
    const [dx, dy] = drawPlan(g, w, L, S.rev, corner.x, corner.y);
    lap("plan");
    drawPlanMarks(g, w, S.rev, dx, dy);
    lap("marks");
    return buf.c;
  }
  if (w !== drawn) carry(w);
  const { land } = w;
  const gr = art.ground;
  used = 0;
  lit = 0;

  // ---------- the floor: the forest's everywhere, and the yard's own over it where the land is the yard's ----------
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

  const tx0 = Math.max(0, Math.floor(cx / TILE) - 1);
  const ty0 = Math.max(0, Math.floor(cy / TILE) - 1);
  const tx1 = Math.min(land.w - 1, Math.ceil((cx + W) / TILE) + 1);
  const ty1 = Math.min(land.h - 1, Math.ceil((cy + H) / TILE) + 2);

  for (let ty = ty0; ty <= ty1; ty++)
    for (let tx = tx0; tx <= tx1; tx++)
      if (land.water[ty * land.w + tx] === 1) glint(g, land, tx, ty, tx * TILE - cx, ty * TILE - cy, S.t);

  for (const r of rings) {
    const k = r.life / r.ttl;
    g.globalAlpha = 1 - k;
    pixelRing(g, r.x - cx, r.y - cy, 2 + r.r * k, (2 + r.r * k) * 0.55, r.col);
  }
  g.globalAlpha = 1;

  lap("floor");
  // ---------- belts, lying flat, and what rides on them ----------
  // A belt of each grade marches at its own pace, in its own wood. What has no grade (a splitter, a
  // joiner, a sorter) lies in plain wood and marches as the first grade does.
  const steps = ALONG.map((along) => Math.floor((w.tick + now.lead) * along * TILE) % STEPS);
  steps[0] = steps[1] ?? 0;
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
      const via = w.via[i] ?? 0;
      const prog8 = w.prog[i] ?? 0;
      // In from the side it was handed over on, out the way the tile sends it.
      const from = via > 0 ? (via - 1) & 3 : BACK[d];
      const to: number = k === SPLITTER ? sendWay(w, i, a) : k === SORTER && n === w.set[i] ? LEFT[d] : d;
      const prog = Math.min(1, prog8 / 8 + (prog8 < 8 ? now.lead * alongAt(w, i) : 0));
      const pic = art.item(n);
      const left = x + Math.round(ride(from, to, prog, false)) - (pic.width >> 1);
      const top = y + Math.round(ride(from, to, prog, true)) - (pic.height >> 1) - 1;
      g.drawImage(pic, left, top);
      // A splitter or a joiner to the left or above is topped after this is drawn, and this lies over its top.
      const beside = left < x && tx > 0 ? w.kind[i - 1] : top < y && ty > 0 ? w.kind[i - land.w] : NONE;
      if (beside === SPLITTER || beside === JOINER || beside === SORTER) {
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
  // Over what is carried: the arrowheads, the joiners' tops and the sorters' boards, each picture in one go; then each idle splitter's vane.
  g.setTransform(1, 0, 0, 1, -cx, -cy);
  for (const top of flat.tops) lay(g, top.pic, top.tiles);
  g.setTransform(1, 0, 0, 1, 0, 0);
  for (let k = 0; k < laps; k++) {
    const over = lapping[k];
    if (over) g.drawImage(over.pic, 0, 0, over.w, over.h, over.x, over.y, over.w, over.h);
  }
  for (const i of flat.splitters) {
    const a = L.arms[i] ?? 0;
    const tx = i % land.w;
    const ty = (i - tx) / land.w;
    if (a === 0 || w.item[i] !== NONE || tx < tx0 || tx > tx1 || ty < ty0 || ty > ty1) continue;
    const v = art.m.vane[sendWay(w, i, a)];
    if (v) g.drawImage(v, tx * TILE - cx + 5, ty * TILE - cy + 5);
  }

  lap("belts");
  // ---------- everything that stands up ----------
  for (let ty = ty0; ty <= ty1; ty++)
    for (let tx = tx0; tx <= tx1; tx++) {
      const i = ty * land.w + tx;
      const k = w.kind[i] ?? NONE;
      if (k === NONE || k === DEPOT) continue;
      const r = holderOf(w, i);
      const open = k !== CRATE || r < 0 || w.holders.open[r] === 1;
      piece(art, w, i, k, dirAt(w, i), w.grade[i] ?? 0, w.span[i] ?? 0, open, tx * TILE - cx, ty * TILE - cy, now, 0);
    }

  // The depot, with whatever it wears.
  const dx = land.depot[0] * TILE + 8 - cx;
  const dfoot = (land.depot[1] + 2) * TILE - cy;
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
  const reach = (REACH.depot / 100) * TILE;
  light(dx, dfoot - 24, reach * 1.2, lamp(now.pace), true);
  light(dx, dfoot - 6, 34, 0.9);

  for (const tr of art.trunks) {
    const x = tr.x - cx;
    const y = tr.y - cy;
    if (x < -40 || x > W + 40 || y < -4 || y > H + 80) continue;
    stand(tr.s, x, y, tr.y);
  }
  for (let f = 0; f + 2 < L.fences.length; f += 3) {
    const fx = L.fences[f] ?? 0;
    const fy = L.fences[f + 1] ?? 0;
    const across = L.fences[f + 2] === 1;
    const x = fx - cx;
    const y = fy - cy;
    if (x < -20 || x > W + 4 || y < -20 || y > H + 12) continue;
    stand(across ? art.m.fenceAcross : art.m.fenceDown, x, y, fy + (across ? 0.5 : TILE - 0.5));
  }
  stand(art.m.gate, L.gate.x - cx, L.gate.y - cy + 1, L.gate.y + 1);
  light(L.gate.x - 6 - cx, L.gate.y - 14 - cy, 26, 0.75);
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

  // The gnomes who come to the gate, and the yard's own: waddling, or standing; arms up under a crate.
  for (const a of walkers) {
    const m = art.m;
    const hat = a.carrying ? 1 : 0;
    const frame = a.moving
      ? m.waddle[a.hat]?.[hat]?.[Math.floor(a.walked / 4) % 2]
      : m.gnome[a.hat]?.[a.carrying ? 3 : 0];
    if (!frame) continue;
    const up = a.hop > 0 ? Math.abs(Math.sin((1 - a.hop / HOP) * Math.PI)) * 5 : 0;
    const x = Math.round(a.x) - cx;
    const y = Math.round(a.y - up) - cy;
    stand(frame, x, y, a.y, a.alpha);
    if (a.carrying) stand(art.parcel, x, y - 14, a.y + 0.1, a.alpha);
  }

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
      // A sorter sends the thing it is set to out to its left.
      const way = w.kind[i] === SORTER && had === w.set[i] ? LEFT[dirAt(w, i)] : dirAt(w, i);
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

  lap("standing");
  // ---------- dusk, and the light cut out of it ----------
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

  lap("dusk");
  // ---------- what is being pointed at, and what is about to be built ----------
  const tool = S.tool;
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
  if (S.picked >= 0) {
    const px = (S.picked % land.w) * TILE - cx;
    const py = Math.floor(S.picked / land.w) * TILE - cy;
    if (w.kind[S.picked] === DEPOT) corners(g, dx - 24, dfoot - 48, 48, 48, GOLD[2], false);
    else corners(g, px, py, TILE, TILE, GOLD[2], false);
  }
  if (S.hover && tool === null) {
    const i = S.hover.y * land.w + S.hover.x;
    const k = S.hover.x >= 0 && S.hover.y >= 0 && S.hover.x < land.w && S.hover.y < land.h ? w.kind[i] : NONE;
    if (k === DEPOT) corners(g, dx - 24, dfoot - 48, 48, 48, GOLD[2], true);
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
          beltTile(armsFor(leg.dir), leg.dir, steps[leg.grade] ?? step, woodOf(leg.grade), 0, marksOf(leg.grade)),
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
        beltTile(armsFor(turn.dir), turn.dir, steps[grade] ?? step, woodOf(grade), 0, marksOf(grade)),
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
    const x = S.aim.x * TILE - cx;
    const y = S.aim.y * TILE - cy;
    const bad = S.aim.why !== null;
    if (tool === "remove") corners(g, x, y, TILE, TILE, CORAL, true);
    else if (tool === "paint") {
      // The brush shows its colour on what it would colour, and nothing elsewhere.
      if (!bad) corners(g, x, y, TILE, TILE, PAINTS[S.tint - 1]?.lit ?? CREAM, true);
    } else if (tool === "select") {
      if (S.group) inHand(g, art, w, S.group, now, cx, cy);
    } else if (!S.run) {
      const mark = used;
      const before = lit;
      // At the grade it would stand at: the one in hand, or the higher one of a piece of its kind it would only turn.
      const grade = S.aim.grade ?? handGrade();
      if (tool === BELT || tool === SPLITTER || tool === JOINER || tool === TUNNEL || tool === SORTER) {
        g.globalAlpha = 0.8;
        const a =
          tool === SPLITTER
            ? splitArms(S.dir)
            : tool === TUNNEL
              ? tunnelArms(S.dir)
              : tool === SORTER
                ? sortArms(S.dir)
                : armsFor(S.dir);
        const graded = tool === BELT || tool === TUNNEL ? grade : 0;
        g.drawImage(beltTile(a, S.dir, steps[graded] ?? step, woodOf(graded), 0, marksOf(graded)), x, y);
        const top =
          tool === SPLITTER
            ? art.m.splitter[S.dir]
            : tool === JOINER
              ? art.m.joiner[S.dir]
              : tool === SORTER
                ? art.sorter(S.dir, NONE)
                : undefined;
        if (top) g.drawImage(top, x, y);
        g.globalAlpha = 1;
      }
      piece(art, w, S.aim.y * land.w + S.aim.x, tool, S.dir, grade, 1, true, x, y, now, bad ? 0.5 : 0.8);
      const far = S.aim.far ?? -1;
      if (tool === TUNNEL && far >= 0) {
        const out = art.m.hood[lookOf(grade)]?.[BACK[S.dir]];
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
      lit = before;
      if (tool === PYLON) {
        const ring = ((REACH.pylon * w.open.reach) / 10_000) * TILE;
        pixelRing(g, x + 8, y + 8, ring, ring, bad ? CORAL : GOLD[2], 2);
      }
      corners(g, x, y, TILE, TILE, bad ? CORAL : GOLD[2], true);
    }
  }
  if (S.nudge) {
    // The place a nudge is about: a gold ring that breathes.
    const x = S.nudge.x * TILE + 8 - cx;
    const y = S.nudge.y * TILE + 8 - cy;
    const r = 9 + Math.sin(S.t * 5) * 1.5;
    pixelRing(g, x, y, r, r, GOLD[2]);
    pixelRing(g, x, y, r + 1, r + 1, GOLD[0], 2);
  }
  lap("marks");
  return buf.c;
}

/** The way a splitter sends its next thing: the first, from the one whose turn it is, that leads somewhere. */
function sendWay(y: Yard, i: number, a: Arms): Dir {
  const d = dirAt(y, i);
  for (let k = 0; k < 3; k++) {
    const turn = ((y.turn[i] ?? 0) + k) % 3;
    const side = turn === 0 ? d : turn === 1 ? LEFT[d] : RIGHT[d];
    if (armAt(a, side) === 2) return side;
  }
  return d;
}

/** A straight belt's arms, pointing a way; a splitter's, every way out open; a sorter's, ahead and to its left; a tunnel's, in from behind. */
const armsFor = (dir: Dir): Arms => withArm(withArm(0, dir, 2), BACK[dir], 1);
const splitArms = (dir: Dir): Arms => withArm(arms(2, 2, 2, 2), BACK[dir], 1);
const sortArms = (dir: Dir): Arms => withArm(armsFor(dir), LEFT[dir], 2);
const tunnelArms = (dir: Dir): Arms => withArm(0, BACK[dir], 1);

/**
 * How far across its tile a thing on the piece there moves in a tick, as the frame shows it between
 * ticks: its grade's pace on a belt or tunnel, the top grade's on a sorter, and the first grade's on
 * a splitter or a joiner, as they have always been drawn.
 */
const alongAt = (y: Yard, i: number): number =>
  y.kind[i] === SPLITTER || y.kind[i] === JOINER ? FIRST : (ALONG[y.grade[i] ?? 0] ?? FIRST);

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
  if (S.nudge && !(why && S.tool !== null)) {
    const { text } = S.nudge;
    const hx = Math.round((S.nudge.x * TILE + 8 - cx) * z);
    const hy = Math.round((S.nudge.y * TILE - 6 - cy) * z);
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
