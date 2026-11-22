import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// What each player has won for good in a game (`Game.awards`, such as `trophy-oldbramble`), and
// when Leaf first saw it, so that another game can show it. A row is never taken away.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE awards (
      player_id TEXT,
      id        TEXT,
      at        INTEGER NOT NULL,
      PRIMARY KEY (player_id, id)
    ) STRICT, WITHOUT ROWID
  `;
});
