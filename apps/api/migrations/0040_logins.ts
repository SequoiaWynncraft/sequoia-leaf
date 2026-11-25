import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// Which player a Minecraft account or a Discord account signs in as, where that is not plain
// (`Logins`). Until now a player was their Minecraft account's UUID, and that stays the rule: an
// account with no row here is its own player. A row says otherwise: a Discord account and the
// player it signs in as, or a Minecraft account linked to some other player. `leaf_ids` holds the
// players whose id is not their own Minecraft account: one who came with Discord alone, who has a
// random id, and one whose account has since gone to another player.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE logins (
      kind        TEXT    NOT NULL CHECK (kind IN ('minecraft', 'discord')),
      external_id TEXT    NOT NULL,
      player_id   TEXT    NOT NULL,
      linked_at   INTEGER NOT NULL,
      PRIMARY KEY (kind, external_id)
    ) STRICT, WITHOUT ROWID
  `;
  yield* sql`CREATE INDEX logins_by_player ON logins (player_id, kind, linked_at)`;
  yield* sql`
    CREATE TABLE leaf_ids (
      player_id TEXT    PRIMARY KEY,
      made_at   INTEGER NOT NULL
    ) STRICT, WITHOUT ROWID
  `;
});
