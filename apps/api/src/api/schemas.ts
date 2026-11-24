import {
  BROWSERS,
  DEVICES,
  ODD_KINDS,
  PAGE_ERROR_KINDS,
  PAGE_ERROR_MESSAGE,
  PAGE_ERROR_STACK,
  PAGES,
  PURSE_HEADER,
  REQUEST_KINDS,
} from "@sequoia-leaf/core";
import { Schema } from "effect";
import { HttpApiSchema } from "effect/http-api";

// What each route answers, field for field. Names are snake_case, as the mod and
// the other Sequoia services use. Times are ISO 8601 strings in UTC.

const Time = Schema.String;

export const Health = Schema.Struct({ status: Schema.Literal("ok") });

/**
 * What Leaf pays and costs right now, as the rate card Leaf keeps in Discord says it: one section a
 * kind of earning or spending, in order. `text` keeps the rate card's Discord `**` bold markers.
 * `changed_at` is when the rates last changed.
 */
export const Rates = Schema.Struct({
  title: Schema.String,
  description: Schema.String,
  sections: Schema.Array(Schema.Struct({ name: Schema.String, text: Schema.String })),
  changed_at: Schema.NullOr(Time),
});

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
   * Whether they play as a guest: signed in, but not a member of the guild. A guest's Leaf is the
   * ledger's, as a member's is; their XP is 0, their level a new member's and their cursor 0,
   * whatever the ledger holds.
   */
  guest: Schema.Boolean,
  leaf: Schema.Number,
  xp: Schema.Number,
  level: Me.fields.level,
  /** The id of their newest event, 0 when they have none: where to read `/v1/me/events?after=` from next visit. */
  event_cursor: Schema.Number,
  /** Their Coins, as Leaf's ledger of them holds them. A new player's open at 300. */
  coins: Schema.Number,
  /** The version of `coins` and `leaf` (`Purse.version`): of two answers, the higher is the newer. */
  version: Schema.Number,
});

/** A skin sheet, the 64 by 64 PNG Minecraft wraps around a character. */
export const Png = Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array({ contentType: "image/png" }));

/**
 * Events across the guild, oldest first, with whose each is. `data` is cut down by type (see the README).
 * The newest, asked for without a position, come with the guild's day and its last war.
 */
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
  /** How many raids and wars the guild finished in the UTC day that began at `from`, each once. */
  today: Schema.optionalKey(Schema.Struct({ from: Time, raids: Schema.Number, wars: Schema.Number })),
  /** The last territory the guild fought at, by when the war happened; null before any. */
  last_war: Schema.optionalKey(Schema.NullOr(Schema.Struct({ territory: Schema.String, occurred_at: Time }))),
});

/** The places in the game a member can be. */
export const PLACES = ["town", "camp", "works", "table", "grove"] as const;

/**
 * Where the member is; whether their character may stay in town, dozing, after they go, when the
 * page says (left out, it is as it was: on for somebody Leaf has never been told about); and what the
 * page is on, by its width when it signed in, when it says.
 */
export const PresenceBody = Schema.Struct({
  place: Schema.Literals(PLACES),
  stay: Schema.optional(Schema.Boolean),
  device: Schema.optional(Schema.Literals(DEVICES)),
});

/**
 * A page's report of its own failure (`PageError` in core): which page, what went wrong, the rules
 * it was built with, the browser's family, and the message and the first of the stack, each cut
 * short by the page.
 */
export const PageErrorBody = Schema.Struct({
  page: Schema.Literals(PAGES),
  kind: Schema.Literals(PAGE_ERROR_KINDS),
  version: Schema.String.check(Schema.isMaxLength(64)),
  browser: Schema.Literals(BROWSERS),
  message: Schema.String.check(Schema.isMaxLength(PAGE_ERROR_MESSAGE)),
  stack: Schema.String.check(Schema.isMaxLength(PAGE_ERROR_STACK)),
});

/** Somebody in the game, or gone from it in the last day, and when they were last seen. */
const Seen = Schema.Struct({
  id: Schema.String,
  username: Schema.String,
  place: Schema.String,
  guest: Schema.Boolean,
  seen_at: Time,
});

/**
 * Everyone seen in the game in the last 90 seconds who has not left a live room since, the caller
 * included, at most the 50 seen most recently, each with when they last did something as far as
 * Leaf knows (null for not yet: away); and those gone since (seen between 90 seconds and a day ago,
 * or who left a room), in two lists, newest first, at most 24 each: those happy to be left in town,
 * and the rest. Each says whether they play as a guest, and when they were last seen.
 */
export const Present = Schema.Struct({
  /** Leaf's clock when the lists were made: of two, the later is newer. */
  at: Time,
  present: Schema.Array(Schema.Struct({ ...Seen.fields, acted_at: Schema.NullOr(Time) })),
  resting: Schema.Array(Seen),
  gone: Schema.Array(Seen),
});

/**
 * The caller's Coins and Leaf as one moment of Leaf's ledgers had them, and that moment's version,
 * which grows with every entry to either: of two, the higher is the newer.
 */
export const Purse = Schema.Struct({ coins: Schema.Number, leaf: Schema.Number, version: Schema.Number });

/**
 * Leaf's word on the player's purse beside an answer that moved their Leaf outside the play service,
 * read after it, as JSON in `Leaf-Purse`: the page's purse takes it as newer than anything asked
 * before, so an answer on its way from before the spend cannot take it back.
 */
export const PurseBeside = { [PURSE_HEADER]: Schema.fromJsonString(Purse) };

/** A player's state in a game, as their page is given it. */
export const PlayShown = Schema.Struct({
  /** How many batches of commands have changed it. */
  rev: Schema.Number,
  /** Leaf's clock. */
  now: Time,
  /** The game's view of it: everything the page draws from, and nothing that tells the future. */
  state: Schema.Unknown,
  /** The caller's balances as they stood when it was answered: for a batch, as it left them. */
  purse: Purse,
  /** The version of the game's rules Leaf played it by: a page built with others loads again. */
  rules: Schema.String,
});

/**
 * Commands for a game, done in order, from the player the page believes it is (`player`). Each has
 * an `id` the page made, unique among its commands.
 */
export const PlayBody = Schema.Struct({ player: Schema.String, commands: Schema.Array(Schema.Unknown) });

/** What each command did (the game's notes), or the code it was refused with. */
export const PlayResult = Schema.Union([
  Schema.Struct({ id: Schema.String, notes: Schema.Array(Schema.Unknown) }),
  Schema.Struct({ id: Schema.String, refused: Schema.String }),
]);

/** A batch done: each command's result, in the order they came, and the state after them all. */
export const Played = Schema.Struct({ ...PlayShown.fields, results: Schema.Array(PlayResult) });

/** A score, and the few numbers the game shows beside it. */
const Stood = { score: Schema.Number, also: Schema.Record(Schema.String, Schema.Number) };
/** Somebody's place among everyone in a game (how many score higher, and one), with their score. */
const Place = Schema.Struct({ place: Schema.Number, ...Stood });

/**
 * A game's board: the twenty highest scores (a tie going to whoever reached it first), each with
 * its place (how many score higher, and one), its player's id (for their face) and name ("Someone"
 * for one Leaf has no name for), and whether it is the caller's own (`you`); and the caller's own
 * place among everyone, or null before they score.
 */
export const Standings = Schema.Struct({
  top: Schema.Array(
    Schema.Struct({
      place: Schema.Number,
      id: Schema.String,
      name: Schema.String,
      guest: Schema.Boolean,
      ...Stood,
      you: Schema.Boolean,
    }),
  ),
  you: Schema.NullOr(Place),
});

/** Somebody's time and Coins in a game: how long they have played it and had it open while AFK, in whole seconds, and the Coins it has taken from them. */
const InGame = { played: Schema.Number, afk: Schema.Number, spent: Schema.Number };

/**
 * Somebody, as their card shows them: their id, their name ("Someone" for one Leaf has no name for),
 * and each game they have a standing or time in, by game: how long they have played it and had it
 * open while AFK, in whole seconds (`played`, `afk`), the Coins its commands have taken from them
 * (`spent`), and with a standing, their place, score and numbers in it; and how long they have
 * played all games together, and had them open while AFK.
 */
export const Person = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  games: Schema.Record(
    Schema.String,
    Schema.Union([Schema.Struct({ ...Place.fields, ...InGame }), Schema.Struct(InGame)]),
  ),
  played: Schema.Number,
  afk: Schema.Number,
});

/**
 * A board of the Tally for a span: its id, the span, the week it is of (its Monday 00:00 UTC; null
 * for all time), its top ten (each with its place, how many score higher and one, its player's id,
 * name as the guild's news has it, whether a guest, its score, and whether it is the caller's own),
 * and the caller's own place and score, or null when they are not on it.
 */
export const Tally = Schema.Struct({
  board: Schema.String,
  period: Schema.Literals(["week", "all"]),
  from: Schema.NullOr(Schema.String),
  top: Schema.Array(
    Schema.Struct({
      place: Schema.Number,
      id: Schema.String,
      name: Schema.String,
      guest: Schema.Boolean,
      score: Schema.Number,
      you: Schema.Boolean,
    }),
  ),
  you: Schema.NullOr(Schema.Struct({ place: Schema.Number, score: Schema.Number })),
});

/**
 * Every pull banner, with its dates and its headliner: the member Leaf's `banner_people` names for
 * it, named as the boards name players ("Someone" for one Leaf has no name for), or null for none yet.
 */
export const Banners = Schema.Struct({
  banners: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      from: Schema.String,
      until: Schema.String,
      headliner: Schema.NullOr(Schema.Struct({ id: Schema.String, name: Schema.String })),
    }),
  ),
});

/**
 * What the Treasury sells, a paid aspect request and a paid tome request: for each, its price in Leaf,
 * and why the member cannot buy it now, in the backend's words where it has them, or null when they can.
 */
export const Requests = Schema.Struct({
  aspect: Schema.Struct({ price: Schema.Number, why_not: Schema.NullOr(Schema.String) }),
  tome: Schema.Struct({ price: Schema.Number, why_not: Schema.NullOr(Schema.String) }),
});

/** A guild request to buy with Leaf: an aspect, or a tome with what it is for (`reason`, 1 to 1,000 characters). */
export const RequestBody = Schema.Struct({
  type: Schema.Literals(REQUEST_KINDS),
  reason: Schema.optional(Schema.String),
});

/** A request made: its place in its queue, what it cost, and the member's Leaf after it. */
export const RequestMade = Schema.Struct({
  type: Schema.Literals(REQUEST_KINDS),
  position: Schema.Number,
  leaf_paid: Schema.Number,
  leaf: Schema.Number,
});

// The staff's routes, under /v1/game/admin.

/** Seconds, or hours, in each place, by place: `{ "town": 840 }`. */
const ByPlace = Schema.Record(Schema.String, Schema.Number);

/** Who played, when, where and for how long, over the last `days` UTC days (see the README). */
export const ActivityReport = Schema.Struct({
  now: Time,
  /** Who is in which place now, and since when. */
  here: Schema.Array(
    Schema.Struct({ id: Schema.String, name: Schema.String, guest: Schema.Boolean, place: Schema.String, since: Time }),
  ),
  /** Everyone with time in the game in the period, most time first. */
  players: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      guest: Schema.Boolean,
      first_seen_at: Time,
      last_seen_at: Time,
      /** All their time, ever. */
      seconds_total: Schema.Number,
      /** Their sessions and seconds in the period, and their seconds there by place. */
      sessions: Schema.Number,
      seconds: Schema.Number,
      places: ByPlace,
      /** The last few things they did in the games, newest first, with what the game logged. */
      done: Schema.Array(Schema.Struct({ at: Time, game: Schema.String, kind: Schema.String, data: Schema.Unknown })),
    }),
  ),
  /** Each UTC day of the period, oldest first, with its hours to two places. */
  days: Schema.Array(
    Schema.Struct({
      day: Schema.String,
      players: Schema.Number,
      new_players: Schema.Number,
      sessions: Schema.Number,
      hours: Schema.Number,
      places: ByPlace,
    }),
  ),
  /** Raid runs begun in the period, by how many rooms each won. */
  raid: Schema.Struct({
    began: Schema.Number,
    runs: Schema.Array(Schema.Struct({ rooms_won: Schema.Number, runs: Schema.Number })),
  }),
  /** Players who first went to the Works in the period, and everyone there in it by the story orders they have filled. */
  works: Schema.Struct({
    began: Schema.Number,
    players: Schema.Array(Schema.Struct({ story_orders: Schema.Number, players: Schema.Number })),
  }),
  /** Anything out of the ordinary, newest first: a list to look at, nothing done about it. */
  odd: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      rule: Schema.Literals(ODD_KINDS),
      at: Time,
      value: Schema.Number,
    }),
  ),
});

// sequoia-backend's routes, under /internal/v1.

/** A player's Leaf, as sequoia-backend asks for it to show what they can buy. */
export const PlayerLeaf = Schema.Struct({ player_id: Schema.String, balance: Schema.Number });

/**
 * A guild request sequoia-backend buys for a member: who (`player_id`, their Minecraft UUID), which
 * kind (`tome` or `aspect`), and its price in Leaf (`leaf`, a whole number of 1 or more).
 */
export const PurchaseBody = Schema.Struct({ player_id: Schema.String, kind: Schema.String, leaf: Schema.Number });

/** A purchase paid, now or before, and the player's balance after it. */
export const Purchased = Schema.Struct({ key: Schema.String, status: Schema.Literal("paid"), balance: Schema.Number });

/** A purchase cancelled: its Leaf given back (`refunded`), or never to be paid (`cancelled`). */
export const PurchaseCancelled = Schema.Struct({
  key: Schema.String,
  status: Schema.Literals(["refunded", "cancelled"]),
});
