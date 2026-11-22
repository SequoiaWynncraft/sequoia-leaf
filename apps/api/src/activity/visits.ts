import {
  type Device,
  DEVICES,
  joinsSession,
  type PlayerId,
  silentSince,
  VISIT_RULES,
  visitSeconds,
} from "@sequoia-leaf/core";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { LeafInstance } from "../instance.ts";

/** Somebody whose stay in a place Leaf records: who they are now, and what their page said it is on, if it did. */
export interface Visitor {
  readonly playerId: PlayerId;
  readonly username: string;
  readonly guest: boolean;
  readonly device: Device | null;
}

/** How Leaf knows a player is somewhere: they are in a live room of the place, or their page said so. */
type Source = "room" | "call";

const OpenVisit = Schema.Struct({
  id: Schema.Int,
  sessionId: Schema.Int,
  playerId: Schema.String,
  place: Schema.String,
  source: Schema.Literals(["room", "call"]),
  enteredAt: Schema.Int,
  heardAt: Schema.Int,
  /** The Leaf that heard of it last. */
  instance: Schema.String,
});
type OpenVisit = typeof OpenVisit.Type;

/**
 * Every stay of a player in one of the game's places (`visits`), the sittings they make up
 * (`sessions`: visits less than five minutes apart) and one row a player (`players_seen`), for the
 * staff's view of who played (`GET /v1/game/admin/activity`).
 *
 * A visit opens when a player comes into a live room of a place, or when their page says it is
 * there (`PUT /v1/game/presence`), and is heard of again while they stay: by the room every half
 * minute, and by each of the page's calls. It closes when they leave the room (or their grace runs
 * out), when they go somewhere else, or, not heard of for 90 seconds, at the last time it was. A
 * player has one open visit at most: coming somewhere closes the one anywhere else. Sessions and
 * players are kept up to date as visits open and close, in the same transaction, and a player's
 * name and whether a guest each time Leaf hears of them. A visit belongs to the Leaf process
 * (`LeafInstance`) that last heard of it, so that a player who moves to the new container in a
 * deploy takes their open visit with them. Whenever a visit is opened, visits and sessions that
 * ended 180 days ago are removed. A database failure is a defect.
 */
export class Visits extends Context.Service<
  Visits,
  {
    /** A player's page said they are at `place` now. */
    readonly called: (who: Visitor, place: string, now: number) => Effect.Effect<void>;
    /** Players are in a live room of `place` now: just come in, or still there. */
    readonly inRoom: (who: readonly Visitor[], place: string, now: number) => Effect.Effect<void>;
    /** A player has left a live room of `place`. Nothing changes if Leaf has heard since that they are somewhere else. */
    readonly leftRoom: (playerId: PlayerId, place: string, now: number) => Effect.Effect<void>;
    /**
     * Leaf is stopping: every open visit this Leaf was the last to hear of closes now (those gone
     * silent, at the last time they were heard of). One another Leaf has heard of since stays open.
     */
    readonly closeAll: (now: number) => Effect.Effect<void>;
    /** Closes every open visit not heard of for 90 seconds, at the last time it was. */
    readonly closeSilent: (now: number) => Effect.Effect<void>;
  }
>()("leaf/Visits") {
  static readonly layer = Layer.effect(
    Visits,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const instance = yield* LeafInstance;
      const rules = VISIT_RULES;
      const openOf = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: OpenVisit,
        execute: (playerId) => sql`
          SELECT id, session_id AS sessionId, player_id AS playerId, place, source, entered_at AS enteredAt,
                 heard_at AS heardAt, instance
          FROM visits WHERE player_id = ${playerId} AND left_at IS NULL
        `,
      });
      const allOpen = SqlSchema.findAll({
        Request: Schema.Void,
        Result: OpenVisit,
        execute: () => sql`
          SELECT id, session_id AS sessionId, player_id AS playerId, place, source, entered_at AS enteredAt,
                 heard_at AS heardAt, instance
          FROM visits WHERE left_at IS NULL ORDER BY id
        `,
      });
      const ownOpen = SqlSchema.findAll({
        Request: Schema.Void,
        Result: OpenVisit,
        execute: () => sql`
          SELECT id, session_id AS sessionId, player_id AS playerId, place, source, entered_at AS enteredAt,
                 heard_at AS heardAt, instance
          FROM visits WHERE left_at IS NULL AND instance = ${instance} ORDER BY id
        `,
      });
      const lastSession = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: Schema.Struct({ id: Schema.Int, endedAt: Schema.NullOr(Schema.Int) }),
        execute: (playerId) => sql`
          SELECT id, ended_at AS endedAt FROM sessions WHERE player_id = ${playerId}
          ORDER BY started_at DESC, id DESC LIMIT 1
        `,
      });
      const beginSession = SqlSchema.findOne({
        Request: Schema.Struct({
          playerId: Schema.String,
          guest: Schema.Boolean,
          at: Schema.Int,
          device: Schema.NullOr(Schema.Literals(DEVICES)),
        }),
        Result: Schema.Struct({ id: Schema.Int }),
        execute: ({ playerId, guest, at, device }) => sql`
          INSERT INTO sessions (player_id, guest, started_at, device)
          VALUES (${playerId}, ${guest ? 1 : 0}, ${at}, ${device})
          RETURNING id
        `,
      });

      /** Closes a visit at `at` (never before it began), and adds its time to its session and its player. */
      const close = (visit: OpenVisit, at: number) =>
        Effect.gen(function* () {
          const leftAt = Math.max(visit.enteredAt, at);
          const seconds = visitSeconds(visit.enteredAt, leftAt);
          const path = `$."${visit.place}"`;
          yield* sql`UPDATE visits SET left_at = ${leftAt}, seconds = ${seconds} WHERE id = ${visit.id}`;
          yield* sql`
            UPDATE sessions SET ended_at = ${leftAt}, seconds = seconds + ${seconds},
              places = json_set(places, ${path}, coalesce(json_extract(places, ${path}), 0) + ${seconds})
            WHERE id = ${visit.sessionId}
          `;
          yield* sql`
            UPDATE players_seen SET seconds_total = seconds_total + ${seconds}, last_seen_at = max(last_seen_at, ${leftAt})
            WHERE player_id = ${visit.playerId}
          `;
        });

      /**
       * Opens a visit for a player who has none open, in their last session if it ended less than
       * five minutes ago, or else in a new one, and removes what has been kept long enough.
       */
      const open = (who: Visitor, place: string, source: Source, at: number) =>
        Effect.gen(function* () {
          const guest = who.guest ? 1 : 0;
          const last = yield* lastSession(who.playerId);
          const joined = Option.isSome(last) && joinsSession(last.value.endedAt, at, rules) ? last : Option.none();
          if (Option.isSome(joined)) {
            yield* sql`
              UPDATE sessions SET ended_at = NULL, guest = ${guest}, device = coalesce(device, ${who.device})
              WHERE id = ${joined.value.id}
            `;
          }
          const sessionId = Option.isSome(joined)
            ? joined.value.id
            : (yield* beginSession({ playerId: who.playerId, guest: who.guest, at, device: who.device })).id;
          yield* sql`
            INSERT INTO visits (session_id, player_id, guest, place, source, entered_at, heard_at, instance)
            VALUES (${sessionId}, ${who.playerId}, ${guest}, ${place}, ${source}, ${at}, ${at}, ${instance})
          `;
          yield* sql`
            INSERT INTO players_seen (player_id, name, guest, first_seen_at, last_seen_at, sessions)
            VALUES (${who.playerId}, ${who.username}, ${guest}, ${at}, ${at}, ${Option.isSome(joined) ? 0 : 1})
            ON CONFLICT (player_id) DO UPDATE SET
              name = excluded.name, guest = excluded.guest,
              first_seen_at = min(first_seen_at, excluded.first_seen_at),
              last_seen_at = max(last_seen_at, excluded.last_seen_at),
              sessions = sessions + excluded.sessions
          `;
          yield* sql`DELETE FROM visits WHERE left_at < ${at - rules.keptMs}`;
          yield* sql`DELETE FROM sessions WHERE ended_at < ${at - rules.keptMs}`;
        });

      /**
       * A player is at `place` now: their open visit there is heard of again, by this Leaf (and is
       * the room's, if this is the room), with their name and whether a guest as they are now; or
       * the one they have elsewhere closes and one opens here.
       */
      const arrive = (who: Visitor, place: string, source: Source, now: number) =>
        Effect.gen(function* () {
          const current = yield* openOf(who.playerId);
          if (Option.isSome(current) && current.value.place === place) {
            const kept = source === "room" ? "room" : current.value.source;
            const guest = who.guest ? 1 : 0;
            yield* sql`
              UPDATE visits SET heard_at = max(heard_at, ${now}), source = ${kept}, guest = ${guest},
                instance = ${instance}
              WHERE id = ${current.value.id}
            `;
            yield* sql`
              UPDATE players_seen SET name = ${who.username}, guest = ${guest}
              WHERE player_id = ${who.playerId} AND (name <> ${who.username} OR guest <> ${guest})
            `;
            return;
          }
          if (Option.isSome(current)) yield* close(current.value, now);
          yield* open(who, place, source, now);
        });

      const closeSilent = (now: number) =>
        Effect.flatMap(allOpen(undefined), (visits) =>
          Effect.forEach(
            visits.filter((v) => silentSince(v.heardAt, now, rules)),
            (v) => close(v, v.heardAt),
            { discard: true },
          ),
        );

      /** Runs a change in one transaction, after closing whatever has gone silent. */
      const write = <A, E>(change: Effect.Effect<A, E>, now: number) =>
        sql.withTransaction(Effect.andThen(closeSilent(now), change)).pipe(Effect.orDie);

      return Visits.of({
        called: (who, place, now) => write(arrive(who, place, "call", now), now),
        inRoom: (who, place, now) =>
          who.length === 0
            ? Effect.void
            : write(
                Effect.forEach(who, (w) => arrive(w, place, "room", now), { discard: true }),
                now,
              ),
        leftRoom: (playerId, place, now) =>
          write(
            Effect.flatMap(openOf(playerId), (current) =>
              // Only this Leaf's to close: a player who has moved to another Leaf (a deploy) is still there.
              Option.isSome(current) &&
              current.value.place === place &&
              current.value.source === "room" &&
              current.value.instance === instance
                ? close(current.value, now)
                : Effect.void,
            ),
            now,
          ),
        closeAll: (now) =>
          write(
            Effect.flatMap(ownOpen(undefined), (visits) =>
              Effect.forEach(visits, (v) => close(v, now), { discard: true }),
            ),
            now,
          ),
        closeSilent: (now) => sql.withTransaction(closeSilent(now)).pipe(Effect.orDie),
      });
    }),
  );
}
