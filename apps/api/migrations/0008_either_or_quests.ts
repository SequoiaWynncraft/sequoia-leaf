import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // A quest can be finished a second way: "Complete 3 NOL raids or 9 wars". The
  // objective columns hold its first goal; the alternative columns hold the second
  // and its own progress, or are all NULL for a quest with one way.

  // SQLite cannot add a table CHECK to an existing table, so it is rebuilt, as in
  // 0005. Nothing else refers to it.
  yield* sql`
    CREATE TABLE quests_rebuilt (
      player_id            TEXT    NOT NULL,
      slot                 TEXT    NOT NULL CHECK (slot IN ('daily', 'weekly', 'repeatable')),
      -- Counts the player's quests in this slot, starting at 1.
      sequence             INTEGER NOT NULL,
      template_id          TEXT    NOT NULL,
      objective_type       TEXT    NOT NULL CHECK (objective_type IN ('raids', 'wars', 'season_rating')),
      -- For a raid objective, the one raid that counts, or NULL when any raid does.
      objective_raid       TEXT    CHECK (objective_raid IS NULL OR objective_type = 'raids'),
      target               INTEGER NOT NULL CHECK (target > 0),
      reward_leaf          INTEGER NOT NULL CHECK (reward_leaf > 0),
      reward_xp            INTEGER NOT NULL CHECK (reward_xp >= 0),
      -- From 0 to the target. It never goes past the target.
      progress             INTEGER NOT NULL CHECK (progress BETWEEN 0 AND target),
      started_at           INTEGER NOT NULL,
      expires_at           INTEGER,
      completed_at         INTEGER,
      alternative_type     TEXT    CHECK (alternative_type IN ('raids', 'wars', 'season_rating')),
      alternative_raid     TEXT    CHECK (alternative_raid IS NULL OR alternative_type = 'raids'),
      alternative_target   INTEGER CHECK (alternative_target > 0),
      alternative_progress INTEGER CHECK (alternative_progress BETWEEN 0 AND alternative_target),
      CHECK ((alternative_type IS NULL) = (alternative_target IS NULL)
         AND (alternative_type IS NULL) = (alternative_progress IS NULL)),
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

  // Quests still open take the other way too, as the templates that replace
  // theirs do (packages/core/src/rules.ts): three wars for each raid a quest is
  // worth, and the reverse for the two war quests. Their new goal counts from now.
  // Every raid and war quest so far came from these templates; any other would
  // leave alternative_target NULL and fail the CHECK above.
  yield* sql`
    UPDATE quests
    SET alternative_type = 'wars',
        alternative_target = CASE
          WHEN template_id = 'daily.raids.any.2' THEN 6
          WHEN template_id LIKE 'daily.raids.%.3' THEN 9
          WHEN template_id LIKE 'weekly.raids.%' THEN 60
          WHEN template_id = 'repeatable.raids.any.8' THEN 24
        END,
        alternative_progress = 0
    WHERE completed_at IS NULL AND objective_type = 'raids'
  `;

  yield* sql`
    UPDATE quests
    SET alternative_type = 'raids',
        alternative_target = CASE template_id WHEN 'daily.wars.2' THEN 1 WHEN 'weekly.wars.15' THEN 5 END,
        alternative_progress = 0
    WHERE completed_at IS NULL AND objective_type = 'wars'
  `;
});
