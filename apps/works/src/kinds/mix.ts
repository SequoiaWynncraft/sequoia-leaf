/**
 * What the cards of the kinds that break a mix share on the page (the breaker, the still): the things
 * of its mix in order as a row of pictures, and what it gives of each a minute. One whose ways out
 * each send one thing (the still's three) says it by way out, naming each.
 */
import { isItem, type Item, type Kind, MIX_OF, mixPerMinute, mixShare, outsAs, wayNames } from "@sequoia-leaf/factory";
import type { Row, Stat } from "@sequoia-leaf/kit/card.ts";
import { perMinute } from "@sequoia-leaf/kit/say.ts";

import type { StandingPrint } from "../ui/cards.ts";
import { itemRef } from "../ui/refs.ts";

/**
 * A mix's pace, by what it does to what goes in (`label`: "Breaks", "Distils"): its kind's, at a grade
 * flat out; and a standing one's, what it does now (`StandingPrint.rate`, the rules' `rateOf`, with
 * power, smog and what its ways out carry), the rate its rows are of.
 */
export const mixPace = (
  label: string,
): { readonly kind: (k: Kind, grade: number) => Stat; readonly now: (p: StandingPrint) => Stat } => ({
  kind: (k, grade) => ({ label, value: perMinute(mixPerMinute(k, grade)) }),
  now: (p) => ({ label, value: perMinute(p.rate ?? 0) }),
});

/** A word with its first letter made a capital: "Left". */
const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A mix's rows: its things in order, on a standing one the next (`next`) picked out; and each thing it
 * gives a minute, of `total` a minute in all (at the card's grade flat out, or on a standing one what
 * it gives now, no more than its ways out carry), by its way out where each sends one thing.
 */
export function mixRows(k: Kind, next: number | null, total: number): Row[] {
  const gives = MIX_OF[k]?.gives ?? [];
  const each = (n: Item): { ref: ReturnType<typeof itemRef>; note: string } => ({
    ref: itemRef(n),
    note: perMinute(total * mixShare(k, n)),
  });
  const strip: Row = {
    label: "Gives, in this order",
    look: "icons",
    things: gives.map((n, at) => ({ ref: itemRef(n), lit: at === next })),
  };
  const ways = outsAs(k, 0).flatMap((o) => (isItem(o.only) ? [o.only] : []));
  if (ways.length === 0) return [strip, { label: "A minute", things: [...new Set(gives)].map(each) }];
  const names = wayNames(ways.length);
  return [strip, ...ways.map((n, w): Row => ({ label: `${capital(names[w] ?? "")} way out`, things: [each(n)] }))];
}
