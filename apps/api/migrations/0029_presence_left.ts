import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// When a player left the live room of the place their presence names (`left_at`), so that Leaf lists
// them as gone from that moment rather than 90 seconds later; null while they are there, or when
// their page, not a room, last said where they are.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE presence ADD COLUMN left_at INTEGER`;
});
