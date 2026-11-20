import {
  allotMonths,
  conversionCost,
  type ConversionKind,
  type ConversionRules,
  leaf,
  type PlayerId,
  utcMonth,
  withinMemberLimit,
} from "@sequoia-leaf/core";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";

import { type ConversionEvent, Events } from "../events/store.ts";
import type { Visitor } from "../grove/actions.ts";
import { Ledger } from "../ledger/store.ts";
import { conversionJson, type Standing } from "./json.ts";
import { type Conversion, Conversions } from "./store.ts";

// Leaf out to LE, tomes and aspects. A member's claim spends their Leaf at once,
// sink `conversion`, and waits in its kind's queue until staff pay it in-game or
// decline it, which gives the Leaf back. Each month pays out up to its cap; a
// claim that doesn't fit waits, in order, for the months after.

/** Why a claim is refused. Nothing is written when it is. */
export type ConversionRefusal =
  /** The balance doesn't cover it. */
  | "insufficient_leaf"
  /** The request id was used before for a different claim. */
  | "request_conflict"
  /** The member already claimed as much of this kind this month as one member may. */
  | "member_limit"
  /** No such claim, or one that isn't the member's. */
  | "conversion_not_found"
  /** It was already paid, declined or cancelled. */
  | "not_pending"
  /** Its month's allowance hasn't come yet. */
  | "not_due"
  /** Staff can't pay their own claim. */
  | "own_claim";

export type Refused = { readonly status: "refused"; readonly reason: ConversionRefusal };

const refused = (reason: ConversionRefusal): Refused => ({ status: "refused", reason });

/** The ledger key of a claim's spend. Its refund is the spend's reversal, `undo:` and the same key. */
const spendKey = (id: number) => `conversion:${id}`;

/** Where every waiting claim of a kind stands, by its id, in the order they wait. */
export const queueOf = Effect.fn("queueOf")(function* (kind: ConversionKind, rules: ConversionRules) {
  const queue = yield* Conversions.use((conversions) => conversions.queue(kind));
  const months = yield* allotted(kind, queue, rules);
  const standings = new Map<number, Standing>();
  for (const [index, claim] of queue.entries()) {
    const month = months[index];
    if (claim.status === "pending" && month !== undefined) {
      standings.set(claim.id, { month, position: standings.size + 1 });
    }
  }
  return standings;
});

/** The month a new claim of the fewest units this kind takes would be paid from, were it made at `now`. */
export const nextDueMonth = Effect.fn("nextDueMonth")(function* (
  kind: ConversionKind,
  now: number,
  rules: ConversionRules,
) {
  const queue = yield* Conversions.use((conversions) => conversions.queue(kind));
  const month = utcMonth(now);
  const joining = {
    id: Number.MAX_SAFE_INTEGER,
    units: rules.kinds[kind].minUnits,
    requestedMonth: month,
    paidMonth: null,
  };
  const months = yield* allotted(kind, [...queue, joining], rules);
  return months.at(-1) ?? month;
});

/**
 * The month that pays each claim of a kind's queue, in its order, after what
 * the claims made before the queue's first were paid from each month.
 */
const allotted = Effect.fnUntraced(function* (
  kind: ConversionKind,
  queue: readonly {
    readonly id: number;
    readonly units: number;
    readonly requestedMonth: number;
    readonly paidMonth: number | null;
  }[],
  rules: ConversionRules,
) {
  const [first] = queue;
  if (first === undefined) {
    return [];
  }
  const paidBefore = yield* Conversions.use((conversions) =>
    conversions.paidBefore(kind, first.id, first.requestedMonth),
  );
  return allotMonths(queue, paidBefore, rules.kinds[kind].monthlyCap);
});

/**
 * Claims Leaf out as `units` of a kind, which must be a number `conversionCost`
 * takes. The Leaf is spent through the ledger, sink `conversion`, keyed by the
 * claim, and the claim joins the end of its kind's queue, however full this
 * month is. A request sent again answers with the claim it made.
 */
export const requestConversion = Effect.fn("requestConversion")(function* (
  member: Visitor,
  kind: ConversionKind,
  units: number,
  note: string | null,
  requestId: string,
  now: number,
  rules: ConversionRules,
) {
  const sql = yield* SqlClient.SqlClient;
  const conversions = yield* Conversions;
  const ledger = yield* Ledger;
  return yield* sql
    .withTransaction(
      Effect.gen(function* () {
        const earlier = yield* conversions.conversionFor(member.playerId, requestId);
        if (earlier !== undefined) {
          const same = earlier.kind === kind && earlier.units === units && earlier.note === note;
          return same ? yield* claimed(earlier, rules) : refused("request_conflict");
        }
        const cost = conversionCost(kind, units, rules);
        if (cost === undefined) {
          return yield* Effect.die(new Error(`A claim of ${units} ${kind} reached Leaf unchecked`));
        }
        const month = utcMonth(now);
        const used = yield* conversions.claimedIn(member.playerId, kind, month);
        if (!withinMemberLimit(used, units, rules.kinds[kind])) {
          return refused("member_limit");
        }
        // The transaction holds the database's write lock, so the balance can't change before the spend.
        if ((yield* ledger.account(member.playerId)).balance < cost) {
          return refused("insufficient_leaf");
        }
        const id = yield* conversions.create(
          {
            playerId: member.playerId,
            username: member.username,
            requestId,
            kind,
            units,
            leaf: cost,
            note,
            requestedMonth: month,
          },
          now,
        );
        const spent = yield* ledger.post(
          {
            kind: "spend",
            playerId: member.playerId,
            amount: leaf(cost),
            sink: "conversion",
            idempotencyKey: spendKey(id),
            memo: `${units} × ${rules.kinds[kind].name}`,
          },
          now,
        );
        if (spent.status !== "posted") {
          return yield* Effect.die(new Error(`Claim ${id}'s spend was not posted: ${JSON.stringify(spent)}`));
        }
        const result = yield* claimed(yield* found(conversions.conversion(id)), rules);
        yield* tell(result.conversion, "conversion.requested", result.standing, now);
        return result;
      }),
    )
    .pipe(Effect.orDie);
});

/** Cancels the member's own claim while it waits, and gives its Leaf back. Cancelling it again changes nothing. */
export const cancelConversion = Effect.fn("cancelConversion")(function* (
  member: PlayerId,
  id: number,
  now: number,
  rules: ConversionRules,
) {
  return yield* close(id, now, rules, (conversion) => {
    if (conversion.playerId !== member) {
      return refused("conversion_not_found");
    }
    return conversion.status === "cancelled" ? "repeat" : { status: "cancelled", actor: member, note: null };
  });
});

/**
 * Marks a claim paid in-game, by the staff member who paid it, once its
 * month's allowance has come. The month is recorded, so it counts against
 * that month's cap. Paying it again changes nothing.
 */
export const payConversion = Effect.fn("payConversion")(function* (
  staff: PlayerId,
  id: number,
  note: string | null,
  now: number,
  rules: ConversionRules,
) {
  return yield* close(id, now, rules, (conversion, standing) => {
    if (conversion.status === "paid") {
      return "repeat";
    }
    if (conversion.status !== "pending") {
      return refused("not_pending");
    }
    if (conversion.playerId === staff) {
      return refused("own_claim");
    }
    if (standing === undefined || standing.month > utcMonth(now)) {
      return refused("not_due");
    }
    return { status: "paid", actor: staff, note, paidMonth: standing.month };
  });
});

/** Declines a waiting claim, giving its Leaf back, with the reason the member is told. Declining it again changes nothing. */
export const declineConversion = Effect.fn("declineConversion")(function* (
  staff: PlayerId,
  id: number,
  reason: string,
  now: number,
  rules: ConversionRules,
) {
  return yield* close(id, now, rules, (conversion) =>
    conversion.status === "declined" ? "repeat" : { status: "declined", actor: staff, note: reason },
  );
});

type Closing =
  | Refused
  | "repeat"
  | {
      readonly status: "paid" | "declined" | "cancelled";
      readonly actor: PlayerId;
      readonly note: string | null;
      readonly paidMonth?: number;
    };

/**
 * Closes a claim as `decide` says, in one transaction: a declined or cancelled
 * one's spend is reversed, and the member is told of a paid or declined one.
 * A claim already closed some other way is refused with `not_pending`.
 */
const close = Effect.fnUntraced(function* (
  id: number,
  now: number,
  rules: ConversionRules,
  decide: (conversion: Conversion, standing: Standing | undefined) => Closing,
) {
  const sql = yield* SqlClient.SqlClient;
  const conversions = yield* Conversions;
  const ledger = yield* Ledger;
  return yield* sql
    .withTransaction(
      Effect.gen(function* () {
        const conversion = yield* conversions.conversion(id);
        if (conversion === undefined) {
          return refused("conversion_not_found");
        }
        const queue =
          conversion.status === "pending" ? yield* queueOf(conversion.kind, rules) : new Map<number, Standing>();
        const decision = decide(conversion, queue.get(id));
        if (decision === "repeat") {
          return yield* claimed(conversion, rules);
        }
        if ("reason" in decision) {
          return decision;
        }
        if (conversion.status !== "pending") {
          return refused("not_pending");
        }
        const { status, actor, note, paidMonth } = decision;
        yield* conversions.close(id, status, { actor, note, paidMonth: paidMonth ?? null }, now);
        if (status !== "paid") {
          const spend = yield* ledger.entry(spendKey(id));
          if (spend === undefined) {
            return yield* Effect.die(new Error(`Claim ${id} has no spend to refund`));
          }
          const refunded = yield* ledger.post(
            {
              kind: "reversal",
              playerId: conversion.playerId,
              reverses: spend,
              idempotencyKey: `undo:${spendKey(id)}`,
              actor,
            },
            now,
          );
          if (refunded.status === "rejected") {
            return yield* Effect.die(new Error(`Claim ${id}'s refund was refused: ${refunded.reason}`));
          }
        }
        const result = yield* claimed(yield* found(conversions.conversion(id)), rules);
        if (status === "paid" || status === "declined") {
          yield* tell(result.conversion, status === "paid" ? "conversion.paid" : "conversion.declined", undefined, now);
        }
        return result;
      }),
    )
    .pipe(Effect.orDie);
});

/** A claim and, while it waits, where it stands in its queue. */
const claimed = Effect.fnUntraced(function* (conversion: Conversion, rules: ConversionRules) {
  const standing =
    conversion.status === "pending" ? (yield* queueOf(conversion.kind, rules)).get(conversion.id) : undefined;
  return { status: "claimed" as const, conversion, standing };
});

const tell = Effect.fnUntraced(function* (
  conversion: Conversion,
  type: ConversionEvent["type"],
  standing: Standing | undefined,
  now: number,
) {
  const events = yield* Events;
  const event: ConversionEvent = { type, data: { conversion: conversionJson(conversion, standing, now) } };
  yield* events.insert(conversion.playerId, event, now);
});

const found = <A>(effect: Effect.Effect<A | undefined>) =>
  effect.pipe(
    Effect.flatMap((value) =>
      value === undefined ? Effect.die(new Error("A claim vanished inside its transaction")) : Effect.succeed(value),
    ),
  );
