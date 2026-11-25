import { DAY_MS, type PlayerId, VISIT_RULES } from "@sequoia-leaf/core";
import { Effect, Schema } from "effect";
import { type SqlClient, SqlSchema, type Statement } from "effect/sql";

import { PlayerUuid } from "../wire.ts";

/** A player counts as here this long after Leaf last heard of them in a place, unless they left it: 90 seconds (`VISIT_RULES.silentMs`). */
export const PRESENT_FOR_MS = VISIT_RULES.silentMs;
/** The most players listed as here in one answer: those heard of most lately. */
export const PRESENT_MOST = 50;
/** The most listed as gone in one answer, of those who stay and of those who do not. */
export const RESTING_MOST = 24;

/** Whose camp somebody is at: the owner's player id, and their name as Leaf last heard it. */
export interface CampOwner {
  readonly playerId: PlayerId;
  readonly name: string;
}

/**
 * Somebody on Leaf's list of who is about: where they are, or were last (at a camp, whose, when
 * their page said; null anywhere else), and when Leaf last heard of them there.
 */
export interface Seen {
  readonly playerId: string;
  readonly username: string;
  readonly place: string;
  readonly camp: CampOwner | null;
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
  campOwner: Schema.NullOr(PlayerUuid),
  campOwnerName: Schema.NullOr(Schema.String),
  guest: Schema.BooleanFromBit,
  heardAt: Schema.Int,
  leftAt: Schema.NullOr(Schema.Int),
  stay: Schema.BooleanFromBit,
});

/** Whose camp a visit is in: at a camp its page named, the owner, named as Leaf last heard them ("Someone" for one it never has). */
const campOf = (v: typeof Latest.Type): CampOwner | null =>
  v.place === "camp" && v.campOwner !== null ? { playerId: v.campOwner, name: v.campOwnerName ?? "Someone" } : null;

/** Everybody on the lists whose camp they are at, by the owner's id. */
export const campOwners = (here: Here): PlayerId[] =>
  [...here.present, ...here.resting, ...here.gone].flatMap((p) => (p.camp === null ? [] : [p.camp.playerId]));

/** The lists, each camp's owner named as `named` has them (as the camp list names them), else as before. */
export const namedCamps = (here: Here, named: ReadonlyMap<string, string>): Here => {
  const name = (p: Seen): Seen =>
    p.camp === null ? p : { ...p, camp: { ...p.camp, name: named.get(p.camp.playerId) ?? p.camp.name } };
  return { present: here.present.map(name), resting: here.resting.map(name), gone: here.gone.map(name) };
};

/** Somebody on the lists, from their newest visit: last seen when it closed, or was last heard of. */
const seen = (v: typeof Latest.Type): Seen => ({
  playerId: v.playerId,
  username: v.username,
  place: v.place,
  camp: campOf(v),
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
 * and of those who do not, the 24 open ones gone silent heard of last, the 24 closed ones that
 * closed last, and the 24 closed before the day began that closed last though last heard of within
 * it (a close that raced a later call), all of the last day. Each list is the first few of one
 * order, and the first few of a list are among the first few of each part it is made of, so
 * `hereFrom` makes the same lists of these as of every player's newest visit. Each part is read in
 * its index's order, newest first, and stops at its few.
 */
export const readHere = (sql: SqlClient.SqlClient) => {
  const candidates = SqlSchema.findAll({
    Request: Schema.Struct({ here: Schema.Int, day: Schema.Int }),
    Result: Latest,
    execute: ({ here, day }) => {
      const silent = (stay: number) =>
        sql`l.left_at IS NULL AND l.heard_at <= ${here} AND l.heard_at >= ${day} AND l.stay = ${stay}`;
      const closed = (stay: number) =>
        sql`l.left_at IS NOT NULL AND l.left_at >= ${day} AND l.heard_at >= ${day} AND l.stay = ${stay}`;
      const closedEarly = (stay: number) =>
        sql`l.left_at < l.heard_at AND l.left_at < ${day} AND l.heard_at >= ${day} AND l.stay = ${stay}`;
      return sql`
        ${newest(sql, sql`l.left_at IS NULL AND l.heard_at > ${here} AND l.heard_at >= ${day}`, "heard", PRESENT_MOST)}
        UNION ALL ${newest(sql, silent(1), "heard", RESTING_MOST)}
        UNION ALL ${newest(sql, silent(0), "heard", RESTING_MOST)}
        UNION ALL ${newest(sql, closed(1), "left", RESTING_MOST)}
        UNION ALL ${newest(sql, closed(0), "left", RESTING_MOST)}
        UNION ALL ${newest(sql, closedEarly(1), "left", RESTING_MOST)}
        UNION ALL ${newest(sql, closedEarly(0), "left", RESTING_MOST)}
      `;
    },
  });
  return (now: number) =>
    candidates({ here: now - PRESENT_FOR_MS, day: now - DAY_MS }).pipe(
      Effect.map((rows) => hereFrom(rows, now)),
      Effect.orDie,
    );
};

/**
 * The first `most` newest visits `where` picks, with who they are, and at a camp whose: newest heard
 * of first, or newest closed first. A player taken into another when they linked an account
 * (`merges`) is nobody now: their visits stay on record, but they are not about, even from a page
 * still open as them.
 */
const newest = (sql: SqlClient.SqlClient, where: Statement.Fragment, by: "heard" | "left", most: number) => sql`
  SELECT * FROM (
    SELECT l.player_id AS playerId, p.name AS username, l.place, l.camp_owner AS campOwner, o.name AS campOwnerName,
           l.guest, l.heard_at AS heardAt, l.left_at AS leftAt, l.stay
    FROM last_visits AS l JOIN players_seen AS p ON p.player_id = l.player_id
      LEFT JOIN players_seen AS o ON o.player_id = l.camp_owner
    WHERE ${where} AND NOT EXISTS (SELECT 1 FROM merges AS m WHERE m.from_id = l.player_id)
    ORDER BY ${sql.literal(by === "heard" ? "l.heard_at" : "l.left_at")} DESC, l.player_id LIMIT ${most}
  )
`;
