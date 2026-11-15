-- What players did, as reported by sequoia-backend.
--
-- An activity is one player's part in one raid or war. It is recorded once,
-- in the same batch as the Leaf it pays, and it is what quests count.

CREATE TABLE activities (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key    TEXT    NOT NULL UNIQUE,
  player_id     TEXT    NOT NULL,
  kind          TEXT    NOT NULL CHECK (kind IN ('raid', 'war')),
  -- The raid's short name for a raid (NULL for a raid not known yet), NULL for a war.
  raid          TEXT,
  -- The raid's full name, or the territory fought over.
  detail        TEXT    NOT NULL,
  season_rating INTEGER NOT NULL,
  war_points    REAL,
  occurred_at   INTEGER NOT NULL,
  recorded_at   INTEGER NOT NULL
) STRICT;

CREATE INDEX activities_by_player_time ON activities (player_id, occurred_at);

-- One row per background job. `locked_until` is a lease: a run takes it by
-- moving it into the future, so two runs never process the same job at once,
-- and a run that dies releases it by letting it pass.
CREATE TABLE sync_state (
  name         TEXT    PRIMARY KEY,
  -- When this job first ran. Nothing that happened before it is ever credited.
  started_at   INTEGER,
  -- Everything that happened before this moment has been processed.
  cursor       INTEGER,
  locked_until INTEGER NOT NULL
) STRICT;

INSERT INTO sync_state (name, started_at, cursor, locked_until) VALUES ('credits', NULL, NULL, 0);
