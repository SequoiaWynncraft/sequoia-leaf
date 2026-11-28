import {
  DAY_MS,
  type GameId,
  gameId,
  type Logged,
  NO_POSTCARDS,
  type Placed,
  type PlayerId,
  type Postcard,
  readPostcard,
  type Standing,
  utcDay,
} from "@sequoia-leaf/core";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { PlayerUuid } from "../wire.ts";
import { type Given, POSTING } from "./games.ts";
import { loggingIn } from "./logs.ts";

/** How many of each player's newest commands to each game have their answers kept, so that one sent again is answered the same. */
export const ANSWERS_KEPT = 256;
/** How many are listed at the top of a game's board. */
export const BOARD_MOST = 20;

/**
 * A player's state in a game, as stored: how many batches have changed it, the game's own text,
 * when it was last written, whether the player was a guest when it was, when it was made (its
 * generation; 0 for one made before Leaf kept that), when Leaf is next to have it in hand (null:
 * never, as for a state standing still or of a game that does not go on by itself), and the
 * postcard kept with it at its `rev`, as JSON (null: none, or one of another `rev`).
 */
const Stored = Schema.Struct({
  rev: Schema.Int,
  state: Schema.String,
  updatedAt: Schema.Int,
  guest: Schema.BooleanFromBit,
  born: Schema.Int,
  dueAt: Schema.NullOr(Schema.Int),
  postcard: Schema.NullOr(Schema.String),
});
export type Stored = typeof Stored.Type;

/** Where a player's state in a game is, as stored: its `rev`, and the postcard kept with it at that `rev` (null: none). */
const StoredAt = Schema.Struct({ rev: Stored.fields.rev, postcard: Stored.fields.postcard });
export type StoredAt = typeof StoredAt.Type;

const Answered = Schema.Struct({ result: Schema.String });

const readJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
/** A postcard as kept (`Game.postcard`), read back from its JSON as the town reads one. */
const keptPostcard = (text: string): Option.Option<Postcard> =>
  Option.flatMap(readJson(text), (raw) => Option.fromNullOr(readPostcard(raw)));

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

/** What is shown beside a score, as a standing keeps it: a number by name, as JSON. */
export const StoodAlso = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Number));
/** Where somebody stands, as read back: their place, their score and what is shown beside it. */
const Own = Schema.Struct({
  place: Schema.Int,
  score: Schema.Int,
  also: StoodAlso,
});
/** Somebody on a game's board, as read back. */
const Stood = Schema.Struct({ ...Own.fields, playerId: PlayerUuid, guest: Schema.BooleanFromBit });

/** A game's board: the top `BOARD_MOST`, and the player's own place among everyone, if they are on it. */
export interface Board {
  readonly top: readonly (Placed & { readonly playerId: PlayerId; readonly guest: boolean })[];
  readonly you: Option.Option<Placed>;
}

/** A state of a player's, with the `rev` of the postcard kept for it (null: none) and when it is due. */
export const Door = Schema.Struct({
  game: Schema.String,
  rev: Schema.Int,
  kept: Schema.NullOr(Schema.Int),
  postcard: Schema.NullOr(Schema.String),
  dueAt: Schema.NullOr(Schema.Int),
});

/**
 * The postcards to show of a player's states, by game: each kept at its state's `rev` that reads.
 * A state of a game that writes postcards (`POSTING`) whose postcard is missing, of another `rev`
 * or does not read shows none, and is given back as stale unless it is due by `now` already. One
 * kept as nothing (a state that does not read) shows none and is not stale.
 */
function doorsOf(rows: readonly (typeof Door.Type)[], now: number) {
  const shown: Partial<Record<GameId, Postcard>> = {};
  const stale: (typeof Door.Type)[] = [];
  for (const row of rows) {
    const game = gameId(row.game);
    if (game === undefined || !POSTING.includes(game)) continue;
    const card = row.kept === row.rev && row.postcard !== null ? keptPostcard(row.postcard) : Option.none();
    if (Option.isSome(card)) shown[game] = card.value;
    else if ((row.kept !== row.rev || row.postcard !== null) && (row.dueAt === null || row.dueAt > now))
      stale.push(row);
  }
  return { shown, stale };
}

/**
 * Makes a player's state due at `now`, for Leaf's sweep to write its postcard again, only if it and
 * its postcard are still as the town `seen` them (stale) and it is not due by then already: one the
 * sweep or its own page put right meanwhile, at the same `rev` or another, is left be.
 */
export const dueAgain = (sql: SqlClient.SqlClient, playerId: PlayerId, seen: typeof Door.Type, now: number) => {
  const kept = (column: "rev" | "postcard") =>
    sql`(SELECT p.${sql(column)} FROM play_postcards AS p WHERE p.player_id = s.player_id AND p.game = s.game)`;
  return sql`
    UPDATE play_state AS s SET due_at = ${now}
    WHERE player_id = ${playerId} AND game = ${seen.game} AND rev = ${seen.rev} AND (due_at IS NULL OR due_at > ${now})
      AND ${kept("rev")} IS ${seen.kept} AND ${kept("postcard")} IS ${seen.postcard}
  `;
};

/**
 * What every call of a player's is told (`Given`), and how it is kept: what they have won for good
 * (`awards`, never taken away) and what each of their states tells the town (`play_postcards`,
 * kept with the state in the play service's transaction, and read back by the player's key).
 */
function givenIn(sql: SqlClient.SqlClient) {
  const awards = SqlSchema.findAll({
    Request: Schema.String,
    Result: Schema.Struct({ id: Schema.String }),
    execute: (playerId) => sql`SELECT id FROM awards WHERE player_id = ${playerId} ORDER BY at, id`,
  });
  const doors = SqlSchema.findAll({
    Request: Schema.String,
    Result: Door,
    execute: (playerId) => sql`
      SELECT s.game, s.rev, p.rev AS kept, p.postcard, s.due_at AS dueAt FROM play_state AS s
      LEFT JOIN play_postcards AS p USING (player_id, game) WHERE player_id = ${playerId}
    `,
  });
  return {
    given: (playerId: PlayerId, withPostcards: boolean, now: number): Effect.Effect<Given> =>
      Effect.gen(function* () {
        const won = (yield* awards(playerId)).map((row) => row.id);
        if (!withPostcards) return { awards: won, postcards: NO_POSTCARDS };
        const { shown, stale } = doorsOf(yield* doors(playerId), now);
        // A state whose postcard is not of it is made due, for Leaf's sweep to write the postcard again.
        for (const seen of stale) yield* dueAgain(sql, playerId, seen, now);
        return { awards: won, postcards: shown };
      }).pipe(Effect.orDie),
    award: (playerId: PlayerId, ids: readonly string[], now: number): Effect.Effect<void> =>
      Effect.forEach(
        ids,
        (id) => sql`INSERT INTO awards (player_id, id, at) VALUES (${playerId}, ${id}, ${now}) ON CONFLICT DO NOTHING`,
        { discard: true },
      ).pipe(Effect.orDie),
    post: (playerId: PlayerId, game: GameId, rev: number, postcard: string | null, dueAt: number | null) =>
      postcard === null
        ? Effect.void
        : Effect.all(
            [
              sql`
                INSERT INTO play_postcards (player_id, game, rev, postcard) VALUES (${playerId}, ${game}, ${rev}, ${postcard})
                ON CONFLICT (player_id, game) DO UPDATE SET rev = excluded.rev, postcard = excluded.postcard
              `,
              // Kept with its postcard, a state made due for it is due as the batch has it: a state standing still, no longer.
              sql`UPDATE play_state SET due_at = ${dueAt} WHERE player_id = ${playerId} AND game = ${game} AND due_at IS NOT ${dueAt}`,
            ],
            { discard: true },
          ).pipe(Effect.orDie),
  };
}

/** A state whose standing was not worked out from it as stored: whose, of which game, and its `rev` and text. */
const Unstood = Schema.Struct({ playerId: PlayerUuid, game: Schema.String, rev: Schema.Int, state: Schema.String });
export type Unstood = typeof Unstood.Type;

/**
 * Where each state stands (`standings`): written by the batch that writes the state, or worked out
 * again from the state as stored for one whose standing is not of its `rev` (`stood`, migration 42;
 * `restand.ts`).
 */
function standingsIn(sql: SqlClient.SqlClient) {
  const unstood = SqlSchema.findAll({
    Request: Schema.Int,
    Result: Unstood,
    execute: (most) => sql`
      SELECT player_id AS playerId, game, rev, state FROM play_state WHERE stood IS NOT rev ORDER BY updated_at LIMIT ${most}
    `,
  });
  /**
   * Puts the standing there right to `standing`, worked out from the state stored at `rev`, while the
   * state is still at `rev` and its standing was not worked out from it (`stood`); reached as
   * `PlayStore.restand` says. One that is not there is not made.
   */
  const correct = (playerId: PlayerId, game: string, rev: number, standing: Standing) => {
    const counts = standing.counts ?? [];
    // When the last of the awards it counts was first won, if Leaf kept that of each since the state was made.
    const won =
      counts.length === 0
        ? sql`NULL`
        : sql`(
            SELECT CASE WHEN count(*) = ${counts.length} THEN max(awards.at) END FROM awards
            WHERE awards.player_id = s.player_id AND awards.id IN ${sql.in(counts)} AND awards.at >= s.born
          )`;
    return sql`
      UPDATE standings SET score = ${standing.score}, also = ${JSON.stringify(standing.also)}, guest = s.guest,
        updated_at = min(standings.updated_at, coalesce(${won}, standings.updated_at))
      FROM play_state AS s
      WHERE standings.player_id = ${playerId} AND standings.game = ${game}
        AND s.player_id = standings.player_id AND s.game = standings.game AND s.rev = ${rev} AND s.stood IS NOT s.rev
    `;
  };
  return {
    stand: (
      playerId: PlayerId,
      game: string,
      rev: number | null,
      before: Standing | null,
      standing: Standing | null,
      guest: boolean,
      now: number,
    ): Effect.Effect<void> =>
      standing === null
        ? Effect.void
        : Effect.all(
            [
              rev === null || before === null ? Effect.void : correct(playerId, game, rev, before),
              sql`
                INSERT INTO standings (player_id, game, score, also, guest, updated_at)
                VALUES (${playerId}, ${game}, ${standing.score}, ${JSON.stringify(standing.also)}, ${guest ? 1 : 0}, ${now})
                ON CONFLICT (player_id, game) DO UPDATE SET
                  score = excluded.score, also = excluded.also, guest = excluded.guest,
                  updated_at = CASE WHEN score = excluded.score THEN updated_at ELSE excluded.updated_at END
              `,
            ],
            { discard: true },
          ).pipe(Effect.orDie),
    unstood: (most: number) => unstood(most).pipe(Effect.orDie),
    restand: (playerId: PlayerId, game: string, rev: number, standing: Standing | null): Effect.Effect<void> =>
      sql
        .withTransaction(
          Effect.all(
            [
              standing === null ? Effect.void : correct(playerId, game, rev, standing),
              sql`
                UPDATE play_state SET stood = rev
                WHERE player_id = ${playerId} AND game = ${game} AND rev = ${rev} AND stood IS NOT rev
              `,
            ],
            { discard: true },
          ),
        )
        .pipe(Effect.orDie),
  };
}

/**
 * What the play service keeps: each player's state in each game (`play_state`), what each command
 * answered (`play_commands`, each player's newest 256 to each game), the things players did that
 * are worth remembering (`activity`, up to 1,000 a player a UTC day, for 180 days; the raid's fights
 * in `raid_fights`, as many, for a year: `logs.ts`), and how many of
 * each player's commands were done and refused each UTC day (`command_days`, for the staff's
 * report), where each player's state stands in a game with a board (`standings`), what each
 * player has won for good in any game (`awards`, never taken away), and what each state tells the
 * town (`play_postcards`). Every method but `board`, `unstood` and `restand` (in a transaction of its
 * own) is meant to run inside the play service's transaction. A database failure is a defect.
 */
export class PlayStore extends Context.Service<
  PlayStore,
  {
    /** The player's state in a game, or none yet. */
    readonly read: (playerId: PlayerId, game: string) => Effect.Effect<Option.Option<Stored>>;
    /**
     * The `rev` the player's state in a game is stored at, and the postcard kept with it at that `rev`
     * (null: none), or none yet: whether a copy of it is still the state, reading no more of it.
     */
    readonly storedAt: (playerId: PlayerId, game: string) => Effect.Effect<Option.Option<StoredAt>>;
    /** The players whose state in a game was due a tend before `now`, the longest due first. */
    readonly due: (game: string, now: number) => Effect.Effect<readonly PlayerId[]>;
    /** For each game with a state due a tend, when the one due longest was due: how far behind Leaf's tending is. */
    readonly firstDue: Effect.Effect<ReadonlyMap<string, number>>;
    /** Says a state stored at `rev` stands still: it is due no tend until it is written again. */
    readonly rest: (playerId: PlayerId, game: string, rev: number, reads: boolean) => Effect.Effect<void>;
    /**
     * Stores a new player's state, untouched (`rev` 0), made `now`, due a tend at `dueAt` (null:
     * never), standing nowhere until a batch changes it. Says whether it did: false when one was there already.
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
     * Stores a state over the one there, its `rev` up by one, due a tend at `dueAt` (null: never), and
     * where it stands as of that `rev` (`stood`): the batch writes its standing with it. Whatever else
     * writes a state must raise its `rev` too: Leaf holds a copy while the `rev` is its own; and its
     * standing is then worked out again (`restand`).
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
     * what was done in the game longer ago than `ACTIVITY_KEPT_MS`, but a raid fight, which goes to
     * `raid_fights` for `FIGHTS_KEPT_MS` (`loggingIn`); and counts each thing the Tally counts
     * (`talliedFrom`), however much was logged.
     */
    readonly log: (playerId: PlayerId, game: string, logged: readonly Logged[], now: number) => Effect.Effect<void>;
    /** A player's activity, oldest first. */
    readonly activity: (playerId: PlayerId) => Effect.Effect<readonly ActivityRow[]>;
    /** Counts a player's commands on the UTC day of `now`: how many were done and how many refused. */
    readonly count: (playerId: PlayerId, done: number, refused: number, now: number) => Effect.Effect<void>;
    /**
     * Writes where a player's state stands (null: nowhere, for a game with no board) as a batch changes
     * it from the state stored at `rev` (null: a new state), which stood as `before`; before the batch
     * writes the state (`write`). A standing there not worked out from that state (`stood`) is first put
     * right to `before`, as `restand` puts it; then, while the score is the same, it keeps when it was
     * reached, and otherwise it was reached `now`.
     */
    readonly stand: (
      playerId: PlayerId,
      game: string,
      rev: number | null,
      before: Standing | null,
      standing: Standing | null,
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
    /** The states whose standing was not worked out from them as stored (`stood` is not their `rev`), `most` at most, the longest unwritten first. */
    readonly unstood: (most: number) => Effect.Effect<readonly Unstood[]>;
    /**
     * Marks a state stored at `rev` as stood as of it (`stood`), if it is still at `rev` and was not, and
     * puts the standing there right to `standing`, worked out from it (null: leaves it be, for a game
     * with no board or a state that does not read).
     *
     * Only a standing there already is put right: a state that stands nowhere (one nothing was done
     * to, moved to another player) stays so until a batch changes it. It was reached no later than the
     * time stored; and for a score that counts awards (`Standing.counts`), when the last of them was
     * first won (`awards.at`), if Leaf kept that of each since the state was made (`born`). Leaf keeps
     * awards since 22 November 2026 (migration 21), and each batch that changes a state keeps those it
     * shows: one won before then was kept at its state's next change, later than it was won, which the
     * time stored bounds; a state not changed since may hold one with no time, and keeps the time stored.
     */
    readonly restand: (playerId: PlayerId, game: string, rev: number, standing: Standing | null) => Effect.Effect<void>;
    /**
     * What every call of the player's is told (`Given`): everything they have won for good, in the
     * order Leaf first saw it; and with `postcards`, for the town, the postcard kept for each of
     * their states at its `rev` (`doorsOf`), each state whose postcard is not made due at `now`; or
     * else none.
     */
    readonly given: (playerId: PlayerId, postcards: boolean, now: number) => Effect.Effect<Given>;
    /** Keeps each of these the player does not hold yet, as won now. */
    readonly award: (playerId: PlayerId, ids: readonly string[], now: number) => Effect.Effect<void>;
    /**
     * Keeps what the player's state in a game at `rev` tells the town (`Game.postcard`, as JSON), over
     * what was kept, and has the state due at `dueAt`; null keeps both as they are.
     */
    readonly post: (
      playerId: PlayerId,
      game: GameId,
      rev: number,
      postcard: string | null,
      dueAt: number | null,
    ) => Effect.Effect<void>;
  }
>()("leaf/PlayStore") {
  static readonly layer = Layer.effect(
    PlayStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      // The postcard kept with a player's state in a game at its `rev` (null: none), and the state to read.
      const kept = ({ playerId, game }: { readonly playerId: string; readonly game: string }) => sql`
        CASE WHEN p.rev = s.rev THEN p.postcard END AS postcard FROM play_state AS s
        LEFT JOIN play_postcards AS p USING (player_id, game) WHERE player_id = ${playerId} AND game = ${game}
      `;
      const read = SqlSchema.findOneOption({
        Request: Schema.Struct({ playerId: Schema.String, game: Schema.String }),
        Result: Stored,
        execute: (of) =>
          sql`SELECT s.rev, s.state, s.updated_at AS updatedAt, s.guest, s.born, s.due_at AS dueAt, ${kept(of)}`,
      });
      const storedAt = SqlSchema.findOneOption({
        Request: Schema.Struct({ playerId: Schema.String, game: Schema.String }),
        Result: StoredAt,
        execute: (of) => sql`SELECT s.rev, ${kept(of)}`,
      });
      const due = SqlSchema.findAll({
        Request: Schema.Struct({ game: Schema.String, now: Schema.Int }),
        Result: Schema.Struct({ playerId: PlayerUuid }),
        execute: ({ game, now }) => sql`
          SELECT player_id AS playerId FROM play_state WHERE game = ${game} AND due_at < ${now} ORDER BY due_at
        `,
      });
      const firstDue = SqlSchema.findAll({
        Request: Schema.Void,
        Result: Schema.Struct({ game: Schema.String, dueAt: Schema.Int }),
        execute: () =>
          sql`SELECT game, MIN(due_at) AS dueAt FROM play_state WHERE due_at IS NOT NULL GROUP BY game ORDER BY game`,
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

      return PlayStore.of({
        read: (playerId, game) => read({ playerId, game }).pipe(Effect.orDie),
        storedAt: (playerId, game) => storedAt({ playerId, game }).pipe(Effect.orDie),
        due: (game, now) =>
          due({ game, now }).pipe(
            Effect.map((rows) => rows.map((row) => row.playerId)),
            Effect.orDie,
          ),
        firstDue: firstDue(undefined).pipe(
          Effect.map((rows) => new Map(rows.map((row) => [row.game, row.dueAt]))),
          Effect.orDie,
        ),
        rest: (playerId, game, rev, reads) => {
          const rested = sql`UPDATE play_state SET due_at = NULL WHERE player_id = ${playerId} AND game = ${game} AND rev = ${rev}`;
          // A state that does not read tells the town nothing, at its `rev`, kept as it rests, so that the
          // town makes it due no more and a failure leaves it due. A codec fix that makes such states
          // read again needs its migration to make that game's states with a null postcard due once:
          // the town's reads alone will not.
          const toldNothing = sql`
            INSERT INTO play_postcards (player_id, game, rev, postcard)
            SELECT player_id, game, rev, NULL FROM play_state WHERE player_id = ${playerId} AND game = ${game} AND rev = ${rev}
            ON CONFLICT (player_id, game) DO UPDATE SET rev = excluded.rev, postcard = NULL
          `;
          return (reads ? rested : sql.withTransaction(Effect.andThen(rested, toldNothing))).pipe(
            Effect.asVoid,
            Effect.orDie,
          );
        },
        create: (playerId, game, state, guest, now, dueAt) =>
          sql`
            INSERT INTO play_state (player_id, game, rev, state, guest, updated_at, born, due_at, stood)
            VALUES (${playerId}, ${game}, 0, ${state}, ${guest ? 1 : 0}, ${now}, ${now}, ${dueAt}, 0)
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
            UPDATE play_state SET rev = rev + 1, state = ${state}, guest = ${guest ? 1 : 0}, updated_at = ${now}, due_at = ${dueAt},
            stood = rev + 1 WHERE player_id = ${playerId} AND game = ${game}
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
        activity: (playerId) => activity(playerId).pipe(Effect.orDie),
        count: (playerId, done, refused, now) =>
          done === 0 && refused === 0
            ? Effect.void
            : sql`
                INSERT INTO command_days (player_id, day, done, refused)
                VALUES (${playerId}, ${utcDay(now) * DAY_MS}, ${done}, ${refused})
                ON CONFLICT (player_id, day) DO UPDATE SET done = done + excluded.done, refused = refused + excluded.refused
              `.pipe(Effect.asVoid, Effect.orDie),
        board: (game, playerId) => Effect.all({ top: top(game), you: own({ playerId, game }) }).pipe(Effect.orDie),
        standingsOf: (playerId) =>
          standingsOf(playerId).pipe(
            Effect.map((rows) => new Map(rows.map(({ game, ...placed }) => [game, placed]))),
            Effect.orDie,
          ),
        ...givenIn(sql),
        ...standingsIn(sql),
        ...loggingIn(sql),
      });
    }),
  );
}
