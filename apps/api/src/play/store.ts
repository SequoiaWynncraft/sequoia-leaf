import { DAY_MS, type Logged, type PlayerId } from "@sequoia-leaf/core";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

/** How long a command's answer is kept, so that one sent again is answered the same. */
export const ANSWERS_KEPT_MS = 2 * DAY_MS;

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
 * answered (`play_commands`, two days), and the things players did that are worth remembering
 * (`activity`, for good). Every method is meant to run inside the play service's transaction. A
 * database failure is a defect.
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
    /** What a command answered, if it was done before. */
    readonly answered: (playerId: PlayerId, game: string, commandId: string) => Effect.Effect<Option.Option<string>>;
    /** Keeps what a command answered, and lets go of answers older than two days. */
    readonly answer: (
      playerId: PlayerId,
      game: string,
      commandId: string,
      rev: number,
      result: string,
      now: number,
    ) => Effect.Effect<void>;
    /** Writes down what a player did. */
    readonly log: (playerId: PlayerId, game: string, logged: Logged, now: number) => Effect.Effect<void>;
    /** A player's activity, oldest first. */
    readonly activity: (playerId: PlayerId) => Effect.Effect<readonly ActivityRow[]>;
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
        answer: (playerId, game, commandId, rev, result, now) =>
          Effect.gen(function* () {
            yield* sql`
              INSERT INTO play_commands (player_id, game, command_id, rev, result, at)
              VALUES (${playerId}, ${game}, ${commandId}, ${rev}, ${result}, ${now})
            `;
            yield* sql`DELETE FROM play_commands WHERE at < ${now - ANSWERS_KEPT_MS}`;
          }).pipe(Effect.orDie),
        log: (playerId, game, logged, now) =>
          sql`
            INSERT INTO activity (player_id, at, game, kind, data)
            VALUES (${playerId}, ${now}, ${game}, ${logged.kind}, ${JSON.stringify(logged.data)})
          `.pipe(Effect.asVoid, Effect.orDie),
        activity: (playerId) => activity(playerId).pipe(Effect.orDie),
      });
    }),
  );
}
