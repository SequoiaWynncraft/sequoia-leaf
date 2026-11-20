import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// What happened in the guild, for anyone to see as it happens: the Forest shows it
// live. Each event is written once, by the fact it reports (`key`), in the same
// transaction as the change, so a raid credited to four members is one lantern
// and a feed read again adds nothing. Streams find events by reading the table.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE guild_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      -- The fact it reports, such as raid:<completion> or level:<player>:<level>.
      key        TEXT    NOT NULL UNIQUE,
      type       TEXT    NOT NULL,
      -- The event's details as JSON, in the shape the API sends.
      data       TEXT    NOT NULL,
      created_at INTEGER NOT NULL
    ) STRICT
  `;
});
