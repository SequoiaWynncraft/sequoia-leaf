import { DAY_MS, type PlayerId } from "@sequoia-leaf/core";
import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

/** A member counts as here this long after the game last said where they are. It says so every 30 seconds. */
export const PRESENT_FOR_MS = 90_000;
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

/** Who is about: those here now, and those gone in the last day whose characters stay in town. */
export interface Here {
  readonly present: readonly Present[];
  readonly resting: readonly Resting[];
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
 * they come in, now and then while they are there, and when they go. Rows a
 * day old are removed whenever one is written. It is in the database rather
 * than in memory because during a deploy two containers answer side by side. A
 * database failure is a defect.
 */
export class Presence extends Context.Service<
  Presence,
  {
    /**
     * Records that a player (a guest, or not) is at `place` now, and whether they would stay,
     * unless the last write for them was less than `PRESENCE_EVERY_MS` ago and said the same; lists
     * the 50 seen most recently in the last 90 seconds, them included, and those seen between then
     * and a day ago who stay.
     */
    readonly arrive: (
      playerId: PlayerId,
      username: string,
      place: string,
      stay: boolean,
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
     * A player has left a live room's `place`: they were last seen there now. Nothing is written if
     * their game has said since that they are somewhere else.
     */
    readonly leftRoom: (playerId: PlayerId, place: string, now: number) => Effect.Effect<void>;
  }
>()("leaf/Presence") {
  static readonly layer = Layer.effect(
    Presence,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const present = SqlSchema.findAll({
        Request: Schema.Int,
        Result: Present,
        execute: (since) => sql`
          SELECT playerId, username, place, guest FROM (
            SELECT player_id AS playerId, username, place, guest FROM presence WHERE seen_at > ${since}
            ORDER BY seen_at DESC, player_id
            LIMIT ${PRESENT_MOST}
          )
          ORDER BY username, playerId
        `,
      });
      const resting = SqlSchema.findAll({
        Request: Schema.Struct({ before: Schema.Int, since: Schema.Int }),
        Result: Resting,
        execute: ({ before, since }) => sql`
          SELECT player_id AS playerId, username, place, guest, seen_at AS seenAt FROM presence
          WHERE seen_at <= ${before} AND seen_at >= ${since} AND stay = 1
          ORDER BY seen_at DESC, player_id
          LIMIT ${RESTING_MOST}
        `,
      });
      const forgetOld = (now: number) => sql`DELETE FROM presence WHERE seen_at < ${now - DAY_MS}`;
      const lists = (now: number) =>
        Effect.all({
          present: present(now - PRESENT_FOR_MS),
          resting: resting({ before: now - PRESENT_FOR_MS, since: now - DAY_MS }),
        });
      return Presence.of({
        look: (now) => sql.withTransaction(lists(now)).pipe(Effect.orDie),
        arrive: (playerId, username, place, stay, guest, now) =>
          sql
            .withTransaction(
              Effect.gen(function* () {
                const written = yield* sql`
                  INSERT INTO presence (player_id, username, place, seen_at, stay, guest)
                  VALUES (${playerId}, ${username}, ${place}, ${now}, ${stay ? 1 : 0}, ${guest ? 1 : 0})
                  ON CONFLICT (player_id) DO UPDATE SET
                    username = excluded.username, place = excluded.place, seen_at = excluded.seen_at,
                    stay = excluded.stay, guest = excluded.guest
                  WHERE presence.seen_at <= ${now - PRESENCE_EVERY_MS}
                    OR presence.place <> excluded.place OR presence.stay <> excluded.stay
                  RETURNING player_id
                `;
                if (written.length > 0) yield* forgetOld(now);
                return yield* lists(now);
              }),
            )
            .pipe(Effect.orDie),
        inRoom: (players, place, now) =>
          players.length === 0
            ? Effect.void
            : sql
                .withTransaction(
                  Effect.gen(function* () {
                    for (const p of players) {
                      yield* sql`
                        INSERT INTO presence (player_id, username, place, seen_at, stay, guest)
                        VALUES (${p.playerId}, ${p.username}, ${place}, ${now}, 1, ${p.guest ? 1 : 0})
                        ON CONFLICT (player_id) DO UPDATE SET
                          username = excluded.username, place = excluded.place, seen_at = excluded.seen_at,
                          guest = excluded.guest
                      `;
                    }
                    yield* forgetOld(now);
                  }),
                )
                .pipe(Effect.orDie),
        leftRoom: (playerId, place, now) =>
          sql`
            UPDATE presence SET seen_at = ${now}
            WHERE player_id = ${playerId} AND place = ${place} AND seen_at < ${now}
          `.pipe(Effect.asVoid, Effect.orDie),
      });
    }),
  );
}
