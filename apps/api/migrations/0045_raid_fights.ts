import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// Every fight the raid decided (`raid_fight`, the raid's `FightRecord`), kept a year for the staff's
// analysis, never shown or sent anywhere. Who fought it and when, the raid's `rules` version, and
// the record as the raid makes it: its run at the table, the `way` it set out (`main`, `own`), trail
// and room (from 0), the room's kind, who was `across` (`plan:<n>`, `regular:<figure>`,
// `member:<Leaf id>`), the result, the `margin` (health left on the party's side less the other's,
// as shares), the fight's seconds, resolve after it, level and acorns, and as JSON the `party` as it
// fought and the party `against` it (null for the forest's). It is read by time: what a player wrote
// in a day, and what is a year old.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE raid_fights (
      id        INTEGER PRIMARY KEY,
      player_id TEXT    NOT NULL,
      at        INTEGER NOT NULL,
      rules     TEXT    NOT NULL,
      run       INTEGER NOT NULL,
      way       TEXT    NOT NULL,
      trail     INTEGER NOT NULL,
      room      INTEGER NOT NULL,
      kind      TEXT    NOT NULL CHECK (kind IN ('trouble', 'spar', 'boss')),
      across    TEXT    NOT NULL,
      result    TEXT    NOT NULL CHECK (result IN ('win', 'loss', 'draw')),
      margin    REAL    NOT NULL,
      seconds   REAL    NOT NULL,
      resolve   INTEGER NOT NULL,
      level     INTEGER NOT NULL,
      acorns    INTEGER NOT NULL,
      party     TEXT    NOT NULL CHECK (json_valid(party)),
      against   TEXT    CHECK (json_valid(against))
    ) STRICT
  `;
  yield* sql`CREATE INDEX raid_fights_by_time ON raid_fights (at, player_id)`;
});
