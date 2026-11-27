/**
 * Saying an ability out loud: the `cast` event every ability begins with, and the shapes of hexes
 * they cover, for `abilities.ts`.
 */
import { specOf } from "../content/figures.ts";
import { neighbours, within } from "../hex.ts";
import { emit } from "./clock.ts";
import type { Channel } from "./moves.ts";
import type { Fight, Unit } from "./types.ts";

export const ids = (units: readonly Unit[]): number[] => units.map((o) => o.id);

/** Announces an ability: the hexes it covers, who it is aimed at, how long before it lands, and its pulses if it is channelled. */
export function say(f: Fight, u: Unit, cells: number[], targets: number[], ticks: number, pulses?: Channel): void {
  const ability = specOf(f.cat, u.kind).ability;
  emit(f, {
    t: "cast",
    id: u.id,
    kind: u.kind,
    name: ability?.name ?? "",
    shape: ability?.shape ?? "bolt",
    cells,
    targets,
    ticks,
    ...pulses,
  });
}
/** Touching hexes, with the middle one first. */
export const around = (cell: number): number[] => [cell, ...neighbours(cell)];
/** Every hex within some steps of one, the middle one first: what an ability that spreads out covers. */
export const spread = (cell: number, steps: number): number[] =>
  steps === 1 ? around(cell) : [cell, ...within(cell, steps)];
