import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// Each player's time in each game, played and AFK, in milliseconds, for good (`time_in`): counted
// from their visits as Leaf hears them, by game (`GAME_AT`: the town and the camps are the town's,
// the table the raid's). A visit keeps when its player last did something (`acted_at`), so that a
// Leaf taking over in a deploy goes on from it.
//
// It starts from what Leaf had: the time each player's pages called each game, since Leaf began
// counting it (migration 23, `played`; the pulls are played in town), as time played; and the rest
// of their visits since then (of one under way then, the part after) as time AFK. `played` goes.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE time_in (
      player_id TEXT,
      game      TEXT,
      played_ms INTEGER NOT NULL CHECK (played_ms >= 0),
      afk_ms    INTEGER NOT NULL CHECK (afk_ms >= 0),
      PRIMARY KEY (player_id, game)
    ) STRICT, WITHOUT ROWID
  `;
  yield* sql`ALTER TABLE visits ADD COLUMN acted_at INTEGER`;
  yield* sql`
    WITH since AS (
      SELECT coalesce((SELECT unixepoch(created_at) * 1000 FROM effect_sql_migrations WHERE migration_id = 23), 0) AS at
    ),
    visited AS (
      SELECT player_id, CASE place WHEN 'camp' THEN 'town' WHEN 'table' THEN 'raid' ELSE place END AS game,
             sum(coalesce(left_at, heard_at) - max(entered_at, since.at)) AS ms
      FROM visits, since WHERE coalesce(left_at, heard_at) > since.at GROUP BY 1, 2
    ),
    called AS (
      SELECT player_id, CASE game WHEN 'pulls' THEN 'town' ELSE game END AS game, sum(ms) AS ms
      FROM played GROUP BY 1, 2
    ),
    games AS (SELECT player_id, game FROM visited UNION SELECT player_id, game FROM called)
    INSERT INTO time_in (player_id, game, played_ms, afk_ms)
    SELECT g.player_id, g.game, coalesce(c.ms, 0), max(0, coalesce(v.ms, 0) - coalesce(c.ms, 0))
    FROM games g
    LEFT JOIN called c ON c.player_id = g.player_id AND c.game = g.game
    LEFT JOIN visited v ON v.player_id = g.player_id AND v.game = g.game
  `;
  yield* sql`DROP TABLE played`;
});
