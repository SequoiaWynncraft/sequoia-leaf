import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// The Tally's counters (`tallies`): one row a player and counter (`TALLY_STATS` in core), its count
// for all time (`n`) and for the week (`week_n`, of the week beginning at `week`, Monday 00:00 UTC,
// in milliseconds), and when it was last counted (`at`), so that a tie goes to whoever reached it
// first. Each is written in the same transaction as what it counts. And the camps each player has
// stayed in (`camp_visits`), one row a visitor and camp: when they first stayed and last did.
//
// The counters start from what Leaf already has: the rooms fought, runs won and orders handed over
// in `activity`, the crab's sightings and callers greeted where each camp stands, and the time in
// each game as a person's card counts it (`time_in`), all for all time; and of those in `activity`,
// the week's too.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE tallies (
      player_id TEXT,
      stat      TEXT,
      n         INTEGER NOT NULL CHECK (n >= 0),
      week      INTEGER NOT NULL,
      week_n    INTEGER NOT NULL CHECK (week_n >= 0),
      at        INTEGER NOT NULL,
      PRIMARY KEY (player_id, stat)
    ) STRICT, WITHOUT ROWID
  `;
  yield* sql`CREATE INDEX tallies_all ON tallies (stat, n DESC)`;
  yield* sql`CREATE INDEX tallies_week ON tallies (stat, week, week_n DESC)`;
  yield* sql`
    CREATE TABLE camp_visits (
      visitor_id TEXT,
      owner_id   TEXT,
      first_at   INTEGER NOT NULL,
      last_at    INTEGER NOT NULL,
      PRIMARY KEY (visitor_id, owner_id)
    ) STRICT, WITHOUT ROWID
  `;
  yield* sql`CREATE INDEX camp_visits_by_owner ON camp_visits (owner_id)`;
  // This week's Monday, 00:00 UTC: 1970-01-05 was a Monday.
  yield* sql`
    WITH this AS (SELECT 345600000 + (unixepoch() * 1000 - 345600000) / 604800000 * 604800000 AS week),
    counted AS (
      SELECT player_id, CASE kind
          WHEN 'raid_room' THEN 'raid_rooms'
          WHEN 'raid_ended' THEN 'raid_wins'
          WHEN 'works_order' THEN 'works_orders'
        END AS stat, at
      FROM activity
      WHERE kind IN ('raid_room', 'works_order') OR (kind = 'raid_ended' AND json_extract(data, '$.ended') = 'won')
    )
    INSERT INTO tallies (player_id, stat, n, week, week_n, at)
    SELECT player_id, stat, count(*), this.week, sum(at >= this.week), max(at) FROM counted, this GROUP BY 1, 2
  `;
  yield* sql`
    WITH this AS (SELECT 345600000 + (unixepoch() * 1000 - 345600000) / 604800000 * 604800000 AS week),
    stood AS (
      SELECT player_id, 'crab' AS stat, json_extract(also, '$.sightings') AS n, updated_at FROM standings WHERE game = 'town'
      UNION ALL
      SELECT player_id, 'greeted', json_extract(also, '$.greeted'), updated_at FROM standings WHERE game = 'town'
    )
    INSERT INTO tallies (player_id, stat, n, week, week_n, at)
    SELECT player_id, stat, n, this.week, 0, updated_at FROM stood, this WHERE n > 0
  `;
  yield* sql`
    WITH this AS (SELECT 345600000 + (unixepoch() * 1000 - 345600000) / 604800000 * 604800000 AS week),
    timed AS (
      SELECT player_id, 'played:' || game AS stat, played_ms AS n FROM time_in WHERE game IN ('town', 'works', 'raid')
      UNION ALL
      SELECT player_id, 'afk:town', afk_ms FROM time_in WHERE game = 'town'
    )
    INSERT INTO tallies (player_id, stat, n, week, week_n, at)
    SELECT player_id, stat, n, this.week, 0, this.week FROM timed, this WHERE n > 0
  `;
});
