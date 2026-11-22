/**
 * The letter that meets the member at the gate: what happened while they were away. Leaf's town
 * says what its own did and what putting the letter away will post (`arrival`); the guild's ledger
 * has already paid the Leaf the member's news shows, and the letter only shows it.
 */

import type { Arrival } from "@sequoia-leaf/town";
import { LOST_CRAB } from "@sequoia-leaf/town/catalogue.ts";
import { capital, FOLK } from "@sequoia-leaf/town/folk.ts";

import type { AwayLine } from "./guild.ts";

export interface Letter {
  /** Whether there is anything to say: a first visit, the UTC day's first, or Leaf the ledger paid. */
  show: boolean;
  title: string;
  sub: string;
  lines: readonly AwayLine[];
}

/** How long somebody was gone, in plain words. */
export function span(minutes: number): string {
  if (minutes < 1) return "a moment";
  if (minutes < 60) return `${Math.floor(minutes)} minute${Math.floor(minutes) === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return hours === 1 ? "an hour" : `${hours} hours`;
  return `${Math.floor(hours / 24)} days`;
}

/**
 * The letter from Leaf's arrival and the member's own news (`news`, each line with the Leaf it
 * paid), and anything else waiting (`extra`): the news first, then the town's own, then the rest.
 */
export function compose(arrival: Arrival, news: readonly AwayLine[], extra: readonly (AwayLine | null)[]): Letter {
  const townsfolk = arrival.said.map((text): AwayLine => {
    // Each line begins with who it is about, for their face beside it.
    const who = FOLK.find((f) => text.startsWith(capital(f.name)));
    return who ? { art: "folk", text, who: [who.name] } : { art: "folk", text };
  });
  const crab: AwayLine = { art: "crab", text: `Crab No. ${LOST_CRAB} is still missing.` };
  const lines = [...news, ...townsfolk, ...extra.filter((l) => l !== null), crab];
  return {
    show: arrival.first || arrival.newDay || news.some((l) => l.got !== undefined),
    title: arrival.first ? "Welcome home" : "Welcome back",
    sub: arrival.first ? "The guild kept these for you:" : `Gone ${span(arrival.away / 60_000)}. Meanwhile:`,
    lines,
  };
}
