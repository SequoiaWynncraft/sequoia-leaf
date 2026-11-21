import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// Whether a member's character stays in town, dozing, for a day after they leave: what their game
// last said, on by default.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE presence ADD COLUMN stay INTEGER NOT NULL DEFAULT 1 CHECK (stay IN (0, 1))`;
});
