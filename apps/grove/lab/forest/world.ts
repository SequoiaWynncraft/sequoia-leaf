/**
 * The valley's geography, and the parallax layers it is painted on.
 *
 * Every place has a nominal world x: where the camera's centre must be for that place to stand in
 * the middle of the screen. A layer at depth `f` (1 is the nearest plane, smaller is further away)
 * draws a thing at nominal x `X` at screen x `(X - cx) * f + W / 2`, so when the camera centres on a
 * place, everything at that place lines up whatever its depth, and as the camera moves the far
 * layers slide past more slowly. Each layer is painted once, at its own pixel scale, into an
 * indexed surface just wide enough for the camera's whole range.
 */

import { Surface } from "../pixel/raster.ts";

/** Nominal width of the valley: about five desktop screens. */
export const WORLD_W = 1760;
/** Rows of art. The screen shows the bottom `H` of them, so a taller screen sees more sky. */
export const WORLD_H = 248;
/** The widest the art gets (the glade's limit); layers are wide enough for any screen. */
export const WMAX = 560;

/** The sunset's line, behind the far ridges. */
export const HORIZON = 156;

/** The Great Sequoia stands at the heart of the valley. */
export const HEART_X = 880;

export interface Row {
  name: "back" | "mid" | "front";
  /** Parallax depth. */
  f: number;
  /** Trees in this row are drawn at this fraction of their own size. */
  scale: number;
  /** Where trees' feet stand, and where the row's ground begins (its top edge). */
  foot: number;
  fringe: number;
}

export const ROWS: readonly Row[] = [
  { name: "back", f: 0.84, scale: 0.5, foot: 190, fringe: 185 },
  { name: "mid", f: 0.92, scale: 2 / 3, foot: 204, fringe: 198 },
  { name: "front", f: 1, scale: 1, foot: 224, fringe: 213 },
];

/** Named places along the valley, west to east, at nominal x. */
export const PLACES = {
  swamp: 150,
  swampSign: 214,
  pond: 628,
  rules: 556,
  rollcall: 712,
  heart: HEART_X,
  campfire: 958,
  stall: 1092,
  gate: 1566,
  farm: 1594,
  meadow: 1680,
} as const;

/** The front plane's features, as spans of nominal x that member trees keep clear of. */
export const KEEP_CLEAR: Record<Row["name"], readonly (readonly [number, number])[]> = {
  front: [
    [0, 300],
    [520, 742],
    [HEART_X - 92, HEART_X + 84],
    [920, 998],
    [1062, 1128],
    [1536, WORLD_W],
  ],
  mid: [
    [0, 262],
    [566, 692],
    [HEART_X - 74, HEART_X + 70],
    [1610, WORLD_W],
  ],
  back: [
    [0, 210],
    [592, 668],
    [HEART_X - 82, HEART_X + 78],
    [1650, WORLD_W],
  ],
};

/** The territories the guild holds on the Fruma ridge, and where a newly won one rises. */
export const BANNERS: readonly number[] = [1010, 1118, 1236, 1330, 1478, 1590, 1700];
export const NEW_BANNER = 1400;

export class Layer {
  readonly f: number;
  readonly margin: number;
  readonly w: number;
  readonly s: Surface;
  /** Which tree or landmark each pixel belongs to (0 is none), for hit tests and highlights. */
  readonly owner: Uint8Array | null;
  /** From this row down, every pixel is opaque, so whole rows can be copied at once. */
  opaqueFrom = WORLD_H;

  constructor(f: number, owners: boolean) {
    this.f = f;
    this.margin = Math.ceil((WMAX / 2) * (1 - f)) + 2;
    this.w = Math.ceil(WORLD_W * f + WMAX * (1 - f)) + 4;
    this.s = new Surface(this.w, WORLD_H);
    this.owner = owners ? new Uint8Array(this.w * WORLD_H) : null;
  }

  /** Layer x of nominal x. */
  lx(X: number): number {
    return Math.round(X * this.f + this.margin);
  }

  /** Nominal x of layer x. */
  X(lx: number): number {
    return (lx - this.margin) / this.f;
  }

  /** The layer x at the screen's left edge, for a camera centred on nominal `cx`. */
  offset(cx: number, W: number): number {
    return Math.round(cx * this.f - W / 2 + this.margin);
  }

  /** Recomputes `opaqueFrom` after painting. */
  seal(): void {
    const { w, s } = this;
    let y = WORLD_H;
    while (y > 0) {
      const row = s.data.subarray((y - 1) * w, y * w);
      if (row.includes(0)) break;
      y--;
    }
    this.opaqueFrom = y;
  }
}

/** Screen x of nominal x at depth f. */
export const screenX = (X: number, f: number, cx: number, W: number): number => (X - cx) * f + W / 2;

/** The camera's centre, kept so the view never runs off the valley. */
export const clampCam = (cx: number, W: number): number => Math.max(W / 2, Math.min(WORLD_W - W / 2, cx));

export function placeX(name: string): number | null {
  const hit = Object.entries(PLACES).find(([k]) => k === name);
  if (hit) return hit[1];
  const n = Number(name);
  return Number.isFinite(n) ? n : null;
}
