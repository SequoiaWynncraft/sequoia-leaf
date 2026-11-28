/**
 * What a charger's and a launch pad's cards show of the yard (tier 8), printed from it as every card's
 * print is (`prints.ts`): the ticks to the yard's next beat, from its tick alone (`toBeat`); and for a
 * pad, the rules' one reading of it (`padAt`: its rocket, each part filling, its charged cells by bars)
 * with what the page counted of it (`pads.ts`: the most since its last launch, and what came in over
 * the last minute). A card draws from this alone.
 */
import { kind, padAt, type PadReading, toBeat, type Yard } from "@sequoia-leaf/factory";

import { type PadCounted, padCounted } from "../pads.ts";

const CHARGER = kind("charger");
const PAD = kind("launchpad");

export interface LaunchPrint {
  /** Ticks to the yard's next beat. */
  readonly toBeat: number;
  readonly pad: PadReading | null;
  readonly counted: PadCounted | null;
}

/** The print of the charger or pad on its own tile `i`; nothing for any other piece. */
export function launchPrint(y: Yard, i: number): LaunchPrint | null {
  const k = y.kind[i];
  if (k !== CHARGER && k !== PAD) return null;
  return { toBeat: toBeat(y.tick), pad: padAt(y, i), counted: k === PAD ? padCounted(y, i) : null };
}
