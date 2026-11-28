/**
 * A throwaway ring of plots round the guild's land, as the land will grow: the plots one further
 * from the yard than any the plots table has (sixteen round today's nine), each a plot of the plots
 * table's size with deadfall, a pool and a redwood standing where a yard might build. They are added
 * to the plots table (`RINGED_IDS`) and the land is put together from all of them (`RINGED`), as the
 * land is. The land of tier 5, seven plots by seven, is the guild's own (`SEVEN`).
 */
import * as F from "../src/index.ts";
import { must } from "./yards.ts";

/** How far from the yard the ring is, in plots: one past the plots table's furthest. */
const OUT = 1 + Math.max(...F.PLOTS.map((p) => Math.max(Math.abs(p.col), Math.abs(p.row))));
/** The places of the plots `out` plots from the yard, each from the yard as the plots table places them. */
function around(out: number): readonly (readonly [number, number])[] {
  const side = Array.from({ length: 2 * out + 1 }, (_, k) => k - out);
  return side.flatMap((col) =>
    side.flatMap((row) => (Math.max(Math.abs(col), Math.abs(row)) === out ? [[col, row] as const] : [])),
  );
}

/** A ring plot's ground: a redwood, deadfall and a pool, each a little further along by the plot's place in the ring. */
function rows(n: number): string[] {
  const out = Array.from({ length: F.PLOT_H }, () => ".".repeat(F.PLOT_W).split(""));
  const set = (x: number, y: number, c: string): void => {
    const row = out[y];
    if (row && x >= 0 && x < F.PLOT_W) row[x] = c;
  };
  const tx = 1 + (n % 12);
  for (const [dx, dy] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const)
    set(tx + dx, 2 + dy, "T");
  for (let x = 2; x < 6; x++) set(x + (n % 8), 7, "d");
  set(13, 9, "~");
  set(14, 9, "~");
  return out.map((r) => r.join(""));
}

/** The plots of a ring `out` plots from the yard, numbered on from `from`, as the plots table has its own. */
const ringOf = (out: number, from: number): readonly F.PlotInfo<string>[] =>
  around(out).map(([col, row], k) => ({
    id: `ring-${col}-${row}`,
    name: `Ring plot ${from + k + 1}`,
    col,
    row,
    price: 1_000_000,
    why: "A plot of a ring added for a test.",
    rows: rows(from + k),
  }));

/** The ring's plots, as the plots table has its own. */
export const RING: readonly F.PlotInfo<string>[] = ringOf(OUT, 0);

/** The plots table with the ring added at its end. */
export const RINGED_IDS: readonly string[] = [...F.PLOT_IDS, ...RING.map((p) => p.id)];

/** The guild's land with the ring round it. */
export const RINGED: F.Land = F.landFrom([...F.PLOTS, ...RING], RINGED_IDS);

/** The land of tier 5: the guild's own, forty-nine plots, seven by seven. */
export const SEVEN: F.Land = F.LAND;

/** A yard on the larger land that owns a plot of the ring, with a crate on it, its redwood felled and a plan of the whole yard kept. */
export function outward(): F.Yard {
  const y = F.create({ land: RINGED, seed: 5, tier: 6 });
  const ring = RINGED.plots.find((p) => RING.some((q) => q.name === p.name) && p.x === RINGED.origin[0]);
  if (!ring) throw new Error("no ring plot north or south of the yard");
  y.plots.push(ring.plot);
  y.till = 1_000_000 * F.MILLI;
  const tree = RINGED.trees.findIndex((tiles) => RINGED.plot[tiles[0] ?? 0] === RINGED.plots.indexOf(ring));
  const first = RINGED.trees[tree]?.[0] ?? 0;
  must(y, { do: "fell", x: first % RINGED.w, y: Math.floor(first / RINGED.w), price: F.fellPrice(y) });
  must(y, { do: "build", kind: "crate", x: first % RINGED.w, y: Math.floor(first / RINGED.w), dir: 0 });
  must(y, { do: "saveYard", slot: 0 });
  return y;
}
