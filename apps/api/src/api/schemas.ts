import { CARE_TOOLS, GROVE_RANKS } from "@sequoia-leaf/core";
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
