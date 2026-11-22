import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// The play service: Leaf owns each game's state, and a player's page sends commands. Coins become a
// ledger like Leaf's, and what players did in the games is kept as activity.
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

  // What each command answered, kept two days, so that a command sent twice is done once and
  // answered the same. `command_id` is made by the page; `result` is the answer as JSON.
  yield* sql`
    CREATE TABLE play_commands (
      player_id  TEXT    NOT NULL,
      game       TEXT    NOT NULL,
      command_id TEXT    NOT NULL,
      rev        INTEGER NOT NULL,
      result     TEXT    NOT NULL,
      at         INTEGER NOT NULL,
      PRIMARY KEY (player_id, game, command_id)
    ) STRICT
  `;
  yield* sql`CREATE INDEX play_commands_by_time ON play_commands (at)`;

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

  // Things worth remembering that players did in the games: a run begun or ended, a room won or lost.
  yield* sql`
    CREATE TABLE activity (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id TEXT    NOT NULL,
      at        INTEGER NOT NULL,
      game      TEXT    NOT NULL,
      kind      TEXT    NOT NULL,
      -- What happened, as a JSON object.
      data      TEXT    NOT NULL
    ) STRICT
  `;
  yield* sql`CREATE INDEX activity_by_player ON activity (player_id, at)`;
});
