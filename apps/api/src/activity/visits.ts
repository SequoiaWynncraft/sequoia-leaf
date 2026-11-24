import {
  away,
  DAY_MS,
  type Device,
  DEVICES,
  GAME_AT,
  joinsSession,
  type PlayerId,
  playing,
  silentSince,
  TIMED,
  VISIT_RULES,
  visitSeconds,
} from "@sequoia-leaf/core";
import { Context, Effect, Layer, Option, PubSub, Schema, type Scope } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { LeafInstance } from "../instance.ts";
import { tally } from "../tally/store.ts";
import { PlayerUuid } from "../wire.ts";

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
  playerId: PlayerUuid,
  place: Schema.String,
  source: Schema.Literals(["room", "call"]),
  enteredAt: Schema.Int,
  heardAt: Schema.Int,
  /** When the player last did something, as Leaf had heard by then; null for not yet. */
  actedAt: Schema.NullOr(Schema.Int),
  /** The Leaf that heard of it last. */
  instance: Schema.String,
});
type OpenVisit = typeof OpenVisit.Type;

/**
 * Whether an open visit is in one of the games (the Works, the raid table: a page of its own) and
 * was said by that page's calls: while it is open, a live room the player is in on another page
 * (another tab, another device) does not move them, so that they are in one place, the game's. The
 * town's own page says where they are itself as they come out of a game, which moves them at once,
 * and a game's page left silent closes after 90 seconds as any visit does.
 */
const inGame = (v: { place: string; source: Source }): boolean =>
  v.source === "call" && (GAME_AT[v.place] ?? "town") !== "town";

/**
 * Whether word that a player is at `place` now, from `source`, leaves their open visit (`v`) where
 * it is: word older than what Leaf has heard of them since moves nobody, and nor does a live room
 * another page of theirs is in while they play a game (`inGame`).
 */
const staysPut = (v: OpenVisit, place: string, source: Source, now: number): boolean =>
  v.place !== place && (v.heardAt > now || (source === "room" && inGame(v)));

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

/** Each player's newest visit of the last day, with who they are and whether they stay. */
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

/** How long a player has played a game, and been in it AFK, in milliseconds. */
export interface Time {
  readonly played: number;
  readonly afk: number;
}

/**
 * Every stay of a player in one of the game's places (`visits`), the sittings they make up
 * (`sessions`: visits less than five minutes apart) and one row a player (`players_seen`), for the
 * staff's view of who played (`GET /v1/game/admin/activity`); and each player's time in each game,
 * for good (`time_in`), for their card.
 *
 * Every stretch of a visit, from when it was last heard of to when it is heard of again or closes,
 * is time played in its place's game (`GAME_AT`), or time AFK when the player had done nothing
 * Leaf heard of for `afkMs` before it began (`playing`). What they do is told as it happens
 * (`acted`: a command, a move, an act), kept in memory, and written on their open visit each time
 * it is heard of, so that a Leaf taking over in a deploy goes on from it.
 *
 * A visit opens when a player comes into a live room of a place, or when their page says it is
 * there (`PUT /v1/game/presence`), and is heard of again while they stay: by the room every half
 * minute, and by each of the page's calls. It closes when they leave the room (or their grace runs
 * out), when they go somewhere else, or, not heard of for 90 seconds, at the last time it was. A
 * player has one open visit at most: coming somewhere closes the one anywhere else. Word of a
 * player older than the last Leaf heard of them (a room's, written late) moves them nowhere.
 *
 * Each player's newest visit is also where everybody else sees them (`about`): here, or gone and
 * last seen when, with whether their character stays in town after they go, as their page last
 * said (`players_seen.stay`; yes until it says). Every change to it (somebody comes, goes, is
 * somewhere else, says otherwise about staying, or is back from being away) is told on `changes`
 * once it is written; a burst may be heard as one. Sessions and
 * players are kept up to date as visits open and close, in the same transaction, and a player's
 * name and whether a guest each time Leaf hears of them. A visit belongs to the Leaf process
 * (`LeafInstance`) that last heard of it, so that a player who moves to the new container in a
 * deploy takes their open visit with them. Whenever a visit is opened, visits and sessions that
 * ended 180 days ago are removed. A database failure is a defect.
 */
export class Visits extends Context.Service<
  Visits,
  {
    /** A player's page said they are at `place` now, and whether they would stay (null: as they last said). */
    readonly called: (who: Visitor, place: string, stay: boolean | null, now: number) => Effect.Effect<void>;
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
    /**
     * A player did something at `now`: a command that is not a chore, or in a live room a move or an
     * act. Back from being away until then, as far as this Leaf knows (`away`), it is told on `changes`.
     */
    readonly acted: (playerId: PlayerId, now: number) => Effect.Effect<void>;
    /** Who is about at `now`, from each player's newest visit (`hereFrom`), read in one statement. */
    readonly about: (now: number) => Effect.Effect<Here>;
    /** Hears of every change to who is about, once it is written; a burst of them may be heard as one. */
    readonly changes: Effect.Effect<PubSub.Subscription<void>, never, Scope.Scope>;
    /** When each of these players last did something, as far as Leaf knows: this Leaf's word, or their open visit's. */
    readonly lastActed: (playerIds: readonly string[]) => Effect.Effect<ReadonlyMap<string, number>>;
    /** How long a player has played each game, and been in it AFK, by game. */
    readonly timeOf: (playerId: PlayerId) => Effect.Effect<ReadonlyMap<string, Time>>;
  }
>()("leaf/Visits") {
  static readonly layer = Layer.effect(
    Visits,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const instance = yield* LeafInstance;
      const rules = VISIT_RULES;
      // Only that something changed is told, so one waiting is as good as many.
      const news = yield* PubSub.sliding<void>(1);
      const tell = (changed: boolean): Effect.Effect<void> =>
        changed ? Effect.asVoid(PubSub.publish(news, undefined)) : Effect.void;
      const latest = SqlSchema.findAll({
        Request: Schema.Int,
        Result: Latest,
        execute: (since) => sql`
          SELECT v.player_id AS playerId, p.name AS username, v.place, v.guest, v.heard_at AS heardAt,
                 v.left_at AS leftAt, p.stay
          FROM visits AS v JOIN players_seen AS p ON p.player_id = v.player_id
          WHERE v.id IN (SELECT max(id) FROM visits WHERE heard_at >= ${since} GROUP BY player_id)
        `,
      });
      const openOf = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: OpenVisit,
        execute: (playerId) => sql`
          SELECT id, session_id AS sessionId, player_id AS playerId, place, source, entered_at AS enteredAt,
                 heard_at AS heardAt, acted_at AS actedAt, instance
          FROM visits WHERE player_id = ${playerId} AND left_at IS NULL
        `,
      });
      const allOpen = SqlSchema.findAll({
        Request: Schema.Void,
        Result: OpenVisit,
        execute: () => sql`
          SELECT id, session_id AS sessionId, player_id AS playerId, place, source, entered_at AS enteredAt,
                 heard_at AS heardAt, acted_at AS actedAt, instance
          FROM visits WHERE left_at IS NULL ORDER BY id
        `,
      });
      const ownOpen = SqlSchema.findAll({
        Request: Schema.Void,
        Result: OpenVisit,
        execute: () => sql`
          SELECT id, session_id AS sessionId, player_id AS playerId, place, source, entered_at AS enteredAt,
                 heard_at AS heardAt, acted_at AS actedAt, instance
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

      const openActed = SqlSchema.findAll({
        Request: Schema.Array(Schema.String),
        Result: Schema.Struct({ playerId: Schema.String, actedAt: Schema.NullOr(Schema.Int) }),
        execute: (ids) => sql`
          SELECT player_id AS playerId, acted_at AS actedAt FROM visits
          WHERE left_at IS NULL AND ${sql.in("player_id", ids)}
        `,
      });

      const timeOf = SqlSchema.findAll({
        Request: Schema.String,
        Result: Schema.Struct({ game: Schema.String, played: Schema.Int, afk: Schema.Int }),
        execute: (playerId) =>
          sql`SELECT game, played_ms AS played, afk_ms AS afk FROM time_in WHERE player_id = ${playerId} ORDER BY game`,
      });

      /** When each player last did something, as this Leaf has heard. */
      const acted = new Map<string, number>();
      /** When a visit's player last did something, as far as Leaf knows. */
      const actedOf = (visit: OpenVisit): number | null => {
        const heard = acted.get(visit.playerId);
        return heard === undefined ? visit.actedAt : Math.max(heard, visit.actedAt ?? heard);
      };

      /** Counts a visit's time from when it was last heard of to `to`: played, or AFK. */
      const count = (visit: OpenVisit, to: number) =>
        Effect.gen(function* () {
          const ms = to - visit.heardAt;
          if (ms <= 0) return;
          const game = GAME_AT[visit.place] ?? visit.place;
          const played = playing(visit.heardAt, actedOf(visit), rules) ? ms : 0;
          yield* sql`
            INSERT INTO time_in (player_id, game, played_ms, afk_ms)
            VALUES (${visit.playerId}, ${game}, ${played}, ${ms - played})
            ON CONFLICT (player_id, game) DO UPDATE SET
              played_ms = played_ms + excluded.played_ms, afk_ms = afk_ms + excluded.afk_ms
          `;
          // The Tally's times, for the week as well as for all time.
          const stats = TIMED[game];
          if (stats) {
            yield* tally(sql, visit.playerId, stats.played, played, to);
            if (stats.afk) yield* tally(sql, visit.playerId, stats.afk, ms - played, to);
          }
        });

      /** Closes a visit at `at` (never before it began), and adds its time to its session and its player. */
      const close = (visit: OpenVisit, at: number) =>
        Effect.gen(function* () {
          const leftAt = Math.max(visit.enteredAt, at);
          yield* count(visit, leftAt);
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
       * Opens a visit for a player who has none open, who last did something at `actedAt`, in their
       * last session if it ended less than five minutes ago, or else in a new one, and removes what
       * has been kept long enough.
       */
      const open = (who: Visitor, place: string, source: Source, at: number, actedAt: number | null) =>
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
            INSERT INTO visits (session_id, player_id, guest, place, source, entered_at, heard_at, acted_at, instance)
            VALUES (${sessionId}, ${who.playerId}, ${guest}, ${place}, ${source}, ${at}, ${at}, ${actedAt}, ${instance})
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
       * the one they have elsewhere closes and one opens here, unless Leaf heard of them there
       * later than `now`, or a room says so while they play a game (`staysPut`). Says whether who is
       * about changed.
       */
      const arrive = (who: Visitor, place: string, source: Source, now: number) =>
        Effect.gen(function* () {
          const current = yield* openOf(who.playerId);
          if (Option.isSome(current) && staysPut(current.value, place, source, now)) return false;
          if (Option.isSome(current) && current.value.place === place) {
            const kept = source === "room" ? "room" : current.value.source;
            const guest = who.guest ? 1 : 0;
            yield* count(current.value, now);
            yield* sql`
              UPDATE visits SET heard_at = max(heard_at, ${now}), acted_at = ${actedOf(current.value)},
                source = ${kept}, guest = ${guest}, instance = ${instance}
              WHERE id = ${current.value.id}
            `;
            yield* sql`
              UPDATE players_seen SET name = ${who.username}, guest = ${guest}
              WHERE player_id = ${who.playerId} AND (name <> ${who.username} OR guest <> ${guest})
            `;
            return false;
          }
          // What they last did goes with them: a Leaf that took over in a deploy knows it from their visit alone.
          const actedAt = Option.isSome(current) ? actedOf(current.value) : (acted.get(who.playerId) ?? null);
          if (Option.isSome(current)) yield* close(current.value, now);
          yield* open(who, place, source, now, actedAt);
          return true;
        });

      /** Closes every visit gone silent, at the last time it was heard of; says whether there was any. */
      const closeSilent = (now: number) =>
        Effect.flatMap(allOpen(undefined), (visits) => {
          const silent = visits.filter((v) => silentSince(v.heardAt, now, rules));
          return Effect.as(
            Effect.forEach(silent, (v) => close(v, v.heardAt), { discard: true }),
            silent.length > 0,
          );
        });

      /**
       * Runs a change in one transaction, after closing whatever has gone silent, and tells of it
       * once it is written if either changed who is about.
       */
      const write = <E>(change: Effect.Effect<boolean, E>, now: number) =>
        sql
          .withTransaction(
            Effect.all([closeSilent(now), change]).pipe(Effect.map(([silent, changed]) => silent || changed)),
          )
          .pipe(Effect.orDie, Effect.flatMap(tell));

      return Visits.of({
        called: (who, place, stay, now) =>
          write(
            Effect.gen(function* () {
              const moved = yield* arrive(who, place, "call", now);
              if (stay === null) return moved;
              const said = yield* sql`
                UPDATE players_seen SET stay = ${stay ? 1 : 0} WHERE player_id = ${who.playerId} AND stay <> ${stay ? 1 : 0}
                RETURNING player_id
              `;
              return moved || said.length > 0;
            }),
            now,
          ),
        inRoom: (who, place, now) =>
          who.length === 0
            ? Effect.void
            : write(
                Effect.map(
                  Effect.forEach(who, (w) => arrive(w, place, "room", now)),
                  (moved) => moved.some(Boolean),
                ),
                now,
              ),
        leftRoom: (playerId, place, now) =>
          write(
            Effect.flatMap(openOf(playerId), (current) =>
              // Only this Leaf's to close: a player who has moved to another Leaf (a deploy) is still
              // there; and not on word older than what Leaf has heard of them since.
              Option.isSome(current) &&
              current.value.place === place &&
              current.value.source === "room" &&
              current.value.instance === instance &&
              current.value.heardAt <= now
                ? Effect.as(close(current.value, now), true)
                : Effect.succeed(false),
            ),
            now,
          ),
        closeAll: (now) =>
          write(
            Effect.flatMap(ownOpen(undefined), (visits) =>
              Effect.as(
                Effect.forEach(visits, (v) => close(v, now), { discard: true }),
                visits.length > 0,
              ),
            ),
            now,
          ),
        closeSilent: (now) => sql.withTransaction(closeSilent(now)).pipe(Effect.orDie, Effect.flatMap(tell)),
        acted: (playerId, now) =>
          Effect.suspend(() => {
            const before = acted.get(playerId);
            acted.set(playerId, Math.max(now, before ?? now));
            // Back from being away: told to every page, so that nobody shows them away a moment longer.
            return tell(away(before ?? null, now, rules));
          }),
        about: (now) =>
          latest(now - DAY_MS).pipe(
            Effect.map((visits) => hereFrom(visits, now)),
            Effect.orDie,
          ),
        changes: PubSub.subscribe(news),
        lastActed: (playerIds) =>
          playerIds.length === 0
            ? Effect.succeed(new Map())
            : openActed(playerIds).pipe(
                Effect.map((rows) => {
                  const out = new Map<string, number>();
                  for (const id of playerIds) {
                    const heard = acted.get(id);
                    if (heard !== undefined) out.set(id, heard);
                  }
                  for (const row of rows) {
                    if (row.actedAt !== null) out.set(row.playerId, Math.max(row.actedAt, out.get(row.playerId) ?? 0));
                  }
                  return out;
                }),
                Effect.orDie,
              ),
        timeOf: (playerId) =>
          timeOf(playerId).pipe(
            Effect.map((rows) => new Map(rows.map(({ game, ...time }) => [game, time]))),
            Effect.orDie,
          ),
      });
    }),
  );
}
