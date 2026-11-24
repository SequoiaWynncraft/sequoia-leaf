import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// Where the check for levels reached and not paid for (`payMissedLevels`, at each start) is up to:
// one row, for the level rules it checks against, as JSON. `checked_to` is the ledger entry every
// account has been checked as of. A check under way covers the entries after it up to
// `checking_to`, and has checked every player up to `checked_player`, in id order.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE level_checks (
      id             INTEGER PRIMARY KEY CHECK (id = 1),
      rules          TEXT    NOT NULL,
      checked_to     INTEGER NOT NULL,
      checking_to    INTEGER,
      checked_player TEXT
    ) STRICT
  `;
});
