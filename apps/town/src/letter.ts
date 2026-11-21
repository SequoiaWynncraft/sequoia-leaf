/**
 * The letter that meets the member at the gate: what happened while they were away, and what it
 * pays (or, on the guild's server, what the guild's ledger has already paid, which it only shows). It is put together from the time they were last in town and the time now, so it says the
 * same thing however often the page is reloaded before it is put away, and pays nothing for no
 * time at all.
 */

import type { Away, AwayLine } from "./guild.ts";
import { dayOf, type Kept, minutesAway } from "./save.ts";

export interface Letter {
  /** Whether there is anything to say: a first visit, the day's first, or something to pay. */
  show: boolean;
  title: string;
  sub: string;
  lines: readonly AwayLine[];
  leaf: number;
  coins: number;
}

/** How long somebody was gone, in plain words. */
export function span(minutes: number): string {
  if (minutes < 1) return "a moment";
  if (minutes < 60) return `${Math.floor(minutes)} minute${Math.floor(minutes) === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return hours === 1 ? "an hour" : `${hours} hours`;
  return `${Math.floor(hours / 24)} days`;
}

export function compose(kept: Kept, now: number, away: Away, extra: readonly (AwayLine | null)[]): Letter {
  const lines: AwayLine[] = [];
  // What pays (or has paid) goes first, Leaf before Coins; then the news.
  const all = [...away.lines, ...extra.filter((l) => l !== null)];
  for (const l of all) if (l.pay?.kind === "leaf" || (!l.pay && l.got !== undefined)) lines.push(l);
  for (const l of all) if (l.pay?.kind === "coins") lines.push(l);
  for (const l of all) if (!l.pay && l.got === undefined) lines.push(l);
  let leaf = 0;
  let coins = 0;
  for (const l of lines) {
    if (l.pay?.kind === "leaf") leaf += l.pay.amount;
    else if (l.pay) coins += l.pay.amount;
  }
  return {
    show: away.first || kept.welcomed !== dayOf(now) || leaf + coins > 0 || lines.some((l) => l.got !== undefined),
    title: away.first ? "Welcome home" : "Welcome back",
    sub: away.first ? "The guild kept these for you:" : `Gone ${span(minutesAway(kept, now))}. Meanwhile:`,
    lines,
    leaf,
    coins,
  };
}

/** The record as it stands once the letter has been read and paid: welcomed today, seen now. */
export function read(kept: Kept, now: number): Kept {
  return { ...kept, welcomed: dayOf(now), lastSeen: now };
}
