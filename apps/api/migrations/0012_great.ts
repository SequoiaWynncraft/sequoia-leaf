import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// The Great Sequoia's weekly goals: each week's raids, wars and Leaf offered, for
// the guild and for each member who helped. Triggers keep them from the facts as
// they are recorded, as the ledger's trigger keeps `accounts`, so they cannot
// drift and reading a week costs the same however busy it was. Code reads them
// and never writes to them.
//
// A week is Monday to Monday in UTC, numbered from the first Monday before the
// Unix epoch, 1969-12-29, which is 259,200,000 ms before it: a moment's week is
// (ms + 259200000) / 604800000, rounded down. This is `greatWeek` in packages/core.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE great_weeks (
      week    INTEGER PRIMARY KEY,
      -- Each raid party's run and each war once, however many members it credited.
      raids   INTEGER NOT NULL,
      wars    INTEGER NOT NULL,
      -- Leaf offered, less any refunded.
      offered INTEGER NOT NULL
    ) STRICT
  `;
  yield* sql`
    CREATE TABLE great_helpers (
      week      INTEGER NOT NULL,
      player_id TEXT    NOT NULL,
      -- Raids and wars they were credited for, and Leaf they offered, less any refunded.
      raids     INTEGER NOT NULL,
      wars      INTEGER NOT NULL,
      offered   INTEGER NOT NULL,
      -- When they first helped that week.
      first_at  INTEGER NOT NULL,
      PRIMARY KEY (week, player_id)
    ) STRICT, WITHOUT ROWID
  `;
  yield* sql`CREATE INDEX great_helpers_by_player ON great_helpers (player_id, week)`;

  // A raid or war counts for the guild when its first member is recorded.
  yield* sql`
    CREATE TRIGGER great_activities_apply
    AFTER INSERT ON activities
    BEGIN
      INSERT OR IGNORE INTO great_weeks (week, raids, wars, offered)
      VALUES ((NEW.occurred_at + 259200000) / 604800000, 0, 0, 0);
      UPDATE great_weeks
      SET raids = raids + (NEW.kind = 'raid'), wars = wars + (NEW.kind = 'war')
      WHERE week = (NEW.occurred_at + 259200000) / 604800000
        AND NEW.event_key IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM activities AS other WHERE other.event_key = NEW.event_key AND other.id <> NEW.id
        );
      INSERT OR IGNORE INTO great_helpers (week, player_id, raids, wars, offered, first_at)
      VALUES ((NEW.occurred_at + 259200000) / 604800000, NEW.player_id, 0, 0, 0, NEW.occurred_at);
      UPDATE great_helpers
      SET raids = raids + (NEW.kind = 'raid'), wars = wars + (NEW.kind = 'war'),
          first_at = MIN(first_at, NEW.occurred_at)
      WHERE week = (NEW.occurred_at + 259200000) / 604800000 AND player_id = NEW.player_id;
    END
  `;
  // An offering is a spend with sink `offering`, and a refund of one its reversal, which subtracts it again.
  yield* sql`
    CREATE TRIGGER great_offerings_apply
    AFTER INSERT ON ledger_entries
    WHEN NEW.origin = 'offering'
    BEGIN
      INSERT OR IGNORE INTO great_weeks (week, raids, wars, offered)
      VALUES ((NEW.created_at + 259200000) / 604800000, 0, 0, 0);
      UPDATE great_weeks SET offered = offered - NEW.balance_delta
      WHERE week = (NEW.created_at + 259200000) / 604800000;
      INSERT OR IGNORE INTO great_helpers (week, player_id, raids, wars, offered, first_at)
      VALUES ((NEW.created_at + 259200000) / 604800000, NEW.player_id, 0, 0, 0, NEW.created_at);
      UPDATE great_helpers SET offered = offered - NEW.balance_delta, first_at = MIN(first_at, NEW.created_at)
      WHERE week = (NEW.created_at + 259200000) / 604800000 AND player_id = NEW.player_id;
    END
  `;

  // The weeks before this one, from the activities already recorded. Nothing was offered before it.
  yield* sql`
    INSERT INTO great_weeks (week, raids, wars, offered)
    SELECT (occurred_at + 259200000) / 604800000,
           COUNT(DISTINCT CASE WHEN kind = 'raid' THEN event_key END),
           COUNT(DISTINCT CASE WHEN kind = 'war' THEN event_key END),
           0
    FROM activities GROUP BY 1
  `;
  yield* sql`
    INSERT INTO great_helpers (week, player_id, raids, wars, offered, first_at)
    SELECT (occurred_at + 259200000) / 604800000, player_id, SUM(kind = 'raid'), SUM(kind = 'war'), 0, MIN(occurred_at)
    FROM activities GROUP BY 1, 2
  `;
});
