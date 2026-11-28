/**
 * The words of a charm boon from Groot Night on, which every release that brings a charm writes its
 * own with: the emblem it gives, the health every charm's emblem has, and the trait it grants.
 */
import type { BoonSpec } from "./boons.ts";
import type { ItemId } from "./items.ts";
import { withA } from "./traits.ts";

/** What every charm's emblem adds of its own, from Groot Night. */
export const EMBLEM = { health: 10 } as const;

/** A charm boon: the emblem it gives, with its health, and the trait it grants. */
export function charm(gives: ItemId, name: string, trait: string, quip: string): BoonSpec {
  return {
    name,
    sort: "charm",
    gives,
    text: `An emblem for one figure to hold, with +${EMBLEM.health}% health: it is ${withA(trait)} as well, and counts as one more ${trait}.`,
    short: `Gives an emblem: +${EMBLEM.health}% health, ${withA(trait)} too.`,
    n: {},
    quip,
  };
}
