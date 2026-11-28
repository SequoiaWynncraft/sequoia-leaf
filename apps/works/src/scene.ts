/**
 * Drawing a frame of the yard. Like the town it is drawn small, one art pixel to a pixel, with
 * dusk laid over it and the lamps and fires cutting holes in the dusk. The page shows that small
 * picture itself and its styles enlarge it by a whole number; the words are written in the guild's
 * font on a canvas of their own over it.
 *
 * The lamplight is also the yard's power: the depot's lamps and every joined pylon's light the
 * ground exactly as far as power reaches, and dim together when the yard is short of it.
 *
 * The graphics card draws it (`@sequoia-leaf/kit/painter.ts`): the art is what the painters draw on
 * canvases, copied to the card the first time each picture is drawn, and every frame is drawn whole,
 * a layer at a time, from what is in view. The ground is kept on the card, painted before it can be
 * seen (`floor.ts`), and the pieces in hand are drawn once for each place they are aimed; nothing
 * else is kept between frames.
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
  REACH,
  REACHES,
  SHUTS,
  STATES,
  tilesOf,
  TROUBLE,
  type Yard,
} from "@sequoia-leaf/factory";
import { type Layer, Painter } from "@sequoia-leaf/kit/painter.ts";
import { CORAL, CREAM, GOLD, INK, SKY } from "@sequoia-leaf/kit/palette.ts";
import type { Scope } from "@sequoia-leaf/kit/scope.ts";
import { bubble, bubbleSize, wrap } from "@sequoia-leaf/kit/signs.ts";
import { widthOf, write } from "@sequoia-leaf/kit/text.ts";
import { clamp, type Ctx, makeCanvas, type Pt } from "@sequoia-leaf/kit/util.ts";

import { walkers } from "./actors.ts";
import { beltTile, marksOf, PAINTS, ride, STEPS, TILE, woodOf } from "./art/belts.ts";
import { BEYOND, type Box, glint, type Ground } from "./art/ground.ts";
import type { Art } from "./art/index.ts";
import { DEPOT as DEPOT_ART, lookOf } from "./art/machines.ts";
import type { Sprite } from "./art/pal.ts";
import { depotOf } from "./art/spark.ts";
import { aimBox, boxIn, drawnFrom, heldIn, markCovers, pointersOn } from "./big.ts";
import { drawPlan, drawPlanMarks, wipePlans } from "./far.ts";
import { Floor, type Hands, handsNow } from "./floor.ts";
import { bits, floaters, rings } from "./fx.ts";
import { onGround } from "./haze.ts";
import { heldBox, heldMarks } from "./held.ts";
import { straight } from "./kinds/carrier.ts";
import { pageOf } from "./kinds/index.ts";
import type { Drawn, KindPage } from "./kinds/kind.ts";
import { lampsIn } from "./lamps.ts";
import { armsAt, asIf, type Layout, layout, pylonTop } from "./layout.ts";
import { boxCorners, corners, dashes, pixelRing } from "./marks.ts";
import { eachPerson } from "./people.ts";
import { pinMark } from "./pinned.ts";
import { builds, draws, type Group, handGrade, type Mark, S, seenFrom, standsOn, tileNudge } from "./state.ts";
import { cameFrom, dirAt, hooded } from "./tiles.ts";
import { eachTrunk } from "./trees.ts";
import { Wires } from "./wires.ts";

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

/**
 * The picture. The page shows this canvas itself, and no bigger than the ground and the light that
 * falls past it; the graphics card draws on it, once the page has opened it (`openPicture`).
 */
export const picture = document.createElement("canvas");
picture.id = "view";
/** What draws the picture: the painter, and the dusk and the pieces in hand as a layer each. */
interface Stage {
  readonly p: Painter;
  readonly dusk: Layer;
  readonly held: Layer;
}
const stage: { on: Stage | null } = { on: null };
/** Where the picture's corner is in the view, in the yard's pixels: the camera says (`camera.ts`). */
export const corner: Pt = { x: 0, y: 0 };
/** How many times a trouble mark is enlarged: more than once only when the view is zoomed far out. */
let markSize = 1;
/** Counts each time what is kept may have been emptied, so that it is all made again. */
let lost = 0;
/** The graphics card took back what it kept (the ground, a plan's picture, the pieces in hand), or the browser emptied the words. */
export const wipe = (): void => {
  lost++;
  wipePlans();
};

/**
 * Opens the picture on the graphics card; false where the browser has no WebGL2, and nothing can be
 * drawn. `sc` holds its listening for the card taking everything back, and giving it back.
 */
export function openPicture(sc: Scope): boolean {
  const p = Painter.open(picture, sc);
  if (!p) return false;
  p.restored(wipe);
  stage.on = { p, dusk: p.layer(), held: p.layer() };
  return true;
}

/** What the card holds for the picture, in bytes, and how its atlas stands, for a review page. */
export const cardHolds = (): Pick<Painter, "memory" | "atlas" | "sent"> | null => stage.on?.p ?? null;

/** Waits for the card to have drawn the frame, for whoever times one. */
export const settle = (): void => stage.on?.p.settle();

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
/** Dusk, as the layer the lamps are cut out of is cleared to: `rgba(32,14,50,0.5)`, each colour multiplied by how solid, in whole 255ths as a canvas keeps it. */
const DUSK = [16 / 255, 7 / 255, 25 / 255, 128 / 255] as const;
/** A pool of light `r` across each way from (`x`, `y`): the pool's picture enlarged, each pixel taking the pixel of it under its middle. */
const pool = (g: Painter, src: HTMLCanvasElement, x: number, y: number, r: number, a: number): void =>
  g.stretch(src, x - r, y - r, r * 2, r * 2, a);

/** The picture's size, and how many times a trouble mark is enlarged. */
export function sizeBuffers(w: number, h: number, marks: number): void {
  markSize = marks;
  if (picture.width !== w) picture.width = w;
  if (picture.height !== h) picture.height = h;
}

// ---------- things that stand up, far to near ----------

/** One thing to draw: where its corner is in the yard's pixels, how near it stands, how faint it is, and how many times enlarged. */
interface Draw {
  c: HTMLCanvasElement;
  x: number;
  y: number;
  z: number;
  a: number;
  k: number;
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
function put(c: HTMLCanvasElement, x: number, y: number, z: number, a = 1, k = 1): void {
  let d = listed[used];
  if (d) {
    d.c = c;
    d.x = x + camX;
    d.y = y + camY;
    d.z = z;
    d.a = a;
    d.k = k;
  } else {
    d = { c, x: x + camX, y: y + camY, z, a, k };
    listed.push(d);
  }
  used++;
}
const stand = (s: Sprite, x: number, y: number, z: number, a = 1, k = 1): void => {
  put(s.c, x - s.ax * k, y - s.ay * k, z, a, k);
};
const farToNear = (p: Draw, q: Draw): number => p.z - q.z;

/**
 * Draws everything listed from `from` on and takes it off the list: far to near (things as near as
 * each other in the order they were listed), or with `sorted` false just as listed.
 */
function drawListed(g: Painter, from: number, sorted = true): void {
  order.length = 0;
  for (let n = from; n < used; n++) {
    const d = listed[n];
    if (d) order.push(d);
  }
  if (sorted) order.sort(farToNear);
  for (const d of order) {
    if (d.k === 1) g.pic(d.c, d.x - camX, d.y - camY, d.a);
    else g.stretch(d.c, d.x - camX, d.y - camY, d.c.width * d.k, d.c.height * d.k, d.a);
  }
  used = from;
}

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
  heldIn(onTile, y, real ? holderOf(y, i) : -1);
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
  const { i, x, top, cx, z, a, real } = onTile;
  const pip = art.m.pips[onTile.grade - 2];
  if (pip) put(pip, x, top, z + 0.55, a);
  if (page.pointer) pointersOn(art, onTile, k, page.pointer === "holding", onTile.ghost > 0 || S.picked === i);
  if (!real) return;
  // Trouble that has lasted says so over the machine's head: but over one that shows where power does not reach in its own way.
  if (troubled(i) && !(page.sleeps && !onTile.powered)) {
    const badge = c % TROUBLE === UNPOWERED ? art.bolt : art.bang;
    stand(badge, cx, head - 2 - Math.round(Math.abs(Math.sin(S.t * 4 + i)) * 2), z + 0.6, 1, markSize);
  }
}

/** The lines between pylons (`wires.ts`). */
const wiring = new Wires();

// ---------- many pieces at once: the area marked, and the pieces in hand ----------

/**
 * The area marked with Select. Every piece in it is lit gold on its tile, with a gold line where
 * the marked pieces end, so they read as one shape however far out the view is; the area itself
 * is a line of dashes that march. While the pieces are in hand to be moved, the tiles they leave
 * are dimmed instead.
 */
function marked(g: Painter, w: Yard, m: Mark, cx: number, cy: number): void {
  const W = w.land.w;
  // Every tile of a piece of more than one, marked by its own; by tile too, to find the mark's edges.
  const { on, all } = markCovers(w, m.tiles);
  const leaving = S.group?.as === "move";
  g.blend(leaving ? "over" : "add");
  const glow = leaving ? "rgba(26,15,30,0.5)" : "rgba(255,176,64,1)";
  const solid = leaving ? 1 : 0.26 + 0.07 * Math.sin(S.t * 5);
  // Only where a piece still stands: one may have been taken away since.
  for (const i of all)
    if (w.kind[i] !== NONE) g.rect((i % W) * TILE - cx, Math.floor(i / W) * TILE - cy, TILE, TILE, glow, solid);
  g.blend("over");
  const edge = leaving ? GOLD[0] : GOLD[2];
  for (const i of all) {
    if (w.kind[i] === NONE) continue;
    const tx = i % W;
    const x = tx * TILE - cx;
    const y = Math.floor(i / W) * TILE - cy;
    if (on[i - W] !== 1) g.rect(x, y, TILE, 1, edge);
    if (on[i + W] !== 1) g.rect(x, y + TILE - 1, TILE, 1, edge);
    if (tx === 0 || on[i - 1] !== 1) g.rect(x, y, 1, TILE, edge);
    if (tx === W - 1 || on[i + 1] !== 1) g.rect(x + TILE - 1, y, 1, TILE, edge);
  }
  const [wide, high] = [(m.x1 - m.x0 + 1) * TILE + 3, (m.y1 - m.y0 + 1) * TILE + 3];
  dashes(g, m.x0 * TILE - cx - 2, m.y0 * TILE - cy - 2, wide, high, CREAM, Math.floor(S.t * 10));
}

/** The pieces in hand, drawn on their layer once for each place they are aimed at: `for` is the aim it was drawn for, of that yard at that count of its changes. */
const held: { for: Group["at"] | null; yard: Yard | null; rev: number; lost: number } = {
  for: null,
  yard: null,
  rev: -1,
  lost: -1,
};
/** Room in that picture round the box of tiles, for what stands taller or leans wider than its tile. */
const ROOM = { side: 8, top: 40, bottom: 8 } as const;

/**
 * Draws the pieces in hand where they are aimed, as they would stand (`asIf`, the yard with them
 * set down): belts joined to each other and to the lines already there, machines as built. Gold
 * lies over each piece that can go there and coral over each that cannot. They are drawn on a layer
 * of their own and that laid faint, so that one piece does not show through another; and afresh only
 * when the aim moves to another tile or the yard changes.
 */
function inHand(f: Frame, grp: Group): void {
  const { g, art, w, now, cx, cy } = f;
  const box = heldBox(w, grp);
  const wide = box.w * TILE + ROOM.side * 2;
  const high = box.h * TILE + ROOM.top + ROOM.bottom;
  if (held.for !== grp.at || held.yard !== w || held.rev !== w.rev || held.lost !== lost) {
    held.for = grp.at;
    held.yard = w;
    held.rev = w.rev;
    held.lost = lost;
    f.held.begin(wide, high);
    const ox = ROOM.side - box.x * TILE;
    const oy = ROOM.top - box.y * TILE;
    const mark = used;
    const before = lit;
    const yard = asIf(w, grp);
    for (const p of grp.at) {
      for (const i of tilesOf(yard, [p])) {
        // Each piece once, from its own tile: none for a tile off the map.
        if (!drawnFrom(yard, i)) continue;
        const x = (i % yard.land.w) * TILE + ox;
        const top = Math.floor(i / yard.land.w) * TILE + oy;
        const k = yard.kind[i] ?? NONE;
        const d = p.dir;
        const a = draws(k) ? armsAt(yard, i) : 0;
        const grade = yard.grade[i] ?? 0;
        if (a !== 0) g.pic(beltTile(a, d, 0, woodOf(grade), yard.tint[i] ?? 0, marksOf(grade)), x, top);
        const over = pageOf(k)?.top?.(art, yard, i, d, false);
        if (over) g.pic(over, x, top);
        const pip = over ? art.m.pips[grade - 2] : undefined;
        if (pip) g.pic(pip, x, top);
        piece(art, yard, i, k, d, grade, yard.span[i] ?? 0, p.open ?? true, x, top, now, 1);
      }
    }
    drawListed(g, mark);
    lit = before;
    // Gold over each piece that can go and coral over each that cannot; coral corners over what it takes up.
    heldMarks(g, w, grp, ox, oy);
    f.held.end();
  }
  g.from(f.held, 0, 0, wide, high, box.x * TILE - ROOM.side - cx, box.y * TILE - ROOM.top - cy, 0.88);
  const bad = grp.why.some((r) => r !== null);
  corners(g, box.x * TILE - cx, box.y * TILE - cy, box.w * TILE, box.h * TILE, bad ? CORAL : GOLD[2], true);
}

/** How many chunks of the floor are still to be painted, for a review page waiting for the land to be whole. */
export const floorWaiting = (): number | null => floored?.floor.waiting ?? null;

/** The floor on the screen (`floor.ts`): for the ground it was opened on, and the count of losses it last saw. */
let floored: { gr: Ground; floor: Floor; lost: number } | null = null;
function floorFor(gr: Ground, p: Painter): Floor {
  if (floored?.gr !== gr) floored = { gr, floor: new Floor(gr, p), lost };
  if (floored.lost !== lost) {
    floored.lost = lost;
    floored.floor.wipe();
  }
  return floored.floor;
}

/** The tiles in view whose piece lies flat with something over its belt (a splitter, a joiner, a sorter), found as the belts are drawn. */
const topped: number[] = [];
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
  readonly g: Painter;
  /** The layers the dusk and the pieces in hand are drawn on. */
  readonly dusk: Layer;
  readonly held: Layer;
  readonly floor: Floor;
  readonly W: number;
  readonly H: number;
  /** The picture's box of the yard: `cx`, `cy`, `W`, `H`. */
  readonly view: Box;
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
export function drawYard(art: Art, now: Moment): void {
  const on = stage.on;
  if (!on) return;
  const began = performance.now();
  const g = on.p;
  const W = picture.width;
  const H = picture.height;
  seenX = S.cam.x + corner.x;
  seenY = S.cam.y + corner.y;
  const cx = (camX = Math.round(S.cam.x) + corner.x);
  const cy = (camY = Math.round(S.cam.y) + corner.y);
  const w = S.world;
  const L: Layout = layout(w);
  const near = S.view.z >= 1;
  // Past the ground the picture is its colour; a plan is laid on nothing, and the page shows round it.
  if (!g.begin(near ? BEYOND : null)) return;
  const floor = floorFor(art.ground, g);
  const hands = handsNow(L, S.clearing);
  if (near) {
    if (w !== drawn) carry(w);
    const { land } = w;
    used = 0;
    lit = 0;
    const f: Frame = {
      art,
      now,
      g,
      dusk: on.dusk,
      held: on.held,
      floor,
      W,
      H,
      view: { x: cx, y: cy, w: W, h: H },
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
    floorLayer(f, hands);
    lap("floor");
    flatLayer(f);
    lap("belts");
    standingLayer(f);
    lap("standing");
    lampLayer(f);
    lap("dusk");
    marksLayer(f);
    lap("marks");
  } else {
    // Further out than a screen pixel for each of the yard's, the yard is its plan (`far.ts`), and
    // the dusk is not laid: its layer, as large as the picture was near, is let go of until then.
    on.dusk.release();
    const [dx, dy] = drawPlan(g, w, L, corner.x, corner.y);
    lap("plan");
    drawPlanMarks(g, w, dx, dy);
    lap("marks");
  }
  g.end();
  lap("card");
  // In what is left of the frame, the ground that is not painted yet: at the plan's zoom too, for when the view comes back in.
  floor.paintAhead(hands, { x: S.cam.x + S.view.w / 2, y: S.cam.y + S.view.h / 2 }, began);
  lap("painting");
}

/** The floor: the forest's everywhere, the yard's own over it where the land is the yard's, the stream's glints and the rings things land with. */
function floorLayer(f: Frame, hands: Hands): void {
  const { g, W, H, cx, cy, tx0, ty0, tx1, ty1, view } = f;
  const { land } = f.w;
  f.floor.lay(view, hands);
  // Bought a moment ago: the cleared ground opens out from the signpost, over the forest's floor.
  for (const n of hands.clearing) {
    const plot = land.plots[n];
    const at = plot && S.clearing.get(plot.plot);
    if (!at) continue;
    g.disc(at.x - cx, at.y - cy, Math.max(1, (S.t - at.at) * 260));
    f.floor.layClearing(view, n);
  }
  g.disc();

  // The trees' shade, and the smog: on the ground, under every belt, piece and redwood.
  onGround(g, f.art, f.w, cx, cy, W, H, S.t);
  for (let ty = ty0; ty <= ty1; ty++)
    for (let tx = tx0; tx <= tx1; tx++)
      if (land.water[ty * land.w + tx] === 1) glint(g, land, tx, ty, tx * TILE - cx, ty * TILE - cy, S.t);

  for (const r of rings) {
    const k = r.life / r.ttl;
    pixelRing(g, r.x - cx, r.y - cy, 2 + r.r * k, (2 + r.r * k) * 0.55, r.col, 1, 1 - k);
  }
}

/** What lies flat: every belt in view, what rides on them, the arrowheads, joiners' tops and sorters' boards over those, and each idle splitter's vane. */
function flatLayer(f: Frame): void {
  const { art, now, g, cx, cy, w, L, tx0, ty0, tx1, ty1, steps } = f;
  const { land } = w;
  const step = steps[1] ?? 0;
  let tops = 0;
  for (let ty = ty0; ty <= ty1; ty++)
    for (let tx = tx0; tx <= tx1; tx++) {
      const i = ty * land.w + tx;
      const a = L.arms[i] ?? 0;
      const k = w.kind[i] ?? NONE;
      if (a === 0 || k === NONE) continue;
      const grade = w.grade[i] ?? 0;
      // Its tile at this step of its grade's march.
      const tile = beltTile(a, dirAt(w, i), steps[grade] ?? step, woodOf(grade), w.tint[i] ?? 0, marksOf(grade));
      g.pic(tile, tx * TILE - cx, ty * TILE - cy);
      if (pageOf(k)?.top) topped[tops++] = i;
    }
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
      g.pic(pic, left, top);
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
          stand(
            art.bang,
            x + 8,
            y - 4 - Math.round(Math.abs(Math.sin(S.t * 4 + i)) * 2),
            (ty + 1) * TILE + 0.6,
            1,
            markSize,
          );
      }
    }
  // Over what is carried: the arrowheads, the joiners' tops and the sorters' boards (a splitter's, on
  // its ways that lead somewhere), and over each its grade's mark, as a belt wears it in its tile.
  for (let n = 0; n < tops; n++) {
    const i = topped[n] ?? 0;
    const x = (i % land.w) * TILE - cx;
    const y = Math.floor(i / land.w) * TILE - cy;
    const page = pageOf(w.kind[i] ?? NONE);
    const lay = (pic: HTMLCanvasElement | undefined): void => {
      if (pic) g.pic(pic, x, y);
    };
    if (page?.laid) page.laid(art, w, i, dirAt(w, i), L.arms[i] ?? 0, lay);
    else lay(page?.top?.(art, w, i, dirAt(w, i), false));
    lay(art.m.tilePips[(w.grade[i] ?? 0) - 2]);
  }
  for (let k = 0; k < laps; k++) {
    const over = lapping[k];
    if (over) g.part(over.pic, 0, 0, over.w, over.h, over.x, over.y);
  }
  // Then each idle splitter's vane, pointing where its next thing goes.
  for (let n = 0; n < tops; n++) {
    const i = topped[n] ?? 0;
    const v = w.item[i] === NONE ? pageOf(w.kind[i] ?? NONE)?.vane?.(art, w, i, L.arms[i] ?? 0) : undefined;
    if (v) g.pic(v, (i % land.w) * TILE - cx + 5, Math.floor(i / land.w) * TILE - cy + 5);
  }
}

/** Everything that stands up, far to near; then what hops into the depot, the lines between pylons and the bits that fly. */
function standingLayer(f: Frame): void {
  const { art, now, g, W, H, cx, cy, w, L, tx0, ty0, tx1, ty1 } = f;
  const { land } = w;
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
  const { depot: ds, fly: flies } = depotOf(art.m, w);
  const dl = dx - ds.ax;
  const dt = dfoot - ds.ay;
  if (dl < W && dl + ds.c.width > 0 && dt < H && dfoot > -8) {
    stand(ds, dx, dfoot, dz);
    const [paper, done] = art.notes;
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
    const fly = w.open.depot > DEPOT_FIRST ? flies[Math.floor(S.t * 8) % 4] : undefined;
    if (fly) put(fly, dl + DEPOT_ART.fly.x - 6, dt + DEPOT_ART.fly.y - 6, dz + 0.1);
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
  for (const sign of L.signs) stand(art.sign(sign.price), sign.x - cx, sign.y - cy, sign.y + 2);

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

  drawListed(g, 0);

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
    g.pic(
      h.pic,
      Math.round(h.x + h.dx * u * 7) - (h.pic.width >> 1) - cx,
      Math.round(h.y + h.dy * u * 7 - Math.sin(u * Math.PI) * 4) - (h.pic.height >> 1) - 1 - cy,
      1 - u * u,
    );
  }

  wiring.draw(g, f.view, L, corner);

  for (const b of bits) {
    if (b.glow) continue;
    const a = clamp((b.ttl - b.life) / (b.ttl * 0.4), 0, 1);
    g.rect(Math.round(b.x) - cx, Math.round(b.y) - cy, b.size, b.size, b.col, a);
  }
}

/** Every lamp and fire whose light reaches the picture (`lamps.ts`), wherever the pieces that hold them are. */
function lamps(f: Frame): void {
  const { w, L, cx, cy, W, H, now } = f;
  const working = (i: number): boolean => reading(w, i) % TROUBLE === WORKING;
  const kiln = (i: number): boolean => pageOf(w.kind[i] ?? NONE)?.fire?.(w, i, mem) ?? false;
  for (const l of lampsIn(w, L.gate, { x: cx, y: cy, w: W, h: H }, now.pace, working, kiln))
    light(l.x - cx, l.y - cy, l.r, l.power, l.reach);
}

/** Whether a light's pool reaches a picture of `W` by `H`. */
const shows = (l: Light, W: number, H: number): boolean =>
  l.x + l.r >= 0 && l.x - l.r <= W && l.y + l.r >= 0 && l.y - l.r <= H;

/** Dusk over everything, on a layer of its own with every lamp and fire cut out of it; their warm glow; then the bits that glow. */
function lampLayer(f: Frame): void {
  const { g, W, H, cx, cy } = f;
  lamps(f);
  f.dusk.begin(W, H, DUSK);
  g.blend("cut");
  for (let k = 0; k < lit; k++) {
    const l = lights[k];
    if (!l || !shows(l, W, H)) continue;
    // A fire flickers by where it is on the screen.
    const a = clamp(l.power * (l.reach ? 0.9 : 0.93 + 0.07 * Math.sin(S.t * 6 + l.x + corner.x)), 0, 1);
    pool(g, l.reach ? REACHED : HOLE, l.x, l.y, l.r, a);
  }
  g.blend("over");
  f.dusk.end();
  g.from(f.dusk, 0, 0, W, H, 0, 0);
  g.blend("add");
  for (let k = 0; k < lit; k++) {
    const l = lights[k];
    if (l && !l.reach && shows(l, W, H)) pool(g, WARM, l.x, l.y, l.r * 0.9, clamp(0.14 * l.power, 0, 0.5));
  }
  g.blend("over");

  for (const b of bits) {
    if (!b.glow) continue;
    const a = clamp((b.ttl - b.life) / (b.ttl * 0.5), 0, 1);
    g.stretch(SPARK, Math.round(b.x) - cx - 3, Math.round(b.y) - cy - 3, 7, 7, a * 0.3);
    g.rect(Math.round(b.x) - cx, Math.round(b.y) - cy, b.size, b.size, b.col, a);
  }
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
    const power = litOf(w);
    const on = (tx: number, ty: number): boolean =>
      tx >= 0 && ty >= 0 && tx < land.w && ty < land.h && power[ty * land.w + tx] === 1;
    for (let ty = ty0; ty <= ty1 + 1; ty++)
      for (let tx = tx0; tx <= tx1 + 1; tx++) {
        const here = on(tx, ty);
        if (here !== on(tx, ty - 1))
          for (let k = 0; k < TILE; k += 3) g.rect(tx * TILE - cx + k, ty * TILE - cy, 1, 1, GOLD[1]);
        if (here !== on(tx - 1, ty))
          for (let k = 0; k < TILE; k += 3) g.rect(tx * TILE - cx, ty * TILE - cy + k, 1, 1, GOLD[1]);
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
    for (const leg of S.run.legs) {
      const x = leg.x * TILE - cx;
      const y = leg.y * TILE - cy;
      if (!leg.tunnel)
        g.pic(
          beltTile(straight(leg.dir), leg.dir, steps[leg.grade] ?? step, woodOf(leg.grade), 0, marksOf(leg.grade)),
          x,
          y,
          0.8,
        );
      else {
        // Its far mouth comes up `span + 1` tiles ahead.
        const far = (leg.span + 1) * TILE;
        const near = art.m.hood[lookOf(leg.grade)]?.[leg.dir];
        const out = art.m.hood[lookOf(leg.grade)]?.[BACK[leg.dir]];
        if (near) g.pic(near.c, x + 8 - near.ax, y + TILE + 1 - near.ay, 0.8);
        if (out && leg.span > 0)
          g.pic(out.c, x + DX[leg.dir] * far + 8 - out.ax, y + DY[leg.dir] * far + TILE + 1 - out.ay, 0.8);
      }
    }
    for (const turn of S.run.turns) {
      const grade = w.grade[turn.y * land.w + turn.x] ?? 1;
      g.pic(
        beltTile(straight(turn.dir), turn.dir, steps[grade] ?? step, woodOf(grade), 0, marksOf(grade)),
        turn.x * TILE - cx,
        turn.y * TILE - cy,
        0.8,
      );
    }
    const last = S.run.legs.at(-1) ?? S.run.turns.at(-1);
    if (last) corners(g, last.x * TILE - cx, last.y * TILE - cy, TILE, TILE, bad ? CORAL : GOLD[2], true);
  }
  if (S.from && !S.run) corners(g, S.from.x * TILE - cx, S.from.y * TILE - cy, TILE, TILE, GOLD[2], true);
  if (S.aim && tool !== null) {
    const on = standsOn(S.aim);
    const x = on.x * TILE - cx;
    const y = on.y * TILE - cy;
    const bad = S.aim.why !== null;
    if (tool === "remove") boxCorners(g, aimBox(w, "remove", 0, on.x, on.y), cx, cy, CORAL);
    else if (tool === "paint") {
      // The brush shows its colour on what it would colour, and nothing elsewhere.
      if (!bad) corners(g, x, y, TILE, TILE, PAINTS[S.tint - 1]?.lit ?? CREAM, true);
    } else if (tool === "select") {
      if (S.group) inHand(f, S.group);
    } else if (!S.run) {
      const mark = used;
      // At the grade it would stand at: the one in hand, or the higher one of a piece of its kind it would only turn.
      const grade = S.aim.grade ?? handGrade();
      const page = pageOf(tool);
      if (page?.aimArms) {
        const a = page.aimArms(S.dir, S.right);
        g.pic(beltTile(a, S.dir, steps[grade] ?? step, woodOf(grade), 0, marksOf(grade)), x, y, 0.8);
        const top = page.top?.(art, null, -1, S.dir, S.right);
        if (top) g.pic(top, x, y, 0.8);
        const pip = top ? art.m.pips[grade - 2] : undefined;
        if (pip) g.pic(pip, x, y, 0.8);
      }
      piece(art, w, on.y * land.w + on.x, tool, S.dir, grade, 1, true, x, y, now, bad ? 0.5 : 0.8);
      const far = S.aim.far ?? -1;
      if (far >= 0) {
        const out = page?.far?.(art, grade, S.dir);
        const fx = far % land.w;
        const fy = (far - fx) / land.w;
        if (out) put(out.c, fx * TILE - cx + 8 - out.ax, fy * TILE - cy + TILE + 1 - out.ay, 0, 0.8);
      }
      drawListed(g, mark, false);
      const col = bad ? CORAL : GOLD[2];
      if (REACHES[tool] === 1) {
        const ring = ((REACH.pylon * w.open.reach) / 10_000) * TILE;
        pixelRing(g, x + 8, y + 8, ring, ring, col, 2);
      }
      boxCorners(g, aimBox(w, tool, S.dir, on.x, on.y), cx, cy, col);
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
