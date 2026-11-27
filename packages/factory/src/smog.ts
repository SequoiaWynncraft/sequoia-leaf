/**
 * Smog (tiers 5 to 8): each plot has a level, 0 to `SMOG.most`, and what was made on it since it was
 * last counted (`Yard.smog`, by the plot's place in the land's `plots`). A piece whose kind makes smog
 * (`KindInfo.smog`) adds it to the plot its own tile is on as it finishes a thing; nothing else makes
 * any, and none passes from one plot to the next. Every `SMOG.every` ticks each plot is counted: up by
 * what was made, down by what its ground clears and each redwood standing on it, held between 0 and
 * the most. At each step (`SMOG.steps`) the pieces that work on it lose ticks: at step 1 one in four,
 * at step 2 two, at step 3 three. The tick passes over a plot's whole part of the plumbing's list of
 * pieces that work on a tick it loses (`Wire.workFrom`), so smog costs one compare a plot.
 */
import { SMOG } from "./content/smog.ts";
import { NONE, plotName } from "./tables.ts";
import type { Wire, Yard } from "./yard.ts";

/** Adds smog to the plot the tile `i` is on (a piece's own tile), as a piece finishes a thing. */
export function smogged(y: Yard, i: number, n: number): void {
  const p = y.land.plot[i] ?? NONE;
  if (n > 0 && p !== NONE) y.smog.made[p] = Math.min(0xffff, (y.smog.made[p] ?? 0) + n);
}

const [STEP_1, STEP_2, STEP_3] = SMOG.steps;
/** The step a plot of smog `level` is at: 0 below the first, up to 3. */
export const stepOf = (level: number): number => (level >= STEP_3 ? 3 : level >= STEP_2 ? 2 : level >= STEP_1 ? 1 : 0);

/** Whether the pieces of a plot at step `s` work on the tick `t`: with `q` the tick modulo 4, step 1 loses q 0, step 2 q 0 and 2, step 3 all but q 3. */
export function worksOn(s: number, t: number): boolean {
  const q = t & 3;
  return s === 0 || (s === 1 ? q !== 0 : s === 2 ? (q & 1) === 1 : s >= 3 ? q === 3 : true);
}

/** The share of ticks the pieces of a plot at step `s` work at. */
export const shareAt = (s: number): number => [1, 0.75, 0.5, 0.25][s] ?? 0.25;

/** The share of ticks the piece on a tile works at, as the smog on its plot lets it. */
export const smogPace = (y: Yard, i: number): number => shareAt(stepOf(y.smog.level[y.land.plot[i] ?? NONE] ?? 0));

/** What a plot clears at a count: its ground, and each redwood standing on it (`Wire.standing`). */
export const clearsAt = (standing: number): number => SMOG.ground + SMOG.redwood * standing;

/** Counts smog on every plot: up by what was made, down by what it clears, held between 0 and the most. Makes nothing. */
export function countSmog(y: Yard, wire: Wire): void {
  const { level, made } = y.smog;
  for (let p = 0; p < level.length; p++) {
    const now = (level[p] ?? 0) + (made[p] ?? 0) - clearsAt(wire.standing[p] ?? 0);
    level[p] = now < 0 ? 0 : now > SMOG.most ? SMOG.most : now;
    made[p] = 0;
  }
}

/** Smog on each plot that has any, by the plot's name, for a kept yard (`codec.ts`): its level and what was made since it was counted. Nothing for a yard with none. */
export function keptSmog(y: Yard): { smog?: Record<string, [number, number]> } {
  const kept = y.land.plots.flatMap((p, n): [string, [number, number]][] => {
    const [level, made] = [y.smog.level[n] ?? 0, y.smog.made[n] ?? 0];
    return level === 0 && made === 0 ? [] : [[plotName(p.plot), [level, made]]];
  });
  return kept.length === 0 ? {} : { smog: Object.fromEntries(kept) };
}

/** A whole number from 0 to `most` as kept, or 0 for anything else. */
const upTo = (v: unknown, most: number): number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= most ? v : 0;

/** Puts back the smog kept on each plot of the land, by its name: a level no more than the most, and what was made since it was counted. */
export function smogOnto(y: Yard, kept: unknown): void {
  if (typeof kept !== "object" || kept === null || Array.isArray(kept)) return;
  y.land.plots.forEach((p, n) => {
    const v: unknown = Reflect.get(kept, plotName(p.plot));
    if (!Array.isArray(v)) return;
    y.smog.level[n] = upTo(v[0], SMOG.most);
    y.smog.made[n] = upTo(v[1], 0xffff);
  });
}
