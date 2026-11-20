import { MAX_LEAF } from "./leaf.ts";

// Leaf out to Wynncraft's own goods: Liquid Emeralds, tomes and aspects. Staff
// pay them in-game, so a member's Leaf is spent when they ask and the claim
// waits in a queue. The guild's budget for each is a monthly cap: a claim that
// doesn't fit this month waits, in order, for the first month that has room.
// It is never dropped. The numbers are data (`ConversionRules`, set in rules.ts).

/** What Leaf converts to: Liquid Emeralds (`le`), a tome or an aspect. */
export const CONVERSION_KINDS = ["le", "tome", "aspect"] as const;
export type ConversionKind = (typeof CONVERSION_KINDS)[number];

/**
 * Where a claim stands: waiting to be paid, paid in-game by staff, declined by
 * staff, or cancelled by the member. Only a waiting claim changes.
 */
export const CONVERSION_STATUSES = ["pending", "paid", "declined", "cancelled"] as const;
export type ConversionStatus = (typeof CONVERSION_STATUSES)[number];

export interface ConversionRule {
  /** As members see it, such as `Liquid Emerald`. */
  readonly name: string;
  /** Leaf one unit costs: one LE, one tome, one aspect. */
  readonly leafPerUnit: number;
  /** The fewest and the most units one claim may ask for. */
  readonly minUnits: number;
  readonly maxUnits: number;
  /** Units the guild pays out each calendar month in UTC, for everyone together. */
  readonly monthlyCap: number;
  /** Units one member may ask for in a calendar month, or undefined for no limit of their own. */
  readonly memberMonthly?: number;
}

export interface ConversionRules {
  /** True while the rates are a first proposal still to be tuned, so clients can say so. */
  readonly provisional: boolean;
  readonly kinds: Readonly<Record<ConversionKind, ConversionRule>>;
  /** Characters a claim's note, such as which aspect, or a staff member's reason may have. */
  readonly note: { readonly max: number };
}

/** The Leaf a claim for `units` costs, or undefined when the rules don't take that many. */
export function conversionCost(kind: ConversionKind, units: number, rules: ConversionRules): number | undefined {
  const rule = rules.kinds[kind];
  if (!Number.isInteger(units) || units < rule.minUnits || units > rule.maxUnits) {
    return undefined;
  }
  const leaf = units * rule.leafPerUnit;
  return Number.isInteger(leaf) && leaf > 0 && leaf <= MAX_LEAF ? leaf : undefined;
}

/** Whether a member who asked for `used` units this month may ask for `units` more. */
export function withinMemberLimit(used: number, units: number, rule: ConversionRule): boolean {
  return rule.memberMonthly === undefined || used + units <= rule.memberMonthly;
}

/** The calendar month a moment falls in, in UTC, counted from January 1970 as 0. */
export function utcMonth(at: number): number {
  const date = new Date(at);
  return (date.getUTCFullYear() - 1970) * 12 + date.getUTCMonth();
}

/** The first moment of a month counted as `utcMonth` counts them. */
export function utcMonthStart(month: number): number {
  return Date.UTC(1970 + Math.floor(month / 12), ((month % 12) + 12) % 12);
}

/** A claim in its kind's queue: waiting, or paid from `paidMonth`. */
export interface QueuedClaim {
  readonly units: number;
  readonly requestedMonth: number;
  readonly paidMonth: number | null;
}

/**
 * The month each claim in a kind's queue is paid from, in the order they were
 * made, so the claims paid keep theirs and the ones waiting get one.
 *
 * `queue` is the kind's claims from the first that waits on, paid and waiting,
 * in the order they were made; `paidBefore` is how many units the claims made
 * before it were paid from each month. Every claim stands behind every claim
 * made before it, paid or waiting: a waiting claim takes the first month, from
 * the one it was made in and never before the month of any claim ahead of it,
 * whose allowance still has room for it once what was paid from that month is
 * counted. So no claim passes another, and no month pays out more than `cap`.
 * A claim bigger than a whole month's cap, which the rules shouldn't allow,
 * takes a month to itself.
 *
 * A month's allowance that nobody claims is not carried over: a claim made
 * later starts from its own month. When a claim ahead leaves the queue, the
 * ones behind it move up.
 */
export function allotMonths(
  queue: readonly QueuedClaim[],
  paidBefore: ReadonlyMap<number, number>,
  cap: number,
): readonly number[] {
  const filled = new Map(paidBefore);
  for (const { units, paidMonth } of queue) {
    if (paidMonth !== null) {
      filled.set(paidMonth, (filled.get(paidMonth) ?? 0) + units);
    }
  }
  let ahead = Math.max(Number.NEGATIVE_INFINITY, ...paidBefore.keys());
  return queue.map(({ units, requestedMonth, paidMonth }) => {
    if (paidMonth !== null) {
      ahead = Math.max(ahead, paidMonth);
      return paidMonth;
    }
    let month = Math.max(ahead, requestedMonth);
    while ((filled.get(month) ?? 0) > 0 && (filled.get(month) ?? 0) + units > cap) {
      month += 1;
    }
    filled.set(month, (filled.get(month) ?? 0) + units);
    ahead = month;
    return month;
  });
}
