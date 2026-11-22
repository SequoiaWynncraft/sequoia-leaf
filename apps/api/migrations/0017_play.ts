import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// The play service: Leaf owns each game's state, and a player's page sends commands. Coins become a
// ledger like Leaf's, and each player's commands are counted by the day, done and refused.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Each player's state in each game, as the game's own text. `rev` goes up by one with every batch
  // of commands that changed anything; 0 is a state nothing has been done to yet.
  yield* sql`
    CREATE TABLE play_state (
      player_id  TEXT    NOT NULL,
      game       TEXT    NOT NULL,
      rev        INTEGER NOT NULL CHECK (rev >= 0),
      state      TEXT    NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (player_id, game)
    ) STRICT
  `;

  // What each command answered, so that a command sent twice is done once and answered the same:
  // the player's newest 256 to each game. `command_id` is made by the page; `rev` is the one the
  // command's batch led to; `result` is its notes or its refusal as JSON, never the state.
  yield* sql`
    CREATE TABLE play_commands (
      id         INTEGER PRIMARY KEY,
      player_id  TEXT    NOT NULL,
      game       TEXT    NOT NULL,
      command_id TEXT    NOT NULL,
      rev        INTEGER NOT NULL,
      result     TEXT    NOT NULL,
      UNIQUE (player_id, game, command_id)
    ) STRICT
  `;
  yield* sql`CREATE INDEX play_commands_by_player ON play_commands (player_id, game, id)`;

  // Coins: a balance per player, changed only by an entry. Each entry has a key naming the fact it
  // records, so that it cannot be made twice.
  yield* sql`
    CREATE TABLE coins (
      player_id TEXT    PRIMARY KEY,
      balance   INTEGER NOT NULL CHECK (balance >= 0)
    ) STRICT
  `;
  yield* sql`
    CREATE TABLE coin_entries (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id TEXT    NOT NULL,
      amount    INTEGER NOT NULL,
      reason    TEXT    NOT NULL,
      -- The game whose command made it; NULL for the welcome and for Coins brought over.
      game      TEXT,
      key       TEXT    NOT NULL UNIQUE,
      at        INTEGER NOT NULL
    ) STRICT
  `;
  yield* sql`CREATE INDEX coin_entries_by_player ON coin_entries (player_id, id)`;
  // For the Coins a player earned in the last day or hour, reading only those entries.
  yield* sql`CREATE INDEX coin_entries_by_player_at ON coin_entries (player_id, at)`;
  // Entries are never changed or removed; each is applied to its balance as it is written.
  yield* sql`
    CREATE TRIGGER coin_entries_append_only_update
    BEFORE UPDATE ON coin_entries
    BEGIN
      SELECT RAISE(ABORT, 'coins_append_only');
    END
  `;
  yield* sql`
    CREATE TRIGGER coin_entries_append_only_delete
    BEFORE DELETE ON coin_entries
    BEGIN
      SELECT RAISE(ABORT, 'coins_append_only');
    END
  `;
  yield* sql`
    CREATE TRIGGER coin_entries_apply
    AFTER INSERT ON coin_entries
    BEGIN
      INSERT OR IGNORE INTO coins (player_id, balance) VALUES (NEW.player_id, 0);
      UPDATE coins SET balance = balance + NEW.amount WHERE player_id = NEW.player_id;
    END
  `;

  // What each player has spent building in the Works through its page, and been given back for
  // taking things away, kept with every such entry: a refund never takes the second past the first.
  // It goes with the pages' calls, when the Works moves to the play service.
  yield* sql`
    CREATE TABLE works_builds (
      player_id TEXT    PRIMARY KEY,
      built     INTEGER NOT NULL DEFAULT 0 CHECK (built >= 0),
      refunded  INTEGER NOT NULL DEFAULT 0 CHECK (refunded >= 0),
      CHECK (refunded <= built)
    ) STRICT, WITHOUT ROWID
  `;
  yield* sql`
    CREATE TRIGGER coin_entries_works_builds
    AFTER INSERT ON coin_entries
    WHEN NEW.reason IN ('works_build', 'works_refund')
    BEGIN
      INSERT OR IGNORE INTO works_builds (player_id) VALUES (NEW.player_id);
      UPDATE works_builds
      SET built = built + CASE NEW.reason WHEN 'works_build' THEN -NEW.amount ELSE 0 END,
          refunded = refunded + CASE NEW.reason WHEN 'works_refund' THEN NEW.amount ELSE 0 END
      WHERE player_id = NEW.player_id;
    END
  `;

  // What each player's commands came to on each UTC day (`day` is its first moment): how many were
  // done and how many refused, for the staff's report. Commands sent again and answered from before
  // count once. What a game's commands log is written to `activity` (migration 16).
  yield* sql`
    CREATE TABLE command_days (
      player_id TEXT    NOT NULL,
      day       INTEGER NOT NULL,
      done      INTEGER NOT NULL DEFAULT 0 CHECK (done >= 0),
      refused   INTEGER NOT NULL DEFAULT 0 CHECK (refused >= 0),
      PRIMARY KEY (player_id, day)
    ) STRICT, WITHOUT ROWID
  `;
});
