/**
 * Drawing a frame of the yard. Like the town it is drawn small, one art pixel to a pixel, with
 * dusk laid over it and the lamps and fires cutting holes in the dusk; then it is blown up to the
 * screen by a whole number and the words are written over it in the guild's font.
 *
 * The lamplight is also the yard's power: the depot's lamps and every joined pylon's light the
 * ground exactly as far as power reaches, and dim together when the yard is short of it.
 */

import { CORAL, CREAM, GOLD, INK, SKY } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import { bubble, bubbleSize, wrap } from "@sequoia-leaf/kit/signs.ts";
import { widthOf, write } from "@sequoia-leaf/kit/text.ts";
import { clamp, type Ctx, hash, makeCanvas } from "@sequoia-leaf/kit/util.ts";
import {
  BACK,
  blank,
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
  tunnelExit,
  type World,
} from "@sequoia-leaf/yard";

import { HOP, walkers } from "./actors.ts";
import { type Arms, beltTile, ride, STEPS, TILE } from "./art/belts.ts";
import { BEYOND, glint } from "./art/ground.ts";
import type { Art } from "./art/index.ts";
import { DEPOT } from "./art/machines.ts";
import type { Sprite } from "./art/pal.ts";
import { bits, burst, floaters, puff, rings, smoke } from "./fx.ts";
import { type Layout, layout, pylonTop } from "./layout.ts";
import { S } from "./state.ts";

/** What the frame needs to know about the moment: how far into the next tick it is, and how the yard is going. */
export interface Moment {
  /** Ticks since the yard's last, as a share of one. */
  lead: number;
  /** The share of its plain pace everything works at: 1, or less when the yard is short of power. */
  pace: number;
}

const buf = makeCanvas(320, 200, true);
const dusk = makeCanvas(320, 200, true);

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
export function sizeBuffers(w: number, h: number): void {
  for (const b of [buf, dusk]) {
    b.c.width = w;
    b.c.height = h;
    b.g.imageSmoothingEnabled = false;
  }
}

// ---------- things that stand up, far to near ----------

interface Draw {
  c: HTMLCanvasElement;
  x: number;
  y: number;
  z: number;
  a: number;
}
const pool: Draw[] = [];
const order: Draw[] = [];
let used = 0;

function put(c: HTMLCanvasElement, x: number, y: number, z: number, a = 1): void {
  let d = pool[used];
  if (d) {
    d.c = c;
    d.x = x;
    d.y = y;
    d.z = z;
    d.a = a;
  } else {
    d = { c, x, y, z, a };
    pool.push(d);
  }
  used++;
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
const mems = new WeakMap<Building, Mem>();

function memOf(w: World, b: Building, i: number): Mem {
  let m = mems.get(b);
  if (m) return m;
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
  m = { face, readAt: -9, status: null, since: -1, held: null, ready: false, struck: false, puffAt: 0 };
  mems.set(b, m);
  return m;
}

/** What a thing is doing, read at most twice a second. */
export function reading(w: World, b: Building, i: number): Status | null {
  const m = memOf(w, b, i);
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
  const z = foot + S.cam.y;
  const a = ghost > 0 ? ghost : 1;
  const real = ghost === 0;
  const powered = !real || w.power[i] === 1;
  const mem = real ? memOf(w, b, i) : null;
  const st = real ? reading(w, b, i) : null;
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
          smoke(cx + 4 + S.cam.x, foot - 19 + S.cam.y, "#9a82a8");
        }
      }
      if (working && face === "saw" && mem && S.t > mem.puffAt) {
        mem.puffAt = S.t + 0.25;
        puff(cx + 3 + S.cam.x, foot - 8 + S.cam.y, 1, "#cbb894", 4);
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
        if (step === 2 && !mem.struck) burst(cx - 2 + S.cam.x, foot - 9 + S.cam.y, 3, [GOLD[2], CREAM], 22);
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
        puff(cx + lean + S.cam.x, foot + drop - 1 + S.cam.y, 1, "#93cfd0", 5);
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
          smoke(cx + 5 + S.cam.x, foot - 24 + S.cam.y, "#cdb6d8");
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
    const badge = st.state === "unpowered" ? art.bolt : art.bang;
    stand(badge, cx, top - 2 - Math.round(Math.abs(Math.sin(S.t * 4 + i)) * 2), z + 0.6);
  }
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

/** A sagging line between two points, with a glint running along it while power flows. */
function wire(g: Ctx, ax: number, ay: number, bx: number, by: number, flow: number): void {
  const len = Math.hypot(bx - ax, by - ay);
  const n = Math.max(2, Math.round(len / 1.2));
  const sag = Math.min(9, len * 0.07);
  const at = flow < 0 ? -1 : Math.floor(((S.t * 0.7 + hash(Math.round(ax), Math.round(ay), 9)) % 1) * n);
  for (let k = 0; k <= n; k++) {
    const u = k / n;
    const x = Math.round(ax + (bx - ax) * u);
    const y = Math.round(ay + (by - ay) * u + sag * 4 * u * (1 - u));
    R(g, x, y, 1, 1, Math.abs(k - at) < 2 ? GOLD[2] : "#2a1519");
  }
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

/** Whether a tool is one that the reach of power matters to. */
const wantsPower = (kind: Kind): boolean => KIND[kind].draw > 0 || KIND[kind].gives > 0 || kind === "pylon";

/** The whole yard as it is this moment, small. */
export function drawYard(art: Art, now: Moment): HTMLCanvasElement {
  const g = buf.g;
  const W = buf.c.width;
  const H = buf.c.height;
  const cx = Math.round(S.cam.x);
  const cy = Math.round(S.cam.y);
  const w = S.world;
  const { land } = w;
  const L: Layout = layout(w, S.rev);
  const gr = art.ground;
  used = 0;
  lit = 0;

  // ---------- the floor: the forest's everywhere, and the yard's own over it where the land is the yard's ----------
  g.fillStyle = BEYOND;
  g.fillRect(0, 0, W, H);
  blit(g, gr.wild, cx - gr.x, cy - gr.y, W, H, 0, 0);
  land.plots.forEach((plot, n) => {
    const clearing = S.clearing.get(plot.id);
    if (!L.owned[n] && !clearing) return;
    const px = plot.x * TILE;
    const py = plot.y * TILE;
    if (clearing) {
      // Bought a moment ago: the cleared ground opens out from the signpost.
      g.save();
      g.beginPath();
      g.arc(clearing.x - cx, clearing.y - cy, Math.max(1, (S.t - clearing.at) * 260), 0, Math.PI * 2);
      g.clip();
      blit(g, gr.owned, px - gr.x, py - gr.y, plot.w * TILE, plot.h * TILE, px - cx, py - cy);
      g.restore();
    } else blit(g, gr.owned, px - gr.x, py - gr.y, plot.w * TILE, plot.h * TILE, px - cx, py - cy);
  });

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

  // ---------- belts, lying flat, and what rides on them ----------
  const tier = w.rates.belt >= 2 ? 2 : w.rates.belt >= 1.5 ? 1 : 0;
  const along = w.rates.belt / TICKS.belt;
  const step = Math.floor((w.tick + now.lead) * along * TILE) % STEPS;
  for (let ty = ty0; ty <= ty1; ty++)
    for (let tx = tx0; tx <= tx1; tx++) {
      const i = ty * land.w + tx;
      const arms = L.arms[i];
      const b = w.cells[i];
      if (!arms || !b) continue;
      g.drawImage(beltTile(arms, b.dir, step, tier), tx * TILE - cx, ty * TILE - cy);
    }
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
        const [rx, ry] = ride(from, to, prog);
        const pic = art.item(b.item);
        g.drawImage(pic, x + Math.round(rx) - (pic.width >> 1), y + Math.round(ry) - (pic.height >> 1) - 1);
      }
      // A belt whose load has nowhere to go says so, like any machine.
      if (b.item !== null && b.prog >= 1) {
        const st = reading(w, b, i);
        const m = mems.get(b);
        if (st?.trouble && m && m.since >= 0 && S.t - m.since > 1.5)
          stand(art.bang, x + 8, y - 4 - Math.round(Math.abs(Math.sin(S.t * 4 + i)) * 2), (ty + 1) * TILE + 0.6);
      }
      if (b.kind === "splitter") {
        // An arrowhead on each way out that leads somewhere.
        [b.dir, LEFT[b.dir], RIGHT[b.dir]].forEach((d, k) => {
          const head = art.m.heads[k]?.[b.dir];
          if (head && arms[d] === 2) g.drawImage(head, x, y);
        });
        const v = art.m.vane[sendWay(b, arms)];
        if (v && b.item === null) g.drawImage(v, x + 5, y + 5);
      } else if (b.kind === "joiner") {
        const top = art.m.joiner[b.dir];
        if (top) g.drawImage(top, x, y);
      }
    }

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
    w.board.forEach((o, n) => {
      put(
        isFilled(o.want, o.filled) ? done : paper,
        dl + 1 + DEPOT.board.x + 1 + n * 3,
        dt + 1 + DEPOT.board.y + 2,
        dz + 0.1,
      );
    });
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
  light(L.gate.x - 6, L.gate.y - 14, 26, 0.75);
  for (const sign of L.signs) stand(art.sign(sign.plot.price), sign.x - cx, sign.y - cy, sign.y);

  // Undergrowth over land that is not the yard's, falling away where a plot has just been bought.
  land.plots.forEach((plot, n) => {
    const clearing = S.clearing.get(plot.id);
    if (L.owned[n] && !clearing) return;
    const px = plot.x * TILE - cx;
    const py = plot.y * TILE - cy;
    if (px > W + 20 || py > H + 20 || px + plot.w * TILE < -20 || py + plot.h * TILE < -20) return;
    for (const u of art.under[n] ?? []) {
      const x = u.x - cx;
      const y = u.y - cy;
      if (x < -14 || x > W + 14 || y < -2 || y > H + 16) continue;
      if (clearing && Math.hypot(u.x - clearing.x, u.y - clearing.y) < (S.t - clearing.at) * 260) continue;
      const s = art.growth[u.pic];
      if (s) stand(s, x, y, u.y);
    }
  });

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

  order.length = used;
  for (let k = 0; k < used; k++) {
    const d = pool[k];
    if (d) order[k] = d;
  }
  order.sort((p, q) => p.z - q.z);
  for (const d of order) {
    if (d.a !== 1) g.globalAlpha = d.a;
    g.drawImage(d.c, d.x, d.y);
    if (d.a !== 1) g.globalAlpha = 1;
  }

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

  g.globalAlpha = 0.6;
  for (const l of L.wires) wire(g, l.a.x - cx, l.a.y - cy, l.b.x - cx, l.b.y - cy, now.pace);
  g.globalAlpha = 1;

  for (const b of bits) {
    if (b.glow) continue;
    g.globalAlpha = clamp((b.ttl - b.life) / (b.ttl * 0.4), 0, 1);
    R(g, Math.round(b.x) - cx, Math.round(b.y) - cy, b.size, b.size, b.col);
  }
  g.globalAlpha = 1;

  // ---------- dusk, and the light cut out of it ----------
  const d = dusk.g;
  d.globalCompositeOperation = "source-over";
  d.globalAlpha = 1;
  d.clearRect(0, 0, W, H);
  d.fillStyle = "rgba(32,14,50,0.5)";
  d.fillRect(0, 0, W, H);
  d.globalCompositeOperation = "destination-out";
  for (let k = 0; k < lit; k++) {
    const l = lights[k];
    if (!l || l.x + l.r < 0 || l.x - l.r > W || l.y + l.r < 0 || l.y - l.r > H) continue;
    d.globalAlpha = clamp(l.power * (l.reach ? 0.9 : 0.93 + 0.07 * Math.sin(S.t * 6 + l.x)), 0, 1);
    d.drawImage(l.reach ? REACHED : HOLE, l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
  }
  d.globalAlpha = 1;
  g.drawImage(dusk.c, 0, 0);
  g.globalCompositeOperation = "lighter";
  for (let k = 0; k < lit; k++) {
    const l = lights[k];
    if (!l || l.reach || l.x + l.r < 0 || l.x - l.r > W || l.y + l.r < 0 || l.y - l.r > H) continue;
    g.globalAlpha = clamp(0.14 * l.power, 0, 0.5);
    g.drawImage(WARM, l.x - l.r * 0.9, l.y - l.r * 0.9, l.r * 1.8, l.r * 1.8);
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

  // ---------- what is being pointed at, and what is about to be built ----------
  const tool = S.tool;
  if (tool !== null && tool !== "remove" && wantsPower(tool)) {
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
    else if (!S.run) {
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
        const p = pool[k];
        if (!p) continue;
        g.globalAlpha = p.a;
        g.drawImage(p.c, p.x, p.y);
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
  return buf.c;
}

/** The way a splitter sends its next thing: the first, from the one whose turn it is, that leads somewhere. */
function sendWay(b: Building, arms: Arms): Dir {
  const ways = [b.dir, LEFT[b.dir], RIGHT[b.dir]] as const;
  for (let k = 0; k < 3; k++) {
    const d = ways[(b.turn + k) % 3] ?? b.dir;
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

// ---------- words, in the guild's font, over the enlarged picture ----------

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

/** The words over the yard. `clear` is how far down the interface covers the top of the screen, in the canvas's pixels. */
export function drawWords(ctx: Ctx, px: number, clear: number): void {
  const z = S.view.z;
  const cx = Math.round(S.cam.x);
  const cy = Math.round(S.cam.y);
  const wide = ctx.canvas.width;

  for (const a of walkers) {
    if (!a.say) continue;
    const hx = Math.round((a.x - cx) * z);
    const hy = Math.round((a.y - cy - 18 - (a.carrying ? 7 : 0)) * z);
    const lines = wrap(ctx, a.say, 100 * px, px);
    const size = bubbleSize(ctx, lines, px);
    ctx.globalAlpha = clamp(a.sayFor / 0.25, 0, 1) * a.alpha;
    bubble(
      ctx,
      lines,
      clamp(hx - Math.round(size.w / 2), 2 * px, Math.max(2 * px, wide - size.w - 2 * px)),
      Math.max(2 * px, hy - size.h - 3 * px),
      px,
      hx,
    );
    ctx.globalAlpha = 1;
  }

  // Why the thing in hand cannot go where it is pointed.
  const why = S.run?.why ?? (S.run ? null : S.aim?.why);
  const where = S.run ? (S.run.legs.at(-1) ?? S.run.turns.at(-1) ?? S.aim) : S.aim;
  if (why && where && S.tool !== null && S.tool !== "remove")
    plate(ctx, why, (where.x * TILE + 8 - cx) * z, (where.y * TILE - 4 - cy) * z, px, "#f4a08c");

  // A nudge keeps quiet while the member is being told why something cannot go where they pointed.
  if (S.nudge && !(why && S.tool !== null)) {
    const hx = Math.round((S.nudge.x * TILE + 8 - cx) * z);
    const hy = Math.round((S.nudge.y * TILE - 6 - cy) * z);
    const lines = wrap(ctx, S.nudge.text, Math.min(130 * px, wide - 16 * px), px);
    const size = bubbleSize(ctx, lines, px);
    const bob = Math.round(Math.sin(S.t * 3)) * px;
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
  }

  for (const f of floaters) {
    const lines = wrap(ctx, f.text, wide - 12 * px, px, true);
    ctx.globalAlpha = clamp((f.ttl - f.life) / 0.4, 0, 1);
    lines.forEach((line, i) => {
      const half = Math.round(widthOf(ctx, line, px, true) / 2) + 2 * px;
      const x = clamp(Math.round((f.x - cx) * z), half, Math.max(half, wide - half));
      const y = Math.round((f.y - cy) * z) + (i - lines.length) * 11 * px;
      write(ctx, line, x, y, { px, bold: true, colour: f.col, align: "center", edge: INK });
    });
  }
  ctx.globalAlpha = 1;
}

/** The tops of the pylons and the depot's bracket, for anything that wants to know where the lines run. */
export { pylonTop };
