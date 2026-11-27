/**
 * The ground a yard stands on, tile by tile: what lies in it, where the stream runs, where the
 * redwoods stand, which plot each tile is on. A land is read-only and shared by every yard on it.
 * The guild's land is put together from the plots table; any other size can be made with `landOf`.
 */
import { PLOT_H, PLOT_IDS, PLOT_W, type PlotInfo, PLOTS } from "./content/plots.ts";
import { isPlotOf, item, NONE, type Plot, plot, type Tile } from "./tables.ts";

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
  /** 1 where the stream runs. Nothing is built on it. */
  readonly water: Uint8Array;
  /**
   * Which redwood grows on each tile, as a place in `trees`, or -1. Whether it still stands is the
   * yard's to say (`redwoodAt`): a yard may fell one.
   */
  readonly tree: Int32Array;
  /** Each redwood's tiles, two by two where they can be, from its north-west corner. */
  readonly trees: readonly (readonly number[])[];
  /** Which plot each tile is on, as a place in `plots`, or `NONE`. */
  readonly plot: Uint8Array;
  readonly plots: readonly Plotted[];
  /** The middle tile of the depot, which is three tiles square. */
  readonly depot: readonly [number, number];
  /**
   * The north-west corner of the yard plot, where the depot is: what a yard keeps its tiles measured
   * from, so that more land round it moves nothing kept (`codec.ts`). (0, 0) on a land with no yard plot.
   */
  readonly origin: readonly [number, number];
  /** For each tile, a bit for each way (east, south, west, north) that leads off the map. */
  readonly edge: Uint8Array;
  /** How far along the arrays one tile east, south, west and north is. */
  readonly step: readonly [number, number, number, number];
}

/** The parts a land is made from, with `trunk` 1 on each tile a redwood grows on; the rest is worked out. */
export type LandParts = Omit<Land, "edge" | "step" | "tree" | "trees" | "origin"> & { readonly trunk: Uint8Array };

export function landOf(parts: LandParts): Land {
  const { trunk, ...rest } = parts;
  const { w, h } = parts;
  const edge = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      edge[y * w + x] = (x === w - 1 ? 1 : 0) | (y === h - 1 ? 2 : 0) | (x === 0 ? 4 : 0) | (y === 0 ? 8 : 0);
  const yard = parts.plots.find((p) => p.plot === plot("yard"));
  const origin = [yard?.x ?? 0, yard?.y ?? 0] as const;
  return { ...rest, ...redwoods(w, h, trunk, parts.plot), edge, step: [1, w, -1, -w], origin };
}

/**
 * The redwoods a land's trunks make: read across and down, each trunk tile not yet in one begins
 * one, which takes the trunk tiles of the two by two from it that no other has, on its own plot. So
 * every trunk tile is in exactly one redwood, and a redwood never spans two plots.
 */
function redwoods(w: number, h: number, trunk: Uint8Array, plotAt: Uint8Array): Pick<Land, "tree" | "trees"> {
  const tree = new Int32Array(w * h).fill(-1);
  const trees: number[][] = [];
  for (let i = 0; i < w * h; i++) {
    if (trunk[i] !== 1 || tree[i] !== -1) continue;
    const x = i % w;
    const own = [i, i + 1, i + w, i + w + 1].filter(
      (j, k) => (k % 2 === 0 || x + 1 < w) && j < w * h && trunk[j] === 1 && tree[j] === -1 && plotAt[j] === plotAt[i],
    );
    for (const j of own) tree[j] = trees.length;
    trees.push(own);
  }
  return { tree, trees };
}

const LETTER: Readonly<Record<string, string>> = {
  d: "deadfall",
  s: "stone",
  o: "ore",
  c: "clay",
  a: "sand",
  r: "resin",
};

/**
 * Puts a map together from plots drawn as rows of letters, each placed from the yard plot: as large
 * as the plots reach every way. Each plot's number is its place in `ids`: the guild's plots table,
 * or a longer one a test adds plots to.
 */
export function landFrom(infos: readonly PlotInfo<string>[], ids: readonly string[] = PLOT_IDS): Land {
  const col0 = Math.min(...infos.map((p) => p.col));
  const row0 = Math.min(...infos.map((p) => p.row));
  const w = (Math.max(...infos.map((p) => p.col)) - col0 + 1) * PLOT_W;
  const h = (Math.max(...infos.map((p) => p.row)) - row0 + 1) * PLOT_H;
  const isPlot = isPlotOf(ids);
  const deposit = new Uint8Array(w * h).fill(NONE);
  const water = new Uint8Array(w * h);
  const trunk = new Uint8Array(w * h);
  const plotAt = new Uint8Array(w * h).fill(NONE);
  const depots: [number, number][] = [];
  const plots = infos.map((p, n): Plotted => {
    const x0 = (p.col - col0) * PLOT_W;
    const y0 = (p.row - row0) * PLOT_H;
    const number = ids.indexOf(p.id);
    if (!isPlot(number)) throw new Error(`no plot ${p.id} in the plots table`);
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
    return { plot: number, name: p.name, why: p.why, price: p.price, x: x0, y: y0, w: PLOT_W, h: PLOT_H };
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
