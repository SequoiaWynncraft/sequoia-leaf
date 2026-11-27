/**
 * The fight's clock and its notebook, which everything else in a fight is written with: steps of the
 * clock, writing down what happened (`emit`), and having something happen in a moment (`later`).
 */
import { FIGHT } from "../content/rooms.ts";
import { distance } from "../hex.ts";
import type { Fight, FightEvent } from "./types.ts";

export const HZ = FIGHT.hz;
/** Seconds as steps of the clock. */
export const secs = (seconds: number): number => Math.round(seconds * HZ);
/** A time that never comes: for a shield that lasts until it is broken. */
export const FOREVER = Number.MAX_SAFE_INTEGER;

export const emit = (f: Fight, ev: FightEvent): void => {
  f.out.push(ev);
};
/** Has something happen in a number of steps: when a thrown thing arrives. */
export const later = (f: Fight, ticks: number, land: () => void): void => {
  f.pending.push({ at: f.tick + Math.max(1, ticks), land });
};
/** How long something thrown takes to get from one hex to another. */
export const flight = (from: number, to: number): number => Math.max(1, distance(from, to)) * FIGHT.flight;
