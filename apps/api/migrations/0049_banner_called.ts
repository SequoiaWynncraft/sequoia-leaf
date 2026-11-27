import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// Whom a pull banner calls besides its headliner, in order (`GET /v1/game/banners`, `called`): Groot
// Night's four grooters, seats 1 to 4, each a player by their id as Leaf writes ids. Its rows are put
// in by hand, as `banner_people`'s are.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE banner_called (
      banner    TEXT NOT NULL,
      seat      INTEGER NOT NULL CHECK (seat BETWEEN 1 AND 4),
      player_id TEXT NOT NULL,
      PRIMARY KEY (banner, seat)
    ) STRICT, WITHOUT ROWID
  `;
});
