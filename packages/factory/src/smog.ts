/**
 * Smog (tiers 5 to 8): each plot has a level, 0 to `SMOG.most`, and what was made on it since it was
 * last counted (`Yard.smog`, by the plot's place in the land's `plots`). A piece whose kind makes smog
 * (`KindInfo.smog`) adds it to the plot its own tile is on as it finishes a thing; nothing else makes
 * any, and none passes from one plot to the next. Every `SMOG.every` ticks each plot is counted: up by
 * what was made, down by what its ground clears and each redwood standing on it, held between 0 and
 * the most. At each step (`SMOG.steps`) the pieces that work on it work at a share of their pace: at
 * step 1 three fourths, at step 2 two, at step 3 one. That is SPEC-2's "3 ticks in 4", "2 in 4" and "1
 * in 4" on average, exactly (`Holders.quarter` carries what is past a whole half-tick), by pace and not
 * by ticks lost, so with the yard short of power, which works on some ticks, the two multiply. A tick
 * with no plot slowed reads no plot's pace (`smogPaces`).
 */
import { perMinute, whole } from "@sequoia-leaf/core";

import { SMOG } from "./content/smog.ts";
import { MINUTE, mixPerMinute } from "./planner.ts";
import { pieceOf } from "./sizes.ts";
import { isKind, NONE, plotName, SMOG_OF } from "./tables.ts";
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

/** Each plot's pace this tick in fourths into `paces` (4 at step 0, then 3, 2 and 1), as its smog lets it; says whether any plot is slowed. Makes nothing. */
export function smogPaces(y: Yard, paces: Uint8Array): boolean {
  const level = y.smog.level;
  let slowed = false;
  for (let p = 0; p < level.length; p++) {
    const q = FULL - stepOf(level[p] ?? 0);
    paces[p] = q;
    if (q < FULL) slowed = true;
  }
  return slowed;
}

/** The share of its pace a piece on a plot at step `s` works at. */
export const shareAt = (s: number): number => [1, 0.75, 0.5, 0.25][s] ?? 0.25;

/** The share of its pace the piece on a tile works at, as the smog on its plot lets it. */
export const smogPace = (y: Yard, i: number): number => shareAt(stepOf(y.smog.level[y.land.plot[i] ?? NONE] ?? 0));

/** What a plot clears at a count: its ground, and each redwood standing on it (`standingOn`). */
export const clearsAt = (standing: number): number => SMOG.ground + SMOG.redwood * standing;

/**
 * How many of the land's redwoods stand on a plot, by its place in the land's list: from what the
 * yard has felled as it is now, the one place both the count and every card ask, so a redwood felled
 * stops clearing at the next count. Makes nothing.
 */
export function standingOn(y: Yard, n: number): number {
  const { trees, plot } = y.land;
  let standing = 0;
  for (let t = 0; t < trees.length; t++) if (y.felled[t] !== 1 && plot[trees[t]?.[0] ?? 0] === n) standing++;
  return standing;
}

/** Counts smog on every plot: up by what was made, down by what it clears, held between 0 and the most. Makes nothing. */
export function countSmog(y: Yard): void {
  const { level, made } = y.smog;
  for (let p = 0; p < level.length; p++) {
    const now = (level[p] ?? 0) + (made[p] ?? 0) - clearsAt(standingOn(y, p));
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

// ---------- what a player reads ----------

/** What a plot's ground clears a minute, and each redwood standing on one. */
const GROUND = (SMOG.ground * MINUTE) / SMOG.every;
const REDWOOD = (SMOG.redwood * MINUTE) / SMOG.every;

/**
 * What a plot's dirty pieces would make a minute, working every tick (`flow`'s way of counting, so
 * that it does not flicker): each piece's things a minute at its grade times what each adds.
 */
export function madeOn(y: Yard, n: number): number {
  let made = 0;
  for (let i = 0; i < y.kind.length; i++) {
    const k = y.kind[i] ?? NONE;
    const each = SMOG_OF[k] ?? 0;
    if (each === 0 || !isKind(k) || y.land.plot[i] !== n || pieceOf(y, i) !== i) continue;
    made += each * mixPerMinute(k, y.grade[i] ?? 1);
  }
  return made;
}

/** What a plot clears a minute in words, and in all: "420 /min: the ground 300, 1 redwood 120". */
function cleared(y: Yard, n: number, of = ""): string {
  const trees = standingOn(y, n);
  const by = trees === 0 ? "" : `, ${trees} redwood${trees === 1 ? "" : "s"} ${whole(REDWOOD * trees)}`;
  return `${perMinute(GROUND + REDWOOD * trees, of)}: the ground ${whole(GROUND)}${by}`;
}

/** How the machines on a plot at a step work, in words, as a piece's own line says it (`slow`): "at full pace", "at 75% of their pace". */
const paceWords = (s: number): string =>
  s === 0 ? "at full pace" : `at ${Math.floor(shareAt(s) * 100)}% of their pace`;

/** A plot's smog, for its card, for a plot the yard owns: its level, what is made and cleared, and how its machines work. */
export function smogLine(y: Yard, n: number): string {
  const level = y.smog.level[n] ?? 0;
  return `Smog ${whole(level)} of ${whole(SMOG.most)}. Made ${perMinute(madeOn(y, n))}. Cleared ${cleared(y, n)}. Machines here work ${paceWords(stepOf(level))}.`;
}

/** What a plot for sale would clear, for its card: "Clears 420 smog /min: the ground 300, 1 redwood 120." */
export const clearsLine = (y: Yard, n: number): string => `Clears ${cleared(y, n, "smog")}.`;

/** What a redwood clears, for its card. */
export const redwoodClears = (): string => `Clears ${perMinute(REDWOOD, "smog")} from this plot.`;

/** The trouble a plot at step 1 or more is in, by name, or nothing: "Smog on The Old Workings: its machines work at 75% of their pace." */
export function smogTrouble(y: Yard, n: number): string | null {
  const s = stepOf(y.smog.level[n] ?? 0);
  const plot = y.land.plots[n];
  return s === 0 || !plot ? null : `Smog on ${plot.name}: its machines work ${paceWords(s)}.`;
}
