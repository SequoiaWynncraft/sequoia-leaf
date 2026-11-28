import { describe, expect, test } from "bun:test";

import { isRecord } from "@sequoia-leaf/kit/net.ts";

import { gameContract } from "../../../contracts/game.ts";
import { leBlocked, LOST, named, type Offers, offersOf, type Outcome, outcomeOf, shown } from "./requests.ts";

/** What Leaf answers the Treasury, as recorded from the real routes. */
const GAME: unknown = gameContract();

/** A recorded exchange's answer: its status and body. */
function recorded(name: string): { status: number; body: unknown } {
  const exchange = isRecord(GAME) ? GAME[name] : undefined;
  if (!isRecord(exchange) || typeof exchange.status !== "number") throw new Error(`the contract has no ${name}`);
  return { status: exchange.status, body: exchange.body };
}

/** The recorded offer, LE among it, with `change` made to its body. */
function offered(change: (body: Record<string, unknown>) => Record<string, unknown>): Offers {
  const { status, body } = recorded("GET /v1/game/requests");
  if (!isRecord(body)) throw new Error("the recorded offer is not an object");
  return offersOf({ status, body: change(body) });
}

/** An object without one of its keys. */
const without = (body: Record<string, unknown>, key: string) =>
  Object.fromEntries(Object.entries(body).filter(([k]) => k !== key));

const RATE = "200 Leaf for 1 LE, at least 32 LE.";
const le = (offers: Offers, outcome?: Outcome) => shown("le", offers.le, outcome);

describe("what the Treasury offers, as Leaf last answered", () => {
  test("every answer replaces the offers whole: LE comes, goes and comes back, and turns buyable", () => {
    // As recorded: Alice has 4,163 Leaf, under 32 LE's 6,400.
    const short = offered((body) => body);
    expect(le(short)).toEqual({
      hidden: false,
      sale: null,
      rate: RATE,
      said: { text: "32 LE costs 6,400 Leaf. You have 4,163.", tone: "k-dim" },
    });
    expect(shown("aspect", short.aspect, undefined)).toEqual({
      hidden: false,
      sale: { price: 3000, minimum: 1 },
      rate: null,
      said: null,
    });

    const enough = offered((body) => ({ ...body, le: { price: 200, minimum: 32, why_not: null } }));
    expect(le(enough)).toEqual({ hidden: false, sale: { price: 200, minimum: 32 }, rate: RATE, said: null });

    // A backend from before LE, or one that stopped selling it: no LE row at all.
    const none = offered((body) => without(body, "le"));
    expect(none.le).toBeUndefined();
    expect(le(none)).toEqual({ hidden: true, sale: null, rate: null, said: null });

    // And back on sale at the next answer.
    expect(le(offered((body) => body))).toMatchObject({ hidden: false, rate: RATE });
  });

  test("an aspect's reason goes when an answer has none, and a missing offer is the unreached line", () => {
    const why = "An aspect request costs 3,000 Leaf. You have 1,200.";
    const short = offered((body) => ({ ...body, aspect: { price: 3000, why_not: why } }));
    expect(shown("aspect", short.aspect, undefined)).toMatchObject({ sale: null, said: { text: why, tone: "k-dim" } });
    const enough = offered((body) => body);
    expect(shown("aspect", enough.aspect, undefined)).toMatchObject({ sale: { price: 3000 }, said: null });

    const unreached = "The guild's requests could not be reached. Try again in a moment.";
    const missing = offered((body) => without(body, "aspect"));
    expect(shown("aspect", missing.aspect, undefined)).toEqual({
      hidden: false,
      sale: null,
      rate: null,
      said: { text: unreached, tone: "k-dim" },
    });
  });

  test("an answer that is not one says why for the aspect and the tome, in its words, and has no LE", () => {
    const busy = { code: "requests_unavailable", message: "The guild's requests could not be reached." };
    const offers = offersOf({ status: 503, body: busy });
    for (const kind of ["aspect", "tome"] as const) {
      expect(shown(kind, offers[kind], undefined).said).toEqual({ text: busy.message, tone: "k-dim" });
    }
    expect(le(offers).hidden).toBe(true);
    expect(offersOf({ status: 0, body: null }).tome).toEqual({
      sold: false,
      why: "The guild's requests could not be reached. Try again in a moment.",
    });
  });
});

describe("what the member's last try came to", () => {
  const enough = offered((body) => ({ ...body, le: { price: 200, minimum: 32, why_not: null } }));

  test("made: the receipt in gold, and no button, whatever Leaf offers after", () => {
    const made = outcomeOf(recorded("POST /v1/game/requests, LE"), named("le", 40));
    const receipt = "Added your 40 LE request to the queue at position #2. 8,000 Leaf paid; you have 1,163 left.";
    expect(made).toEqual({ is: "made", text: receipt });
    expect(le(enough, made)).toEqual({
      hidden: false,
      sale: null,
      rate: RATE,
      said: { text: receipt, tone: "k-gold" },
    });
    // Leaf stopped offering LE meanwhile: the receipt still shows.
    expect(le(offersOf({ status: 200, body: { aspect: {}, tome: {} } }), made)).toMatchObject({
      hidden: false,
      said: { text: receipt },
    });
    // An aspect's and a tome's receipts say their kind, as before LE.
    expect(outcomeOf(recorded("POST /v1/game/requests"), named("tome", 0))).toEqual({
      is: "made",
      text: "Added your tome request to the queue at position #2. 3,000 Leaf paid; you have 1,163 left.",
    });
  });

  test("an LE refusal keeps the field and the button, so another number may be tried; an aspect's or a tome's takes it away", () => {
    const refused = outcomeOf(recorded("POST /v1/game/requests, refused"), named("le", 40));
    const words = "You already have a pending tome request in the queue.";
    expect(refused).toEqual({ is: "refused", text: words });
    expect(le(enough, refused)).toEqual({
      hidden: false,
      sale: { price: 200, minimum: 32 },
      rate: RATE,
      said: { text: words, tone: "k-coral" },
    });
    expect(shown("tome", enough.tome, refused)).toMatchObject({ sale: null, said: { text: words, tone: "k-coral" } });
  });

  test("not knowing takes every button away; a busy server keeps them", () => {
    const unknown = outcomeOf({ status: 504, body: { code: "request_unknown", message: "Could not tell." } }, "aspect");
    expect(unknown).toEqual({ is: "lost" });
    expect(le(enough, unknown)).toMatchObject({ sale: null, said: { text: LOST, tone: "k-coral" } });
    expect(outcomeOf({ status: 0, body: null }, "aspect")).toEqual({ is: "lost" });

    const busy = outcomeOf({ status: 503, body: { message: "Try again in a minute." } }, "aspect");
    expect(busy).toEqual({ is: "again", text: "Try again in a minute." });
    expect(shown("aspect", enough.aspect, busy)).toMatchObject({ sale: { price: 3000 }, said: { tone: "k-coral" } });
    expect(le(enough, busy).sale).not.toBeNull();
  });
});

describe("how many LE", () => {
  const sale = { price: 200, minimum: 32 };
  test("is whole, at least the fewest sold, and no more than the member's Leaf pays for", () => {
    expect(leBlocked(sale, 32, 6400)).toBeNull();
    expect(leBlocked(sale, 10, 50_000)).toBe("Ask for at least 32 LE, in whole LE.");
    expect(leBlocked(sale, 32.5, 50_000)).toBe("Ask for at least 32 LE, in whole LE.");
    expect(leBlocked(sale, 0, 50_000)).toBe("Ask for at least 32 LE, in whole LE.");
    expect(leBlocked(sale, 40, 6500)).toBe("40 LE costs 8,000 Leaf. You have 6,500.");
  });
});
