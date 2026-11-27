/**
 * What binds a room, as rows: each of the Wilds' rules (`wilds.ts` has their numbers), what its card
 * calls it and says, and what it sets in a fight (`FightRules`). A rule that draws something for a
 * room (Stumps' stumps) draws it from the run's stream as the room is laid out; what it drew is kept
 * on the run's wing, and the rule sets its numbers from that. The fight reads what is set, never
 * which rule set it, so a rule that only sets a number the fight already reads is a row here.
 */
import { shuffled, type Stream } from "@sequoia-leaf/core";

import { COLS, SEATS } from "../hex.ts";
import { FIGHT } from "./rooms.ts";
import { type RuleId, WILDS } from "./wilds.ts";

/** What a fight reads of the room it is fought in. Every field has a plain value (`PLAIN_RULES`), so "no rule" is a value and not an absence. */
export interface FightRules {
  /** Seats nobody stands on or walks through all fight long, the same on both halves. */
  readonly closed: readonly number[];
  /** Seats closed only while the parties sit down, the same on both halves (Long Table). */
  readonly closedToSit: readonly number[];
  /** No attack reaches further, in hexes; Infinity for none. An ability reaches as far as its figure does. */
  readonly reach: number;
  /** When dusk falls, in seconds. */
  readonly dusk: number;
  /** How much more attack a figure that starts touching no friend has, in percent. */
  readonly alone: number;
}
/** A fight bound by nothing. */
export const PLAIN_RULES: FightRules = {
  closed: [],
  closedToSit: [],
  reach: Number.POSITIVE_INFINITY,
  dusk: FIGHT.dusk,
  alone: 0,
};

const together = (a: readonly number[], b: readonly number[]): number[] =>
  [...new Set([...a, ...b])].toSorted((x, y) => x - y);
/** Two rules in force at once: the seats either closes, the lower reach and dusk, and both rules' extra attack added. */
export const bind = (a: FightRules, b: FightRules): FightRules => ({
  closed: together(a.closed, b.closed),
  closedToSit: together(a.closedToSit, b.closedToSit),
  reach: Math.min(a.reach, b.reach),
  dusk: Math.min(a.dusk, b.dusk),
  alone: a.alone + b.alone,
});
/** Rules from what they set apart from plain. */
export const ruled = (set: Partial<FightRules> = {}): FightRules => ({ ...PLAIN_RULES, ...set });
/**
 * What rules set apart from plain: how a fight's setup keeps them (`FightSetup.rules`), with no
 * Infinity in it, so it is plain data. Nothing for plain rules.
 */
export function apart(r: FightRules): Partial<FightRules> {
  const set: { -readonly [K in keyof FightRules]?: FightRules[K] } = {};
  if (r.closed.length > 0) set.closed = r.closed.slice();
  if (r.closedToSit.length > 0) set.closedToSit = r.closedToSit.slice();
  if (r.reach !== PLAIN_RULES.reach) set.reach = r.reach;
  if (r.dusk !== PLAIN_RULES.dusk) set.dusk = r.dusk;
  if (r.alone !== PLAIN_RULES.alone) set.alone = r.alone;
  return set;
}
/** The seats nobody may sit on as the parties sit down: those closed, and those closed only for sitting down. */
export const shut = (r: Pick<FightRules, "closed" | "closedToSit">): ReadonlySet<number> =>
  new Set([...r.closed, ...r.closedToSit]);

/** One rule a room may be played under. */
export interface RuleRow {
  readonly name: string;
  /** What the rule is, as its card says it. */
  readonly text: string;
  /** What it draws for a room from the run's stream, as seats: Stumps' stumps. The rest draw nothing, and take nothing from the stream. */
  readonly draws: (rng: Stream) => number[];
  /** What it sets in a fight, from what it drew for the room. */
  readonly sets: (drawn: readonly number[]) => Partial<FightRules>;
}

const ALL_SEATS = Array.from({ length: SEATS }, (_, seat) => seat);
const none = (): number[] => [];

export const ROOM_RULES: Readonly<Record<RuleId, RuleRow>> = {
  stumps: {
    name: "Stumps",
    text: `${WILDS.stumps} hexes on each side are stumps: nobody stands on them or walks through them. New ones every room.`,
    draws: (rng) =>
      shuffled(rng, ALL_SEATS)
        .slice(0, WILDS.stumps)
        .toSorted((a, b) => a - b),
    sets: (drawn) => ({ closed: drawn.slice() }),
  },
  narrow: {
    name: "Narrow Table",
    text: "The 2 outside columns are closed. The board is 5 across.",
    draws: none,
    sets: () => ({ closed: ALL_SEATS.filter((s) => WILDS.narrow.some((col) => col === s % COLS)) }),
  },
  long: {
    name: "Long Table",
    text: "Both front rows are empty at the start. The parties begin 2 hexes further apart.",
    draws: none,
    sets: () => ({ closedToSit: ALL_SEATS.filter((s) => s < COLS) }),
  },
  fog: {
    name: "Fog",
    text: `No attack reaches further than ${WILDS.fog} hexes.`,
    draws: none,
    sets: () => ({ reach: WILDS.fog }),
  },
  dusk: {
    name: "Early Dusk",
    text: `Dusk falls after ${WILDS.dusk} seconds, not ${FIGHT.dusk}.`,
    draws: none,
    sets: () => ({ dusk: WILDS.dusk }),
  },
  elbow: {
    name: "Elbow Room",
    text: `A figure that starts with no friend touching it has ${WILDS.elbow}% more attack.`,
    draws: none,
    sets: () => ({ alone: WILDS.elbow }),
  },
};
