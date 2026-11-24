import {
  away,
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
import { Array as Arr, Context, Effect, Layer, Option, PubSub, Ref, Schema, type Scope } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { LeafInstance } from "../instance.ts";
import { tally } from "../tally/store.ts";
import { PlayerUuid } from "../wire.ts";
import { type Here, readHere } from "./here.ts";

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
 * Whether word that a player is at `place` now, from `source`, leaves their open visit (`v`) as it
 * is: word older than what Leaf has heard of them since changes nothing, in that place or another
 * (in a deploy, a room's word the Leaf stopping wrote late would give it the visit back); and a
 * live room another page of theirs is in while they play a game (`inGame`) does not move them.
 */
const staysPut = (v: OpenVisit, place: string, source: Source, now: number): boolean =>
  v.heardAt > now || (v.place !== place && source === "room" && inGame(v));

/**
 * The most visits one transaction writes or closes: a live room's word that everybody in it is
 * still there, the visits gone silent, or Leaf's farewell are written this many at a time, so that
 * no write of anybody else's waits for more. A visit's records come out the same whichever
 * transaction writes them: each player's are written in one.
 */
const AT_ONCE = 100;

/** Each minute, at most this many visits, and as many sessions, that ended 180 days ago are removed. */
const REMOVED_AT_ONCE = 1000;

/**
 * How long who is about, as read for one who asks (`lists`), is given to everybody else who asks:
 * a second. It is read again sooner once this Leaf has written a change to who is about (somebody
 * comes, goes, moves, says otherwise about staying, goes silent, or is back from being away), so
 * those are in every list given after they are written. What changes without a change being told
 * (when somebody here was last heard of, or last did something), and a change another Leaf writes
 * beside this one in a deploy, are at most a second old in it. Pages are told of every change, and
 * ask every 30 seconds at most.
 */
export const ABOUT_FRESH_MS = 1000;

/** Who is about as everybody is given it: Leaf's lists, when each of those here last did something, and when they were read. */
export interface Lists {
  readonly at: number;
  readonly here: Here;
  readonly acted: ReadonlyMap<string, number>;
}

/** How long a player has played a game, and been in it AFK, in milliseconds. */
export interface Time {
  readonly played: number;
  readonly afk: number;
}

const OPEN_COLUMNS = `id, session_id AS sessionId, player_id AS playerId, place, source, entered_at AS enteredAt,
  heard_at AS heardAt, acted_at AS actedAt, instance`;

/** What Visits reads, and the session it begins. */
const statements = (sql: SqlClient.SqlClient, instance: string) => ({
  openOf: SqlSchema.findOneOption({
    Request: Schema.String,
    Result: OpenVisit,
    execute: (playerId) =>
      sql`SELECT ${sql.literal(OPEN_COLUMNS)} FROM visits WHERE player_id = ${playerId} AND left_at IS NULL`,
  }),
  /**
   * Up to `most` open visits last heard of at `heard` or before, the longest silent first. Named
   * to read the index of open visits by when they were heard of, which reads only those: left to
   * itself, SQLite reads every open visit by `visits_by_end` instead.
   */
  silentOpen: SqlSchema.findAll({
    Request: Schema.Struct({ heard: Schema.Int, most: Schema.Int }),
    Result: OpenVisit,
    execute: ({ heard, most }) => sql`
      SELECT ${sql.literal(OPEN_COLUMNS)} FROM visits INDEXED BY visits_open_by_heard
      WHERE left_at IS NULL AND heard_at <= ${heard}
      ORDER BY heard_at, id LIMIT ${most}
    `,
  }),
  /** Up to `most` open visits this Leaf was the last to hear of. */
  ownOpen: SqlSchema.findAll({
    Request: Schema.Int,
    Result: OpenVisit,
    execute: (most) => sql`
      SELECT ${sql.literal(OPEN_COLUMNS)} FROM visits WHERE left_at IS NULL AND instance = ${instance}
      ORDER BY id LIMIT ${most}
    `,
  }),
  lastSession: SqlSchema.findOneOption({
    Request: Schema.String,
    Result: Schema.Struct({ id: Schema.Int, endedAt: Schema.NullOr(Schema.Int) }),
    execute: (playerId) => sql`
      SELECT id, ended_at AS endedAt FROM sessions WHERE player_id = ${playerId}
      ORDER BY started_at DESC, id DESC LIMIT 1
    `,
  }),
  beginSession: SqlSchema.findOne({
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
  }),
  openActed: SqlSchema.findAll({
    Request: Schema.Array(Schema.String),
    Result: Schema.Struct({ playerId: Schema.String, actedAt: Schema.NullOr(Schema.Int) }),
    execute: (ids) => sql`
      SELECT player_id AS playerId, acted_at AS actedAt FROM visits
      WHERE left_at IS NULL AND ${sql.in("player_id", ids)}
    `,
  }),
  timeOf: SqlSchema.findAll({
    Request: Schema.String,
    Result: Schema.Struct({ game: Schema.String, played: Schema.Int, afk: Schema.Int }),
    execute: (playerId) =>
      sql`SELECT game, played_ms AS played, afk_ms AS afk FROM time_in WHERE player_id = ${playerId} ORDER BY game`,
  }),
});

/** What a player's visits are written with: the database and its statements, this Leaf, and what Leaf has heard players did. */
interface Writer {
  readonly sql: SqlClient.SqlClient;
  readonly rows: ReturnType<typeof statements>;
  readonly instance: string;
  /** When a visit's player last did something, as far as Leaf knows: this Leaf's word, or their visit's. */
  readonly actedOf: (visit: OpenVisit) => number | null;
  /** When a player last did something, as this Leaf has heard; null for not. */
  readonly heardActed: (playerId: string) => number | null;
  /** Tells of a change to who is about, once it is written, if there was one. */
  readonly tell: (changed: boolean) => Effect.Effect<void>;
}

/** Counts a visit's time from when it was last heard of to `to`: played, or AFK. */
const count = (w: Writer, visit: OpenVisit, to: number) =>
  Effect.gen(function* () {
    const ms = to - visit.heardAt;
    if (ms <= 0) return;
    const game = GAME_AT[visit.place] ?? visit.place;
    const played = playing(visit.heardAt, w.actedOf(visit), VISIT_RULES) ? ms : 0;
    yield* w.sql`
      INSERT INTO time_in (player_id, game, played_ms, afk_ms)
      VALUES (${visit.playerId}, ${game}, ${played}, ${ms - played})
      ON CONFLICT (player_id, game) DO UPDATE SET
        played_ms = played_ms + excluded.played_ms, afk_ms = afk_ms + excluded.afk_ms
    `;
    // The Tally's times, for the week as well as for all time.
    const stats = TIMED[game];
    if (stats) {
      yield* tally(w.sql, visit.playerId, stats.played, played, to);
      if (stats.afk) yield* tally(w.sql, visit.playerId, stats.afk, ms - played, to);
    }
  });

/** Closes a visit at `at` (never before it began), and adds its time to its session and its player. */
const close = (w: Writer, visit: OpenVisit, at: number) =>
  Effect.gen(function* () {
    const leftAt = Math.max(visit.enteredAt, at);
    yield* count(w, visit, leftAt);
    const seconds = visitSeconds(visit.enteredAt, leftAt);
    const path = `$."${visit.place}"`;
    yield* w.sql`UPDATE visits SET left_at = ${leftAt}, seconds = ${seconds} WHERE id = ${visit.id}`;
    yield* w.sql`
      UPDATE sessions SET ended_at = ${leftAt}, seconds = seconds + ${seconds},
        places = json_set(places, ${path}, coalesce(json_extract(places, ${path}), 0) + ${seconds})
      WHERE id = ${visit.sessionId}
    `;
    yield* w.sql`
      UPDATE players_seen SET seconds_total = seconds_total + ${seconds}, last_seen_at = max(last_seen_at, ${leftAt})
      WHERE player_id = ${visit.playerId}
    `;
  });

/** When a visit closes if it closes at `now`: then, or at the last time it was heard of, if it has gone silent. */
const endOf = (visit: OpenVisit, now: number): number =>
  silentSince(visit.heardAt, now, VISIT_RULES) ? visit.heardAt : now;

/**
 * Opens a visit for a player who has none open, who last did something at `actedAt`, in their
 * last session if it ended less than five minutes ago, or else in a new one.
 */
const open = (w: Writer, who: Visitor, place: string, source: Source, at: number, actedAt: number | null) =>
  Effect.gen(function* () {
    const guest = who.guest ? 1 : 0;
    const last = yield* w.rows.lastSession(who.playerId);
    const joined = Option.isSome(last) && joinsSession(last.value.endedAt, at, VISIT_RULES) ? last : Option.none();
    if (Option.isSome(joined)) {
      yield* w.sql`
        UPDATE sessions SET ended_at = NULL, guest = ${guest}, device = coalesce(device, ${who.device})
        WHERE id = ${joined.value.id}
      `;
    }
    const sessionId = Option.isSome(joined)
      ? joined.value.id
      : (yield* w.rows.beginSession({ playerId: who.playerId, guest: who.guest, at, device: who.device })).id;
    yield* w.sql`
      INSERT INTO visits (session_id, player_id, guest, place, source, entered_at, heard_at, acted_at, instance)
      VALUES (${sessionId}, ${who.playerId}, ${guest}, ${place}, ${source}, ${at}, ${at}, ${actedAt}, ${w.instance})
    `;
    yield* w.sql`
      INSERT INTO players_seen (player_id, name, guest, first_seen_at, last_seen_at, sessions)
      VALUES (${who.playerId}, ${who.username}, ${guest}, ${at}, ${at}, ${Option.isSome(joined) ? 0 : 1})
      ON CONFLICT (player_id) DO UPDATE SET
        name = excluded.name, guest = excluded.guest,
        first_seen_at = min(first_seen_at, excluded.first_seen_at),
        last_seen_at = max(last_seen_at, excluded.last_seen_at),
        sessions = sessions + excluded.sessions
    `;
  });

/**
 * A player's open visit at `now`, if they have one, and whether one was closed to find it: one
 * gone silent closes first, at the last time it was heard of, and leaves them none. So nobody is
 * heard of again in a visit gone silent, nor has its silence counted, however soon the visits gone
 * silent are closed for everybody else.
 */
const openAt = (w: Writer, playerId: string, now: number) =>
  Effect.flatMap(w.rows.openOf(playerId), (current) =>
    Option.isSome(current) && silentSince(current.value.heardAt, now, VISIT_RULES)
      ? Effect.as(close(w, current.value, current.value.heardAt), { visit: Option.none<OpenVisit>(), closed: true })
      : Effect.succeed({ visit: current, closed: false }),
  );

/**
 * A player is at `place` now: their open visit there is heard of again, by this Leaf (and is
 * the room's, if this is the room), with their name and whether a guest as they are now; or
 * the one they have elsewhere closes and one opens here; unless Leaf heard of them later than
 * `now`, or a room says so while they play a game (`staysPut`). Says whether who is about changed.
 */
const arrive = (w: Writer, who: Visitor, place: string, source: Source, now: number) =>
  Effect.gen(function* () {
    const current = (yield* openAt(w, who.playerId, now)).visit;
    if (Option.isSome(current) && staysPut(current.value, place, source, now)) return false;
    if (Option.isSome(current) && current.value.place === place) {
      const kept = source === "room" ? "room" : current.value.source;
      const guest = who.guest ? 1 : 0;
      yield* count(w, current.value, now);
      yield* w.sql`
        UPDATE visits SET heard_at = ${now}, acted_at = ${w.actedOf(current.value)},
          source = ${kept}, guest = ${guest}, instance = ${w.instance}
        WHERE id = ${current.value.id}
      `;
      yield* w.sql`
        UPDATE players_seen SET name = ${who.username}, guest = ${guest}
        WHERE player_id = ${who.playerId} AND (name <> ${who.username} OR guest <> ${guest})
      `;
      return false;
    }
    // What they last did goes with them: a Leaf that took over in a deploy knows it from their visit alone.
    const actedAt = Option.isSome(current) ? w.actedOf(current.value) : w.heardActed(who.playerId);
    if (Option.isSome(current)) yield* close(w, current.value, now);
    yield* open(w, who, place, source, now, actedAt);
    return true;
  });

/** Removes up to `REMOVED_AT_ONCE` visits, and as many sessions, that ended 180 days before `now`, the oldest first. */
const removeOld = (sql: SqlClient.SqlClient, now: number) =>
  sql
    .withTransaction(
      Effect.gen(function* () {
        const before = now - VISIT_RULES.keptMs;
        yield* sql`
          DELETE FROM visits WHERE id IN (
            SELECT id FROM visits WHERE left_at < ${before} ORDER BY left_at LIMIT ${REMOVED_AT_ONCE}
          )
        `;
        // A session whose visits are not all removed yet waits, so that none goes with its visits.
        yield* sql`
          DELETE FROM sessions WHERE id IN (
            SELECT id FROM sessions AS s WHERE ended_at < ${before}
              AND NOT EXISTS (SELECT 1 FROM visits WHERE session_id = s.id)
            ORDER BY ended_at LIMIT ${REMOVED_AT_ONCE}
          )
        `;
      }),
    )
    .pipe(Effect.orDie);

/** When each of these players last did something, as far as Leaf knows: what this Leaf heard (`acted`), or their open visit's. */
const lastActed = (w: Writer, acted: ReadonlyMap<string, number>, playerIds: readonly string[]) =>
  playerIds.length === 0
    ? Effect.succeed(new Map<string, number>())
    : w.rows.openActed(playerIds).pipe(
        Effect.map((found) => {
          const out = new Map<string, number>();
          for (const id of playerIds) {
            const heard = acted.get(id);
            if (heard !== undefined) out.set(id, heard);
          }
          for (const row of found) {
            if (row.actedAt !== null) out.set(row.playerId, Math.max(row.actedAt, out.get(row.playerId) ?? 0));
          }
          return out;
        }),
        Effect.orDie,
      );

/** Closes up to `AT_ONCE` visits gone silent by `now`, the longest silent first, each at the last time it was heard of; says how many. */
const closeSomeSilent = (w: Writer, now: number) =>
  Effect.flatMap(w.rows.silentOpen({ heard: now - VISIT_RULES.silentMs, most: AT_ONCE }), (visits) =>
    Effect.as(
      Effect.forEach(visits, (v) => close(w, v, v.heardAt), { discard: true }),
      visits.length,
    ),
  );

/**
 * Runs a change in one transaction, after closing up to `AT_ONCE` visits gone silent, and tells
 * of it once it is written if either changed who is about.
 */
const write = <E>(w: Writer, change: Effect.Effect<boolean, E>, now: number) =>
  w.sql
    .withTransaction(
      Effect.all([closeSomeSilent(w, now), change]).pipe(Effect.map(([silent, changed]) => silent > 0 || changed)),
    )
    .pipe(Effect.orDie, Effect.flatMap(w.tell));

/** Closes `AT_ONCE` visits a transaction, those `which` gives each time, at `at` of each, until it gives fewer. */
const closeInParts = <E>(w: Writer, which: Effect.Effect<readonly OpenVisit[], E>, at: (v: OpenVisit) => number) =>
  w.sql
    .withTransaction(
      Effect.flatMap(which, (visits) =>
        Effect.as(
          Effect.forEach(visits, (v) => close(w, v, at(v)), { discard: true }),
          visits.length,
        ),
      ),
    )
    .pipe(
      Effect.orDie,
      Effect.tap((closed) => w.tell(closed > 0)),
      Effect.repeat({ while: (closed) => closed === AT_ONCE }),
      Effect.asVoid,
    );

/** A player's page said they are at `place` now, and whether they would stay (null: as they last said); says whether who is about changed. */
const pageSaid = (w: Writer, who: Visitor, place: string, stay: boolean | null, now: number) =>
  Effect.gen(function* () {
    const moved = yield* arrive(w, who, place, "call", now);
    if (stay === null) return moved;
    const said = yield* w.sql`
      UPDATE players_seen SET stay = ${stay ? 1 : 0} WHERE player_id = ${who.playerId} AND stay <> ${stay ? 1 : 0}
      RETURNING player_id
    `;
    return moved || said.length > 0;
  });

/**
 * A player has left a live room of `place`: their visit there closes, if it is this Leaf's to close
 * (a player who has moved to another Leaf, in a deploy, is still there) and not on word older than
 * what Leaf has heard of them since. Says whether who is about changed.
 */
const leaveRoom = (w: Writer, playerId: string, place: string, now: number) =>
  Effect.flatMap(openAt(w, playerId, now), ({ visit, closed }) =>
    Option.isSome(visit) &&
    visit.value.place === place &&
    visit.value.source === "room" &&
    visit.value.instance === w.instance &&
    visit.value.heardAt <= now
      ? Effect.as(close(w, visit.value, now), true)
      : Effect.succeed(closed),
  );

/** Lists as read, and how many changes had been told before they were. */
type Read = Lists & { readonly told: number };

/** Whether lists read as `last` may be given again at `now`, `changes` changes having been told: none since, and less than `ABOUT_FRESH_MS` after. */
const stillFresh = (last: Read, now: number, changes: number) =>
  last.told === changes && now >= last.at && now < last.at + ABOUT_FRESH_MS;

/**
 * Who is about at `now` as everybody is given it (`Visits.lists`): read with `about` and
 * `lastActed`, and given again to whoever asks in the next `ABOUT_FRESH_MS`, unless a change has
 * been told since (`told`, counted before reading, so that one told meanwhile leaves them old).
 */
const sharedLists = (
  w: Writer,
  about: (now: number) => Effect.Effect<Here>,
  acted: ReadonlyMap<string, number>,
  told: Ref.Ref<number>,
) =>
  Effect.map(
    Ref.make(Option.none<Read>()),
    (read) => (now: number) =>
      Effect.gen(function* () {
        const changes = yield* Ref.get(told);
        const last = yield* Ref.get(read);
        if (Option.isSome(last) && stillFresh(last.value, now, changes)) return last.value;
        const here = yield* about(now);
        const players = here.present.map((p) => p.playerId);
        const lists = { at: now, here, acted: yield* lastActed(w, acted, players) };
        yield* Ref.set(read, Option.some({ ...lists, told: changes }));
        return lists;
      }),
  );

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
 * Each player's newest visit is also where everybody else sees them (`about`, from `last_visits`,
 * which the database keeps): here, or gone and last seen when, with whether their character stays
 * in town after they go, as their page last said (`players_seen.stay`; yes until it says). Every
 * change to it (somebody comes, goes, is somewhere else, says otherwise about staying, or is back
 * from being away) is told on `changes` once it is written; a burst may be heard as one. Sessions
 * and players are kept up to date as visits open and close, in the same transaction, and a
 * player's name and whether a guest each time Leaf hears of them. A visit belongs to the Leaf
 * process (`LeafInstance`) that last heard of it, so that a player who moves to the new container
 * in a deploy takes their open visit with them. Each write closes up to `AT_ONCE` visits gone
 * silent first, and the minute's upkeep the rest (`closeSilent`) and removes what has been kept
 * 180 days (`removeOld`). A database failure is a defect.
 */
export class Visits extends Context.Service<
  Visits,
  {
    /** A player's page said they are at `place` now, and whether they would stay (null: as they last said). */
    readonly called: (who: Visitor, place: string, stay: boolean | null, now: number) => Effect.Effect<void>;
    /** Players are in a live room of `place` now: just come in, or still there. Written `AT_ONCE` players a transaction. */
    readonly inRoom: (who: readonly Visitor[], place: string, now: number) => Effect.Effect<void>;
    /** A player has left a live room of `place`. Nothing changes if Leaf has heard since that they are somewhere else. */
    readonly leftRoom: (playerId: PlayerId, place: string, now: number) => Effect.Effect<void>;
    /**
     * Leaf is stopping: every open visit this Leaf was the last to hear of closes now (those gone
     * silent, at the last time they were heard of). One another Leaf has heard of since stays open.
     */
    readonly closeAll: (now: number) => Effect.Effect<void>;
    /** Closes every open visit not heard of for 90 seconds, at the last time it was, `AT_ONCE` a transaction. */
    readonly closeSilent: (now: number) => Effect.Effect<void>;
    /** Removes up to `REMOVED_AT_ONCE` visits, and as many sessions, that ended 180 days before `now`; players stay. */
    readonly removeOld: (now: number) => Effect.Effect<void>;
    /**
     * A player did something at `now`: a command that is not a chore, or in a live room a move or an
     * act. Back from being away until then, as far as this Leaf knows (`away`), it is told on `changes`.
     */
    readonly acted: (playerId: PlayerId, now: number) => Effect.Effect<void>;
    /** Who is about at `now`, from each player's newest visit (`hereFrom`), read in one statement. */
    readonly about: (now: number) => Effect.Effect<Here>;
    /**
     * Who is about at `now` as everybody is given it: `about`, and `lastActed` of those here, as read
     * for whoever asked first in the last `ABOUT_FRESH_MS`, unless a change has been told since.
     */
    readonly lists: (now: number) => Effect.Effect<Lists>;
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
      // Only that something changed is told, so one waiting is as good as many.
      const news = yield* PubSub.sliding<void>(1);
      /** How many changes have been told. */
      const told = yield* Ref.make(0);
      /** When each player last did something, as this Leaf has heard. */
      const acted = new Map<string, number>();
      const w: Writer = {
        sql,
        rows: statements(sql, instance),
        instance,
        actedOf: (visit) => {
          const heard = acted.get(visit.playerId);
          return heard === undefined ? visit.actedAt : Math.max(heard, visit.actedAt ?? heard);
        },
        heardActed: (playerId) => acted.get(playerId) ?? null,
        tell: (changed) =>
          changed
            ? Effect.andThen(
                Ref.update(told, (n) => n + 1),
                PubSub.publish(news, undefined),
              )
            : Effect.void,
      };
      const about = readHere(sql);
      return Visits.of({
        called: (who, place, stay, now) => write(w, pageSaid(w, who, place, stay, now), now),
        inRoom: (who, place, now) =>
          Effect.forEach(
            Arr.chunksOf(who, AT_ONCE),
            (some) =>
              write(
                w,
                Effect.map(
                  Effect.forEach(some, (v) => arrive(w, v, place, "room", now)),
                  (moved) => moved.some(Boolean),
                ),
                now,
              ),
            { discard: true },
          ),
        leftRoom: (playerId, place, now) => write(w, leaveRoom(w, playerId, place, now), now),
        closeAll: (now) => closeInParts(w, w.rows.ownOpen(AT_ONCE), (v) => endOf(v, now)),
        closeSilent: (now) =>
          closeInParts(w, w.rows.silentOpen({ heard: now - VISIT_RULES.silentMs, most: AT_ONCE }), (v) => v.heardAt),
        removeOld: (now) => removeOld(sql, now),
        acted: (playerId, now) =>
          Effect.suspend(() => {
            const before = acted.get(playerId);
            acted.set(playerId, Math.max(now, before ?? now));
            // Back from being away: told to every page, so that nobody shows them away a moment longer.
            return w.tell(away(before ?? null, now, VISIT_RULES));
          }),
        about,
        lists: yield* sharedLists(w, about, acted, told),
        changes: PubSub.subscribe(news),
        lastActed: (playerIds) => lastActed(w, acted, playerIds),
        timeOf: (playerId) =>
          w.rows.timeOf(playerId).pipe(
            Effect.map((found) => new Map(found.map(({ game, ...time }) => [game, time]))),
            Effect.orDie,
          ),
      });
    }),
  );
}
