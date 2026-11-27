import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// How each fight's run set out, beside the `way` it was first kept by (the raid's `FightRecord`):
// its `course` (`trail`, `wilds`, `deep`), `pool` (`fair` for everyone's figures, `own` for the
// member's) and the `era` its fight was set up in. Each is empty (null, no default) in a row kept
// before, and in one an older Leaf writes while a deploy is under way; whoever reads a row reads an
// empty one as its `way` says it and its era as the one live at its `at` (the raid's `readFight`).
// So no row is rewritten: adding columns that may be empty changes the schema and nothing else.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE raid_fights ADD COLUMN course TEXT`;
  yield* sql`ALTER TABLE raid_fights ADD COLUMN pool TEXT CHECK (pool IN ('fair', 'own'))`;
  yield* sql`ALTER TABLE raid_fights ADD COLUMN era INTEGER`;
});
