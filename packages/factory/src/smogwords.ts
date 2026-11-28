/**
 * Smog as a player reads it (`smog.ts` has the rules): a plot's card, with its level, what its dirty
 * pieces make a minute as their own cards say it, what it clears, and how its machines work; what a
 * plot for sale and a redwood would clear; and the trouble a smoggy plot is in.
 */
import { perMinute, whole } from "@sequoia-leaf/core";

import { SMOG } from "./content/smog.ts";
import { MINUTE } from "./planner.ts";
import { pieceOf } from "./sizes.ts";
import { shareAt, standingOn, stepOf } from "./smog.ts";
import { machineRate } from "./status.ts";
import { isKind, NONE, SMOG_OF } from "./tables.ts";
import type { Yard } from "./yard.ts";

/** What a plot's ground clears a minute, and each redwood standing on one. */
const GROUND = (SMOG.ground * MINUTE) / SMOG.every;
const REDWOOD = (SMOG.redwood * MINUTE) / SMOG.every;

/**
 * What a plot's dirty pieces make a minute: each piece's things a minute as its own card says it
 * (`machineRate`: at its grade's pace, the share power and smog let it, and no more than its way out
 * carries), times what each adds.
 */
export function madeOn(y: Yard, n: number): number {
  let made = 0;
  for (let i = 0; i < y.kind.length; i++) {
    const k = y.kind[i] ?? NONE;
    const each = SMOG_OF[k] ?? 0;
    if (each === 0 || !isKind(k) || y.land.plot[i] !== n || pieceOf(y, i) !== i) continue;
    made += each * machineRate(y, i).effective;
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
