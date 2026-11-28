/**
 * Smog (tiers 5 to 8): each plot has a level, 0 to `SMOG.most`, and what was made on it since it was
 * last counted (`Yard.smog`, by the plot's place in the land's `plots`). A piece whose kind makes smog
 * (`KindInfo.smog`) adds it to the plot its own tile is on as it finishes a thing; nothing else makes
 * any, and none passes from one plot to the next. Every `SMOG.every` ticks each plot is counted: up by
 * what was made, down by what its ground clears and each redwood standing on it, held between 0 and
 * the most. At each step (`SMOG.steps`) the pieces that work on it work at a share of their pace: at
 * step 1 three fourths, at step 2 two, at step 3 one. That is SPEC-2's "3 ticks in 4", "2 in 4" and "1
 * in 4" on average, exactly (`Holders.quarter` carries what is past a whole half-tick), by pace and not
 * by ticks lost, so with the yard short of power, which works on some ticks, the two multiply. A
 * plot's pace changes only where its level is set (`setLevel`), and a tick with no plot slowed reads
 * none, and does just what it did before smog.
 */
import { SMOG } from "./content/smog.ts";
import { NONE, plotName } from "./tables.ts";
import type { Yard } from "./yard.ts";

/** Adds smog to the plot the tile `i` is on (a piece's own tile), as a piece finishes a thing. */
export function smogged(y: Yard, i: number, n: number): void {
  const p = y.land.plot[i] ?? NONE;
  if (n > 0 && p !== NONE) y.smog.made[p] = Math.min(0xffff, (y.smog.made[p] ?? 0) + n);
}

const [STEP_1, STEP_2, STEP_3] = SMOG.steps;
/** The step a plot of smog `level` is at: 0 below the first, up to 3. */
export const stepOf = (level: number): number => (level >= STEP_3 ? 3 : level >= STEP_2 ? 2 : level >= STEP_1 ? 1 : 0);

/** A plot's pace in fourths with no smog slowing it. */
export const FULL = 4;

/**
 * Sets a plot's smog level: the one place a level is set, at a count, as a yard is read, or by a test.
 * Where the plot's step changes, so does its pace in fourths (4 at step 0, then 3, 2 and 1) and the
 * count of plots slowed, which the tick reads (`Yard.smog`). Makes nothing.
 */
export function setLevel(y: Yard, p: number, level: number): void {
  const s = y.smog;
  s.level[p] = level;
  const q = FULL - stepOf(level);
  const was = s.pace[p] ?? FULL;
  if (q === was) return;
  s.pace[p] = q;
  s.slowed += (q < FULL ? 1 : 0) - (was < FULL ? 1 : 0);
}

/** The share of its pace a piece on a plot at step `s` works at. */
export const shareAt = (s: number): number => [1, 0.75, 0.5, 0.25][s] ?? 0.25;

/** The share of its pace the piece on a tile works at, as the smog on its plot lets it. */
export const smogPace = (y: Yard, i: number): number => shareAt(stepOf(y.smog.level[y.land.plot[i] ?? NONE] ?? 0));

/** What a plot clears at a count: its ground, and each redwood standing on it (`standingOn`). */
export const clearsAt = (standing: number): number => SMOG.ground + SMOG.redwood * standing;

/**
 * Counts the land's redwoods standing on each plot into `out`, by the plot's place in the land's list,
 * in one pass over them: from what the yard has felled as it is now, the one place both the count and
 * every card ask, so a redwood felled stops clearing at the next count. Makes nothing.
 */
export function standingInto(y: Yard, out: Uint8Array): void {
  const { trees, plot } = y.land;
  out.fill(0);
  for (let t = 0; t < trees.length; t++) {
    const p = y.felled[t] === 1 ? NONE : (plot[trees[t]?.[0] ?? 0] ?? NONE);
    if (p !== NONE) out[p] = (out[p] ?? 0) + 1;
  }
}

/** How many of the land's redwoods stand on a plot, by its place in the land's list (`standingInto`). */
export function standingOn(y: Yard, n: number): number {
  standingInto(y, y.smog.standing);
  return y.smog.standing[n] ?? 0;
}

/**
 * Counts smog on every plot: up by what was made, down by what it clears, held between 0 and the
 * most. A yard with no smog on any plot, and none made, has nothing to count. Makes nothing.
 */
export function countSmog(y: Yard): void {
  const { level, made, standing } = y.smog;
  let any = false;
  for (let p = 0; p < level.length && !any; p++) any = level[p] !== 0 || made[p] !== 0;
  if (!any) return;
  standingInto(y, standing);
  for (let p = 0; p < level.length; p++) {
    const now = (level[p] ?? 0) + (made[p] ?? 0) - clearsAt(standing[p] ?? 0);
    setLevel(y, p, now < 0 ? 0 : now > SMOG.most ? SMOG.most : now);
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
    setLevel(y, n, upTo(v[0], SMOG.most));
    y.smog.made[n] = upTo(v[1], 0xffff);
  });
}
