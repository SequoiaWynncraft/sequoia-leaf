import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// Leaf's own sessions, for players who sign in with Discord alone (`SignIns`): each by the SHA-256 of
// its token, which only the player's cookie holds; the Discord account and name it came with; and
// whether Sequoia's Discord gave that account a member's role when it signed in (null when the
// backend could not tell), so a member with no Minecraft account linked is asked to link one.
// `merges` records each player taken into another when an account was linked, for staff to see.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE sign_ins (
      token_hash TEXT    PRIMARY KEY,
      player_id  TEXT    NOT NULL,
      discord_id TEXT    NOT NULL,
      name       TEXT    NOT NULL,
      member     INTEGER CHECK (member IN (0, 1)),
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    ) STRICT, WITHOUT ROWID
  `;
  yield* sql`CREATE INDEX sign_ins_by_player ON sign_ins (player_id)`;
  yield* sql`
    CREATE TABLE merges (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id    TEXT    NOT NULL,
      into_id    TEXT    NOT NULL,
      account    TEXT    NOT NULL,
      moved      TEXT    NOT NULL,
      merged_at  INTEGER NOT NULL
    ) STRICT
  `;
  yield* sql`CREATE INDEX merges_from ON merges (from_id)`;
  // Why a player's id is not their account's: Leaf made it for a Discord account (1), or their
  // account went to another person (0). Only a player made for Discord is taken into another.
  yield* sql`ALTER TABLE leaf_ids ADD COLUMN for_discord INTEGER NOT NULL DEFAULT 0 CHECK (for_discord IN (0, 1))`;
});
