import {
  CARE_TOOLS,
  CONVERSION_KINDS,
  CONVERSION_STATUSES,
  DEFAULT_RULES,
  GREAT_GOAL_KINDS,
  GROVE_RANKS,
  LISTING_KINDS,
  ORDER_STATES,
} from "@sequoia-leaf/core";
import { Schema } from "effect";

// What each route answers, field for field. Names are snake_case, as the mod and
// the other Sequoia services use. Times are ISO 8601 strings in UTC.

const Time = Schema.String;

export const Health = Schema.Struct({ status: Schema.Literal("ok") });

export const Me = Schema.Struct({
  player: Schema.Struct({ id: Schema.String, username: Schema.String }),
  leaf: Schema.Number,
  xp: Schema.Number,
  level: Schema.Struct({
    number: Schema.Number,
    xp_into_level: Schema.Number,
    xp_for_next_level: Schema.Number,
  }),
});

const ObjectiveType = Schema.Literals(["raids", "wars", "season_rating"]);

/** A quest, in every answer and event that carries one. */
export const QuestJson = Schema.Struct({
  /** `<slot>:<sequence>`, such as `daily:4`. */
  id: Schema.String,
  slot: Schema.Literals(["daily", "weekly", "timed", "repeatable"]),
  title: Schema.String,
  /** The goal nearest to being met, with `progress` and `target`, for clients that show one bar. */
  objective: Schema.Struct({ type: ObjectiveType, raid: Schema.NullOr(Schema.String) }),
  progress: Schema.Number,
  target: Schema.Number,
  /** Every way to finish the quest; meeting any of them finishes it. */
  goals: Schema.Array(
    Schema.Struct({
      type: ObjectiveType,
      raid: Schema.NullOr(Schema.String),
      title: Schema.String,
      progress: Schema.Number,
      target: Schema.Number,
    }),
  ),
  reward: Schema.Struct({ leaf: Schema.Number, xp: Schema.Number }),
  started_at: Time,
  expires_at: Schema.NullOr(Time),
  completed_at: Schema.NullOr(Time),
});

/** A quest in progress as `/quests` lists it: with what rerolling it costs now, or null when it can't be rerolled. */
export const QuestOnOffer = Schema.Struct({ ...QuestJson.fields, reroll_leaf: Schema.NullOr(Schema.Number) });

export const Quests = Schema.Struct({
  daily: Schema.Struct({
    /** Dailies available, counting the one in progress. */
    charges: Schema.Number,
    charge_cap: Schema.Number,
    /** When the next daily arrives, or null while the bank is full. */
    next_charge_at: Schema.NullOr(Time),
  }),
  /** When the open timed quest ends (null between windows) and when the next opens; null when there are none. */
  timed: Schema.NullOr(Schema.Struct({ ends_at: Schema.NullOr(Time), next_at: Time })),
  quests: Schema.Array(QuestOnOffer),
  recently_completed: Schema.Array(QuestJson),
});

/** The cost the member was shown and agreed to: Leaf charges that or nothing. */
export const RerollBody = Schema.Struct({ leaf: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) });

export const Rerolled = Schema.Struct({
  /** The balance after it. */
  leaf: Schema.Number,
  /** What it cost, 0 for a free reroll. */
  spent: Schema.Number,
  quest: QuestOnOffer,
});

/** Events, oldest first. `data` is the event's details, in the shape its type has (see the README). */
export const Events = Schema.Struct({
  events: Schema.Array(
    Schema.Struct({ id: Schema.Number, type: Schema.String, created_at: Time, data: Schema.Unknown }),
  ),
});

// Sequoia Grove.

/** Names the request, so one sent again does what it does once: any id the client makes, such as a UUID. */
const RequestId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,64}$/));

const GroveRank = Schema.Literals(GROVE_RANKS);

const Charges = Schema.Struct({
  count: Schema.Number,
  max: Schema.Number,
  /** When the next charge comes back, or null while the bank is full. */
  next_at: Schema.NullOr(Time),
});

const Bloom = Schema.Struct({ value: Schema.Number, max: Schema.Number });

const Pity = Schema.Struct({
  /** Cones opened since the last one of `rank` or better, on any banner. */
  count: Schema.Number,
  /** A cone of `rank` or better comes within this many. */
  cones: Schema.Number,
  rank: GroveRank,
});

export const GroveMe = Schema.Struct({
  player: Schema.Struct({ id: Schema.String, username: Schema.String }),
  leaf: Schema.Number,
  /** The tree's level is the member's SEQ level; its variant and spot never change. */
  tree: Schema.Struct({ level: Schema.Number, variant: Schema.Number, spot: Schema.Number }),
  bloom: Bloom,
  charges: Charges,
  cones: Schema.Number,
  pity: Pity,
  /** The banner on, or null when none is. */
  banner: Schema.NullOr(Schema.Struct({ id: Schema.String, title: Schema.String, featured: Schema.String })),
  /** Every spirit the member has opened, in the order they first found it. */
  collection: Schema.Array(
    Schema.Struct({
      spirit: Schema.String,
      rank: GroveRank,
      copies: Schema.Number,
      /** Hearts, from 1: each copy deepens the bond, up to the most a bond can have. */
      bond: Schema.Number,
      verdant: Schema.Boolean,
    }),
  ),
  companion: Schema.NullOr(Schema.String),
});

export const CareBody = Schema.Struct({ tool: Schema.Literals(CARE_TOOLS), request_id: RequestId });

export const Cared = Schema.Struct({
  charges: Charges,
  bloom: Bloom,
  cones: Schema.Number,
  /** Cones this care's Bloom gave: 1 when it filled the Bloom. */
  bloomed: Schema.Number,
});

/** `count` is 1 or 10, as the rate card's `batches` lists. */
export const ConesBody = Schema.Struct({ count: Schema.Int, request_id: RequestId });

export const ConesBought = Schema.Struct({
  /** The balance after it. */
  leaf: Schema.Number,
  spent: Schema.Number,
  /** The cones held after it. */
  cones: Schema.Number,
});

export const ConesOpened = Schema.Struct({
  banner: Schema.String,
  opened: Schema.Array(
    Schema.Struct({
      spirit: Schema.String,
      rank: GroveRank,
      verdant: Schema.Boolean,
      /** Whether pity lifted it to the guaranteed rank. */
      guaranteed: Schema.Boolean,
      /** Whether it is the banner's featured spirit by the featured share. */
      featured: Schema.Boolean,
      /** Which copy of the spirit it was: 1 for a new one. */
      copy: Schema.Number,
      bond: Schema.Number,
    }),
  ),
  /** The pity after the last of them. */
  pity: Pity,
  /** The cones held now. */
  cones: Schema.Number,
});

export const CompanionBody = Schema.Struct({ spirit: Schema.NullOr(Schema.String) });

export const Companion = Schema.Struct({ companion: Schema.NullOr(Schema.String) });

export const Rates = Schema.Struct({
  banner: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      featured: Schema.String,
      /** How often a cone of the featured spirit's rank is the featured spirit. */
      featured_share: Schema.Number,
      starts_at: Time,
    }),
  ),
  cone_price: Schema.Number,
  /** How many cones one purchase or opening can be. */
  batches: Schema.Array(Schema.Number),
  /** Commonest first. Each chance is a share of all cones. */
  ranks: Schema.Array(
    Schema.Struct({
      rank: GroveRank,
      name: Schema.String,
      chance: Schema.Number,
      spirits: Schema.Array(Schema.Struct({ id: Schema.String, chance: Schema.Number })),
    }),
  ),
  pity: Schema.Struct({ cones: Schema.Number, rank: GroveRank }),
  verdant: Schema.Struct({ chance: Schema.Number, copy: Schema.Number }),
  bloom: Schema.Struct({ max: Schema.Number, per_raid: Schema.Number, per_care: Schema.Number }),
  care: Schema.Struct({
    charge_seconds: Schema.Number,
    charge_max: Schema.Number,
    tools: Schema.Array(Schema.Literals(CARE_TOOLS)),
  }),
});

export const Forest = Schema.Struct({
  /** Every member who has opened the Grove, nearest the heart first. */
  trees: Schema.Array(
    Schema.Struct({
      player_id: Schema.String,
      name: Schema.String,
      level: Schema.Number,
      variant: Schema.Number,
      spot: Schema.Number,
      companion: Schema.NullOr(Schema.String),
    }),
  ),
});

// The Great Sequoia.

const GreatGoal = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(GREAT_GOAL_KINDS),
  title: Schema.String,
  /** From 0 to `target`; it never goes past it. */
  progress: Schema.Number,
  target: Schema.Number,
  met: Schema.Boolean,
  /** The cosmetic the whole guild gets when the goal is met. */
  reward: Schema.Struct({ id: Schema.String, title: Schema.String }),
});

const GreatWeek = Schema.Struct({ starts_at: Time, ends_at: Time, goals: Schema.Array(GreatGoal) });

export const Great = Schema.Struct({
  /** This week, Monday to Monday in UTC, and its goals so far. */
  week: GreatWeek,
  /** Last week's goals, as they ended. A goal met then is still rewarded this week. */
  last_week: GreatWeek,
  /** The rewards everyone has now: those of the goals met this week or last. */
  rewards: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String })),
  /**
   * A lantern for everyone who helped this week, in the order they first did.
   * `glow` is a step from 1 up for helping more; it is not a ranking. `name` is
   * null for a member who has not opened the Grove.
   */
  lanterns: Schema.Array(
    Schema.Struct({ player_id: Schema.String, name: Schema.NullOr(Schema.String), glow: Schema.Number }),
  ),
  me: Schema.Struct({
    /** Whether they helped this week, which hangs their lantern and marks a ring on their tree. */
    lantern: Schema.Boolean,
    glow: Schema.Number,
    /** Leaf they offered this week. */
    offered: Schema.Number,
    /** The weeks they have helped in, this one included. */
    rings: Schema.Number,
  }),
  offering: Schema.Struct({ min: Schema.Number, max: Schema.Number }),
});

export const OfferBody = Schema.Struct({ leaf: Schema.Int, request_id: RequestId });

export const Offered = Schema.Struct({
  /** The balance after it. */
  leaf: Schema.Number,
  /** What they have offered in the offering's week, this one included. */
  offered: Schema.Number,
  glow: Schema.Number,
});

// The marketplace and conversions.

/** A row's id in a path or a query: a whole number from 1. */
export const Id = Schema.FiniteFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 2 ** 53 - 1 }));

/** How many a page holds: up to 100, 50 when the client doesn't say. */
const PageLimit = Schema.FiniteFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 100 }));

/** A page of a list that is newest first: `before` is the `next_before` of the page before. */
export const Page = { before: Schema.optional(Id), limit: Schema.optional(PageLimit) };

/** What a member writes for others to read: a dispute's reason, a staff note, a claim's note. */
const Note = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max));
const MarketNote = Note(DEFAULT_RULES.market.note.max);
const ClaimNote = Note(DEFAULT_RULES.conversions.note.max);

const Member = Schema.Struct({ player_id: Schema.String, name: Schema.String });
const ListingKind = Schema.Literals(LISTING_KINDS);
const NextBefore = Schema.NullOr(Schema.Number);

export const ListingJson = Schema.Struct({
  id: Schema.Number,
  kind: ListingKind,
  title: Schema.String,
  description: Schema.String,
  /** Leaf for one unit. */
  price: Schema.Number,
  quantity: Schema.Number,
  /** Units the orders that stand haven't taken. */
  remaining: Schema.Number,
  status: Schema.Literals(["open", "sold_out", "expired", "withdrawn"]),
  seller: Member,
  created_at: Time,
  updated_at: Time,
  /** It takes no orders from then. */
  expires_at: Time,
});

export const ListingAnswer = Schema.Struct({ listing: ListingJson });

/** Listings taking orders, newest first. `next_before` asks for the page after, or is null on the last. */
export const Listings = Schema.Struct({ listings: Schema.Array(ListingJson), next_before: NextBefore });

/** The seller's own listings, however they stand, newest first, with how many orders on each are open. */
export const MyListings = Schema.Struct({
  listings: Schema.Array(Schema.Struct({ ...ListingJson.fields, open_orders: Schema.Number })),
  next_before: NextBefore,
});

export const ListingQuery = {
  kind: Schema.optional(ListingKind),
  /** Words in the title or the description. */
  q: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100))),
  ...Page,
};

export const ListingBody = Schema.Struct({
  kind: ListingKind,
  title: Schema.String,
  description: Schema.optional(Schema.String),
  price: Schema.Int,
  /** 1 when left out. */
  quantity: Schema.optional(Schema.Int),
  request_id: RequestId,
});

/** The terms a seller may change while no order on the listing is open. */
export const ListingEditBody = Schema.Struct({
  price: Schema.optional(Schema.Int),
  description: Schema.optional(Schema.String),
});

/** `price` is the unit price the buyer was shown and agreed to: Leaf holds that or nothing. */
export const BuyBody = Schema.Struct({
  price: Schema.Int,
  /** 1 when left out. */
  quantity: Schema.optional(Schema.Int),
  request_id: RequestId,
});

export const DisputeBody = Schema.Struct({ reason: MarketNote });

export const ResolveBody = Schema.Struct({
  outcome: Schema.Literals(["release", "refund"]),
  note: Schema.optional(MarketNote),
});

export const OrderJson = Schema.Struct({
  id: Schema.Number,
  listing: Schema.Struct({ id: Schema.Number, kind: ListingKind, title: Schema.String }),
  seller: Member,
  buyer: Member,
  quantity: Schema.Number,
  /** The unit price agreed, the Leaf held, and the part of it the seller is not paid. */
  price: Schema.Number,
  leaf: Schema.Number,
  fee: Schema.Number,
  state: Schema.Literals(ORDER_STATES),
  placed_at: Time,
  delivered_at: Schema.NullOr(Time),
  disputed_at: Schema.NullOr(Time),
  /** When it was completed, cancelled or refunded. */
  closed_at: Schema.NullOr(Time),
  /** While delivered and not disputed: when it confirms itself and pays the seller. */
  auto_confirms_at: Schema.NullOr(Time),
  cancelled_by: Schema.NullOr(Schema.Literals(["buyer", "seller"])),
  dispute_reason: Schema.NullOr(Schema.String),
  /** How staff settled a dispute, and their note to both sides. */
  resolution: Schema.NullOr(
    Schema.Struct({ outcome: Schema.Literals(["release", "refund"]), note: Schema.NullOr(Schema.String) }),
  ),
});

export const OrderAnswer = Schema.Struct({ order: OrderJson });

/** An order after one of its sides acted on it, and that member's balance after it. */
export const OrderActed = Schema.Struct({ order: OrderJson, leaf: Schema.Number });

/** Orders the member bought or sold, newest first. */
export const Orders = Schema.Struct({ orders: Schema.Array(OrderJson), next_before: NextBefore });

/** Disputed orders, the longest-waiting first. */
export const Disputes = Schema.Struct({ orders: Schema.Array(OrderJson) });

const ConversionKind = Schema.Literals(CONVERSION_KINDS);

export const ConversionJson = Schema.Struct({
  id: Schema.Number,
  kind: ConversionKind,
  /** LE for a claim of LE; 1 for a tome or an aspect. */
  count: Schema.Number,
  leaf: Schema.Number,
  note: Schema.NullOr(Schema.String),
  status: Schema.Literals(CONVERSION_STATUSES),
  requested_at: Time,
  /**
   * The start of the month whose allowance pays it: while it waits, the month
   * it is due from, which can only come sooner; once paid, the month it was
   * paid from. Null once declined or cancelled.
   */
  due_from: Schema.NullOr(Time),
  /** Whether staff can pay it now. */
  due: Schema.Boolean,
  /** Its place in its kind's queue, from 1, while it waits. */
  position: Schema.NullOr(Schema.Number),
  closed_at: Schema.NullOr(Time),
  /** Staff's reason, when they declined it. */
  decline_reason: Schema.NullOr(Schema.String),
});

const StaffConversionJson = Schema.Struct({ ...ConversionJson.fields, player: Member });

/** `count` is how many LE, from the rate card's `min_count`; 1 when left out, for a tome or an aspect. */
export const ConversionBody = Schema.Struct({
  kind: ConversionKind,
  count: Schema.optional(Schema.Int),
  /** What the member wants, such as which tome or aspect. */
  note: Schema.optional(ClaimNote),
  request_id: RequestId,
});

/** A claim after the member made or cancelled it, and their balance after it. */
export const ConversionAnswer = Schema.Struct({ conversion: ConversionJson, leaf: Schema.Number });

/** The member's claims, newest first. */
export const MyConversions = Schema.Struct({ conversions: Schema.Array(ConversionJson) });

export const StaffConversionAnswer = Schema.Struct({ conversion: StaffConversionJson });

/** Every claim waiting, kind by kind, each kind in its order. */
export const ConversionQueue = Schema.Struct({ queue: Schema.Array(StaffConversionJson) });

export const PayBody = Schema.Struct({ note: Schema.optional(ClaimNote) });

export const DeclineBody = Schema.Struct({ reason: ClaimNote });

export const ConversionRates = Schema.Struct({
  /** True while the rates are a first proposal still to be tuned. */
  provisional: Schema.Boolean,
  kinds: Schema.Array(
    Schema.Struct({
      kind: ConversionKind,
      name: Schema.String,
      /** Leaf for one LE, one tome or one aspect. */
      leaf_per_unit: Schema.Number,
      min_count: Schema.Number,
      max_count: Schema.Number,
      /** What the guild pays out each calendar month in UTC, for everyone together. */
      monthly_cap: Schema.Number,
      /** What one member may claim in a calendar month, or null for no limit of their own. */
      member_monthly_limit: Schema.NullOr(Schema.Number),
      /** The month a claim made now would be paid from. */
      next_due_from: Time,
    }),
  ),
});
