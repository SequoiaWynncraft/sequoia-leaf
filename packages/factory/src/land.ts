/**
 * The ground a yard stands on, tile by tile: what lies in it, where the stream runs, where the
 * redwoods stand, which plot each tile is on. A land is read-only and shared by every yard on it.
 * The guild's land is put together from the plots table; any other size can be made with `landOf`.
 */
import { PLOT_H, PLOT_W, type PlotInfo, PLOTS } from "./content/plots.ts";
import { item, NONE, type Plot, plot, type Tile } from "./tables.ts";

/** A plot as it lies on a land: its number, its corner and size in tiles, and its price. */
export interface Plotted {
  readonly plot: Plot;
  readonly name: string;
  readonly why: string;
  readonly price: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Land {
  readonly w: number;
  readonly h: number;
  /** What a gatherer would gather at each tile, or `NONE`. */
  readonly deposit: Uint8Array;
  /** 1 where the stream runs, and 1 where a redwood stands. Nothing is built on either. */
  readonly water: Uint8Array;
  readonly trunk: Uint8Array;
  /** Which plot each tile is on, as a place in `plots`, or `NONE`. */
  readonly plot: Uint8Array;
  readonly plots: readonly Plotted[];
  /** The middle tile of the depot, which is three tiles square. */
  readonly depot: readonly [number, number];
  /** For each tile, a bit for each way (east, south, west, north) that leads off the map. */
  readonly edge: Uint8Array;
  /** How far along the arrays one tile east, south, west and north is. */
  readonly step: readonly [number, number, number, number];
}

/** The parts a land is made from; the rest is worked out. */
export type LandParts = Omit<Land, "edge" | "step">;

export function landOf(parts: LandParts): Land {
  const { w, h } = parts;
  const edge = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      edge[y * w + x] = (x === w - 1 ? 1 : 0) | (y === h - 1 ? 2 : 0) | (x === 0 ? 4 : 0) | (y === 0 ? 8 : 0);
  return { ...parts, edge, step: [1, w, -1, -w] };
}

const LETTER: Readonly<Record<string, string>> = {
  d: "deadfall",
  s: "stone",
  o: "ore",
  c: "clay",
  a: "sand",
  r: "resin",
};

/** Puts a map together from plots drawn as rows of letters. */
export function landFrom(infos: readonly PlotInfo[]): Land {
  const w = (Math.max(...infos.map((p) => p.col)) + 1) * PLOT_W;
  const h = (Math.max(...infos.map((p) => p.row)) + 1) * PLOT_H;
  const deposit = new Uint8Array(w * h).fill(NONE);
  const water = new Uint8Array(w * h);
  const trunk = new Uint8Array(w * h);
  const plotAt = new Uint8Array(w * h).fill(NONE);
  const depots: [number, number][] = [];
  const plots = infos.map((p, n): Plotted => {
    const x0 = p.col * PLOT_W;
    const y0 = p.row * PLOT_H;
    for (let y = 0; y < PLOT_H; y++)
      for (let x = 0; x < PLOT_W; x++) {
        const i = (y0 + y) * w + x0 + x;
        const letter = p.rows[y]?.[x] ?? ".";
        const raw = LETTER[letter];
        plotAt[i] = n;
        if (
          raw === "deadfall" ||
          raw === "stone" ||
          raw === "ore" ||
          raw === "clay" ||
          raw === "sand" ||
          raw === "resin"
        )
          deposit[i] = item(raw);
        if (letter === "~") water[i] = 1;
        if (letter === "T") trunk[i] = 1;
        if (letter === "D") depots.push([x0 + x, y0 + y]);
      }
    return { plot: plot(p.id), name: p.name, why: p.why, price: p.price, x: x0, y: y0, w: PLOT_W, h: PLOT_H };
  });
  // The depot is the nine tiles marked D; its middle is the fifth of them, reading across and down.
  const depot = depots[4] ?? [Math.floor(w / 2), Math.floor(h / 2)];
  return landOf({ w, h, deposit, water, trunk, plot: plotAt, plots, depot });
}

/** The guild's land. */
export const LAND: Land = landFrom(PLOTS);

/** The tile a way leads to from a tile, or -1 off the map. */
export const toward = (land: Land, i: number, way: number): number => {
  // A way may be given as a way and a turn (3 and 1): it is the same way all the way round.
  const d = way & 3;
  return ((land.edge[i] ?? 15) >> d) & 1 ? -1 : i + (land.step[d] ?? 0);
};

/** The tile at (x, y), or -1 off the map. */
export const tileAt = (land: Land, x: number, y: number): Tile | -1 => {
  const i = x < 0 || y < 0 || x >= land.w || y >= land.h ? -1 : y * land.w + x;
  return isTileOf(land, i) ? i : -1;
};
/** Whether a number is a tile of a land. */
export const isTileOf = (land: Land, i: number): i is Tile => i >= 0 && i < land.w * land.h && Math.floor(i) === i;

/** Whether a tile has the stream on one of its four sides. */
export function besideWater(land: Land, i: number): boolean {
  for (let way = 0; way < 4; way++) {
    const j = toward(land, i, way);
    if (j >= 0 && land.water[j] === 1) return true;
  }
  return false;
}

/** Whether two plots share an edge. */
export const touching = (a: Plotted, b: Plotted): boolean =>
  (a.x < b.x + b.w && b.x < a.x + a.w && (a.y + a.h === b.y || b.y + b.h === a.y)) ||
  (a.y < b.y + b.h && b.y < a.y + a.h && (a.x + a.w === b.x || b.x + b.w === a.x));
