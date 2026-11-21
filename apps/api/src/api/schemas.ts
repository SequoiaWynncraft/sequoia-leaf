import { Schema } from "effect";
import { HttpApiSchema } from "effect/http-api";

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

// The game's routes, under /v1/game.

/** Whether this is a live server, and where it signs members in. */
export const Hello = Schema.Struct({
  /** The sign-in address, ending in `return_to=`: the game appends its own address, URL-encoded. */
  sign_in: Schema.String,
  /** Whether the game may offer to spend Leaf. */
  leaf_spending: Schema.Boolean,
});

export const GameMe = Schema.Struct({
  player: Me.fields.player,
  /** Their rank in the guild as the guild writes it, or null for a guest or a website admin who is not a member. */
  rank: Schema.NullOr(Schema.String),
  /**
   * Whether they play as a guest: signed in, but not a member of the guild. A guest's Leaf and XP
   * are 0, their level is a new member's, and their cursor is 0, whatever the ledger holds.
   */
  guest: Schema.Boolean,
  leaf: Schema.Number,
  xp: Schema.Number,
  level: Me.fields.level,
  /** The id of their newest event, 0 when they have none: where to read `/v1/me/events?after=` from next visit. */
  event_cursor: Schema.Number,
});

const SaveInfo = Schema.Struct({
  slot: Schema.String,
  /** How many times the slot was written. */
  version: Schema.Number,
  updated_at: Time,
});

export const SaveList = Schema.Struct({ saves: Schema.Array(SaveInfo) });

export const Save = Schema.Struct({ ...SaveInfo.fields, data: Schema.Unknown });

/** A save, written over the version the game last read: 0 when it read none. */
export const SaveBody = Schema.Struct({
  /** The member the page sending it believes it is: a save from a page left open as someone else is refused. */
  player: Schema.String,
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  data: Schema.Unknown,
});

export const Saved = Schema.Struct({ version: Schema.Number, updated_at: Time });

/** A skin sheet, the 64 by 64 PNG Minecraft wraps around a character. */
export const Png = Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array({ contentType: "image/png" }));

/** Events across the guild, oldest first, with whose each is. `data` is cut down by type (see the README). */
export const GuildEvents = Schema.Struct({
  events: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      type: Schema.String,
      created_at: Time,
      player: Me.fields.player,
      data: Schema.Unknown,
    }),
  ),
});

/** The places in the game a member can be. */
export const PLACES = ["town", "camp", "works", "table"] as const;

/** Where the member is, and whether their character may stay in town, dozing, after they go (true when left out). */
export const PresenceBody = Schema.Struct({ place: Schema.Literals(PLACES), stay: Schema.optional(Schema.Boolean) });

/**
 * Everyone seen in the game in the last 90 seconds, the caller included, at most the 50 seen most
 * recently; and those who were seen between 90 seconds and a day ago and are happy to be left in
 * town, newest first, at most 24. Each says whether they play as a guest.
 */
export const Present = Schema.Struct({
  present: Schema.Array(
    Schema.Struct({ id: Schema.String, username: Schema.String, place: Schema.String, guest: Schema.Boolean }),
  ),
  resting: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      username: Schema.String,
      place: Schema.String,
      guest: Schema.Boolean,
      seen_at: Time,
    }),
  ),
});
