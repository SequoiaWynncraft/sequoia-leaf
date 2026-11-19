import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Whether a war was fought over a territory in Sequoia's claim, as the backend
  // reports it: the guild taking back its own ground, which pays more Leaf per
  // war point. NULL for raids, for wars recorded before the backend said, and for
  // wars it could not place.
  yield* sql`
    ALTER TABLE activities ADD COLUMN in_claim INTEGER CHECK (in_claim IN (0, 1))
  `;
});
