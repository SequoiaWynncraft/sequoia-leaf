/**
 * The Wilds' rules as a table (`wing.ts` says which one a room is played under, `wilds.ts` deals
 * the pick, `fight/rules.ts` plays them). After the boss in room 5, and after every boss after it,
 * the member picks one of two, and the next five rooms, a wing, are played under it by both
 * parties. Tuning a rule is editing its number here; its sentence says the number.
 */
import { FIGHT } from "./rooms.ts";

export const RULE_IDS = ["stumps", "narrow", "long", "fog", "dusk", "elbow"] as const;
export type RuleId = (typeof RULE_IDS)[number];
export const isRuleId = (v: unknown): v is RuleId => RULE_IDS.some((id) => id === v);

export const WILDS = {
  /** The first room a rule is picked after, counting from 0: the fifth, a boss. One is picked after every boss from it on. */
  first: 4,
  /** How many rooms a rule holds: a wing. Rooms 6 to 10 are one, 11 to 15 the next. */
  wing: 5,
  /** How many rules a pick offers. */
  offers: 2,
  /** Stumps: how many seats are stumps on each half, the same ones on both. */
  stumps: 3,
  /** Narrow Table: the columns closed. */
  narrow: [0, 6],
  /** Fog: the furthest an attack reaches, in hexes. */
  fog: 2,
  /** Early Dusk: when dusk falls, in seconds. */
  dusk: 12,
  /** Elbow Room: how much more attack a figure with no friend touching it has, in percent. */
  elbow: 30,
} as const;

export interface RuleSpec {
  readonly name: string;
  /** What the rule is, as its card says it. */
  readonly text: string;
}

export const RULES: Readonly<Record<RuleId, RuleSpec>> = {
  stumps: {
    name: "Stumps",
    text: `${WILDS.stumps} hexes on each side are stumps: nobody stands on them or walks through them. New ones every room.`,
  },
  narrow: { name: "Narrow Table", text: "The 2 outside columns are closed. The board is 5 across." },
  long: {
    name: "Long Table",
    text: "Both front rows are empty at the start. The parties begin 2 hexes further apart.",
  },
  fog: { name: "Fog", text: `No attack reaches further than ${WILDS.fog} hexes.` },
  dusk: { name: "Early Dusk", text: `Dusk falls after ${WILDS.dusk} seconds, not ${FIGHT.dusk}.` },
  elbow: {
    name: "Elbow Room",
    text: `A figure that starts with no friend touching it has ${WILDS.elbow}% more attack.`,
  },
};
