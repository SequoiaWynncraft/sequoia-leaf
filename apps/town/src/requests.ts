/**
 * What the Treasury shows of each guild request, from two things kept apart: what Leaf says of it now
 * (its offer, replaced whole by every answer to `GET /v1/game/requests`), and what the member's last
 * try at it came to (`POST /v1/game/requests`). A row is drawn from both (`shown`), so an offer never
 * outlives the answer that made it, and a receipt or a refusal stays under its row while offers change.
 */

import { type LeRate, leRateText, leTooDear, leTooFew, type RequestKind } from "@sequoia-leaf/core";
import { type Answer, isRecord } from "@sequoia-leaf/kit/net.ts";
import { whole } from "@sequoia-leaf/kit/say.ts";

/** The guild's requests the Treasury sells, in the order it lists them. */
export const KINDS: readonly RequestKind[] = ["aspect", "tome", "le"];

export const LOST = "Could not tell whether the request went through. Check the queue in Discord before trying again.";
const UNREACHED = "The guild's requests could not be reached. Try again in a moment.";

/** What Leaf says of a request now. */
export type Offer =
  /** On sale at `price` Leaf (for LE, Leaf for 1 LE, at least `minimum`), and why the member cannot buy it now, or null. */
  | { readonly sold: true; readonly price: number; readonly minimum: number; readonly whyNot: string | null }
  /** Not on sale now, and why, in Leaf's or the backend's words. */
  | { readonly sold: false; readonly why: string };

/** Every request's offer: an aspect's and a tome's always once Leaf has answered, LE's only while the backend sells it. */
export type Offers = Partial<Readonly<Record<RequestKind, Offer>>>;

/** What the member's last try at a request came to. */
export type Outcome =
  /** Made: the receipt. */
  | { readonly is: "made"; readonly text: string }
  /** Refused by the backend, in its words; nothing was taken. */
  | { readonly is: "refused"; readonly text: string }
  /** Not made, nothing taken, and it may be tried again as it stands: the guild's server was busy, or the number will not do. */
  | { readonly is: "again"; readonly text: string }
  /** No answer that says: it may have been made, and must not be sent again. */
  | { readonly is: "lost" };

/** A line under a request's name. */
export interface Line {
  readonly text: string;
  readonly tone: "k-gold" | "k-coral" | "k-dim";
}

/** What a request's button buys at: its price in Leaf (for LE, for 1 LE), and the fewest sold at once (1 but for LE). */
export interface Sale {
  readonly price: number;
  readonly minimum: number;
}

/** What a request's row shows now. */
export interface Shown {
  /** Not there at all: LE, while the backend sells none and the member has tried none. */
  readonly hidden: boolean;
  /** What its button buys at, or null for no button. */
  readonly sale: Sale | null;
  /** LE's rate and minimum while it is on sale: "200 Leaf for 1 LE, at least 32 LE." */
  readonly rate: string | null;
  /** What the last try came to, or else why it cannot be bought now. */
  readonly said: Line | null;
}

/** One request's offer in Leaf's answer, or what to say for one missing; LE missing is LE not sold. */
function offerIn(kind: RequestKind, said: unknown, why: string): Offer | undefined {
  const minimum = kind === "le" ? (isRecord(said) ? said.minimum : undefined) : 1;
  if (isRecord(said) && typeof said.price === "number" && typeof minimum === "number") {
    const whyNot = typeof said.why_not === "string" ? said.why_not : null;
    return { sold: true, price: said.price, minimum, whyNot };
  }
  return kind === "le" ? undefined : { sold: false, why };
}

/**
 * Leaf's answer to `GET /v1/game/requests`, as every request's offer now. One missing, or an answer
 * that is not one, leaves an aspect and a tome not on sale, in the answer's words or in the Treasury's
 * own, and LE not there at all.
 */
export function offersOf(answer: Answer): Offers {
  const body = answer.status === 200 && isRecord(answer.body) ? answer.body : null;
  const why = isRecord(answer.body) && typeof answer.body.message === "string" ? answer.body.message : UNREACHED;
  const offers: Partial<Record<RequestKind, Offer>> = {};
  for (const kind of KINDS) {
    const offer = offerIn(kind, body?.[kind], why);
    if (offer) offers[kind] = offer;
  }
  return offers;
}

/** A request as a sentence names it: "your tome request", "your 40 LE request". */
export const named = (kind: RequestKind, amount: number): string => (kind === "le" ? `${whole(amount)} LE` : kind);

/** Leaf's answer to `POST /v1/game/requests` for the request named `what` ("tome", "40 LE"), as what the try came to. */
export function outcomeOf(answer: Answer, what: string): Outcome {
  const made = answer.status === 200 && isRecord(answer.body) ? answer.body : null;
  const [position, paid, left] = [made?.position, made?.leaf_paid, made?.leaf];
  if (typeof position === "number" && typeof paid === "number" && typeof left === "number") {
    const text = `Added your ${what} request to the queue at position #${position}. ${whole(paid)} Leaf paid; you have ${whole(left)} left.`;
    return { is: "made", text };
  }
  const message = isRecord(answer.body) ? answer.body.message : null;
  if (typeof message !== "string") return { is: "lost" };
  // The guild's server was busy: nothing was taken, and the same may be sent again.
  if (answer.status === 503) return { is: "again", text: message };
  return answer.status >= 400 && answer.status < 500 ? { is: "refused", text: message } : { is: "lost" };
}

/**
 * Whether what a try came to takes its row's button away. A request made, or one that may have been,
 * is not bought again. An aspect or a tome refused stays refused; LE refused keeps its button, as the
 * backend's words for too little Leaf and for one already waiting come the same way, and a member who
 * changes the number may try again.
 */
export const locks = (kind: RequestKind, outcome: Outcome): boolean =>
  outcome.is === "made" || outcome.is === "lost" || (outcome.is === "refused" && kind !== "le");

/** The line a try came to. */
function lineOf(outcome: Outcome): Line {
  if (outcome.is === "lost") return { text: LOST, tone: "k-coral" };
  return { text: outcome.text, tone: outcome.is === "made" ? "k-gold" : "k-coral" };
}

/** The line an offer says where the member cannot buy it now, if any. */
function reasonOf(offer: Offer): Line | null {
  const why = offer.sold ? offer.whyNot : offer.why;
  return why === null ? null : { text: why, tone: "k-dim" };
}

/** What a request's row shows, from its offer now and what the member's last try at it came to. */
export function shown(kind: RequestKind, offer: Offer | undefined, outcome: Outcome | undefined): Shown {
  const sold = offer?.sold ? offer : null;
  const open = sold !== null && sold.whyNot === null && (outcome === undefined || !locks(kind, outcome));
  return {
    hidden: kind === "le" && offer === undefined && outcome === undefined,
    sale: open ? { price: sold.price, minimum: sold.minimum } : null,
    rate: kind === "le" && sold ? leRateText({ leafPerLe: sold.price, minimum: sold.minimum }) : null,
    said: outcome ? lineOf(outcome) : offer ? reasonOf(offer) : null,
  };
}

/** Why `amount` LE on sale at `sale` will not do for a member with `leaf` Leaf (not whole, too few, more than they have), or null. */
export function leBlocked({ price, minimum }: Sale, amount: number, leaf: number): string | null {
  const rate: LeRate = { leafPerLe: price, minimum };
  if (!Number.isInteger(amount) || amount < minimum) return leTooFew(rate);
  return amount * price > leaf ? leTooDear(amount, rate, leaf) : null;
}
