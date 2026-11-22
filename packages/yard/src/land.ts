/**
 * The ground the yard stands on: what lies in it tile by tile, where the stream runs, where the
 * redwoods stand, and which plot each tile belongs to. The guild's land is put together from the
 * plots table; a test can make a bare patch of its own.
 */
import type { Raw } from "./content/items.ts";
import { PLOT_H, PLOT_W, type PlotId, type PlotInfo, PLOTS } from "./content/plots.ts";

export interface Plot {
  readonly id: PlotId;
  readonly name: string;
  readonly why: string;
  readonly price: number;
  /** Its corner and size on the map, in tiles. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Land {
  readonly w: number;
  readonly h: number;
  /** What a gatherer would gather at each tile, if anything. */
  readonly deposit: readonly (Raw | null)[];
  /** 1 where the stream runs, and 1 where a redwood stands. Nothing is built on either. */
  readonly water: Uint8Array;
  readonly trunk: Uint8Array;
  /** Which plot each tile belongs to, as a place in `plots`. */
  readonly plot: Int8Array;
  readonly plots: readonly Plot[];
  /** The middle tile of the depot, which is three tiles square. */
  readonly depot: readonly [number, number];
}

const LETTER: Partial<Record<string, Raw>> = { d: "deadfall", s: "stone", o: "ore", c: "clay", a: "sand", r: "resin" };

/** Puts a map together from plots drawn as rows of letters. */
export function landFrom(infos: readonly PlotInfo[]): Land {
  const w = (Math.max(...infos.map((p) => p.col)) + 1) * PLOT_W;
  const h = (Math.max(...infos.map((p) => p.row)) + 1) * PLOT_H;
  const deposit: (Raw | null)[] = Array.from({ length: w * h }, () => null);
  const water = new Uint8Array(w * h);
  const trunk = new Uint8Array(w * h);
  const plot = new Int8Array(w * h).fill(-1);
  const depots: [number, number][] = [];
  const plots = infos.map((p, n): Plot => {
    const x0 = p.col * PLOT_W;
    const y0 = p.row * PLOT_H;
    for (let y = 0; y < PLOT_H; y++)
      for (let x = 0; x < PLOT_W; x++) {
        const i = (y0 + y) * w + x0 + x;
        const letter = p.rows[y]?.[x] ?? ".";
        plot[i] = n;
        deposit[i] = LETTER[letter] ?? null;
        if (letter === "~") water[i] = 1;
        if (letter === "T") trunk[i] = 1;
        if (letter === "D") depots.push([x0 + x, y0 + y]);
      }
    return { id: p.id, name: p.name, why: p.why, price: p.price, x: x0, y: y0, w: PLOT_W, h: PLOT_H };
  });
  // The depot is the nine tiles marked D; its middle is the fifth of them, reading across and down.
  const depot = depots[4] ?? [Math.floor(w / 2), Math.floor(h / 2)];
  return { w, h, deposit, water, trunk, plot, plots, depot };
}

/** The guild's land. */
export const LAND: Land = landFrom(PLOTS);

/**
 * A bare patch that is all one plot, with the depot in the middle: for trying one rule at a time.
 * `deposits` puts things in the ground by "x,y"; `water` and `trunks` are lists of "x,y".
 */
export function bareLand(
  w: number,
  h: number,
  deposits: Readonly<Record<string, Raw>> = {},
  water: readonly string[] = [],
  trunks: readonly string[] = [],
): Land {
  const cell = (key: string): number => {
    const [x = -1, y = -1] = key.split(",").map(Number);
    return x < 0 || y < 0 || x >= w || y >= h ? -1 : y * w + x;
  };
  const deposit: (Raw | null)[] = Array.from({ length: w * h }, () => null);
  for (const [key, item] of Object.entries(deposits)) if (cell(key) >= 0) deposit[cell(key)] = item;
  const wet = new Uint8Array(w * h);
  for (const key of water) if (cell(key) >= 0) wet[cell(key)] = 1;
  const trunk = new Uint8Array(w * h);
  for (const key of trunks) if (cell(key) >= 0) trunk[cell(key)] = 1;
  return {
    w,
    h,
    deposit,
    water: wet,
    trunk,
    plot: new Int8Array(w * h),
    plots: [{ id: "yard", name: "The Yard", why: "", price: 0, x: 0, y: 0, w, h }],
    depot: [Math.floor(w / 2), Math.floor(h / 2)],
  };
}

/** The place of a tile in the land's lists, or -1 off the map. */
export const cellOf = (land: Land, x: number, y: number): number =>
  x < 0 || y < 0 || x >= land.w || y >= land.h ? -1 : y * land.w + x;

/** Whether a tile has the stream on one of its four sides. */
export function besideWater(land: Land, x: number, y: number): boolean {
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ] as const) {
    const i = cellOf(land, x + dx, y + dy);
    if (i >= 0 && land.water[i] === 1) return true;
  }
  return false;
}

/** Whether two plots share an edge. */
export const touching = (a: Plot, b: Plot): boolean =>
  (a.x < b.x + b.w && b.x < a.x + a.w && (a.y + a.h === b.y || b.y + b.h === a.y)) ||
  (a.y < b.y + b.h && b.y < a.y + a.h && (a.x + a.w === b.x || b.x + b.w === a.x));
