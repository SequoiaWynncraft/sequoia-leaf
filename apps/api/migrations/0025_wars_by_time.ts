import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// The last war fought, for the town's banner (`guildDay`), found from the newest end without
// reading every activity.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE INDEX activities_wars ON activities (occurred_at DESC, detail DESC) WHERE kind = 'war'`;
});
