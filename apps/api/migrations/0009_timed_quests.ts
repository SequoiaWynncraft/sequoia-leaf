import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Timed quests take the third slot: the same quest for the whole guild, open for
  // a short window every few hours. Repeatable quests stop being handed out, and
  // the ones still open are dropped: they expire as of when they started, so no
  // activity counts toward them, not even one reported late, and they no longer
  // show. Finished ones stay as they are.

  // SQLite cannot change a CHECK constraint, so the table is rebuilt with 'timed'
  // among the slots, as in 0005 and 0008. Nothing else refers to it.
  yield* sql`
    CREATE TABLE quests_rebuilt (
      player_id            TEXT    NOT NULL,
      slot                 TEXT    NOT NULL CHECK (slot IN ('daily', 'weekly', 'timed', 'repeatable')),
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
       reward_leaf, reward_xp, progress, started_at, expires_at, completed_at,
       alternative_type, alternative_raid, alternative_target, alternative_progress)
    SELECT
       player_id, slot, sequence, template_id, objective_type, objective_raid, target,
       reward_leaf, reward_xp, progress, started_at, expires_at, completed_at,
       alternative_type, alternative_raid, alternative_target, alternative_progress
    FROM quests
  `;

  yield* sql`
    DROP TABLE quests
  `;

  yield* sql`
    ALTER TABLE quests_rebuilt RENAME TO quests
  `;

  yield* sql`
    UPDATE quests
    SET expires_at = started_at
    WHERE slot = 'repeatable' AND completed_at IS NULL AND expires_at IS NULL
  `;
});
