import { DAY_MS, type Logged, type PlayerId, utcDay } from "@sequoia-leaf/core";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

/** How many of each player's newest commands to each game have their answers kept, so that one sent again is answered the same. */
export const ANSWERS_KEPT = 256;
/** How many things a player did are logged in a UTC day; past that, they are not logged (the play goes on). */
export const LOGGED_A_DAY = 1000;
/** How long what players did is kept. */
export const ACTIVITY_KEPT_MS = 180 * DAY_MS;

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

/**
 * What the play service keeps: each player's state in each game (`play_state`), what each command
 * answered (`play_commands`, each player's newest 256 to each game), the things players did that
 * are worth remembering (`activity`, up to 1,000 a player a UTC day, for 180 days), and how many of
 * each player's commands were done and refused each UTC day (`command_days`, for the staff's
 * report). Every method is meant to run inside the play service's transaction. A database failure
 * is a defect.
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
      });
    }),
  );
}
