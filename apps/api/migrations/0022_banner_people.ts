import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// Who each pull banner's headliner is (`GET /v1/game/banners`), by their id as Leaf writes ids
// (lowercase, with dashes). Its rows are put in by hand.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE banner_people (
      banner    TEXT PRIMARY KEY,
      player_id TEXT NOT NULL
    ) STRICT, WITHOUT ROWID
  `;
});
