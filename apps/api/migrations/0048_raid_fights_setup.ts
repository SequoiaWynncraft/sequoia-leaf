import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// What each fight was decided from (the raid's `FightRecord.setup`), as JSON: its seed, its era, both
// parties whole and what bound its room, so it plays again exactly as it was decided (the raid's
// `replayOf`). It is empty (null, no default) in a row kept before, and in one an older Leaf writes
// while a deploy is under way; such a fight cannot be played again, and says so. No row is rewritten.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE raid_fights ADD COLUMN setup TEXT CHECK (json_valid(setup))`;
});
