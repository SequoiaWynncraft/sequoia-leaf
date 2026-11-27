import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// How each fight's run set out, beside the `way` it was first kept by (the raid's `FightRecord`):
// its `course` (`trail`, `wilds`, `deep`), `pool` (`fair` for everyone's figures, `own` for the
// member's) and the `era` its fight was set up in. Every row kept before is filled from its `way`
// (`own`: a trail with the member's own figures; `wilds`, `deep`: that course with everyone's; else a
// trail with everyone's), set up in era 2, the one live before fights kept theirs (`LEGACY_ERA`).
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE raid_fights ADD COLUMN course TEXT NOT NULL DEFAULT 'trail'`;
  yield* sql`ALTER TABLE raid_fights ADD COLUMN pool TEXT NOT NULL DEFAULT 'fair' CHECK (pool IN ('fair', 'own'))`;
  yield* sql`ALTER TABLE raid_fights ADD COLUMN era INTEGER NOT NULL DEFAULT 2`;
  yield* sql`
    UPDATE raid_fights SET
      course = CASE way WHEN 'wilds' THEN 'wilds' WHEN 'deep' THEN 'deep' ELSE 'trail' END,
      pool = CASE way WHEN 'own' THEN 'own' ELSE 'fair' END
  `;
});
