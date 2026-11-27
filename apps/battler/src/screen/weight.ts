/**
 * The weight of a moment in a fight on the table: the clock held a moment (a hit-stop), and the
 * board bumped under a big one. `fightshow.ts` weighs blows with it; a true form rising and
 * Seqwawa's roots do too.
 */
import { clockNow, FV } from "./board.ts";
import { bumpFor, holdFor, type Weight } from "./playback.ts";

/** Holds the clock a moment for a blow of weight (or for some seconds at 1x). */
export function weigh(w: Weight | number): void {
  if (FV.pb) holdFor(FV.pb, w, FV.speed);
}
/** Whether the player has asked their system for less motion. */
const lessMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Bumps the board under a big moment, unless a bigger bump is still going. */
export function bump(strength: number): void {
  const px = bumpFor(strength, FV.speed, lessMotion());
  if (px > 0 && (px >= FV.bump.px || clockNow() - FV.bump.at > 5)) FV.bump = { at: clockNow(), px };
}
