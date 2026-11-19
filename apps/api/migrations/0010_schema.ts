import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// Leaf's schema as of migration 10, which every database already running had
// reached when the earlier migrations were folded into this one. A database
// that has migration 10 skips it; a new one starts here. Add changes as
// `0011_name.ts` and up, one `sql` call per statement.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // `ledger_entries` is the source of truth and is append-only. `accounts` holds
  // each player's running totals and is maintained only by the trigger below, so
  // the totals cannot drift from the entries. Code inserts entries and reads
  // accounts; it never writes to `accounts`.
  yield* sql`
    CREATE TABLE accounts (
      player_id       TEXT    PRIMARY KEY,
      balance         INTEGER NOT NULL,
      xp              INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL
    ) STRICT
  `;
  yield* sql`
    CREATE TABLE ledger_entries (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id       TEXT    NOT NULL,
      kind            TEXT    NOT NULL,
      balance_delta   INTEGER NOT NULL,
      xp_delta        INTEGER NOT NULL,
      origin          TEXT    NOT NULL,
      idempotency_key TEXT    NOT NULL UNIQUE,
      reverses_id     INTEGER UNIQUE REFERENCES ledger_entries (id),
      actor           TEXT,
      memo            TEXT,
      created_at      INTEGER NOT NULL,
      CHECK (
        (kind = 'earn' AND balance_delta > 0 AND xp_delta >= 0 AND reverses_id IS NULL)
        OR (kind = 'spend' AND balance_delta < 0 AND xp_delta = 0 AND reverses_id IS NULL)
        OR (kind = 'reversal' AND balance_delta <> 0 AND reverses_id IS NOT NULL)
      )
    ) STRICT
  `;
  yield* sql`CREATE INDEX ledger_entries_by_player ON ledger_entries (player_id, id)`;
  yield* sql`
    CREATE TRIGGER ledger_entries_append_only_update
    BEFORE UPDATE ON ledger_entries
    BEGIN
      SELECT RAISE(ABORT, 'ledger_append_only');
    END
  `;
  yield* sql`
    CREATE TRIGGER ledger_entries_append_only_delete
    BEFORE DELETE ON ledger_entries
    BEGIN
      SELECT RAISE(ABORT, 'ledger_append_only');
    END
  `;
  // A reversal must undo exactly one entry of the same player, origin and amounts.
  yield* sql`
    CREATE TRIGGER ledger_entries_reversal_matches
    BEFORE INSERT ON ledger_entries
    WHEN NEW.kind = 'reversal'
    BEGIN
      SELECT RAISE(ABORT, 'reversal_mismatch')
      WHERE NOT EXISTS (
        SELECT 1
        FROM ledger_entries AS original
        WHERE original.id = NEW.reverses_id
          AND original.player_id = NEW.player_id
          AND original.kind <> 'reversal'
          AND original.origin = NEW.origin
          AND original.balance_delta = -NEW.balance_delta
          AND original.xp_delta = -NEW.xp_delta
      );
    END
  `;
  // Applies each entry to its account in the same statement, and refuses a spend the balance cannot cover.
  yield* sql`
    CREATE TRIGGER ledger_entries_apply
    AFTER INSERT ON ledger_entries
    BEGIN
      INSERT OR IGNORE INTO accounts (player_id, balance, xp, updated_at)
      VALUES (NEW.player_id, 0, 0, NEW.created_at);

      SELECT RAISE(ABORT, 'insufficient_leaf')
      WHERE NEW.kind = 'spend'
        AND (SELECT balance FROM accounts WHERE player_id = NEW.player_id) + NEW.balance_delta < 0;

      UPDATE accounts
      SET balance = balance + NEW.balance_delta,
          xp = xp + NEW.xp_delta,
          updated_at = NEW.created_at
      WHERE player_id = NEW.player_id;
    END
  `;

  // Every raid and war the feeds reported, once each by `source_key`.
  yield* sql`
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
      recorded_at   INTEGER NOT NULL,
      -- For a war, whether the territory was in Sequoia's claim; NULL when not known.
      in_claim      INTEGER CHECK (in_claim IN (0, 1))
    ) STRICT
  `;
  yield* sql`CREATE INDEX activities_by_player_time ON activities (player_id, occurred_at)`;
  yield* sql`CREATE INDEX activities_by_time ON activities (occurred_at, source_key)`;

  // One row per feed sync: its lease, its cursor, and when a player last asked for a sync.
  yield* sql`
    CREATE TABLE sync_state (
      name         TEXT    PRIMARY KEY,
      -- When this job first ran. Nothing that happened before it is ever credited.
      started_at   INTEGER,
      -- Everything that happened before this moment has been processed.
      cursor       INTEGER,
      locked_until INTEGER NOT NULL,
      on_demand_at INTEGER NOT NULL DEFAULT 0
    ) STRICT
  `;
  yield* sql`INSERT INTO sync_state (name, locked_until) VALUES ('credits', 0), ('achievements', 0)`;

  yield* sql`
    CREATE TABLE quest_players (
      player_id         TEXT    PRIMARY KEY,
      -- Dailies available to the player, counting the one in progress.
      daily_charges     INTEGER NOT NULL,
      -- The UTC day, as days since the Unix epoch, of the last charge granted.
      daily_charged_day INTEGER NOT NULL
    ) STRICT
  `;
  // Each quest holds its first goal in the objective columns and a second, when it has one, in the alternative ones.
  yield* sql`
    CREATE TABLE quests (
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
    CREATE TABLE quest_rerolls (
      player_id   TEXT    NOT NULL,
      slot        TEXT    NOT NULL,
      -- The quest swapped out. The one that took its place is the next in the slot.
      sequence    INTEGER NOT NULL,
      leaf        INTEGER NOT NULL CHECK (leaf >= 0),
      rerolled_at INTEGER NOT NULL,
      PRIMARY KEY (player_id, slot, sequence)
    ) STRICT, WITHOUT ROWID
  `;
  yield* sql`CREATE INDEX quest_rerolls_by_day ON quest_rerolls (player_id, rerolled_at)`;

  // What happened to each player, for clients to show. Streams find new events by reading this table.
  yield* sql`
    CREATE TABLE events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id  TEXT    NOT NULL,
      type       TEXT    NOT NULL,
      -- The event's details as JSON, in the shape the API sends.
      data       TEXT    NOT NULL,
      created_at INTEGER NOT NULL
    ) STRICT
  `;
  yield* sql`CREATE INDEX events_by_player ON events (player_id, id)`;
});
