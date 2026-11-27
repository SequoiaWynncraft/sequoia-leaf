/**
 * What a command did (`commands.ts`): the Coins it moved, each a change keyed by the yard's count of
 * them, and what it logged; or the rules' refusal, with the code Leaf answers and the page's sentence.
 */
import type { CoinChange, Logged, Refused } from "@sequoia-leaf/core";

import type { Refund, Spent } from "./build.ts";
import { REASON } from "./reasons.ts";
import { collect, type Yard } from "./yard.ts";

/** A command the rules turned down: the code Leaf answers, and the sentence the page says. */
export type Turned = Refused & { readonly why: string };

/** What a command did: the Coins it moved and what it logged, or the rules' refusal. */
export type Did = { readonly coins: CoinChange[]; readonly log: Logged[] } | Turned;
export const done = (coins: CoinChange[] = [], log: Logged[] = []): Did => ({ coins, log });

export function change(y: Yard, amount: number, reason: string, free: boolean): CoinChange {
  const key = `bank:${y.bank++}`;
  return free ? { amount, reason, key, free: true } : { amount, reason, key };
}
export function payIn(y: Yard): CoinChange[] {
  const coins = collect(y);
  return coins > 0 ? [change(y, coins, REASON.till, true)] : [];
}
/** A price paid: the till paid in first, then the price taken (or, below nothing, given back, free, for `back`). */
export function priced(y: Yard, price: number, reason: string, back: string = REASON.lower): CoinChange[] {
  const paid = payIn(y);
  if (price < 0) return [...paid, change(y, -price, back, true)];
  return price > 0 ? [...paid, change(y, -price, reason, false)] : paid;
}

/** Done, if the rules spent Coins, with what it cost paid as `reason`; else refused with their reason. */
export const spent = (y: Yard, did: Spent, reason: string, no: (why: string) => Turned): Did =>
  did.ok ? done(priced(y, did.cost, reason)) : no(did.why);
/** Done, if the rules took something away, with what came back given free; else refused with their reason. */
export const refunded = (y: Yard, did: Refund, no: (why: string) => Turned): Did =>
  did.ok ? done(did.refund > 0 ? [change(y, did.refund, REASON.remove, true)] : []) : no(did.why);

/** Refused with what the rules said; or where they said null, done, `then` done first. */
export function doneUnless(why: string | null, no: (why: string) => Turned, then?: () => void): Did {
  if (why !== null) return no(why);
  then?.();
  return done();
}
