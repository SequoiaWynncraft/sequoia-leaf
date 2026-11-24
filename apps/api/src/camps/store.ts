import { type PlayerId, utcWeekStart } from "@sequoia-leaf/core";
import { liking, type NoLike } from "@sequoia-leaf/town/likes.ts";
import { Clock, Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { Allowances } from "../allowance.ts";
import { Events } from "../events/store.ts";
import { PlayerNames } from "../game/names.ts";
import { PlayerUuid } from "../wire.ts";

/** The most camps the list holds: those with the most things set out. */
export const CAMPS_LISTED = 1000;
/** The most of each kind of visitor a camp's owner is shown: who likes it, and who stayed in it this week. */
export const VISITORS_LISTED = 100;
/** How many likes and likes taken back a player may give: one a second, bursts of five. */
const LIKES = { rate: 1, burst: 5 } as const;
/** How many players' allowances are kept before those filled up again are let go. */
const HELD = 1000;

/** A camp as the list gives it: whose, named as the boards name players, the things set out, its likes, and whether the caller likes it. */
export interface Listed {
  readonly playerId: PlayerId;
  readonly name: string;
  readonly guest: boolean;
  readonly setOut: number;
  readonly likes: number;
  readonly liked: boolean;
}

/** Somebody who likes a camp or stayed in it, named, and when they last liked it or stayed. */
export interface Caller {
  readonly playerId: PlayerId;
  readonly name: string;
  readonly guest: boolean;
  readonly at: number;
}

/** What a like or taking one back did: the camp's likes and whether the caller likes it now; why not; or too many too fast. */
export type Liked =
  | { readonly status: "done"; readonly likes: number; readonly liked: boolean }
  | { readonly status: "refused"; readonly why: NoLike }
  | { readonly status: "slow" };

const Row = Schema.Struct({
  playerId: PlayerUuid,
  guest: Schema.BooleanFromBit,
  setOut: Schema.Int,
  likes: Schema.Int,
  liked: Schema.BooleanFromBit,
});
const Visitor = Schema.Struct({ playerId: PlayerUuid, guest: Schema.BooleanFromBit, at: Schema.Int });
const Kept = Schema.Struct({ first: Schema.Int, at: Schema.Int, liked: Schema.BooleanFromBit });
const Pair = Schema.Struct({ liker: Schema.String, owner: Schema.String });

/** Whether the player in `column` was a guest when Leaf last saw them. */
const guestIn = (sql: SqlClient.SqlClient, column: string) =>
  sql`coalesce((SELECT guest FROM players_seen AS g WHERE g.player_id = ${sql(column)}), 0)`;

/** Each of these, named as the boards name players: "Someone" for one Leaf cannot name. */
const namedBy = <T extends { readonly playerId: PlayerId }>(names: PlayerNames["Service"], found: readonly T[]) =>
  Effect.map(names.of(found.map((r) => r.playerId)), (got) =>
    found.map((r) => ({ ...r, name: got.get(r.playerId) ?? "Someone" })),
  );

/**
 * The camps: every member's town state is a camp, listed by the things set out in it, with its
 * likes (`camp_likes`: one a person and camp, kept when it is taken back, so its owner is told of
 * it once), and who likes it and who stayed in it this week (`camp_visits`, which the Tally keeps).
 * A like pays nothing. A database failure is a defect.
 */
export class Camps extends Context.Service<
  Camps,
  {
    /** Every camp, the first `CAMPS_LISTED` by things set out, as `caller` is shown them. */
    readonly list: (caller: PlayerId) => Effect.Effect<readonly Listed[]>;
    /** `liker`, named `name`, gives (`on`) or takes back a like of `owner`'s camp; its owner is told the first time ever. */
    readonly like: (liker: PlayerId, name: string, owner: PlayerId, on: boolean) => Effect.Effect<Liked>;
    /** Whether `owner` has a camp: a town state Leaf keeps. */
    readonly has: (owner: PlayerId) => Effect.Effect<boolean>;
    /** Who likes `owner`'s camp, newest first, and who stayed in it this UTC week, last stay first. */
    readonly visitors: (
      owner: PlayerId,
    ) => Effect.Effect<{ readonly likes: readonly Caller[]; readonly stays: readonly Caller[] }>;
  }
>()("leaf/Camps") {
  static readonly layer = Layer.effect(
    Camps,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const names = yield* PlayerNames;
      const events = yield* Events;
      const pace = new Allowances([LIKES], HELD);
      const guestOf = (column: string) => guestIn(sql, column);
      const rows = SqlSchema.findAll({
        Request: Schema.String,
        Result: Row,
        execute: (caller) => sql`
          SELECT p.player_id AS playerId, p.guest, coalesce(s.score, 0) AS setOut,
                 (SELECT count(*) FROM camp_likes AS l WHERE l.owner_id = p.player_id AND l.liked = 1) AS likes,
                 EXISTS (
                   SELECT 1 FROM camp_likes AS m WHERE m.owner_id = p.player_id AND m.liker_id = ${caller} AND m.liked = 1
                 ) AS liked
          FROM play_state AS p LEFT JOIN standings AS s ON s.player_id = p.player_id AND s.game = 'town'
          WHERE p.game = 'town'
          ORDER BY setOut DESC, p.player_id LIMIT ${CAMPS_LISTED}
        `,
      });
      const kept = SqlSchema.findOneOption({
        Request: Pair,
        Result: Kept,
        execute: ({ liker, owner }) =>
          sql`SELECT first_at AS first, at, liked FROM camp_likes WHERE liker_id = ${liker} AND owner_id = ${owner}`,
      });
      const hasCamp = SqlSchema.findAll({
        Request: Schema.String,
        Result: Schema.Struct({ n: Schema.Int }),
        execute: (owner) => sql`SELECT 1 AS n FROM play_state WHERE player_id = ${owner} AND game = 'town'`,
      });
      const likesOf = SqlSchema.findOne({
        Request: Schema.String,
        Result: Schema.Struct({ n: Schema.Int }),
        execute: (owner) => sql`SELECT count(*) AS n FROM camp_likes WHERE owner_id = ${owner} AND liked = 1`,
      });
      const likers = SqlSchema.findAll({
        Request: Schema.String,
        Result: Visitor,
        execute: (owner) => sql`
          SELECT liker_id AS playerId, ${guestOf("liker_id")} AS guest, at FROM camp_likes
          WHERE owner_id = ${owner} AND liked = 1 ORDER BY at DESC, liker_id LIMIT ${VISITORS_LISTED}
        `,
      });
      const stayers = SqlSchema.findAll({
        Request: Schema.Struct({ owner: Schema.String, week: Schema.Int }),
        Result: Visitor,
        execute: ({ owner, week }) => sql`
          SELECT visitor_id AS playerId, ${guestOf("visitor_id")} AS guest, last_at AS at FROM camp_visits
          WHERE owner_id = ${owner} AND last_at >= ${week} ORDER BY last_at DESC, visitor_id LIMIT ${VISITORS_LISTED}
        `,
      });
      const named = <T extends { readonly playerId: PlayerId }>(found: readonly T[]) => namedBy(names, found);
      return Camps.of({
        list: (caller) => rows(caller).pipe(Effect.orDie, Effect.flatMap(named)),
        like: (liker, name, owner, on) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            if (!pace.take(liker, now, [1])) return { status: "slow" } satisfies Liked;
            return yield* sql.withTransaction(
              Effect.gen(function* () {
                const was = Option.getOrNull(yield* kept({ liker, owner }));
                const camp = (yield* hasCamp(owner)).length > 0;
                const done = liking({ liker, owner, hasCamp: camp, was, on, now });
                if ("refused" in done) return { status: "refused", why: done.refused } satisfies Liked;
                const { kept: like } = done;
                if (like !== null && like !== was)
                  yield* sql`
                    INSERT INTO camp_likes (liker_id, owner_id, first_at, at, liked)
                    VALUES (${liker}, ${owner}, ${like.first}, ${like.at}, ${like.liked ? 1 : 0})
                    ON CONFLICT (liker_id, owner_id) DO UPDATE SET at = excluded.at, liked = excluded.liked
                  `;
                if (done.tell)
                  yield* events.insert(owner, { type: "camp_liked", data: { by: { id: liker, username: name } } }, now);
                const { n } = yield* likesOf(owner);
                return { status: "done", likes: n, liked: like?.liked ?? false } satisfies Liked;
              }),
            );
          }).pipe(Effect.orDie),
        has: (owner) => Effect.map(Effect.orDie(hasCamp(owner)), (found) => found.length > 0),
        visitors: (owner) =>
          Effect.gen(function* () {
            const week = utcWeekStart(yield* Clock.currentTimeMillis);
            const [likes, stays] = yield* Effect.all([likers(owner), stayers({ owner, week })]).pipe(Effect.orDie);
            return { likes: yield* named(likes), stays: yield* named(stays) };
          }),
      });
    }),
  );
}
