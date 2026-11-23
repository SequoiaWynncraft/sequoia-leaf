import {
  ACT_EVERY_MS,
  EARN_SOURCES,
  type Period,
  type PlayerId,
  RAID_KEYS,
  type RaidKey,
  rankTally,
  STAY_MS,
  talliedActs,
  TALLY_KEPT_MS,
  TALLY_SHOWN,
  type TallyBoard,
  tallyBoard,
  type TallyStat,
  utcWeekStart,
} from "@sequoia-leaf/core";
import { Cache, Clock, Context, Duration, Effect, Layer, Schema } from "effect";
import { SqlClient, type SqlError, type Statement } from "effect/sql";

import { Allowances } from "../allowance.ts";
import { PlayerNames } from "../game/names.ts";
import { PlayerUuid } from "../wire.ts";

/**
 * Adds `n` to a player's counter, for all time and for the UTC week of `now` (`utcWeekStart`, as the
 * weekly quests count it), as of `now`. Written in the transaction of whatever it counts.
 */
export const tally = (sql: SqlClient.SqlClient, playerId: PlayerId, stat: TallyStat, n: number, now: number) =>
  n <= 0
    ? Effect.void
    : sql`
        INSERT INTO tallies (player_id, stat, n, week, week_n, at)
        VALUES (${playerId}, ${stat}, ${n}, ${utcWeekStart(now)}, ${n}, ${now})
        ON CONFLICT (player_id, stat) DO UPDATE SET
          n = n + excluded.n,
          week_n = CASE WHEN week = excluded.week THEN week_n + excluded.week_n ELSE excluded.week_n END,
          week = excluded.week, at = excluded.at
      `.pipe(Effect.asVoid);

/**
 * The rows Leaf reads for a board (`playerId`, `value`, `at`: when they reached it), for the week
 * beginning at `week`, or for all time when it is null.
 */
type Source = (
  sql: SqlClient.SqlClient,
  week: number | null,
) => Effect.Effect<ReadonlyArray<unknown>, SqlError.SqlError>;

/** `column` from `week` on, or nothing for all time. */
const since = (sql: SqlClient.SqlClient, column: string, week: number | null): Statement.Fragment[] =>
  week === null ? [] : [sql`${sql(column)} >= ${week}`];

/** What the credit feed recorded (`activities`): raids, one raid, wars or defences counted, or season rating added up. */
const activities =
  (of: {
    readonly kind?: "raid" | "war";
    readonly raid?: RaidKey;
    readonly claim?: true;
    readonly rating?: true;
  }): Source =>
  (sql, week) => sql`
    SELECT player_id AS playerId, ${of.rating ? sql`sum(season_rating)` : sql`count(*)`} AS value, max(occurred_at) AS at
    FROM activities
    WHERE ${sql.and([
      ...(of.kind === undefined ? [] : [sql`kind = ${of.kind}`]),
      ...(of.raid === undefined ? [] : [sql`raid = ${of.raid}`]),
      ...(of.claim ? [sql`in_claim = 1`] : []),
      ...since(sql, "occurred_at", week),
    ])}
    GROUP BY player_id
  `;

/** Where each player's state stands in a game (`standings`): its score, or its tier. */
const standing =
  (game: "works" | "raid", tier = false): Source =>
  (sql) => sql`
    SELECT player_id AS playerId, ${tier ? sql`coalesce(json_extract(also, '$.tier'), 0)` : sql`score`} AS value,
           updated_at AS at
    FROM standings WHERE game = ${game}
  `;

/** One of Leaf's own counters, for all time or for the week. */
const counter =
  (stat: TallyStat): Source =>
  (sql, week) =>
    week === null
      ? sql`SELECT player_id AS playerId, n AS value, at FROM tallies WHERE stat = ${stat} AND n > 0`
      : sql`
          SELECT player_id AS playerId, week_n AS value, at FROM tallies
          WHERE stat = ${stat} AND week = ${week} AND week_n > 0
        `;

/** The camps stayed in, counted by whoever stayed (`visitor_id`) or whoever's camp it was (`owner_id`). */
const stays =
  (by: "visitor_id" | "owner_id"): Source =>
  (sql, week) => sql`
    SELECT ${sql(by)} AS playerId, count(*) AS value, ${week === null ? sql`max(first_at)` : sql`max(last_at)`} AS at
    FROM camp_visits WHERE ${sql.and(since(sql, "last_at", week))} GROUP BY 1
  `;

/** The Leaf a player has earned: everything but the staff's grants, with reversals taking back. */
const EARNED = EARN_SOURCES.filter((source) => source !== "staff");

/** Each board's numbers, by its id in core (`TALLY_BOARDS`). */
export const SOURCES: Readonly<Record<string, Source>> = {
  raids: activities({ kind: "raid" }),
  ...Object.fromEntries(RAID_KEYS.map((raid) => [`raid-${raid}`, activities({ kind: "raid", raid })])),
  wars: activities({ kind: "war" }),
  defences: activities({ kind: "war", claim: true }),
  rating: activities({ rating: true }),
  quests: (sql, week) => sql`
    SELECT player_id AS playerId, count(*) AS value, max(completed_at) AS at FROM quests
    WHERE ${sql.and([sql`completed_at IS NOT NULL`, ...since(sql, "completed_at", week)])} GROUP BY player_id
  `,
  leaf: (sql, week) => sql`
    SELECT player_id AS playerId, sum(balance_delta) AS value, max(created_at) AS at FROM ledger_entries
    WHERE ${sql.and([sql.in("origin", EARNED), ...since(sql, "created_at", week)])} GROUP BY player_id
  `,
  level: (sql) => sql`SELECT player_id AS playerId, xp AS value, updated_at AS at FROM accounts`,
  milestones: (sql, week) => sql`
    SELECT player_id AS playerId, sum(CASE kind WHEN 'reversal' THEN -1 ELSE 1 END) AS value, max(created_at) AS at
    FROM ledger_entries WHERE ${sql.and([sql`origin = 'achievement'`, ...since(sql, "created_at", week)])}
    GROUP BY player_id
  `,
  yards: standing("works"),
  tier: standing("works", true),
  orders: counter("works_orders"),
  "works-time": counter("played:works"),
  "runs-won": counter("raid_wins"),
  rooms: counter("raid_rooms"),
  bosses: standing("raid"),
  "raid-time": counter("played:raid"),
  "town-time": counter("played:town"),
  dozing: counter("afk:town"),
  crab: counter("crab"),
  greeted: counter("greeted"),
  waves: counter("waves"),
  taps: counter("taps"),
  logs: counter("logs"),
  rolls: counter("rolls"),
  camps: stays("visitor_id"),
  visitors: stays("owner_id"),
};

const Row = Schema.Struct({ playerId: PlayerUuid, value: Schema.Number, at: Schema.Number });
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Row));
const Guest = Schema.Struct({ playerId: Schema.String, guest: Schema.BooleanFromBit });
const decodeGuests = Schema.decodeUnknownEffect(Schema.Array(Guest));

/** A place on a board and the score it is for. */
export interface Place {
  readonly place: number;
  readonly score: number;
}

/** Somebody on a board, as the Tally shows them: named as the guild's news names them, "Someone" for one Leaf cannot name. */
export interface Listed extends Place {
  readonly playerId: PlayerId;
  readonly name: string;
  readonly guest: boolean;
}

/** A board as the caller is shown it: the week it is of (null for all time), its top `TALLY_SHOWN`, and the caller's own place. */
export interface Shown {
  readonly from: number | null;
  readonly top: readonly Listed[];
  readonly you: Place | null;
}

/** A board worked out: its top, and everybody's place on it. */
interface Worked {
  readonly top: readonly Listed[];
  readonly places: ReadonlyMap<string, Place>;
}

/** How long a visitor's page may go without reading the camp they are in before their stay there is over. */
const STAY_GAP_MS = 3 * STAY_MS;
/** How many players' allowances for acts, and stays in camps, are held before those long over are let go. */
const HELD = 1000;

/**
 * The Tally: the counters Leaf keeps of what players do (`tallies`, written with `tally` by whatever
 * each counts) and the camps they stay in (`camp_visits`), and the boards worked out from those and
 * from what Leaf records otherwise (`SOURCES`). A board is worked out by one query the first time it
 * is asked for, and kept `TALLY_KEPT_MS`. An act in a live room counts at most once each
 * `ACT_EVERY_MS` for a player and a counter. A camp counts as stayed in once the visitor's page has
 * read it again `STAY_MS` after first reading it, with no other camp read between and no gap longer
 * than `STAY_GAP_MS`. A database failure is a defect.
 */
export class Tallies extends Context.Service<
  Tallies,
  {
    /** Somebody did something in a live room (one of `ACTS` in core). */
    readonly acted: (playerId: PlayerId, kind: string, arg: string, now: number) => Effect.Effect<void>;
    /** `visitor`'s page read `owner`'s camp. */
    readonly visited: (visitor: PlayerId, owner: PlayerId, now: number) => Effect.Effect<void>;
    /** A board for a span, as `caller` is shown it. */
    readonly board: (board: TallyBoard, period: Period, caller: PlayerId) => Effect.Effect<Shown>;
  }
>()("leaf/Tallies") {
  static readonly layer = Layer.effect(
    Tallies,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const names = yield* PlayerNames;
      const acts = new Map(
        Object.entries(ACT_EVERY_MS).map(([stat, ms]) => [stat, new Allowances([{ rate: 1000 / ms, burst: 1 }], HELD)]),
      );
      /** Each visitor's stay: whose camp, when their page first and last read it, and whether it has counted. */
      const camps = new Map<string, { owner: string; since: number; last: number; counted: boolean }>();

      /** Works out a board, by its key: `<board>|<period>|<week>`. */
      const work = (key: string) =>
        Effect.gen(function* () {
          const [id = "", period = "", week = ""] = key.split("|");
          const board = tallyBoard(id);
          const source = SOURCES[id];
          if (board === undefined || source === undefined) return { top: [], places: new Map() } satisfies Worked;
          const rows = yield* source(sql, period === "week" ? Number(week) : null).pipe(Effect.flatMap(decodeRows));
          const ranked = rankTally(board.unit, rows);
          const top = ranked.slice(0, TALLY_SHOWN);
          const ids = top.map((r) => r.playerId);
          const named = yield* names.of(ids);
          const guests =
            ids.length === 0
              ? []
              : yield* sql`SELECT player_id AS playerId, guest FROM players_seen WHERE ${sql.in("player_id", ids)}`.pipe(
                  Effect.flatMap(decodeGuests),
                );
          const guest = new Set(guests.filter((g) => g.guest).map((g) => g.playerId));
          return {
            top: top.map(({ playerId, place, score }) => ({
              playerId,
              place,
              score,
              name: named.get(playerId) ?? "Someone",
              guest: guest.has(playerId),
            })),
            places: new Map(ranked.map((r) => [r.playerId, { place: r.place, score: r.score }])),
          } satisfies Worked;
        }).pipe(Effect.orDie);
      const worked = yield* Cache.makeWith(work, { capacity: 256, timeToLive: () => Duration.millis(TALLY_KEPT_MS) });

      return Tallies.of({
        acted: (playerId, kind, arg, now) =>
          Effect.forEach(
            talliedActs(kind, arg).filter((stat) => acts.get(stat)?.take(playerId, now, [1]) === true),
            (stat) => tally(sql, playerId, stat, 1, now),
            { discard: true },
          ).pipe(Effect.orDie),
        visited: (visitor, owner, now) =>
          Effect.suspend(() => {
            if (visitor === owner) return Effect.void;
            const stay = camps.get(visitor);
            if (stay === undefined || stay.owner !== owner || now - stay.last > STAY_GAP_MS) {
              if (camps.size > HELD) for (const [id, s] of camps) if (now - s.last > STAY_GAP_MS) camps.delete(id);
              camps.set(visitor, { owner, since: now, last: now, counted: false });
              return Effect.void;
            }
            stay.last = now;
            if (stay.counted || now - stay.since < STAY_MS) return Effect.void;
            stay.counted = true;
            return sql`
              INSERT INTO camp_visits (visitor_id, owner_id, first_at, last_at) VALUES (${visitor}, ${owner}, ${now}, ${now})
              ON CONFLICT (visitor_id, owner_id) DO UPDATE SET last_at = excluded.last_at
            `.pipe(Effect.asVoid, Effect.orDie);
          }),
        board: (board, period, caller) =>
          Effect.gen(function* () {
            const week = utcWeekStart(yield* Clock.currentTimeMillis);
            const { top, places } = yield* Cache.get(worked, `${board.id}|${period}|${week}`);
            return { from: period === "week" ? week : null, top, you: places.get(caller) ?? null };
          }),
      });
    }),
  );
}
