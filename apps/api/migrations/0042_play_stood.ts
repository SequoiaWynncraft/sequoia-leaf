import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// Which `rev` of each state where it stands (`standings`) was worked out from (`stood`). Leaf
// writes it with the state, and works a standing out again from its state (`restand.ts`) for each
// state whose `stood` is not its `rev`, the longest unwritten first (indexed in that order). A Leaf
// from before this, beside this one in a deploy, writes states and their standings without it, so
// whatever it writes is worked out again by this one. Each state stood at its `rev` as stored, but the Little Raid's: its standing summed
// the bosses beaten on each trail, and counts each boss once now. A state never written (`rev` 0)
// stands nowhere, as Leaf makes it.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE play_state ADD COLUMN stood INTEGER`;
  yield* sql`UPDATE play_state SET stood = rev WHERE game <> 'raid' OR rev = 0`;
  yield* sql`CREATE INDEX play_state_unstood ON play_state (updated_at) WHERE stood IS NOT rev`;
});
