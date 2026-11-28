import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// Whether a Leaf session was signed in inside a Discord call (`http/activity.ts`): the session says
// so for as long as it lasts, wherever its requests come from, and Leaf makes no draw for it. Every
// session before this one was signed in on the website.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE sign_ins ADD COLUMN in_call INTEGER NOT NULL DEFAULT 0 CHECK (in_call IN (0, 1))`;
});
