import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// Who is about comes from each player's newest visit since migration 33, and no Leaf writes
// `presence` any more: the last that did is no longer deployed. It goes, with its index.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DROP TABLE presence`;
});
