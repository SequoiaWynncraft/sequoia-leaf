import {
  DAY_MS,
  type Logged,
  type Placed,
  type PlayerId,
  type Standing,
  talliedFrom,
  utcDay,
} from "@sequoia-leaf/core";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { tally } from "../tally/store.ts";
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
 * A player's state in a game, as stored: how many batches have changed it, the game's own text,
 * when it was last written, whether the player was a guest when it was, when it was made (its
 * generation; 0 for one made before Leaf kept that), and when Leaf is next to tend it (null: never,
 * as for a state standing still or of a game that does not go on by itself).
 */
const Stored = Schema.Struct({
  rev: Schema.Int,
  state: Schema.String,
  updatedAt: Schema.Int,
  guest: Schema.BooleanFromBit,
  born: Schema.Int,
  dueAt: Schema.NullOr(Schema.Int),
});
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
 * player has won for good in any game (`awards`, never taken away), and the pieces of a player's that a game asks to keep (`play_kept`,
 * one for each slot). Every method but `board` is meant to run inside the play service's
 * transaction. A database failure is a defect.
 */
export class PlayStore extends Context.Service<
  PlayStore,
  {
    /** The player's state in a game, or none yet. */
    readonly read: (playerId: PlayerId, game: string) => Effect.Effect<Option.Option<Stored>>;
    /** The `rev` the player's state in a game is stored at, or none yet: whether a copy of it is still the state, reading no more. */
    readonly revOf: (playerId: PlayerId, game: string) => Effect.Effect<Option.Option<number>>;
    /** The players whose state in a game was due a tend before `now`, the longest due first. */
    readonly due: (game: string, now: number) => Effect.Effect<readonly PlayerId[]>;
    /** Says a state stored at `rev` stands still: it is due no tend until it is written again. */
    readonly rest: (playerId: PlayerId, game: string, rev: number) => Effect.Effect<void>;
    /**
     * Stores a new player's state, untouched (`rev` 0), made `now`, due a tend at `dueAt` (null:
     * never). Says whether it did: false when one was there already.
     */
    readonly create: (
      playerId: PlayerId,
      game: string,
      state: string,
      guest: boolean,
      now: number,
      dueAt: number | null,
    ) => Effect.Effect<boolean>;
    /** Whether the player's state in a game is stored at `rev`. */
    readonly isAt: (playerId: PlayerId, game: string, rev: number) => Effect.Effect<boolean>;
    /**
     * Stores a state over the one there, its `rev` up by one, due a tend at `dueAt` (null: never).
     * Whatever else writes a state must raise its `rev` too: Leaf holds a copy while the `rev` is its own.
     */
    readonly write: (
      playerId: PlayerId,
      game: string,
      state: string,
      guest: boolean,
      now: number,
      dueAt: number | null,
    ) => Effect.Effect<void>;
    /** What a command answered (its notes or its refusal, as JSON), if it was done before. */
    readonly answered: (playerId: PlayerId, game: string, commandId: string) => Effect.Effect<Option.Option<string>>;
    /** Keeps what a command answered, and the `rev` it led to. Says whether it did: false when one was kept for it already. */
    readonly answer: (
      playerId: PlayerId,
      game: string,
      commandId: string,
      rev: number,
      result: string,
    ) => Effect.Effect<boolean>;
    /** Lets go of the answers to the player's commands to a game but the newest `ANSWERS_KEPT`. */
    readonly keepNewest: (playerId: PlayerId, game: string) => Effect.Effect<void>;
    /**
     * Writes down what a player did, as far as the UTC day's `LOGGED_A_DAY` goes, and lets go of
     * what was done in the game longer ago than `ACTIVITY_KEPT_MS`; and counts each thing the Tally
     * counts (`talliedFrom`), however much was logged.
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
    /** Keeps a piece of the player's in a game (`Done.keep`), its data as JSON, over the one in its slot. */
    readonly keep: (playerId: PlayerId, game: string, slot: string, data: string, now: number) => Effect.Effect<void>;
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
          sql`SELECT rev, state, updated_at AS updatedAt, guest, born, due_at AS dueAt FROM play_state WHERE player_id = ${playerId} AND game = ${game}`,
      });
      const revOf = SqlSchema.findOneOption({
        Request: Schema.Struct({ playerId: Schema.String, game: Schema.String }),
        Result: Schema.Struct({ rev: Schema.Int }),
        execute: ({ playerId, game }) =>
          sql`SELECT rev FROM play_state WHERE player_id = ${playerId} AND game = ${game}`,
      });
      const due = SqlSchema.findAll({
        Request: Schema.Struct({ game: Schema.String, now: Schema.Int }),
        Result: Schema.Struct({ playerId: PlayerUuid }),
        execute: ({ game, now }) => sql`
          SELECT player_id AS playerId FROM play_state WHERE game = ${game} AND due_at < ${now} ORDER BY due_at
        `,
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
      return PlayStore.of({
        read: (playerId, game) => read({ playerId, game }).pipe(Effect.orDie),
        revOf: (playerId, game) =>
          revOf({ playerId, game }).pipe(Effect.map(Option.map((row) => row.rev)), Effect.orDie),
        due: (game, now) =>
          due({ game, now }).pipe(
            Effect.map((rows) => rows.map((row) => row.playerId)),
            Effect.orDie,
          ),
        rest: (playerId, game, rev) =>
          sql`UPDATE play_state SET due_at = NULL WHERE player_id = ${playerId} AND game = ${game} AND rev = ${rev}`.pipe(
            Effect.asVoid,
            Effect.orDie,
          ),
        create: (playerId, game, state, guest, now, dueAt) =>
          sql`
            INSERT INTO play_state (player_id, game, rev, state, guest, updated_at, born, due_at)
            VALUES (${playerId}, ${game}, 0, ${state}, ${guest ? 1 : 0}, ${now}, ${now}, ${dueAt})
            ON CONFLICT (player_id, game) DO NOTHING
            RETURNING rev
          `.pipe(
            Effect.map((rows) => rows.length > 0),
            Effect.orDie,
          ),
        isAt: (playerId, game, rev) =>
          sql`SELECT rev FROM play_state WHERE player_id = ${playerId} AND game = ${game} AND rev = ${rev}`.pipe(
            Effect.map((rows) => rows.length > 0),
            Effect.orDie,
          ),
        write: (playerId, game, state, guest, now, dueAt) =>
          sql`
            UPDATE play_state SET rev = rev + 1, state = ${state}, guest = ${guest ? 1 : 0}, updated_at = ${now}, due_at = ${dueAt}
            WHERE player_id = ${playerId} AND game = ${game}
          `.pipe(Effect.asVoid, Effect.orDie),
        answered: (playerId, game, commandId) =>
          answered({ playerId, game, commandId }).pipe(Effect.map(Option.map((row) => row.result)), Effect.orDie),
        answer: (playerId, game, commandId, rev, result) =>
          sql`
            INSERT INTO play_commands (player_id, game, command_id, rev, result)
            VALUES (${playerId}, ${game}, ${commandId}, ${rev}, ${result})
            ON CONFLICT (player_id, game, command_id) DO NOTHING
            RETURNING id
          `.pipe(
            Effect.map((rows) => rows.length > 0),
            Effect.orDie,
          ),
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
                // The Tally counts all of it, logged or not.
                for (const stat of talliedFrom(logged)) yield* tally(sql, playerId, stat, 1, now);
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
        keep: (playerId, game, slot, data, now) =>
          sql`
            INSERT INTO play_kept (player_id, game, slot, data, updated_at) VALUES (${playerId}, ${game}, ${slot}, ${data}, ${now})
            ON CONFLICT (player_id, game, slot) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
          `.pipe(Effect.asVoid, Effect.orDie),
      });
    }),
  );
}
