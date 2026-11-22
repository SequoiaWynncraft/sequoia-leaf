/**
 * Portraits. A member's 64x64 block-game skin sheet drawn as character art, entirely in code: the
 * skin's six boxes (head, body, two arms, two legs) with their outer layers (hat, jacket, sleeves,
 * trousers), seen a little from the side.
 *
 * Each box shows three faces. Its front is drawn square, `s` art pixels to a skin pixel. Its side
 * (the figure's left, to the right of the front as we look) is half as wide as the box is deep and
 * rises one art pixel for every two across. Its top sits above the front, as tall as the side
 * rises, and slides two across for every one up, so it meets the side. Light comes from the upper
 * left: tops are lighter, sides darker, and the head shades the chest and shoulders under it.
 *
 * The drawing works on plain pixel arrays (`draw`, `paintFigure`, `figure`), so it is tested
 * without a canvas; `portrait` is the same thing on a canvas.
 */

import { CREAM, INK } from "./palette.ts";
import { rgb } from "./pix.ts";
import { clamp, makeCanvas } from "./util.ts";

export type Pose = "stand" | "wave" | "cheer" | "sit" | "bust";
export const POSES: readonly Pose[] = ["stand", "wave", "cheer", "sit", "bust"];

/** A skin sheet as pixels: 64 wide, 64 rows of RGBA. `tall` is 32 for an old sheet, whose lower half is never read. */
export interface SheetPixels {
  data: Uint8ClampedArray;
  tall: number;
}

/** A picture as plain RGBA pixels, row after row. */
export interface Pixels {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

/** A rim of light along the figure's upper-left edges: those pixels mixed `amount` toward `colour`. */
export interface Rim {
  colour: string;
  amount: number;
}

/** A sheet read once: which of its layers and arms it has. */
export interface Skin {
  sheet: SheetPixels;
  /** Arms three skin pixels wide instead of four. */
  slim: boolean;
  /** Whether the hat layer is drawn: old sheets fill it with a solid block instead of leaving it clear. */
  hat: boolean;
  /** A 64x64 sheet: body and limbs have outer layers. */
  full: boolean;
  /** Whether the left arm and the left leg have pictures of their own; if not, they are the right ones mirrored. */
  ownArm: boolean;
  ownLeg: boolean;
}

const alphaAt = (sheet: SheetPixels, x: number, y: number): number => sheet.data[(y * 64 + x) * 4 + 3] ?? 0;

/** Whether anything at all is drawn in a part of the sheet. */
function drawnIn(sheet: SheetPixels, x0: number, y0: number, w: number, h: number): boolean {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (alphaAt(sheet, x, y) > 0) return true;
  return false;
}

/**
 * Reads what a sheet holds. The hat layer counts only when some of it is clear, as `skin.ts` decides.
 * Arms are slim when the strip a four-wide right arm would fill at the back (x 54-55, y 20-31) is clear,
 * unless `slim` says otherwise. A left arm or leg with nothing drawn for it (an old sheet, or one made
 * like one) is the right one mirrored.
 */
export function readSkin(sheet: SheetPixels, slim?: boolean): Skin {
  let clear = 0;
  for (let y = 0; y < 16; y++) for (let x = 32; x < 64; x++) if (alphaAt(sheet, x, y) < 255) clear++;
  const full = sheet.tall >= 64;
  const thin = full && !drawnIn(sheet, 54, 20, 2, 12);
  return {
    sheet,
    slim: slim ?? thin,
    hat: clear > 0,
    full,
    ownArm: full && drawnIn(sheet, 32, 48, 16, 16),
    ownLeg: full && drawnIn(sheet, 16, 48, 16, 16),
  };
}

// ---------- the boxes, and where their faces lie on the sheet ----------

export type PartId = "head" | "body" | "armR" | "armL" | "legR" | "legL";
/** A box's own faces, named as the sheet lays them out: `left` is the figure's left side, `right` its right. */
export type Face = "front" | "left" | "right" | "top" | "bottom";

interface Part {
  /** The base layer's corner on the sheet. */
  u: number;
  v: number;
  /** The outer layer's corner, or null when the sheet has none for this box. */
  outer: readonly [number, number] | null;
  w: number;
  h: number;
  d: number;
  /** An old sheet's left arm and leg: the right one's picture, mirrored. */
  mirror: boolean;
}

function partOf(skin: Skin, id: PartId): Part {
  const arm = skin.slim ? 3 : 4;
  const limb = (u: number, v: number, outer: readonly [number, number] | null, w: number, mirror = false): Part => ({
    u,
    v,
    outer: skin.full ? outer : null,
    w,
    h: 12,
    d: 4,
    mirror,
  });
  switch (id) {
    case "head":
      return { u: 0, v: 0, outer: skin.hat ? [32, 0] : null, w: 8, h: 8, d: 8, mirror: false };
    case "body":
      return { u: 16, v: 16, outer: skin.full ? [16, 32] : null, w: 8, h: 12, d: 4, mirror: false };
    case "armR":
      return limb(40, 16, [40, 32], arm);
    case "legR":
      return limb(0, 16, [0, 32], 4);
    case "armL":
      return skin.ownArm ? limb(32, 48, [48, 48], arm) : limb(40, 16, null, arm, true);
    case "legL":
      return skin.ownLeg ? limb(16, 48, [0, 48], 4) : limb(0, 16, null, 4, true);
  }
}

const cell = (v: number, n: number): number => clamp(Math.floor(v), 0, n - 1);

/**
 * The sheet pixel (as `y * 64 + x`) that a point on one of a box's faces shows, from the point's
 * place in the box in skin pixels: `lx` from its right side to its left, `ly` from the top down,
 * `lz` from the front back. Points just outside the box (an outer layer standing proud) take the
 * nearest pixel of the face.
 */
export function spotOn(p: Part, layer: 0 | 1, face: Face, lx: number, ly: number, lz: number): number {
  const { w, h, d } = p;
  let f = face;
  let x = lx;
  if (p.mirror) {
    x = w - lx;
    if (f === "left") f = "right";
    else if (f === "right") f = "left";
  }
  const col = cell(x, w);
  const row = cell(ly, h);
  const dep = cell(lz, d);
  let sx: number;
  let sy: number;
  switch (f) {
    case "front":
      [sx, sy] = [d + col, d + row];
      break;
    case "left":
      [sx, sy] = [d + w + dep, d + row];
      break;
    case "right":
      [sx, sy] = [d - 1 - dep, d + row];
      break;
    case "top":
      [sx, sy] = [d + col, d - 1 - dep];
      break;
    case "bottom":
      [sx, sy] = [d + w + col, d - 1 - dep];
      break;
  }
  const [u, v] = layer === 0 || !p.outer ? [p.u, p.v] : p.outer;
  return (v + sy) * 64 + u + sx;
}

// ---------- poses: where the boxes stand ----------

/**
 * How a box is turned. `up`: half a turn in the picture's plane, an arm raised straight up (its
 * hand on top, its inner side towards us). `forward`: a leg put out towards us, its sole to the
 * front and its front on top, as a thigh seen from above.
 */
type Turn = "none" | "up" | "forward";

interface Place {
  part: PartId;
  /** The box's corner nearest the top left and front, in skin pixels: x right, y down, z away from us. */
  x: number;
  y: number;
  z: number;
  turn: Turn;
  /** Only this many rows of the box, from its top (a bust). */
  cut: number | null;
  /** The head's shadow: on the top two rows of the chest, or on the top of a shoulder. */
  shade: "chest" | "shoulder" | null;
}

/** Raised, an arm runs from a little under the top of the shoulder to three pixels over the head. */
const raised = (part: PartId, x: number): Place => ({ part, x, y: -3, z: 2, turn: "up", cut: null, shade: null });

/** Where the boxes stand in a pose, furthest first: far leg, far arm, body, near leg, head, near arm. */
export function places(pose: Pose, arm: number): Place[] {
  const cut = pose === "bust" ? 5 : null;
  const down = (part: PartId, x: number): Place => ({ part, x, y: 8, z: 2, turn: "none", cut, shade: "shoulder" });
  const leg = (part: PartId, x: number): Place =>
    pose === "sit"
      ? { part, x, y: 20, z: -6, turn: "forward", cut: null, shade: null }
      : { part, x, y: 20, z: 2, turn: "none", cut: null, shade: null };
  const farArm = pose === "cheer" ? raised("armR", 4 - arm) : down("armR", 4 - arm);
  const nearArm = pose === "cheer" || pose === "wave" ? raised("armL", 12) : down("armL", 12);
  const body: Place = { part: "body", x: 4, y: 8, z: 2, turn: "none", cut, shade: "chest" };
  const head: Place = { part: "head", x: 4, y: 0, z: 0, turn: "none", cut: null, shade: null };
  if (pose === "bust") return [farArm, body, head, nearArm];
  return [leg("legR", 4), farArm, body, leg("legL", 8), head, nearArm];
}

/** A placed box's size in the picture's directions: across, down, and away from us. */
function sizeOf(p: Part, pl: Place): readonly [number, number, number] {
  const h = pl.cut ?? p.h;
  return pl.turn === "forward" ? [p.w, p.d, p.h] : [p.w, h, p.d];
}

/** A point in a placed box (skin pixels from its corner) as a point in the box's own frame. */
function own(p: Part, pl: Place, wx: number, wy: number, wz: number): readonly [number, number, number] {
  switch (pl.turn) {
    case "none":
      return [wx, wy, wz];
    case "up":
      return [p.w - wx, (pl.cut ?? p.h) - wy, wz];
    case "forward":
      return [wx, p.h - wz, wy];
  }
}

/** Which of a box's own faces looks to the front, up, and to the side, as it is turned. */
const FACING: Readonly<Record<Turn, readonly [Face, Face, Face]>> = {
  none: ["front", "top", "left"],
  up: ["front", "bottom", "right"],
  forward: ["bottom", "front", "left"],
};

// ---------- drawing the boxes ----------

/** Which way a drawn pixel's face looks. */
export const FRONT = 0;
export const UP = 1;
export const SIDE = 2;

/**
 * The figure before it is coloured: for each pixel, what it shows. One clear pixel of room is left
 * all round for the edge.
 */
export interface Drawn {
  w: number;
  h: number;
  /** The sheet pixel shown (`y * 64 + x`), or -1 where the figure is not. */
  spot: Int32Array;
  /** `FRONT`, `UP` or `SIDE`. */
  look: Uint8Array;
  /** 1 where the head's shadow falls. */
  dark: Uint8Array;
  /** Which box (its place in the pose's list) the pixel belongs to, or -1. */
  box: Int8Array;
  /** 1 where the outer layer shows. */
  outer: Uint8Array;
}

/**
 * Draws the boxes of a pose at `s` art pixels to a skin pixel. A point at (x, y, z) in skin pixels
 * lands at (x*s + z*s/2, y*s - z*s/4); each art pixel asks which face covers the point a little
 * below the middle of its top edge, and the nearest face (smallest z) wins, so the three faces of
 * a box meet with no gap and no pixel twice, and nearer boxes cover further ones. The outer layers
 * stand one art pixel proud of their boxes when `s` is 3 or more, and lie flat on them below that.
 */
export function draw(skin: Skin, s: number, pose: Pose): Drawn {
  const kx = s / 2;
  const ky = s / 4;
  const list = places(pose, skin.slim ? 3 : 4);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const pl of list) {
    const [W, H, D] = sizeOf(partOf(skin, pl.part), pl);
    for (const x of [pl.x * s - 1, (pl.x + W) * s + 1])
      for (const y of [pl.y * s - 1, (pl.y + H) * s + 1])
        for (const z of [pl.z, pl.z + D]) {
          minX = Math.min(minX, x + z * kx);
          maxX = Math.max(maxX, x + z * kx);
          minY = Math.min(minY, y - z * ky);
          maxY = Math.max(maxY, y - z * ky);
        }
  }
  const ox = Math.floor(minX) - 2;
  const oy = Math.floor(minY) - 2;
  const bw = Math.ceil(maxX) + 3 - ox;
  const bh = Math.ceil(maxY) + 3 - oy;
  const n = bw * bh;
  const spot = new Int32Array(n).fill(-1);
  const look = new Uint8Array(n);
  const dark = new Uint8Array(n);
  const box = new Int8Array(n).fill(-1);
  const outer = new Uint8Array(n);
  const depth = new Float64Array(n).fill(Infinity);

  list.forEach((pl, b) => {
    const p = partOf(skin, pl.part);
    const [W, H, D] = sizeOf(p, pl);
    const facing = FACING[pl.turn];
    for (const layer of p.outer ? ([0, 1] as const) : ([0] as const)) {
      // Art pixels: the box's edges, grown by one where the outer layer stands proud.
      const g = layer === 1 && s >= 3 ? 1 : 0;
      const ax0 = pl.x * s - g;
      const ax1 = (pl.x + W) * s + g;
      const ay0 = pl.y * s - g;
      const ay1 = (pl.y + H) * s + g;
      const z0 = pl.z;
      const z1 = pl.z + D;

      const put = (X: number, Y: number, z: number, f: 0 | 1 | 2, ax: number, ay: number, az: number): void => {
        const [lx, ly, lz] = own(p, pl, (ax - pl.x * s) / s, (ay - pl.y * s) / s, az - pl.z);
        const at = spotOn(p, layer, facing[f], lx, ly, lz);
        if (layer === 1 && (skin.sheet.data[at * 4 + 3] ?? 0) < 128) return;
        const i = (Y - oy) * bw + (X - ox);
        const was = depth[i] ?? Infinity;
        if (!(z < was - 1e-9 || (z <= was + 1e-9 && layer >= (outer[i] ?? 0)))) return;
        depth[i] = z;
        spot[i] = at;
        look[i] = f;
        box[i] = b;
        outer[i] = layer;
        dark[i] = (pl.shade === "chest" && f === FRONT && ly < 2) || (pl.shade === "shoulder" && f === UP) ? 1 : 0;
      };

      // The front, at z0.
      for (let Y = Math.floor(ay0 - z0 * ky) - 1; Y <= Math.ceil(ay1 - z0 * ky); Y++) {
        const ay = Y + 0.2 + z0 * ky;
        if (ay < ay0 || ay >= ay1) continue;
        for (let X = Math.floor(ax0 + z0 * kx) - 1; X <= Math.ceil(ax1 + z0 * kx); X++) {
          const ax = X + 0.5 - z0 * kx;
          if (ax >= ax0 && ax < ax1) put(X, Y, z0, FRONT, ax, ay, z0);
        }
      }
      // The top, at ay0, going back from z0 to z1.
      for (let Y = Math.floor(ay0 - z1 * ky) - 1; Y <= Math.ceil(ay0 - z0 * ky); Y++) {
        const z = ((ay0 - (Y + 0.2)) * 4) / s;
        if (z < z0 || z >= z1) continue;
        for (let X = Math.floor(ax0 + z0 * kx) - 1; X <= Math.ceil(ax1 + z1 * kx); X++) {
          const ax = X + 0.5 - z * kx;
          if (ax >= ax0 && ax < ax1) put(X, Y, z, UP, ax, ay0, z);
        }
      }
      // The side, at ax1, going back from z0 to z1.
      for (let X = Math.floor(ax1 + z0 * kx) - 1; X <= Math.ceil(ax1 + z1 * kx); X++) {
        const z = ((X + 0.5 - ax1) * 2) / s;
        if (z < z0 || z >= z1) continue;
        for (let Y = Math.floor(ay0 - z1 * ky) - 1; Y <= Math.ceil(ay1 - z0 * ky); Y++) {
          const ay = Y + 0.2 + z * ky;
          if (ay >= ay0 && ay < ay1) put(X, Y, z, SIDE, ax1, ay, z);
        }
      }
    }
  });

  // Cropped to the figure, with one clear pixel all round for the edge.
  let x0 = bw;
  let x1 = -1;
  let y0 = bh;
  let y1 = -1;
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++)
      if ((spot[y * bw + x] ?? -1) >= 0) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  const w = x1 - x0 + 3;
  const h = y1 - y0 + 3;
  const out: Drawn = {
    w,
    h,
    spot: new Int32Array(w * h).fill(-1),
    look: new Uint8Array(w * h),
    dark: new Uint8Array(w * h),
    box: new Int8Array(w * h).fill(-1),
    outer: new Uint8Array(w * h),
  };
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = y * bw + x;
      const j = (y - y0 + 1) * w + (x - x0 + 1);
      out.spot[j] = spot[i] ?? -1;
      out.look[j] = look[i] ?? 0;
      out.dark[j] = dark[i] ?? 0;
      out.box[j] = box[i] ?? -1;
      out.outer[j] = outer[i] ?? 0;
    }
  return out;
}

// ---------- colouring ----------

type RGB = readonly [number, number, number];

/** A colour mixed part of the way toward another. */
export function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

export const TOP_LIGHT = 0.18;
export const SIDE_SHADE = 0.28;
export const HEAD_SHADE = 0.2;
export const CREASE = 0.22;

/**
 * Where two boxes' fronts meet side by side (an arm and the body, the two legs), the further box's
 * pixel next to the other is a crease, so an arm in the same colour as the body still reads as an arm.
 */
export function creased(d: Drawn, i: number): boolean {
  if (d.look[i] !== FRONT) return false;
  const b = d.box[i] ?? -1;
  for (const j of [i - 1, i + 1]) {
    const o = d.box[j] ?? -1;
    if (o > b && d.look[j] === FRONT && (d.spot[j] ?? -1) >= 0) return true;
  }
  return false;
}

/**
 * Colours a drawn figure: fronts as the sheet has them, tops mixed toward cream, sides toward ink,
 * the head's shadow and the creases between boxes toward ink again; the rim of light, if any, on
 * pixels with nothing to their left or above them; and a one-pixel ink edge all round. Creases are
 * left out at `s` 1, where a pixel is a whole skin pixel.
 */
export function paintFigure(skin: Skin, d: Drawn, rim: Rim | null = null, creases = true): Pixels {
  const { w, h } = d;
  const data = new Uint8ClampedArray(w * h * 4);
  const ink = rgb(INK);
  const cream = rgb(CREAM);
  const glow = rim ? rgb(rim.colour) : ink;
  const sheet = skin.sheet.data;
  const isIn = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && (d.spot[y * w + x] ?? -1) >= 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const at = d.spot[i] ?? -1;
      let c: RGB;
      if (at < 0) {
        if (!(isIn(x - 1, y) || isIn(x + 1, y) || isIn(x, y - 1) || isIn(x, y + 1))) continue;
        c = ink;
      } else {
        c = [sheet[at * 4] ?? 0, sheet[at * 4 + 1] ?? 0, sheet[at * 4 + 2] ?? 0];
        const f = d.look[i];
        if (f === UP) c = mix(c, cream, TOP_LIGHT);
        else if (f === SIDE) c = mix(c, ink, SIDE_SHADE);
        if (d.dark[i]) c = mix(c, ink, HEAD_SHADE);
        if (creases && creased(d, i)) c = mix(c, ink, CREASE);
        if (rim && (!isIn(x - 1, y) || !isIn(x, y - 1))) c = mix(c, glow, rim.amount);
      }
      data[i * 4] = c[0];
      data[i * 4 + 1] = c[1];
      data[i * 4 + 2] = c[2];
      data[i * 4 + 3] = 255;
    }
  return { w, h, data };
}

/** A picture mirrored left to right. */
export function mirrored(p: Pixels): Pixels {
  const data = new Uint8ClampedArray(p.data.length);
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const from = (y * p.w + x) * 4;
      const to = (y * p.w + (p.w - 1 - x)) * 4;
      for (let k = 0; k < 4; k++) data[to + k] = p.data[from + k] ?? 0;
    }
  return { w: p.w, h: p.h, data };
}

export interface FigureOptions {
  /** Art pixels to a skin pixel on a front face, 1 to 8. */
  s: number;
  pose: Pose;
  flip?: boolean;
  rim?: Rim | null;
}

/** The whole figure as pixels, exactly as large as the figure and its edge. */
export function figure(skin: Skin, o: FigureOptions): Pixels {
  const s = clamp(Math.round(o.s), 1, 8);
  const p = paintFigure(skin, draw(skin, s, o.pose), o.rim ?? null, s >= 2);
  return o.flip ? mirrored(p) : p;
}

// ---------- on a canvas ----------

export type Sheet = HTMLImageElement | HTMLCanvasElement;

const read = new WeakMap<Sheet, Skin>();

/** A sheet's pixels, read once per sheet. Throws if the sheet cannot be read (a picture from elsewhere). */
export function skinOf(sheet: Sheet): Skin {
  let skin = read.get(sheet);
  if (!skin) {
    const { g } = makeCanvas(64, 64);
    g.drawImage(sheet, 0, 0);
    const tall = sheet instanceof HTMLImageElement ? sheet.naturalHeight : sheet.height;
    skin = readSkin({ data: g.getImageData(0, 0, 64, 64).data, tall });
    read.set(sheet, skin);
  }
  return skin;
}

export function toCanvas(p: Pixels): HTMLCanvasElement {
  const { c, g } = makeCanvas(p.w, p.h);
  const img = g.createImageData(p.w, p.h);
  img.data.set(p.data);
  g.putImageData(img, 0, 0);
  return c;
}

/** The member's figure on a canvas exactly as large as the figure and its edge. */
export function portrait(sheet: Sheet, o: FigureOptions): HTMLCanvasElement {
  return toCanvas(figure(skinOf(sheet), o));
}
