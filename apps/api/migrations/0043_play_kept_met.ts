import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// The pieces players leave for others to meet (`Done.keep`, migration 26) are read by game and slot
// (`Ctx.met`), so they are indexed so. The pulls' `have`, kept by an earlier attempt that nothing
// ever read, is let go.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE INDEX play_kept_slot ON play_kept (game, slot)`;
  yield* sql`DELETE FROM play_kept WHERE game = 'pulls'`;
});
