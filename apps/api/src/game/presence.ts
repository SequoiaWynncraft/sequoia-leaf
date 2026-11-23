import { DAY_MS, type PlayerId, VISIT_RULES } from "@sequoia-leaf/core";
import { Context, Effect, Layer, Option, PubSub, Schema, type Scope } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

/**
 * A member counts as here this long after the game last said where they are, unless they left a
 * live room there since: the same 90 seconds after which Leaf closes a visit not heard of
 * (`VISIT_RULES.silentMs`). The game says so every 30 seconds.
 */
export const PRESENT_FOR_MS = VISIT_RULES.silentMs;
/** The most members listed as resting in one answer. */
export const RESTING_MOST = 24;
/** The most players listed as here in one answer: those seen most recently. */
export const PRESENT_MOST = 50;
/**
 * A player's game saying it is where it last said, sooner than this after the last time anything was
 * written for them, is answered, but not written down.
 */
export const PRESENCE_EVERY_MS = 5000;

const Present = Schema.Struct({
  playerId: Schema.String,
  username: Schema.String,
  place: Schema.String,
  guest: Schema.BooleanFromBit,
  seenAt: Schema.Number,
});
export type Present = typeof Present.Type;

const Resting = Schema.Struct({
  playerId: Schema.String,
  username: Schema.String,
  place: Schema.String,
  guest: Schema.BooleanFromBit,
  seenAt: Schema.Number,
});
export type Resting = typeof Resting.Type;

/** What a player's row said before a write: where, whether they had left it, and whether they stay. */
const Was = Schema.Struct({ place: Schema.String, leftAt: Schema.NullOr(Schema.Number), stay: Schema.Number });

/**
 * Who is about: those here now, and those gone in the last day, in two lists: `resting`, whose
 * characters stay in town, and `gone`, whose do not. They are apart so that a page which draws
 * everybody resting as dozing never draws somebody who would rather not stay.
 */
export interface Here {
  readonly present: readonly Present[];
  readonly resting: readonly Resting[];
  readonly gone: readonly Resting[];
}

/** Somebody in one of Live's rooms, as their presence is written. */
export interface InRoom {
  readonly playerId: PlayerId;
  readonly username: string;
  readonly guest: boolean;
}

/**
 * Who has the game open, and where they are in it. Each player, member or
 * guest, has one row, written whenever their game says where they are (and
 * whether their character may stay in town after they go), but no sooner than
 * five seconds after the last write unless they say somewhere else, or other
 * about staying. Live writes it too, for a player in one of its rooms: when
 * they come in, now and then while they are there, and when they go, which
 * lists them as gone at once. Rows a day old are removed whenever one is
 * written. It is in the database rather than in memory because during a deploy
 * two containers answer side by side. A database failure is a defect.
 *
 * Every change to who is where (somebody comes, goes, is somewhere else, or
 * says otherwise about staying) is told on `changes` once it is written, for
 * Live to tell the pages in its rooms; a write that only says again what was
 * said is not a change.
 */
export class Presence extends Context.Service<
  Presence,
  {
    /**
     * Records that a player (a guest, or not) is at `place` now, and whether they would stay (null:
     * as they last said, or yes for a player never seen), unless the last write for them was less
     * than `PRESENCE_EVERY_MS` ago and said the same; lists the 50 seen most recently in the last 90
     * seconds who have not left a room since, them included, and those seen between then and a day
     * ago (or who left) who stay.
     */
    readonly arrive: (
      playerId: PlayerId,
      username: string,
      place: string,
      stay: boolean | null,
      guest: boolean,
      now: number,
    ) => Effect.Effect<Here>;
    /** Lists who is about now, as `arrive` does, writing nothing: for a page in a live room, whose place the room keeps. */
    readonly look: (now: number) => Effect.Effect<Here>;
    /**
     * Records that players in a live room are at its `place` now, as `arrive` would, keeping what
     * each last said about staying (a player never seen stays, as `arrive` has it when nothing is
     * said). Written whatever was written last.
     */
    readonly inRoom: (players: readonly InRoom[], place: string, now: number) => Effect.Effect<void>;
    /**
     * A player has left a live room's `place`: they were last seen there now, and are gone from now
     * on. Nothing is written if their game has said since that they are somewhere else.
     */
    readonly leftRoom: (playerId: PlayerId, place: string, now: number) => Effect.Effect<void>;
    /** Hears of every change to who is where, once it is written; a burst of them may be heard as one. */
    readonly changes: Effect.Effect<PubSub.Subscription<void>, never, Scope.Scope>;
  }
>()("leaf/Presence") {
  static readonly layer = Layer.effect(
    Presence,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      // Only that something changed is told, so one waiting is as good as many.
      const news = yield* PubSub.sliding<void>(1);
      const present = SqlSchema.findAll({
        Request: Schema.Int,
        Result: Present,
        execute: (since) => sql`
          SELECT playerId, username, place, guest, seenAt FROM (
            SELECT player_id AS playerId, username, place, guest, seen_at AS seenAt FROM presence
            WHERE seen_at > ${since} AND left_at IS NULL
            ORDER BY seen_at DESC, player_id
            LIMIT ${PRESENT_MOST}
          )
          ORDER BY username, playerId
        `,
      });
      const left = SqlSchema.findAll({
        Request: Schema.Struct({ before: Schema.Int, since: Schema.Int, stay: Schema.Int }),
        Result: Resting,
        execute: ({ before, since, stay }) => sql`
          SELECT player_id AS playerId, username, place, guest, seen_at AS seenAt FROM presence
          WHERE (seen_at <= ${before} OR left_at IS NOT NULL) AND seen_at >= ${since} AND stay = ${stay}
          ORDER BY seen_at DESC, player_id
          LIMIT ${RESTING_MOST}
        `,
      });
      const was = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: Was,
        execute: (playerId) => sql`SELECT place, left_at AS leftAt, stay FROM presence WHERE player_id = ${playerId}`,
      });
      /** Whether a row going to `place` (staying as `said`, or as it was for null) changes who is where. */
      const changes = (before: Option.Option<typeof Was.Type>, place: string, said: number | null): boolean =>
        Option.match(before, {
          onNone: () => true,
          onSome: (row) => row.place !== place || row.leftAt !== null || (said !== null && row.stay !== said),
        });
      const tell = (changed: boolean) => (changed ? PubSub.publish(news, undefined) : Effect.void);
      const forgetOld = (now: number) => sql`DELETE FROM presence WHERE seen_at < ${now - DAY_MS}`;
      const lists = (now: number) =>
        Effect.all({
          present: present(now - PRESENT_FOR_MS),
          resting: left({ before: now - PRESENT_FOR_MS, since: now - DAY_MS, stay: 1 }),
          gone: left({ before: now - PRESENT_FOR_MS, since: now - DAY_MS, stay: 0 }),
        });
      return Presence.of({
        look: (now) => sql.withTransaction(lists(now)).pipe(Effect.orDie),
        arrive: (playerId, username, place, stay, guest, now) =>
          sql
            .withTransaction(
              Effect.gen(function* () {
                // Not said: a new row stays, and a row there keeps what it had.
                const said = stay === null ? null : stay ? 1 : 0;
                const before = yield* was(playerId);
                const written = yield* sql`
                  INSERT INTO presence (player_id, username, place, seen_at, stay, guest, left_at)
                  VALUES (${playerId}, ${username}, ${place}, ${now}, ${said ?? 1}, ${guest ? 1 : 0}, NULL)
                  ON CONFLICT (player_id) DO UPDATE SET
                    username = excluded.username, place = excluded.place, seen_at = excluded.seen_at,
                    stay = coalesce(${said}, presence.stay), guest = excluded.guest, left_at = NULL
                  WHERE presence.seen_at <= ${now - PRESENCE_EVERY_MS} OR presence.left_at IS NOT NULL
                    OR presence.place <> excluded.place OR presence.stay <> coalesce(${said}, presence.stay)
                  RETURNING player_id
                `;
                if (written.length > 0) yield* forgetOld(now);
                return { here: yield* lists(now), changed: changes(before, place, said) };
              }),
            )
            .pipe(
              Effect.orDie,
              Effect.tap(({ changed }) => tell(changed)),
              Effect.map(({ here }) => here),
            ),
        inRoom: (players, place, now) =>
          players.length === 0
            ? Effect.void
            : sql
                .withTransaction(
                  Effect.gen(function* () {
                    let changed = false;
                    for (const p of players) {
                      if (changes(yield* was(p.playerId), place, null)) changed = true;
                      yield* sql`
                        INSERT INTO presence (player_id, username, place, seen_at, stay, guest, left_at)
                        VALUES (${p.playerId}, ${p.username}, ${place}, ${now}, 1, ${p.guest ? 1 : 0}, NULL)
                        ON CONFLICT (player_id) DO UPDATE SET
                          username = excluded.username, place = excluded.place, seen_at = excluded.seen_at,
                          guest = excluded.guest, left_at = NULL
                      `;
                    }
                    yield* forgetOld(now);
                    return changed;
                  }),
                )
                .pipe(Effect.orDie, Effect.flatMap(tell)),
        leftRoom: (playerId, place, now) =>
          sql`
            UPDATE presence SET seen_at = max(seen_at, ${now}), left_at = ${now}
            WHERE player_id = ${playerId} AND place = ${place} AND left_at IS NULL
            RETURNING player_id
          `.pipe(
            Effect.orDie,
            Effect.flatMap((rows) => tell(rows.length > 0)),
          ),
        changes: PubSub.subscribe(news),
      });
    }),
  );
}
