import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// What the browser game keeps: members' saves, the skins and names Leaf has
// looked up, and who is in town. None of it is the ledger, and none of it holds
// Leaf.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // One save per member and slot, overwritten in place. `version` counts the
  // writes, so a game that read an older one cannot overwrite a newer one. The
  // slots are listed in packages/core, not here.
  yield* sql`
    CREATE TABLE saves (
      player_id  TEXT    NOT NULL,
      slot       TEXT    NOT NULL,
      version    INTEGER NOT NULL CHECK (version > 0),
      -- The save as JSON, in the shape the API sends.
      data       TEXT    NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (player_id, slot)
    ) STRICT
  `;

  // Players' skin sheets as Mojang last served them, kept for a day and kept
  // longer for when Mojang can't be reached.
  yield* sql`
    CREATE TABLE skins (
      player_id  TEXT    PRIMARY KEY,
      png        BLOB    NOT NULL,
      fetched_at INTEGER NOT NULL
    ) STRICT
  `;

  // Players' Minecraft names, for showing members by name in the guild's news.
  yield* sql`
    CREATE TABLE player_names (
      player_id  TEXT    PRIMARY KEY,
      username   TEXT    NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT
  `;

  // Where each member who has the game open was last seen.
  yield* sql`
    CREATE TABLE presence (
      player_id TEXT    PRIMARY KEY,
      username  TEXT    NOT NULL,
      place     TEXT    NOT NULL,
      seen_at   INTEGER NOT NULL
    ) STRICT
  `;
  yield* sql`CREATE INDEX presence_by_time ON presence (seen_at)`;
});
