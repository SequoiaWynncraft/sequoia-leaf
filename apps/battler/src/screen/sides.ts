/**
 * Which side of a fight is the member's own. At the solo table it is always the first; at a live
 * table, the away seat of a sparring pair is the second side of the one fight the pair fights, and
 * the seat says so (`live/seated.ts` sets `OWN.side` while the member is at it). The fight is drawn
 * from that side (the near half, "You" in the tally), and played to the outcome turned back to the
 * first side, as Leaf decided it.
 */
import type { FightResult, FightSetup, FightSummary, Party } from "@sequoia-leaf/raid";
import type { Side } from "@sequoia-leaf/raid/hex.ts";
import { sided } from "@sequoia-leaf/raid/sitting/sitting.ts";

const first = (_setup: FightSetup): Side => 0;

export const OWN: { side: (setup: FightSetup) => Side } = { side: first };

/** Back to the solo table: the first side is the member's. */
export const ownFirst = (): void => {
  OWN.side = first;
};

/** How a fight the member's run kept came out for the first side: as Leaf decided it, which the rules play to. */
export const decided = (setup: FightSetup, outcome: FightSummary): FightSummary => sided(outcome, OWN.side(setup));

/** The party across the table from the member in a fight. */
export const acrossOf = (setup: FightSetup): Party => (OWN.side(setup) === 0 ? setup.sides[1] : setup.sides[0]);

/** How a fight decided for its first side came out for the member: for the second side a win is a loss. */
const TURNED: Readonly<Record<FightResult, FightResult>> = { win: "loss", loss: "win", draw: "draw" };
export const ownResult = (setup: FightSetup, result: FightResult): FightResult =>
  OWN.side(setup) === 0 ? result : TURNED[result];
