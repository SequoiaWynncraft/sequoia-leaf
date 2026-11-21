import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// Guests: anyone signed in may play, member of the guild or not. A save and a presence row say
// whether a guest wrote them, so that guests' saves left untouched for 90 days can be removed
// (members' never are), and so that the town can show who is a guest.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE saves ADD COLUMN guest INTEGER NOT NULL DEFAULT 0 CHECK (guest IN (0, 1))`;
  yield* sql`CREATE INDEX saves_guests_by_time ON saves (updated_at) WHERE guest = 1`;
  yield* sql`ALTER TABLE presence ADD COLUMN guest INTEGER NOT NULL DEFAULT 0 CHECK (guest IN (0, 1))`;
});
