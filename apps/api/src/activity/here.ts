import { DAY_MS, VISIT_RULES } from "@sequoia-leaf/core";
import { Effect, Schema } from "effect";
import { type SqlClient, SqlSchema } from "effect/sql";

/** A player counts as here this long after Leaf last heard of them in a place, unless they left it: 90 seconds (`VISIT_RULES.silentMs`). */
export const PRESENT_FOR_MS = VISIT_RULES.silentMs;
/** The most players listed as here in one answer: those heard of most lately. */
export const PRESENT_MOST = 50;
/** The most listed as gone in one answer, of those who stay and of those who do not. */
export const RESTING_MOST = 24;

/** Somebody on Leaf's list of who is about: where they are, or were last, and when Leaf last heard of them there. */
export interface Seen {
  readonly playerId: string;
  readonly username: string;
  readonly place: string;
  readonly guest: boolean;
  readonly seenAt: number;
}

/**
 * Who is about: those here now, and those gone in the last day, in two lists: `resting`, whose
 * characters stay in town, and `gone`, whose do not. They are apart so that a page which draws
 * everybody resting as dozing never draws somebody who would rather not stay.
 */
export interface Here {
  readonly present: readonly Seen[];
  readonly resting: readonly Seen[];
  readonly gone: readonly Seen[];
}

/** A player's newest visit, with who they are and whether they stay. */
const Latest = Schema.Struct({
  playerId: Schema.String,
  username: Schema.String,
  place: Schema.String,
  guest: Schema.BooleanFromBit,
  heardAt: Schema.Int,
  leftAt: Schema.NullOr(Schema.Int),
  stay: Schema.BooleanFromBit,
});

/** Somebody on the lists, from their newest visit: last seen when it closed, or was last heard of. */
const seen = (v: typeof Latest.Type): Seen => ({
  playerId: v.playerId,
  username: v.username,
  place: v.place,
  guest: v.guest,
  seenAt: v.leftAt ?? v.heardAt,
});
/** Newest first, then by id. */
const byNewest = (a: Seen, b: Seen) => b.seenAt - a.seenAt || (a.playerId < b.playerId ? -1 : 1);
/** By name, then by id. */
const byName = (a: Seen, b: Seen) =>
  a.username < b.username ? -1 : a.username > b.username ? 1 : a.playerId < b.playerId ? -1 : 1;

/**
 * Who is about at `now`, from each player's newest visit: here while it is open and was heard of
 * in the last 90 seconds, at most the 50 heard of most lately, in name order; gone otherwise, last
 * seen when it closed (or was last heard of), newest first, at most 24 of those who stay and 24 of
 * those who do not.
 */
export function hereFrom(visits: readonly (typeof Latest.Type)[], now: number): Here {
  const isHere = (v: typeof Latest.Type) => v.leftAt === null && v.heardAt > now - PRESENT_FOR_MS;
  const left = visits.filter((v) => !isHere(v));
  return {
    present: visits.filter(isHere).map(seen).toSorted(byNewest).slice(0, PRESENT_MOST).toSorted(byName),
    resting: left
      .filter((v) => v.stay)
      .map(seen)
      .toSorted(byNewest)
      .slice(0, RESTING_MOST),
    gone: left
      .filter((v) => !v.stay)
      .map(seen)
      .toSorted(byNewest)
      .slice(0, RESTING_MOST),
  };
}

/**
 * Who is about at `now` (`hereFrom`), in one statement that reads only the newest visits that can
 * be on the lists (`last_visits`, one row a player, which the database keeps as visits are
 * written): the 50 open ones heard of most lately in the last 90 seconds; and, of those who stay
 * and of those who do not, the 24 closed ones that closed last and the 24 open ones gone silent
 * that were heard of last, all of the last day. Each list is the first few of one order, and the
 * first few of a list are among the first few of each part it is made of, so `hereFrom` makes the
 * same lists of these as of every player's newest visit. Each part is read in its index's order,
 * newest first, and stops at its few.
 */
export const readHere = (sql: SqlClient.SqlClient) => {
  const candidates = SqlSchema.findAll({
    Request: Schema.Struct({ here: Schema.Int, day: Schema.Int }),
    Result: Latest,
    execute: ({ here, day }) => sql`
      SELECT * FROM (
        SELECT l.player_id AS playerId, p.name AS username, l.place, l.guest, l.heard_at AS heardAt, l.left_at AS leftAt, l.stay
        FROM last_visits AS l JOIN players_seen AS p ON p.player_id = l.player_id
        WHERE l.left_at IS NULL AND l.heard_at > ${here} AND l.heard_at >= ${day}
        ORDER BY l.heard_at DESC, l.player_id LIMIT ${PRESENT_MOST}
      )
      UNION ALL SELECT * FROM (${silent(sql, here, day, 1)})
      UNION ALL SELECT * FROM (${silent(sql, here, day, 0)})
      UNION ALL SELECT * FROM (${closed(sql, day, 1)})
      UNION ALL SELECT * FROM (${closed(sql, day, 0)})
    `,
  });
  return (now: number) =>
    candidates({ here: now - PRESENT_FOR_MS, day: now - DAY_MS }).pipe(
      Effect.map((rows) => hereFrom(rows, now)),
      Effect.orDie,
    );
};

/** The open newest visits of those who stay (`stay` 1) or not, gone silent by `here`, heard of last, of the day. */
const silent = (sql: SqlClient.SqlClient, here: number, day: number, stay: number) => sql`
  SELECT l.player_id AS playerId, p.name AS username, l.place, l.guest, l.heard_at AS heardAt, l.left_at AS leftAt, l.stay
  FROM last_visits AS l JOIN players_seen AS p ON p.player_id = l.player_id
  WHERE l.left_at IS NULL AND l.heard_at <= ${here} AND l.heard_at >= ${day} AND l.stay = ${stay}
  ORDER BY l.heard_at DESC, l.player_id LIMIT ${RESTING_MOST}
`;

/** The closed newest visits of those who stay (`stay` 1) or not, closed last, of the day. A visit closes after it was last heard of. */
const closed = (sql: SqlClient.SqlClient, day: number, stay: number) => sql`
  SELECT l.player_id AS playerId, p.name AS username, l.place, l.guest, l.heard_at AS heardAt, l.left_at AS leftAt, l.stay
  FROM last_visits AS l JOIN players_seen AS p ON p.player_id = l.player_id
  WHERE l.left_at IS NOT NULL AND l.stay = ${stay} AND l.left_at >= ${day} AND l.heard_at >= ${day}
  ORDER BY l.left_at DESC, l.player_id LIMIT ${RESTING_MOST}
`;
