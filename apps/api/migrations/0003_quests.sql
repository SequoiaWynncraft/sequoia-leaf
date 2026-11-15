-- Quests: dailies that bank up, a weekly, and a repeatable.
--
-- Only the credit sync writes these tables, in the same batch as the
-- activities that move a quest forward. What a player sees between
-- activities is computed from these rows without writing anything.

CREATE TABLE quest_players (
  player_id         TEXT    PRIMARY KEY,
  -- Dailies available to the player, counting the one in progress.
  daily_charges     INTEGER NOT NULL,
  -- The UTC day, as days since the Unix epoch, of the last charge granted.
  daily_charged_day INTEGER NOT NULL
) STRICT;

-- Every quest ever handed out. The objective and reward are copied from the
-- template when the quest is handed out, so changing a template later does
-- not change a quest someone already holds, and the history stays readable.
CREATE TABLE quests (
  player_id      TEXT    NOT NULL,
  slot           TEXT    NOT NULL CHECK (slot IN ('daily', 'weekly', 'repeatable')),
  -- Counts the player's quests in this slot, starting at 1.
  sequence       INTEGER NOT NULL,
  template_id    TEXT    NOT NULL,
  objective_type TEXT    NOT NULL CHECK (objective_type IN ('raids', 'wars')),
  -- For a raid objective, the one raid that counts, or NULL when any raid does.
  objective_raid TEXT,
  target         INTEGER NOT NULL CHECK (target > 0),
  reward_leaf    INTEGER NOT NULL CHECK (reward_leaf > 0),
  reward_xp      INTEGER NOT NULL CHECK (reward_xp >= 0),
  progress       INTEGER NOT NULL,
  started_at     INTEGER NOT NULL,
  expires_at     INTEGER,
  completed_at   INTEGER,
  PRIMARY KEY (player_id, slot, sequence)
) STRICT, WITHOUT ROWID;

-- When a player last asked for a sync outside the schedule. Such requests are
-- allowed one sync between them every few seconds, whatever the sync's outcome.
ALTER TABLE sync_state ADD COLUMN on_demand_at INTEGER NOT NULL DEFAULT 0;
