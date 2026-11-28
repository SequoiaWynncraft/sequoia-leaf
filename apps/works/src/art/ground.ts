/**
 * The yard's floor, worked out a pixel at a time: as the yard keeps it (grass, packed earth round the
 * depot, the path to the gate) on the plots it owns and has cleared, and as the forest left it
 * elsewhere. What lies in the ground is the same in both, and so is the stream. Any box of it can
 * be painted on its own (`Ground.paint`), the same to the pixel as the whole would be, so the screen
 * paints it a chunk at a time (`floor.ts`).
 */

import type { Land } from "@sequoia-leaf/factory";
import { EARTH, GREEN, SKY, STONE, WATER } from "@sequoia-leaf/kit/palette.ts";
import { bitmap, type Pen, rgb } from "@sequoia-leaf/kit/pix.ts";
import { clamp, type Ctx, hash, makeCanvas, vnoise } from "@sequoia-leaf/kit/util.ts";

import { TILE } from "./belts.ts";
import { lie, LYING, patchOf, rawAt } from "./lying.ts";
import { nearFerns, trunkBox, trunkPixel } from "./nature.ts";
import { DEEP, PAL, tone } from "./pal.ts";

/** How far the picture runs past the map on each side, for the forest that rings the clearing. */
export const MARGIN = { l: 56, r: 56, t: 88, b: 56 } as const;

/** A box of the yard's pixels: its corner (the map's own corner is 0, 0) and its size. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The ground: the land and the forest round it, as far as `x`, `y`, `w`, `h` reach. */
export interface Ground extends Box {
  readonly land: Land;
  /**
   * Paints a box of the ground on `g`, the box's corner at `g`'s (0, 0): the yard's own floor over
   * each plot `owned` says (by its place in the land's list), the forest's elsewhere, and past the
   * ground the colour beyond it. `g` must be a picture kept on the CPU, as large as the box.
   */
  paint(g: Ctx, box: Box, owned: (plot: number) => boolean): void;
  /**
   * Paints a box as `paint` does, a small step at a time (a row of the floor's pixels, or one thing
   * drawn over them), the box done when the steps run out. Stopped part way (`return`), it leaves
   * `g` as it found it, but for what it painted.
   */
  painting(g: Ctx, box: Box, owned: (plot: number) => boolean): Generator<void, void, undefined>;
  /**
   * The floor's own colour at a pixel as the yard keeps it, under whatever is drawn over it (a rock,
   * a branch, a flower), worked out for that pixel alone; null past the ground.
   */
  colour(x: number, y: number): string | null;
}

/** Whether something holds at all four points `r` pixels out from a point. */
const ringed = (x: number, y: number, r: number, of: (ax: number, ay: number) => boolean): boolean =>
  of(x - r, y) && of(x + r, y) && of(x, y - r) && of(x, y + r);

/** By tile of a land: 1 where `on` is set on the tile or on any of the eight round it. */
function nearby(land: Land, on: Uint8Array): Uint8Array {
  const out = new Uint8Array(land.w * land.h);
  for (let ty = 0; ty < land.h; ty++)
    for (let tx = 0; tx < land.w; tx++) {
      if ((on[ty * land.w + tx] ?? 0) === 0) continue;
      for (let y = Math.max(0, ty - 1); y <= Math.min(land.h - 1, ty + 1); y++)
        for (let x = Math.max(0, tx - 1); x <= Math.min(land.w - 1, tx + 1); x++) out[y * land.w + x] = 1;
    }
  return out;
}

/**
 * Past this many pixels from the depot's middle (across, a third shorter), no pixel is the yard's
 * packed earth, nor at its edge: the earth reaches at most 79 pixels out, and its edge 1.6 more.
 */
const EARTH_REACH = 81;

/**
 * The stream and its banks at a pixel of a land, in it or out of it (`jx`, `jy` where its edge has
 * wandered to, `i` the tile there), or null for neither.
 */
function streamOf(land: Land): (x: number, y: number, jx: number, jy: number, i: number) => string | null {
  const tile = (x: number, y: number): number =>
    clamp(Math.floor(y / TILE), 0, land.h - 1) * land.w + clamp(Math.floor(x / TILE), 0, land.w - 1);
  // By tile: whether water is on it or any tile round it. Every point the banks look at is within a tile of the pixel.
  const wetNear = nearby(land, land.water);
  const wet = (x: number, y: number): boolean => land.water[tile(x, y)] === 1;
  const dry = (x: number, y: number): boolean => land.water[tile(x, y)] !== 1;
  return (x, y, jx, jy, i) => {
    if (wetNear[i] !== 1) return null;
    if (land.water[i] === 1) return waterAt(land.ford[tile(x, y)] === 1, x, y, jx, jy, wet);
    if (!ringed(jx, jy, 3, dry)) {
      const peb = hash(x >> 1, y >> 1, 53);
      return peb > 0.9 ? STONE[2] : peb > 0.8 ? STONE[1] : EARTH[2];
    }
    return ringed(jx, jy, 5, dry) ? null : EARTH[0];
  };
}

/** The yard's packed earth at a pixel `td` inside its edge (below 0): its rim, a stone, a dark speck, or one of two browns. */
function packedEarth(x: number, y: number, td: number): string {
  if (td > -2.2) return EARTH[0];
  if (hash(x >> 1, y, 43) > 0.994) return STONE[1];
  if (hash(x, y >> 1, 44) > 0.985) return EARTH[0];
  return vnoise(x / 15, y / 8, 41) > 0.62 ? EARTH[2] : EARTH[1];
}

/** How far a pixel is outside the yard's packed earth round the depot and the path from its door down to the gate (below 0 inside). */
function earthOf(land: Land): (x: number, y: number) => number {
  const cxp = (land.depot[0] + 0.5) * TILE;
  const cyp = (land.depot[1] + 0.5) * TILE;
  // The path wanders and widens by the row alone.
  const row = { y: Number.NaN, wander: 0, wide: 0 };
  const path = (x: number, y: number): number => {
    if (y <= cyp) return 99;
    if (row.y !== y) {
      row.y = y;
      row.wander = (vnoise(3, y / 30, 6) - 0.5) * 8;
      row.wide = 6 + vnoise(5, y / 14, 6) * 4;
    }
    return Math.abs(x - cxp + row.wander) - row.wide;
  };
  const yard = (x: number, y: number): number => {
    const ax = (x - cxp) / 1.35;
    const ay = y - cyp;
    if (ax * ax + ay * ay > EARTH_REACH * EARTH_REACH) return 99;
    return Math.hypot(ax, ay) - (62 + (vnoise(x / 24, y / 24, 5) - 0.5) * 34);
  };
  return (x, y) => Math.min(yard(x, y), path(x, y));
}

/**
 * The colour of the floor at a pixel of the yard, as the yard keeps it or, `wild`, as the forest
 * left it. Painted a pixel at a time for every patch of the screen, so what cannot change the
 * colour is not worked out: the soft edge of a patch of ground with nothing near it, the edge of the
 * map far from it, the yard's earth far from the depot; and what is the same for a whole row is
 * worked out once for it.
 */
export function floorOf(land: Land): (x: number, y: number, wild: boolean) => string {
  const mw = land.w * TILE;
  const mh = land.h * TILE;
  const dep = new Uint8Array(land.w * land.h);
  for (let i = 0; i < dep.length; i++) {
    const raw = rawAt(land, i);
    dep[i] = raw ? LYING.indexOf(raw) + 1 : 0;
  }
  const tile = (x: number, y: number): number =>
    clamp(Math.floor(y / TILE), 0, land.h - 1) * land.w + clamp(Math.floor(x / TILE), 0, land.w - 1);
  // By tile: whether something lies in the ground on it or any tile round it, as far as its patch reaches.
  const depNear = nearby(land, dep);
  const stream = streamOf(land);
  const earth = earthOf(land);

  return (x, y, wild) => {
    // Beyond the map: the forest floor, darker the further out.
    if (x < 0 || y < 0 || x >= mw || y >= mh) return tone(DEEP, vnoise(x / 12, y / 9, 72) * 2.4);
    // Nothing in the ground keeps to the grid: every edge wanders a few pixels.
    const jx = x + (vnoise(x / 6, y / 6, 21) - 0.5) * 7;
    const jy = y + (vnoise(x / 6, y / 6, 22) - 0.5) * 7;
    const i = tile(jx, jy);

    const bank = stream(x, y, jx, jy, i);
    if (bank) return bank;

    // What lies in the ground makes a soft-edged patch round every tile that holds it.
    let d = 0;
    let near = 99;
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (depNear[ty * land.w + tx] === 1)
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          if (tx + ox < 0 || ty + oy < 0 || tx + ox >= land.w || ty + oy >= land.h) continue;
          const k = dep[(ty + oy) * land.w + tx + ox] ?? 0;
          if (k === 0) continue;
          const far = Math.hypot(x - (tx + ox + 0.5) * TILE, y - (ty + oy + 0.5) * TILE);
          if (far < near) {
            near = far;
            d = k;
          }
        }
    const reach = d > 0 ? 12.5 + (vnoise(x / 5, y / 5, 23) - 0.5) * 6 : 0;
    if (d > 0 && near < reach) {
      const rim = near > reach - 1.5;
      const f = hash(x, y, 30 + d);
      const g2 = hash(x >> 1, y >> 1, 40 + d);
      return patchOf(d, rim, f, g2, x, y, jy);
    }

    if (wild) {
      // Uncleared forest floor: dark, with a little green coming through.
      const n = vnoise(x / 22, y / 16, 7);
      if (hash(x, y, 8) > 0.975) return GREEN[1];
      return n > 0.62 ? GREEN[0] : n < 0.3 ? DEEP[1] : DEEP[2];
    }

    // The packed earth of the yard round the depot, and the path from its door down to the gate.
    const td = earth(x, y);
    if (td < 0) return packedEarth(x, y, td);

    // Grass, as in the town: one green with lighter and darker drifts across it, and tufts.
    const n = vnoise(x / 34, y / 13, 3);
    let idx = n > 0.7 ? 3 : n < 0.27 ? 1 : 2;
    // Darker along the map's edge, as much as 34 pixels in.
    const edge = Math.min(x, mw - x, y, mh - y);
    if (edge < 34 && edge < 4 + vnoise(x / 26, y / 20, 8) * 30) idx -= 1;
    if (td < 1.6) idx -= 1;
    idx = clamp(idx, 0, 3);
    const gx = Math.floor(x / 13);
    const gy = Math.floor(y / 9);
    if (hash(gx, gy, 31) > 0.62) {
      const dx = x - (gx * 13 + 1 + Math.floor(hash(gx, gy, 32) * 9));
      const dy = y - (gy * 9 + 3 + Math.floor(hash(gx, gy, 33) * 5));
      if ((dx === 0 && dy === 0) || (dx === 2 && dy === 0)) return tone(GREEN, idx - 1);
      if (dx === 1 && dy === -1) return tone(GREEN, idx + 1);
    }
    return tone(GREEN, idx);
  };
}

const FLOWERS = [
  ["..p..", ".pyp.", "..p..", "..G..", ".GG..", "..G.."],
  ["..w..", ".wyw.", "..w..", "..G..", "..GG.", "..G.."],
  [".y.y.", "..r..", ".y.y.", "..G..", ".GG..", "..G.."],
];

/** The tiles whose drawings over the floor can reach into a box: two more round it each way than it covers. */
interface Tiles {
  readonly tx0: number;
  readonly ty0: number;
  readonly tx1: number;
  readonly ty1: number;
}
const tilesUnder = (land: Land, b: Box): Tiles => ({
  tx0: Math.max(0, Math.floor(b.x / TILE) - 2),
  ty0: Math.max(0, Math.floor(b.y / TILE) - 2),
  tx1: Math.min(land.w - 1, Math.floor((b.x + b.w) / TILE) + 2),
  ty1: Math.min(land.h - 1, Math.floor((b.y + b.h) / TILE) + 2),
});

/** What lies in the ground, drawn over the floor: branches, rocks, banks and stumps, none of them in ranks (`lying.ts`). */
function* deposits(g: Ctx, land: Land, t: Tiles): Generator<void, void, undefined> {
  for (let ty = t.ty0; ty <= t.ty1; ty++, yield)
    for (let tx = t.tx0; tx <= t.tx1; tx++) {
      const d = rawAt(land, ty * land.w + tx);
      if (d) lie(g, d, tx, ty);
    }
}

/** One of the great trunks that ring the clearing: how it is drawn (`trunk`), and the box it takes in the yard. */
interface Trunk extends Box {
  readonly hw: number;
  readonly seed: number;
  readonly dim: number;
}

/** The trunks painted last, newest last: one stands over two or three patches, painted one after another. */
const TRUNKS_KEPT = 8;
const kept = new Map<Trunk, HTMLCanvasElement>();
/** A trunk's picture (`trunk`), painted a few rows a step unless it was painted a moment ago. */
function* trunkOf(t: Trunk): Generator<void, HTMLCanvasElement, undefined> {
  let c = kept.get(t);
  if (c) kept.delete(t);
  else c = yield* painted(t.w, t.h, trunkPixel(t.hw, t.h, t.seed, t.dim));
  kept.set(t, c);
  for (const old of kept.keys()) if (kept.size > TRUNKS_KEPT) kept.delete(old);
  return c;
}

/** A picture painted a pixel at a time, exactly as the kit's `paint` paints it, eight rows a step. */
function* painted(
  w: number,
  h: number,
  at: (x: number, y: number) => string | null,
): Generator<void, HTMLCanvasElement, undefined> {
  const { c, g } = makeCanvas(w, h);
  const img = g.createImageData(w, h);
  const px = new Uint32Array(img.data.buffer);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const col = at(x, y);
      if (col !== null) px[y * w + x] = pack(col);
    }
    if (y % 8 === 7) yield;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Where the great trunks that ring the clearing stand, in the order they are drawn. */
function trunks(land: Land): Trunk[] {
  const mw = land.w * TILE;
  const mh = land.h * TILE;
  const out: Trunk[] = [];
  const stand = (hw: number, height: number, seed: number, dim: number, footX: number, footY: number): void => {
    const b = trunkBox(hw, height);
    out.push({ hw, seed, dim, x: footX - b.ax, y: footY - b.ay, w: b.w, h: b.h });
  };
  // The far side: a rank of trunks with their feet just beyond the map, rising out of the picture.
  for (let x = -30, k = 0; x < mw + 40; k++) {
    const hw = 16 + Math.floor(hash(k, 1, 95) * 14);
    stand(hw, 120, 3 + k * 1.7, 84, x, -4 - Math.floor(hash(k, 2, 95) * 14));
    x += hw * 2 + 18 + Math.floor(hash(k, 3, 95) * 40);
  }
  // Either side: trunks standing one behind another down the edge.
  for (const side of [0, 1])
    for (let y = 70, k = 0; y < mh + 40; k++) {
      const hw = 15 + Math.floor(hash(k, 4 + side, 96) * 6);
      const cx = side === 0 ? -27 - Math.floor(hash(k, 6, 96) * 6) : mw + 27 + Math.floor(hash(k, 7, 96) * 6);
      stand(hw, 230, 11 + k * 2.3 + side * 5, 150, cx, y);
      y += 96 + Math.floor(hash(k, 8 + side, 96) * 50);
    }
  return out;
}

const meets = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The great trunks that ring the clearing and the dark ferns along its near edge, as much of them as reaches into a box. */
function* forest(g: Ctx, gr: Ground, ranks: readonly Trunk[], b: Box): Generator<void, void, undefined> {
  for (const t of ranks) {
    if (!meets(t, b)) continue;
    g.drawImage(yield* trunkOf(t), t.x, t.y);
    yield;
  }
  const ferns: Box = { x: gr.x, y: gr.land.h * TILE - 12, w: gr.w, h: 70 };
  if (!meets(ferns, b)) return;
  const from = Math.max(b.x, ferns.x) - ferns.x;
  const wide = Math.min(b.x + b.w, ferns.x + ferns.w) - ferns.x - from;
  g.drawImage(yield* nearFerns(ferns.w, ferns.h, from, wide), ferns.x + from, ferns.y);
}

const FLOWER_PICS: HTMLCanvasElement[] = [];
/** Small flowers in the grass, where nothing lies in the ground: drawn on all of it, and shown only on the yard's own land. */
function flowers(g: Ctx, land: Land, t: Tiles): void {
  if (FLOWER_PICS.length === 0) FLOWER_PICS.push(...FLOWERS.map((rows) => bitmap(rows, PAL)));
  for (let ty = t.ty0; ty <= t.ty1; ty++)
    for (let tx = t.tx0; tx <= t.tx1; tx++) {
      const i = ty * land.w + tx;
      if (rawAt(land, i) || land.water[i] || (land.tree[i] ?? -1) >= 0 || hash(tx, ty, 97) < 0.86) continue;
      if (Math.hypot(tx - land.depot[0], ty - land.depot[1]) < 6) continue;
      const pic = FLOWER_PICS[Math.floor(hash(tx, ty, 98) * FLOWER_PICS.length)];
      if (pic) g.drawImage(pic, tx * TILE + 3 + Math.floor(hash(tx, ty, 99) * 8), ty * TILE + 5);
    }
}

/** A colour as the four bytes of a pixel, read as one number: red first in memory, and opaque. */
const packed = new Map<string, number>();
export function pack(col: string): number {
  let n = packed.get(col);
  if (n === undefined) {
    const [r, g, b] = rgb(col);
    n = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
    packed.set(col, n);
  }
  return n;
}

/** The floor's pixels of a box, a row at a time, before anything is drawn over them: the yard's or the forest's by plot, and beyond the ground its colour. */
function* floorPixels(
  g: Ctx,
  gr: Ground,
  at: ReturnType<typeof floorOf>,
  b: Box,
  owned: (plot: number) => boolean,
): Generator<void, void, undefined> {
  const { land } = gr;
  const img = g.createImageData(b.w, b.h);
  const px = new Uint32Array(img.data.buffer);
  const mw = land.w * TILE;
  const mh = land.h * TILE;
  const beyond = pack(BEYOND);
  // The last colour packed: neighbouring pixels are mostly the same colour.
  let col: string = BEYOND;
  let n = beyond;
  for (let row = 0; row < b.h; row++, yield) {
    const y = b.y + row;
    const inY = y >= gr.y && y < gr.y + gr.h;
    const ty = Math.floor(y / TILE);
    for (let k = 0; k < b.w; k++) {
      const x = b.x + k;
      if (!inY || x < gr.x || x >= gr.x + gr.w) {
        px[row * b.w + k] = beyond;
        continue;
      }
      // Off the map both floors are the forest's; on it, whose the plot under the pixel is says which.
      const onMap = x >= 0 && y >= 0 && x < mw && y < mh;
      const c = at(x, y, onMap && !owned(land.plot[ty * land.w + Math.floor(x / TILE)] ?? -1));
      if (c !== col) {
        col = c;
        n = pack(c);
      }
      px[row * b.w + k] = n;
    }
  }
  g.putImageData(img, 0, 0);
}

/** Everything drawn over the floor's pixels in a box, a thing (or a row of tiles) at a time. */
function* over(
  g: Ctx,
  gr: Ground,
  ranks: readonly Trunk[],
  b: Box,
  owned: (plot: number) => boolean,
): Generator<void, void, undefined> {
  const { land } = gr;
  const t = tilesUnder(land, b);
  g.save();
  try {
    g.translate(-b.x, -b.y);
    g.beginPath();
    g.rect(gr.x, gr.y, gr.w, gr.h);
    g.clip();
    // The flowers show on the yard's own plots only.
    g.save();
    g.beginPath();
    land.plots.forEach((plot, n) => {
      if (owned(n)) g.rect(plot.x * TILE, plot.y * TILE, plot.w * TILE, plot.h * TILE);
    });
    g.clip();
    flowers(g, land, t);
    g.restore();
    yield;
    yield* deposits(g, land, t);
    yield* forest(g, gr, ranks, b);
  } finally {
    g.restore();
  }
}

/** The ground of a land, to be painted a box at a time. */
export function makeGround(land: Land): Ground {
  const at = floorOf(land);
  const ranks = trunks(land);
  const gr: Ground = {
    land,
    x: -MARGIN.l,
    y: -MARGIN.t,
    w: land.w * TILE + MARGIN.l + MARGIN.r,
    h: land.h * TILE + MARGIN.t + MARGIN.b,
    *painting(g, b, owned) {
      yield* floorPixels(g, gr, at, b, owned);
      yield* over(g, gr, ranks, b, owned);
    },
    colour(x, y) {
      return x < gr.x || y < gr.y || x >= gr.x + gr.w || y >= gr.y + gr.h ? null : at(x, y, false);
    },
    paint(g, b, owned) {
      // Every step at once.
      Array.from(gr.painting(g, b, owned));
    },
  };
  return gr;
}

/** A patch of water's glints for one moment: a few short bright dashes that drift with the stream. */
export function glint(g: Pen, land: Land, tx: number, ty: number, sx: number, sy: number, t: number): void {
  if (land.water[ty * land.w + tx] !== 1) return;
  const k = hash(tx, ty, 54);
  const phase = (t * 0.35 + k * 7) % 1;
  if (k < 0.45 || phase > 0.6) return;
  const x = sx + 2 + Math.floor(hash(tx, ty, 55) * 9);
  const y = sy + 2 + Math.floor(((k * 31 + t * 5) % 1) * 12);
  g.rect(x, y, phase < 0.3 ? 3 : 2, 1, phase < 0.15 ? WATER[3] : WATER[2]);
}

/** A pixel of the stream: deep in the middle, lighter at its banks, a stepping stone where it is forded. */
function waterAt(
  forded: boolean,
  x: number,
  y: number,
  jx: number,
  jy: number,
  wet: (x: number, y: number) => boolean,
): string {
  const stone = forded ? steppingStone(x & 15, y & 15) : null;
  if (stone) return stone;
  if (!ringed(jx, jy, 3, wet)) return WATER[2];
  if (!ringed(jx, jy, 8, wet)) return WATER[1];
  return (y & 3) === 0 && hash(x >> 2, y, 52) > 0.86 ? WATER[1] : WATER[0];
}

/** Three flat stones across a forded tile, corner to corner, each lit on its top left and dark on its foot: a pixel of one, or null. */
function steppingStone(x: number, y: number): string | null {
  for (const [cx, cy] of [
    [3, 4],
    [8, 8],
    [13, 12],
  ] as const) {
    const dx = x - cx;
    const dy = y - cy;
    if (dx * dx * 0.6 + dy * dy > 4.5) continue;
    if (dy >= 1.5) return STONE[0];
    return dx + dy <= -2 ? STONE[2] : STONE[1];
  }
  return null;
}

/** The colour the view is cleared to before the floor is drawn. */
export const BEYOND = DEEP[0];
export const SHADE = SKY[0];
