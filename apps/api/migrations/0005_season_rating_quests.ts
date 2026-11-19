import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Quests can ask for season rating: "earn 1,000 season rating". The amount is
  // the quest's target, and its progress is the season rating earned so far.

  // SQLite cannot change a CHECK constraint, so the table is rebuilt with the
  // wider one. Nothing else refers to it.
  yield* sql`
    CREATE TABLE quests_rebuilt (
      player_id      TEXT    NOT NULL,
      slot           TEXT    NOT NULL CHECK (slot IN ('daily', 'weekly', 'repeatable')),
      -- Counts the player's quests in this slot, starting at 1.
      sequence       INTEGER NOT NULL,
      template_id    TEXT    NOT NULL,
      objective_type TEXT    NOT NULL CHECK (objective_type IN ('raids', 'wars', 'season_rating')),
      -- For a raid objective, the one raid that counts, or NULL when any raid does.
      objective_raid TEXT    CHECK (objective_raid IS NULL OR objective_type = 'raids'),
      target         INTEGER NOT NULL CHECK (target > 0),
      reward_leaf    INTEGER NOT NULL CHECK (reward_leaf > 0),
      reward_xp      INTEGER NOT NULL CHECK (reward_xp >= 0),
      -- From 0 to the target. It never goes past the target.
      progress       INTEGER NOT NULL CHECK (progress BETWEEN 0 AND target),
      started_at     INTEGER NOT NULL,
      expires_at     INTEGER,
      completed_at   INTEGER,
      PRIMARY KEY (player_id, slot, sequence)
    ) STRICT, WITHOUT ROWID
  `;

  yield* sql`
    INSERT INTO quests_rebuilt
      (player_id, slot, sequence, template_id, objective_type, objective_raid, target,
       reward_leaf, reward_xp, progress, started_at, expires_at, completed_at)
    SELECT
       player_id, slot, sequence, template_id, objective_type, objective_raid, target,
       reward_leaf, reward_xp, progress, started_at, expires_at, completed_at
    FROM quests
  `;

  yield* sql`
    DROP TABLE quests
  `;

  yield* sql`
    ALTER TABLE quests_rebuilt RENAME TO quests
  `;
});
