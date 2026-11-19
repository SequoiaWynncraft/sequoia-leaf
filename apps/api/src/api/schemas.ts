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
