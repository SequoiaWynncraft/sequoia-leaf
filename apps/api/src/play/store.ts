import { DAY_MS, type Logged, type Placed, type PlayerId, type Standing, utcDay } from "@sequoia-leaf/core";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { PlayerUuid } from "../wire.ts";

/** How many of each player's newest commands to each game have their answers kept, so that one sent again is answered the same. */
export const ANSWERS_KEPT = 256;
/** How many things a player did are logged in a UTC day; past that, they are not logged (the play goes on). */
export const LOGGED_A_DAY = 1000;
/** How long what players did is kept. */
export const ACTIVITY_KEPT_MS = 180 * DAY_MS;
/** How many are listed at the top of a game's board. */
export const BOARD_MOST = 20;
/**
 * The longest gap between a player's calls to a game that counts as playing it. A page open and in
 * view calls at least every 75 seconds (the kit's `STILL_HERE`, a minute, checked every 15
 * seconds), and a visit every 30; this is twice that and more, for a slow network. A longer gap is
 * time away.
 */
export const IDLE_MS = 3 * 60_000;

/** A player's state in a game, as stored: how many batches have changed it, and the game's own text. */
const Stored = Schema.Struct({ rev: Schema.Int, state: Schema.String });
export type Stored = typeof Stored.Type;

const Answered = Schema.Struct({ result: Schema.String });

/** An activity as stored, for reading back. */
const Activity = Schema.Struct({
  id: Schema.Int,
  playerId: Schema.String,
  at: Schema.Int,
  game: Schema.String,
  kind: Schema.String,
  data: Schema.String,
});
export type ActivityRow = typeof Activity.Type;

/** Where somebody stands, as read back: their place, their score and what is shown beside it. */
const Own = Schema.Struct({
  place: Schema.Int,
  score: Schema.Int,
  also: Schema.fromJsonString(Schema.Record(Schema.String, Schema.Number)),
});
/** Somebody on a game's board, as read back. */
const Stood = Schema.Struct({ ...Own.fields, playerId: PlayerUuid, guest: Schema.BooleanFromBit });

/** A game's board: the top `BOARD_MOST`, and the player's own place among everyone, if they are on it. */
export interface Board {
  readonly top: readonly (Placed & { readonly playerId: PlayerId; readonly guest: boolean })[];
  readonly you: Option.Option<Placed>;
}

/**
 * What the play service keeps: each player's state in each game (`play_state`), what each command
 * answered (`play_commands`, each player's newest 256 to each game), the things players did that
 * are worth remembering (`activity`, up to 1,000 a player a UTC day, for 180 days), and how many of
 * each player's commands were done and refused each UTC day (`command_days`, for the staff's
 * report), where each player's state stands in a game with a board (`standings`), what each
 * player has won for good in any game (`awards`, never taken away), and how long each player has
 * played each game (`played`). Every method but `board` is meant to run inside the play service's
 * transaction. A database failure is a defect.
 */
export class PlayStore extends Context.Service<
  PlayStore,
  {
    /** The player's state in a game, or none yet. */
    readonly read: (playerId: PlayerId, game: string) => Effect.Effect<Option.Option<Stored>>;
    /** Stores a new player's state, untouched (`rev` 0). Says whether it did: false when one was there already. */
    readonly create: (playerId: PlayerId, game: string, state: string, now: number) => Effect.Effect<boolean>;
    /** Stores a state over the one at `over`, as `over + 1`. Says whether it did: false when it changed meanwhile. */
    readonly write: (
      playerId: PlayerId,
      game: string,
      over: number,
      state: string,
      now: number,
    ) => Effect.Effect<boolean>;
    /** What a command answered (its notes or its refusal, as JSON), if it was done before. */
    readonly answered: (playerId: PlayerId, game: string, commandId: string) => Effect.Effect<Option.Option<string>>;
    /** Keeps what a command answered, and the `rev` it led to. */
    readonly answer: (
      playerId: PlayerId,
      game: string,
      commandId: string,
      rev: number,
      result: string,
    ) => Effect.Effect<void>;
    /** Lets go of the answers to the player's commands to a game but the newest `ANSWERS_KEPT`. */
    readonly keepNewest: (playerId: PlayerId, game: string) => Effect.Effect<void>;
    /**
     * Writes down what a player did, as far as the UTC day's `LOGGED_A_DAY` goes, and lets go of
     * what was done in the game longer ago than `ACTIVITY_KEPT_MS`.
     */
    readonly log: (playerId: PlayerId, game: string, logged: readonly Logged[], now: number) => Effect.Effect<void>;
    /** A player's activity, oldest first. */
    readonly activity: (playerId: PlayerId) => Effect.Effect<readonly ActivityRow[]>;
    /** Counts a player's commands on the UTC day of `now`: how many were done and how many refused. */
    readonly count: (playerId: PlayerId, done: number, refused: number, now: number) => Effect.Effect<void>;
    /** Writes where a player's state stands; while its score is the same, it keeps when the score was reached. */
    readonly stand: (
      playerId: PlayerId,
      game: string,
      standing: Standing,
      guest: boolean,
      now: number,
    ) => Effect.Effect<void>;
    /**
     * A game's board, of those who score above 0: the highest `BOARD_MOST`, a tie going to whoever
     * reached it first, and the player's own place.
     */
    readonly board: (game: string, playerId: PlayerId) => Effect.Effect<Board>;
    /** Where a player stands in each game they have a standing in, by game, each place worked out as `board`'s own. */
    readonly standingsOf: (playerId: PlayerId) => Effect.Effect<ReadonlyMap<string, Placed>>;
    /** Everything a player has won for good, in the order Leaf first saw it. */
    readonly awards: (playerId: PlayerId) => Effect.Effect<readonly string[]>;
    /** Keeps each of these the player does not hold yet, as won now. */
    readonly award: (playerId: PlayerId, ids: readonly string[], now: number) => Effect.Effect<void>;
    /**
     * A call of the player's to a game at `now`: the time since their last one there is added to
     * what they have played, if it is no more than `IDLE_MS`. The first adds nothing, and so does
     * one at or before the last.
     */
    readonly heard: (playerId: PlayerId, game: string, now: number) => Effect.Effect<void>;
    /** How long a player has played each game, in milliseconds, by game. */
    readonly playedOf: (playerId: PlayerId) => Effect.Effect<ReadonlyMap<string, number>>;
  }
>()("leaf/PlayStore") {
  static readonly layer = Layer.effect(
    PlayStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const read = SqlSchema.findOneOption({
        Request: Schema.Struct({ playerId: Schema.String, game: Schema.String }),
        Result: Stored,
        execute: ({ playerId, game }) =>
          sql`SELECT rev, state FROM play_state WHERE player_id = ${playerId} AND game = ${game}`,
      });
      const answered = SqlSchema.findOneOption({
        Request: Schema.Struct({ playerId: Schema.String, game: Schema.String, commandId: Schema.String }),
        Result: Answered,
        execute: ({ playerId, game, commandId }) => sql`
          SELECT result FROM play_commands WHERE player_id = ${playerId} AND game = ${game} AND command_id = ${commandId}
        `,
      });
      const loggedSince = SqlSchema.findAll({
        Request: Schema.Struct({ playerId: Schema.String, since: Schema.Int }),
        Result: Schema.Struct({ n: Schema.Int }),
        execute: ({ playerId, since }) =>
          sql`SELECT count(*) AS n FROM activity WHERE player_id = ${playerId} AND at >= ${since}`,
      });
      const activity = SqlSchema.findAll({
        Request: Schema.String,
        Result: Activity,
        execute: (playerId) => sql`
          SELECT id, player_id AS playerId, at, game, kind, data FROM activity WHERE player_id = ${playerId} ORDER BY id
        `,
      });
      // A place is how many score higher, and one.
      const place = sql`(SELECT count(*) FROM standings AS o WHERE o.game = s.game AND o.score > s.score) + 1`;
      const top = SqlSchema.findAll({
        Request: Schema.String,
        Result: Stood,
        execute: (game) => sql`
          SELECT ${place} AS place, score, also, player_id AS playerId, guest FROM standings AS s
          WHERE game = ${game} AND score > 0
          ORDER BY score DESC, updated_at, player_id LIMIT ${BOARD_MOST}
        `,
      });
      const own = SqlSchema.findOneOption({
        Request: Schema.Struct({ playerId: Schema.String, game: Schema.String }),
        Result: Own,
        execute: ({ playerId, game }) => sql`
          SELECT ${place} AS place, score, also FROM standings AS s
          WHERE player_id = ${playerId} AND game = ${game} AND score > 0
        `,
      });
      const standingsOf = SqlSchema.findAll({
        Request: Schema.String,
        Result: Schema.Struct({ ...Own.fields, game: Schema.String }),
        execute: (playerId) => sql`
          SELECT game, ${place} AS place, score, also FROM standings AS s WHERE player_id = ${playerId} ORDER BY game
        `,
      });
      const awards = SqlSchema.findAll({
        Request: Schema.String,
        Result: Schema.Struct({ id: Schema.String }),
        execute: (playerId) => sql`SELECT id FROM awards WHERE player_id = ${playerId} ORDER BY at, id`,
      });
      const playedOf = SqlSchema.findAll({
        Request: Schema.String,
        Result: Schema.Struct({ game: Schema.String, ms: Schema.Int }),
        execute: (playerId) => sql`SELECT game, ms FROM played WHERE player_id = ${playerId} ORDER BY game`,
      });
      return PlayStore.of({
        read: (playerId, game) => read({ playerId, game }).pipe(Effect.orDie),
        create: (playerId, game, state, now) =>
          sql`
            INSERT INTO play_state (player_id, game, rev, state, updated_at)
            VALUES (${playerId}, ${game}, 0, ${state}, ${now})
            ON CONFLICT (player_id, game) DO NOTHING
            RETURNING rev
          `.pipe(
            Effect.map((rows) => rows.length > 0),
            Effect.orDie,
          ),
        write: (playerId, game, over, state, now) =>
          sql`
            UPDATE play_state SET rev = rev + 1, state = ${state}, updated_at = ${now}
            WHERE player_id = ${playerId} AND game = ${game} AND rev = ${over}
            RETURNING rev
          `.pipe(
            Effect.map((rows) => rows.length > 0),
            Effect.orDie,
          ),
        answered: (playerId, game, commandId) =>
          answered({ playerId, game, commandId }).pipe(Effect.map(Option.map((row) => row.result)), Effect.orDie),
        answer: (playerId, game, commandId, rev, result) =>
          sql`
            INSERT INTO play_commands (player_id, game, command_id, rev, result)
            VALUES (${playerId}, ${game}, ${commandId}, ${rev}, ${result})
          `.pipe(Effect.asVoid, Effect.orDie),
        keepNewest: (playerId, game) =>
          sql`
            DELETE FROM play_commands
            WHERE player_id = ${playerId} AND game = ${game} AND id <= (
              SELECT id FROM play_commands WHERE player_id = ${playerId} AND game = ${game}
              ORDER BY id DESC LIMIT 1 OFFSET ${ANSWERS_KEPT}
            )
          `.pipe(Effect.asVoid, Effect.orDie),
        log: (playerId, game, logged, now) =>
          logged.length === 0
            ? Effect.void
            : Effect.gen(function* () {
                const [today] = yield* loggedSince({ playerId, since: utcDay(now) * DAY_MS });
                const room = Math.max(0, LOGGED_A_DAY - (today?.n ?? 0));
                for (const one of logged.slice(0, room)) {
                  yield* sql`
                    INSERT INTO activity (player_id, at, game, kind, data)
                    VALUES (${playerId}, ${now}, ${game}, ${one.kind}, ${JSON.stringify(one.data)})
                  `;
                }
                yield* sql`DELETE FROM activity WHERE game = ${game} AND at < ${now - ACTIVITY_KEPT_MS}`;
              }).pipe(Effect.orDie),
        activity: (playerId) => activity(playerId).pipe(Effect.orDie),
        count: (playerId, done, refused, now) =>
          done === 0 && refused === 0
            ? Effect.void
            : sql`
                INSERT INTO command_days (player_id, day, done, refused)
                VALUES (${playerId}, ${utcDay(now) * DAY_MS}, ${done}, ${refused})
                ON CONFLICT (player_id, day) DO UPDATE SET done = done + excluded.done, refused = refused + excluded.refused
              `.pipe(Effect.asVoid, Effect.orDie),
        stand: (playerId, game, standing, guest, now) =>
          sql`
            INSERT INTO standings (player_id, game, score, also, guest, updated_at)
            VALUES (${playerId}, ${game}, ${standing.score}, ${JSON.stringify(standing.also)}, ${guest ? 1 : 0}, ${now})
            ON CONFLICT (player_id, game) DO UPDATE SET
              score = excluded.score, also = excluded.also, guest = excluded.guest,
              updated_at = CASE WHEN score = excluded.score THEN updated_at ELSE excluded.updated_at END
          `.pipe(Effect.asVoid, Effect.orDie),
        board: (game, playerId) => Effect.all({ top: top(game), you: own({ playerId, game }) }).pipe(Effect.orDie),
        standingsOf: (playerId) =>
          standingsOf(playerId).pipe(
            Effect.map((rows) => new Map(rows.map(({ game, ...placed }) => [game, placed]))),
            Effect.orDie,
          ),
        awards: (playerId) =>
          awards(playerId).pipe(
            Effect.map((rows) => rows.map((row) => row.id)),
            Effect.orDie,
          ),
        award: (playerId, ids, now) =>
          Effect.forEach(
            ids,
            (id) =>
              sql`INSERT INTO awards (player_id, id, at) VALUES (${playerId}, ${id}, ${now}) ON CONFLICT DO NOTHING`,
            { discard: true },
          ).pipe(Effect.orDie),
        heard: (playerId, game, now) =>
          sql`
            INSERT INTO played (player_id, game, ms, seen_at) VALUES (${playerId}, ${game}, 0, ${now})
            ON CONFLICT (player_id, game) DO UPDATE SET
              ms = ms + CASE WHEN excluded.seen_at - seen_at BETWEEN 1 AND ${IDLE_MS} THEN excluded.seen_at - seen_at ELSE 0 END,
              seen_at = max(seen_at, excluded.seen_at)
          `.pipe(Effect.asVoid, Effect.orDie),
        playedOf: (playerId) =>
          playedOf(playerId).pipe(
            Effect.map((rows) => new Map(rows.map((row) => [row.game, row.ms]))),
            Effect.orDie,
          ),
      });
    }),
  );
}
