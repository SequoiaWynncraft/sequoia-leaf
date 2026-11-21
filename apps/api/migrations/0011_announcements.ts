import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// Messages Leaf posted to Discord and keeps up to date, one per name, such as
// the rate card: the message to edit, and a digest of what it last said, so an
// unchanged message is not edited again.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE announcements (
      name       TEXT    PRIMARY KEY,
      message_id TEXT    NOT NULL,
      digest     TEXT    NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT
  `;
});
