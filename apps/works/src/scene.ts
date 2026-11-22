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

import { CORAL, CREAM, GOLD, INK, SKY } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import { bubble, bubbleSize, wrap } from "@sequoia-leaf/kit/signs.ts";
import { widthOf, write } from "@sequoia-leaf/kit/text.ts";
import { clamp, type Ctx, hash, makeCanvas, must, type Pt } from "@sequoia-leaf/kit/util.ts";
import {
  BACK,
  blank,
  boxOf,
  type Building,
  type Dir,
  DX,
  DY,
  isFilled,
  type Item,
  ITEMS,
  KIND,
  type Kind,
  LEFT,
  MILLED,
  REACH,
  RECIPE,
  RIGHT,
  type Status,
  status,
  TICKS,
  tilesOf,
  tunnelExit,
  type World,
} from "@sequoia-leaf/yard";

import { HOP, walkers } from "./actors.ts";
import { type Arms, beltTile, PAINTS, ride, STEPS, TILE } from "./art/belts.ts";
import { BEYOND, glint, type Ground } from "./art/ground.ts";
import type { Art } from "./art/index.ts";
import { DEPOT } from "./art/machines.ts";
import type { Sprite } from "./art/pal.ts";
import { bits, burst, floaters, puff, rings, smoke } from "./fx.ts";
import { armsOf, type Layout, layout, pylonTop } from "./layout.ts";
import { builds, type Group, type Mark, S } from "./state.ts";

/** What the frame needs to know about the moment: how far into the next tick it is, and how the yard is going. */
export interface Moment {
  /** Ticks since the yard's last, as a share of one. */
  lead: number;
  /** The share of its plain pace everything works at: 1, or less when the yard is short of power. */
  pace: number;
}

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

type Face = "saw" | "kiln" | "press";
/** What the screen remembers about a thing between frames. */
interface Mem {
  face: Face;
  /** When its state was last read, the reading, and since when it has been in trouble. */
  readAt: number;
  status: Status | null;
  since: number;
  /** What it last held ready to hand on, to notice the moment it goes. */
  held: Item | null;
  ready: boolean;
  struck: boolean;
  puffAt: number;
}
/**
 * By tile, with the kind of thing it was about: Leaf's yard, taken each time Leaf answers, is all
 * new things, and what the screen knew of each (how long it has been in trouble) must outlast it.
 */
const mems = new Map<number, { kind: Kind; m: Mem }>();

function memOf(w: World, b: Building, i: number): Mem {
  const kept = mems.get(i);
  if (kept?.kind === b.kind) return kept.m;
  // A new mill's face is guessed from the gatherer that points into it, until something arrives.
  let face: Face = "saw";
  if (b.kind === "mill") {
    const x = i % w.land.w;
    const y = (i - x) / w.land.w;
    for (const d of [0, 1, 2, 3] as const) {
      const j = (y + DY[d]) * w.land.w + x + DX[d];
      const n = w.cells[j];
      const raw = n?.kind === "gatherer" && n.dir === BACK[d] ? w.land.deposit[j] : null;
      const made = raw ? MILLED[raw] : undefined;
      if (made?.face) face = made.face;
    }
  }
  const m: Mem = { face, readAt: -9, status: null, since: -1, held: null, ready: false, struck: false, puffAt: 0 };
  mems.set(i, { kind: b.kind, m });
  return m;
}

/** What a thing is doing, read at most twice a second. */
function reading(w: World, i: number, m: Mem): Status | null {
  if (S.t - m.readAt > 0.5 || S.t < m.readAt) {
    m.readAt = S.t;
    m.status = status(w, i);
    if (!m.status?.trouble) m.since = -1;
    else if (m.since < 0) m.since = S.t;
  }
  return m.status;
}

function faceOf(b: Building, m: Mem): Face {
  const item = b.making ?? b.out ?? b.recipe;
  let r = item ? RECIPE[item] : undefined;
  if (!r && b.count > 0) for (const k of ITEMS) if ((b.buf[k] ?? 0) > 0) r = MILLED[k];
  if (r?.face) m.face = r.face;
  return m.face;
}

const first = <T>(list: readonly T[], i: number): T | undefined => list[clamp(Math.floor(i), 0, list.length - 1)];

/**
 * Puts one built thing into the frame. `x`, `y` is its tile's top-left corner in the picture.
 * `ghost` draws it as something not yet built: faint, at rest, and with nothing remembered.
 */
function build(art: Art, w: World, b: Building, i: number, x: number, y: number, now: Moment, ghost: number): void {
  const m = art.m;
  const foot = y + TILE;
  const cx = x + 8;
  const z = foot + camY;
  const a = ghost > 0 ? ghost : 1;
  const real = ghost === 0;
  const powered = !real || w.power[i] === 1;
  const mem = real ? memOf(w, b, i) : null;
  const st = mem ? reading(w, i, mem) : null;
  const working = real && st?.state === "working";
  const t = S.t;
  let top = foot - 16;
  switch (b.kind) {
    case "gatherer": {
      const hat = Math.floor(hash(i, 3, 7) * 4);
      const left = b.dir === 2 || (b.dir !== 0 && hash(i, 4, 7) > 0.5);
      const p = b.work / TICKS.gather;
      const pose = !powered ? 4 : b.out !== null ? 3 : !working ? 0 : p < 0.2 ? 0 : p < 0.4 ? 1 : p < 0.72 ? 2 : 3;
      const row = (left ? m.gnomeLeft : m.gnome)[hat];
      const s = row?.[pose];
      if (!s) break;
      stand(s, cx, foot - 1, z, a);
      top = foot - 15;
      const gear = w.rates.gather >= 2 ? m.barrow : w.rates.gather >= 1.5 ? m.rake : m.basket;
      put(gear, left ? x + 15 - gear.width : x, foot - gear.height, z - 0.2, a);
      const held = b.out ?? (pose === 3 ? (w.land.deposit[i] ?? null) : null);
      if (held && real) {
        const pic = art.item(held);
        put(pic, cx - Math.floor(pic.width / 2), foot - 16 - pic.height, z + 0.1);
        top -= pic.height;
      }
      if (!powered) put(art.zed.c, cx + 3, foot - 19 - Math.round(Math.sin(S.t * 2) * 1.5), z + 0.3);
      break;
    }
    case "mill": {
      const face = mem ? faceOf(b, mem) : "saw";
      const frames = face === "saw" ? m.saw : face === "kiln" ? m.kiln : m.press;
      const p = b.making ? b.work / (RECIPE[b.making]?.ticks ?? 12) : 0;
      const step = !working
        ? 0
        : face === "saw"
          ? 1 + (Math.floor(t * 14) % 2)
          : face === "kiln"
            ? 1 + (Math.floor(t * 8 + i) % 3)
            : p < 0.3
              ? 0
              : p < 0.6
                ? 1
                : 2;
      const s = first(frames, step);
      if (!s) break;
      stand(s, cx, foot, z, a);
      top = foot - s.c.height + 2;
      if (working && face === "kiln") {
        light(cx, foot - 6, 22, 0.8);
        if (S.t > (mem?.puffAt ?? 0) && mem) {
          mem.puffAt = S.t + 0.5 + hash(i, Math.floor(S.t), 3) * 0.4;
          smoke(cx + 4 + seenX, foot - 19 + seenY, "#9a82a8");
        }
      }
      if (working && face === "saw" && mem && S.t > mem.puffAt) {
        mem.puffAt = S.t + 0.25;
        puff(cx + 3 + seenX, foot - 8 + seenY, 1, "#cbb894", 4);
      }
      break;
    }
    case "bench": {
      const p = b.making ? b.work / (RECIPE[b.making]?.ticks ?? 20) : 0;
      const beat = (p * 2) % 1;
      const step = !working ? 0 : beat < 0.55 ? 0 : beat < 0.75 ? 1 : 2;
      const s = first(m.bench, step);
      if (!s) break;
      stand(s, cx, foot, z, a);
      if (mem) {
        if (step === 2 && !mem.struck) burst(cx - 2 + seenX, foot - 9 + seenY, 3, [GOLD[2], CREAM], 22);
        mem.struck = step === 2;
      }
      break;
    }
    case "workshop": {
      const s = m.workshop[working || !real ? 1 : 0]?.[working ? Math.floor(t * 6) % 2 : 0];
      if (!s) break;
      stand(s, cx, foot, z, a);
      top = foot - 25;
      if (working) light(cx - 3, foot - 10, 18, 0.7);
      break;
    }
    case "crate": {
      const s = m.crate[w.rates.crate > 32 ? 1 : 0]?.[b.open ? 1 : 0];
      if (s) stand(s, cx, foot - 1, z, a);
      break;
    }
    case "pylon": {
      const tall = w.rates.reach > 1;
      // Short of power the lamps burn low, and gutter.
      const dim = now.pace < 1 && Math.sin(S.t * 9 + i) > 0.86 - now.pace;
      const level = !powered ? 0 : now.pace < 1 ? (dim ? 0 : 1) : 2;
      const s = m.pylon[tall ? 1 : 0]?.[real ? level : 2];
      if (s) stand(s, cx, foot, z, a);
      top = foot - (tall ? 34 : 26);
      if (real && powered) {
        const reach = REACH.pylon * w.rates.reach * TILE;
        light(cx, y + 8, reach * 1.2, lamp(now.pace), true);
        light(cx + 5, foot - (tall ? 24 : 16), 14, 0.5 * now.pace);
      }
      break;
    }
    case "wheel": {
      // It hangs over whichever side the stream is on.
      const wet = (d: Dir): boolean => w.land.water[i + DX[d] + DY[d] * w.land.w] === 1;
      const lean = wet(0) ? 5 : wet(2) ? -5 : 0;
      const drop = wet(1) ? 4 : wet(3) ? -3 : 0;
      const s = first(m.wheel, powered && real ? Math.floor(t * 8) % 4 : 0);
      if (s) stand(s, cx + lean, foot + drop, z + (drop > 0 ? 3 : 0), a);
      top = foot - 20;
      if (real && powered && mem && S.t > mem.puffAt) {
        mem.puffAt = S.t + 0.3;
        puff(cx + lean + seenX, foot + drop - 1 + seenY, 1, "#93cfd0", 5);
      }
      break;
    }
    case "boiler": {
      const burning = real && powered && b.fuel > 0;
      const s = first(m.boiler, burning ? 1 + (Math.floor(t * 7) % 2) : ghost > 0 ? 1 : 0);
      if (s) stand(s, cx, foot, z, a);
      top = foot - 23;
      if (burning && mem) {
        light(cx - 2, foot - 4, 24, 0.85);
        if (S.t > mem.puffAt) {
          mem.puffAt = S.t + 0.3 + hash(i, Math.floor(S.t * 3), 5) * 0.3;
          smoke(cx + 5 + seenX, foot - 24 + seenY, "#cdb6d8");
        }
      }
      break;
    }
    case "tunnel": {
      const s = m.hood[b.span > 0 ? b.dir : BACK[b.dir]];
      if (s) stand(s, cx, foot + 1, z - 2, a);
      break;
    }
    case "belt":
    case "splitter":
    case "joiner":
    case "depot":
      return;
  }
  // The brass pointer on its way out, and whatever it is holding with nowhere to send it.
  const hands =
    b.kind === "gatherer" || b.kind === "mill" || b.kind === "bench" || b.kind === "workshop" || b.kind === "crate";
  if (hands) {
    const p = (ghost > 0 || S.picked === i ? m.pointerLit : m.pointer)[b.dir];
    const ex = cx + DX[b.dir] * 8;
    const ey = y + 8 + DY[b.dir] * 8;
    if (p) put(p, ex - Math.floor(p.width / 2), ey - Math.floor(p.height / 2), z + 0.4, a);
    if (real && b.out !== null && b.kind !== "gatherer" && b.kind !== "crate") {
      const pic = art.item(b.out);
      put(
        pic,
        ex - DX[b.dir] * 4 - Math.floor(pic.width / 2),
        ey - DY[b.dir] * 4 - Math.floor(pic.height / 2) - 2,
        z + 0.5,
      );
    }
  }
  if (!real || !mem) return;
  // Second- and third-tier machines wear their brass.
  if (b.kind === "mill" || b.kind === "bench" || b.kind === "workshop") {
    if (w.rates.craft >= 1.5) put(m.pip, x, top + 1, z + 0.2);
    if (w.rates.craft >= 2) put(m.pip, x + 12, top + 1, z + 0.2);
  }
  // Trouble that has lasted says so over the machine's head.
  if (st?.trouble && mem.since >= 0 && S.t - mem.since > 1.5 && !(b.kind === "gatherer" && !powered)) {
    const badge = grown(st.state === "unpowered" ? art.bolt : art.bang);
    stand(badge, cx, top - 2 - Math.round(Math.abs(Math.sin(S.t * 4 + i)) * 2), z + 0.6);
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
  const ends = s.of === L ? s.ends : L.wires.map((l) => `${l.a.x},${l.a.y},${l.b.x},${l.b.y}`).join();
  s.of = L;
  if (ends !== s.ends || s.lost !== lost) {
    s.ends = ends;
    s.lost = lost;
    const hits = new Map<number, number>();
    const at = (line: Line, k: number): number => ((line.ys[k] ?? 0) + 4096) * 8192 + (line.xs[k] ?? 0) + 4096;
    s.lines = L.wires.map((l) => {
      const len = Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y);
      const n = Math.max(2, Math.round(len / 1.2));
      const sag = Math.min(9, len * 0.07);
      const line = { xs: new Int16Array(n + 1), ys: new Int16Array(n + 1), alone: new Uint8Array(n + 1), lit: -9 };
      for (let k = 0; k <= n; k++) {
        const u = k / n;
        line.xs[k] = Math.round(l.a.x + (l.b.x - l.a.x) * u);
        line.ys[k] = Math.round(l.a.y + (l.b.y - l.a.y) * u + sag * 4 * u * (1 - u));
        hits.set(at(line, k), (hits.get(at(line, k)) ?? 0) + 1);
      }
      return line;
    });
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
    const l = L.wires[n];
    if (!line || !l) continue;
    // The glint starts from a different place on every line, by where the line is on the screen.
    const spot = Math.floor(
      ((S.t * 0.7 + hash(l.a.x - cx + corner.x, l.a.y - cy + corner.y, 9)) % 1) * (line.xs.length - 1),
    );
    if (spot === line.lit) continue;
    for (let k = line.lit - 1; k <= line.lit + 1; k++)
      if (line.alone[k] === 1) s.g.fillRect((line.xs[k] ?? 0) - gr.x, (line.ys[k] ?? 0) - gr.y, 1, 1);
    for (let k = spot - 1; k <= spot + 1; k++)
      if (line.alone[k] === 1) s.g.clearRect((line.xs[k] ?? 0) - gr.x, (line.ys[k] ?? 0) - gr.y, 1, 1);
    line.lit = spot;
  }
  g.globalAlpha = 0.6;
  blit(g, s.c, cx - gr.x, cy - gr.y, g.canvas.width, g.canvas.height, 0, 0);
  for (const line of s.lines)
    for (let k = line.lit - 1; k <= line.lit + 1; k++)
      if (line.alone[k] === 1) R(g, (line.xs[k] ?? 0) - cx, (line.ys[k] ?? 0) - cy, 1, 1, GOLD[2]);
  for (let j = 0; j < s.shared.length; j += 2) {
    const line = s.lines[s.shared[j] ?? 0];
    const k = s.shared[j + 1] ?? 0;
    if (line) R(g, (line.xs[k] ?? 0) - cx, (line.ys[k] ?? 0) - cy, 1, 1, Math.abs(k - line.lit) < 2 ? GOLD[2] : WIRE);
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
function marked(g: Ctx, w: World, m: Mark, cx: number, cy: number): void {
  const W = w.land.w;
  if (masked?.of !== m.tiles) {
    const on = new Uint8Array(w.cells.length);
    for (const i of m.tiles) on[i] = 1;
    masked = { of: m.tiles, on };
  }
  const { on } = masked;
  const leaving = S.group?.as === "move";
  g.globalCompositeOperation = leaving ? "source-over" : "lighter";
  g.fillStyle = leaving ? "rgba(26,15,30,0.5)" : `rgba(255,176,64,${0.26 + 0.07 * Math.sin(S.t * 5)})`;
  // Only where a piece still stands: one may have been taken away since.
  for (const i of m.tiles) if (w.cells[i]) g.fillRect((i % W) * TILE - cx, Math.floor(i / W) * TILE - cy, TILE, TILE);
  g.globalCompositeOperation = "source-over";
  g.fillStyle = leaving ? GOLD[0] : GOLD[2];
  for (const i of m.tiles) {
    if (!w.cells[i]) continue;
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

/** The pieces in hand, drawn once for each place they are aimed at and kept: `for` is the aim it was drawn for. */
const held: { c: HTMLCanvasElement; g: Ctx; for: Group["at"] | null } = { ...makeCanvas(1, 1, true), for: null };
/** Room in that picture round the box of tiles, for what stands taller or leans wider than its tile. */
const ROOM = { side: 8, top: 40, bottom: 8 } as const;

/**
 * Draws the pieces in hand where they are aimed, as they would stand: belts joined to each other
 * and to the lines already there, machines as built. Gold lies over each piece that can go there
 * and coral over each that cannot. It is drawn afresh only when the aim moves to another tile, so
 * a frame costs one picture however many pieces are in hand.
 */
function inHand(g: Ctx, art: Art, w: World, grp: Group, now: Moment, cx: number, cy: number): void {
  const box = boxOf(grp.at);
  if (held.for !== grp.at) {
    held.for = grp.at;
    const tiles = tilesOf(w, grp.at);
    // The yard as it would be: for a move without the pieces where they stand now, and with every piece in hand set down.
    const yard: World = { ...w, cells: [...w.cells], wire: null };
    if (grp.as === "move") for (const i of tilesOf(w, grp.pieces)) yard.cells[i] = null;
    for (const p of grp.at) {
      const [near = -1, far = -1] = tilesOf(w, [p]);
      if (near < 0) continue;
      const tint = p.tint ?? 0;
      const shut = p.shut ?? 0;
      yard.cells[near] = Object.assign(blank(p.kind, p.dir), { span: p.span, open: p.open ?? true, tint, shut });
      if (far >= 0) yard.cells[far] = Object.assign(blank(p.kind, p.dir), { span: -p.span, tint });
    }
    const arms = armsOf(yard);
    held.c.width = box.w * TILE + ROOM.side * 2;
    held.c.height = box.h * TILE + ROOM.top + ROOM.bottom;
    const h = held.g;
    h.imageSmoothingEnabled = false;
    const ox = ROOM.side - box.x * TILE;
    const oy = ROOM.top - box.y * TILE;
    const tier = w.rates.belt >= 2 ? 2 : w.rates.belt >= 1.5 ? 1 : 0;
    const mark = used;
    const before = lit;
    for (const i of tiles) {
      const b = yard.cells[i];
      if (!b) continue;
      const x = (i % w.land.w) * TILE + ox;
      const y = Math.floor(i / w.land.w) * TILE + oy;
      const a = arms[i];
      if (a) h.drawImage(beltTile(a, b.dir, 0, tier, b.tint), x, y);
      const top = b.kind === "splitter" ? art.m.splitter[b.dir] : b.kind === "joiner" ? art.m.joiner[b.dir] : undefined;
      if (top) h.drawImage(top, x, y);
      build(art, yard, b, i, x, y, now, 1);
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
  const cleared = L.world.land.plots.filter((plot, n) => L.owned[n] && !S.clearing.has(plot.id));
  const plots = cleared.map((plot) => plot.id).join();
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
 * shape, way and colour; over those, the splitters' arrowheads and the joiners' tops, gathered by
 * picture; and where the splitters are.
 */
let laid: {
  of: Layout;
  belts: (Tiled & { arms: Arms; dir: Dir; tint: number })[];
  tops: (Tiled & { pic: HTMLCanvasElement })[];
  splitters: number[];
} | null = null;
function laidOf(L: Layout, art: Art): NonNullable<typeof laid> {
  if (laid?.of === L) return laid;
  const { cells, land } = L.world;
  const made: NonNullable<typeof laid> = { of: L, belts: [], tops: [], splitters: [] };
  const belts = new Map<number, Path2D>();
  const tops = new Map<HTMLCanvasElement, Path2D>();
  L.arms.forEach((arms, i) => {
    const b = cells[i];
    if (!arms || !b) return;
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
    const key = ((((arms[0] * 4 + arms[1]) * 4 + arms[2]) * 4 + arms[3]) * 4 + b.dir) * 7 + b.tint;
    let tiles = belts.get(key);
    if (!tiles) {
      tiles = new Path2D();
      belts.set(key, tiles);
      made.belts.push({ arms, dir: b.dir, tint: b.tint, tiles });
    }
    here(tiles);
    if (b.kind === "joiner") top(art.m.joiner[b.dir]);
    if (b.kind !== "splitter") return;
    made.splitters.push(i);
    // An arrowhead on each way out that leads somewhere.
    [b.dir, LEFT[b.dir], RIGHT[b.dir]].forEach((d, k) => {
      if (arms[d] === 2) top(art.m.heads[k]?.[b.dir]);
    });
  });
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
const wantsPower = (kind: Kind): boolean => KIND[kind].draw > 0 || KIND[kind].gives > 0 || kind === "pylon";

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
  const { land } = w;
  const L: Layout = layout(w, S.rev);
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
      const clearing = S.clearing.get(plot.id);
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
  const tier = w.rates.belt >= 2 ? 2 : w.rates.belt >= 1.5 ? 1 : 0;
  const along = w.rates.belt / TICKS.belt;
  const step = Math.floor((w.tick + now.lead) * along * TILE) % STEPS;
  // Each kind in one go: its tile, at this step of the march, fills every tile of that kind.
  const flat = laidOf(L, art);
  g.setTransform(1, 0, 0, 1, -cx, -cy);
  for (const kind of flat.belts) lay(g, beltTile(kind.arms, kind.dir, step, tier, kind.tint), kind.tiles);
  g.setTransform(1, 0, 0, 1, 0, 0);
  let laps = 0;
  for (let ty = ty0; ty <= ty1; ty++)
    for (let tx = tx0; tx <= tx1; tx++) {
      const i = ty * land.w + tx;
      const b = w.cells[i];
      const arms = L.arms[i];
      if (!b || !arms) continue;
      const x = tx * TILE - cx;
      const y = ty * TILE - cy;
      if (b.item !== null) {
        // In from the side it was handed over on, out the way the tile sends it.
        const vx = b.via >= 0 ? (b.via % land.w) - tx : 9;
        const vy = b.via >= 0 ? Math.floor(b.via / land.w) - ty : 9;
        const from =
          vx === 1 && vy === 0
            ? 0
            : vx === 0 && vy === 1
              ? 1
              : vx === -1 && vy === 0
                ? 2
                : vx === 0 && vy === -1
                  ? 3
                  : BACK[b.dir];
        const to: number = b.kind === "splitter" ? sendWay(b, arms) : b.dir;
        const prog = Math.min(1, b.prog + (b.prog < 1 ? now.lead * along : 0));
        const pic = art.item(b.item);
        const left = x + Math.round(ride(from, to, prog, false)) - (pic.width >> 1);
        const top = y + Math.round(ride(from, to, prog, true)) - (pic.height >> 1) - 1;
        g.drawImage(pic, left, top);
        // A splitter or a joiner to the left or above is topped after this is drawn, and this lies over its top.
        const beside = w.cells[left < x && tx > 0 ? i - 1 : top < y ? i - land.w : -1]?.kind;
        if (beside === "splitter" || beside === "joiner") {
          const over = (lapping[laps++] ??= { pic, x: 0, y: 0, w: 0, h: 0 });
          over.pic = pic;
          over.x = left;
          over.y = top;
          over.w = left < x ? x - left : pic.width;
          over.h = left < x ? pic.height : y - top;
        }
      }
      // A belt whose load has nowhere to go says so, like any machine.
      if (b.item !== null && b.prog >= 1) {
        const m = memOf(w, b, i);
        if (reading(w, i, m)?.trouble && m.since >= 0 && S.t - m.since > 1.5)
          stand(grown(art.bang), x + 8, y - 4 - Math.round(Math.abs(Math.sin(S.t * 4 + i)) * 2), (ty + 1) * TILE + 0.6);
      }
    }
  // Over what is carried: the arrowheads and the joiners' tops, each picture in one go; then each idle splitter's vane.
  g.setTransform(1, 0, 0, 1, -cx, -cy);
  for (const top of flat.tops) lay(g, top.pic, top.tiles);
  g.setTransform(1, 0, 0, 1, 0, 0);
  for (let k = 0; k < laps; k++) {
    const over = lapping[k];
    if (over) g.drawImage(over.pic, 0, 0, over.w, over.h, over.x, over.y, over.w, over.h);
  }
  for (const i of flat.splitters) {
    const b = w.cells[i];
    const arms = L.arms[i];
    const tx = i % land.w;
    const ty = (i - tx) / land.w;
    if (!b || !arms || b.item !== null || tx < tx0 || tx > tx1 || ty < ty0 || ty > ty1) continue;
    const v = art.m.vane[sendWay(b, arms)];
    if (v) g.drawImage(v, tx * TILE - cx + 5, ty * TILE - cy + 5);
  }

  lap("belts");
  // ---------- everything that stands up ----------
  for (let ty = ty0; ty <= ty1; ty++)
    for (let tx = tx0; tx <= tx1; tx++) {
      const i = ty * land.w + tx;
      const b = w.cells[i];
      if (b && b.kind !== "depot") build(art, w, b, i, tx * TILE - cx, ty * TILE - cy, now, 0);
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
          dl + 2 + DEPOT.board.x + n * 3,
          dt + 3 + DEPOT.board.y,
          dz + 0.1,
        );
    }
    if (w.plans.includes("flywheel")) {
      const fly = art.m.fly[Math.floor(S.t * 8) % 4];
      if (fly) put(fly, dl + DEPOT.fly.x - 6, dt + DEPOT.fly.y - 6, dz + 0.1);
    }
  }
  const reach = REACH.depot * TILE;
  light(dx, dfoot - 24, reach * 1.2, lamp(now.pace), true);
  light(dx, dfoot - 6, 34, 0.9);

  for (const tr of art.trunks) {
    const x = tr.x - cx;
    const y = tr.y - cy;
    if (x < -40 || x > W + 40 || y < -4 || y > H + 80) continue;
    stand(tr.s, x, y, tr.y);
  }
  for (const f of L.fences) {
    const x = f.x - cx;
    const y = f.y - cy;
    if (x < -20 || x > W + 4 || y < -20 || y > H + 12) continue;
    stand(f.across ? art.m.fenceAcross : art.m.fenceDown, x, y, f.y + (f.across ? 0.5 : TILE - 0.5));
  }
  stand(art.m.gate, L.gate.x - cx, L.gate.y - cy + 1, L.gate.y + 1);
  light(L.gate.x - 6 - cx, L.gate.y - 14 - cy, 26, 0.75);
  // A sign is drawn at the foot of its tile, in front of any undergrowth on the same tile.
  for (const sign of L.signs) stand(art.sign(sign.plot.price), sign.x - cx, sign.y - cy, sign.y + 2);

  // Undergrowth over land that is not the yard's, falling away where a plot has just been bought.
  for (let n = 0; n < land.plots.length; n++) {
    const plot = land.plots[n];
    if (!plot) continue;
    const clearing = S.clearing.get(plot.id);
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

  // What the depot takes in hops over the sill and is gone.
  for (const i of L.intoDepot) {
    const b = w.cells[i];
    if (!b) continue;
    const m = memOf(w, b, i);
    const has = b.item ?? b.out;
    const ready = b.item !== null ? b.prog + now.lead * along >= 0.85 : b.out !== null;
    if (m.held !== null && m.ready && (has !== m.held || !ready)) {
      const x = (i % land.w) * TILE + 8;
      const y = Math.floor(i / land.w) * TILE + 8;
      const way = b.kind === "splitter" ? b.dir : b.dir;
      hops.push({ pic: art.item(m.held), x: x + DX[way] * 8, y: y + DY[way] * 8, dx: DX[way], dy: DY[way], t: S.t });
    }
    m.held = has;
    m.ready = ready;
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
    const on = (tx: number, ty: number): boolean =>
      tx >= 0 && ty >= 0 && tx < land.w && ty < land.h && w.power[ty * land.w + tx] === 1;
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
    const b = w.cells[S.picked];
    const px = (S.picked % land.w) * TILE - cx;
    const py = Math.floor(S.picked / land.w) * TILE - cy;
    if (b?.kind === "depot") corners(g, dx - 24, dfoot - 48, 48, 48, GOLD[2], false);
    else corners(g, px, py, TILE, TILE, GOLD[2], false);
  }
  if (S.hover && tool === null) {
    const i = S.hover.y * land.w + S.hover.x;
    const b = S.hover.x >= 0 && S.hover.y >= 0 && S.hover.x < land.w && S.hover.y < land.h ? w.cells[i] : null;
    if (b?.kind === "depot") corners(g, dx - 24, dfoot - 48, 48, 48, GOLD[2], true);
    else if (b) corners(g, S.hover.x * TILE - cx, S.hover.y * TILE - cy, TILE, TILE, GOLD[2], true);
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
      if (leg.kind === "belt") g.drawImage(beltTile(armsFor(leg.dir), leg.dir, step, tier), x, y);
      else {
        const far = tunnelExit(w, leg.x, leg.y, leg.dir, leg.span);
        const near = art.m.hood[leg.dir];
        const out = art.m.hood[BACK[leg.dir]];
        if (near) g.drawImage(near.c, x + 8 - near.ax, y + TILE + 1 - near.ay);
        if (far && out) g.drawImage(out.c, far.x * TILE - cx + 8 - out.ax, far.y * TILE - cy + TILE + 1 - out.ay);
      }
    }
    for (const turn of S.run.turns)
      g.drawImage(beltTile(armsFor(turn.dir), turn.dir, step, tier), turn.x * TILE - cx, turn.y * TILE - cy);
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
      if (tool === "belt" || tool === "splitter" || tool === "joiner" || tool === "tunnel") {
        g.globalAlpha = 0.8;
        const arms = tool === "splitter" ? splitArms(S.dir) : tool === "tunnel" ? tunnelArms(S.dir) : armsFor(S.dir);
        g.drawImage(beltTile(arms, S.dir, step, tier), x, y);
        const top = tool === "splitter" ? art.m.splitter[S.dir] : tool === "joiner" ? art.m.joiner[S.dir] : undefined;
        if (top) g.drawImage(top, x, y);
        g.globalAlpha = 1;
      }
      const ghost = blank(tool, S.dir);
      ghost.span = 1;
      build(art, w, ghost, S.aim.y * land.w + S.aim.x, x, y, now, bad ? 0.5 : 0.8);
      if (tool === "tunnel") {
        const far = tunnelExit(w, S.aim.x, S.aim.y, S.dir);
        const out = art.m.hood[BACK[S.dir]];
        if (far && out) put(out.c, far.x * TILE - cx + 8 - out.ax, far.y * TILE - cy + TILE + 1 - out.ay, 0, 0.8);
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
      if (tool === "pylon")
        pixelRing(
          g,
          x + 8,
          y + 8,
          REACH.pylon * w.rates.reach * TILE,
          REACH.pylon * w.rates.reach * TILE,
          bad ? CORAL : GOLD[2],
          2,
        );
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
function sendWay(b: Building, arms: Arms): Dir {
  for (let k = 0; k < 3; k++) {
    const turn = (b.turn + k) % 3;
    const d = turn === 0 ? b.dir : turn === 1 ? LEFT[b.dir] : RIGHT[b.dir];
    if (arms[d] === 2) return d;
  }
  return b.dir;
}

const armsFor = (dir: Dir): readonly [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2] => {
  const a: [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2] = [0, 0, 0, 0];
  a[dir] = 2;
  a[BACK[dir]] = 1;
  return a;
};
const splitArms = (dir: Dir): readonly [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2] => {
  const a: [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2] = [2, 2, 2, 2];
  a[BACK[dir]] = 1;
  return a;
};
const tunnelArms = (dir: Dir): readonly [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2] => {
  const a: [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2] = [0, 0, 0, 0];
  a[BACK[dir]] = 1;
  return a;
};

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
  const cx = Math.round(S.cam.x);
  const cy = Math.round(S.cam.y);
  const wide = ctx.canvas.width;
  let key = "";
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
      // Under the thing it points at, if there is no room over it.
      bubble(
        ctx,
        lines,
        clamp(hx - Math.round(size.w / 2), 2 * px, Math.max(2 * px, wide - size.w - 2 * px)),
        top < clear + 2 * px ? hy + 34 * z + bob : top,
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
