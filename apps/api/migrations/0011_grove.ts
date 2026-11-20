import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// Sequoia Grove: each member's place in the Forest, their tree's Bloom and care,
// their cones and the spirits in them. Everything a member earns in the Grove is
// recorded once by the fact behind it, so a retried request or a feed read again
// changes nothing. Leaf itself moves only through the ledger.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // A member who has opened the Grove, signed in with their Sequoia session.
  yield* sql`
    CREATE TABLE grove_members (
      player_id     TEXT    PRIMARY KEY,
      -- The Minecraft name they last signed in with, as the Forest shows it.
      username      TEXT    NOT NULL,
      -- When the Grove first saw them. Spots go by this, the earliest nearest the heart.
      first_seen_at INTEGER NOT NULL,
      -- Their place in the Forest, from 0 nearest the heart. Given once and never moved.
      spot          INTEGER NOT NULL UNIQUE CHECK (spot >= 0),
      -- The spirit that follows them, one they have opened; NULL for none.
      companion     TEXT,
      -- Their care charges are counted from this moment; NULL for a bank never spent from, which is full.
      charge_anchor INTEGER
    ) STRICT
  `;

  // Each member's running totals and spirits, kept by the triggers below from the
  // facts they add up, as `accounts` is kept from the ledger, so they cannot drift
  // and reading them costs the same however long a member has played. Code reads
  // them and never writes to them.
  yield* sql`
    CREATE TABLE grove_totals (
      player_id TEXT    PRIMARY KEY,
      -- All the Bloom they ever gained.
      bloom     INTEGER NOT NULL CHECK (bloom >= 0),
      -- The cones they hold: granted, less opened. Opening one they don't hold is refused here too.
      cones     INTEGER NOT NULL CHECK (cones >= 0)
    ) STRICT
  `;
  yield* sql`
    CREATE TABLE grove_spirits (
      player_id   TEXT    NOT NULL,
      spirit      TEXT    NOT NULL,
      copies      INTEGER NOT NULL CHECK (copies >= 0),
      -- Whether any copy wore the Verdant coat.
      verdant     INTEGER NOT NULL CHECK (verdant IN (0, 1)),
      -- The opening that first gave it, so the collection lists spirits in the order found.
      first_found INTEGER NOT NULL,
      PRIMARY KEY (player_id, spirit)
    ) STRICT, WITHOUT ROWID
  `;

  // Every Bloom a member gained, once by its key: a credited raid by its ledger key
  // (`raid:<completion>:<player>`), a care by its request (`care:<player>:<request>`).
  // Bloom never decays, so a member's Bloom is the sum of these.
  yield* sql`
    CREATE TABLE grove_bloom (
      key        TEXT    PRIMARY KEY,
      player_id  TEXT    NOT NULL,
      source     TEXT    NOT NULL CHECK (source IN ('raid', 'care')),
      bloom      INTEGER NOT NULL CHECK (bloom > 0),
      created_at INTEGER NOT NULL
    ) STRICT, WITHOUT ROWID
  `;
  yield* sql`
    CREATE TRIGGER grove_bloom_apply
    AFTER INSERT ON grove_bloom
    BEGIN
      INSERT OR IGNORE INTO grove_totals (player_id, bloom, cones) VALUES (NEW.player_id, 0, 0);
      UPDATE grove_totals SET bloom = bloom + NEW.bloom WHERE player_id = NEW.player_id;
    END
  `;

  // Every cone a member was given, once by its key: bought (`buy:<player>:<request>`,
  // beside the ledger's spend) or from a full Bloom (`bloom:<player>:<cycle>`). A
  // member's cones are these, less the ones they opened.
  yield* sql`
    CREATE TABLE grove_cone_grants (
      key        TEXT    PRIMARY KEY,
      player_id  TEXT    NOT NULL,
      source     TEXT    NOT NULL CHECK (source IN ('bought', 'bloom')),
      cones      INTEGER NOT NULL CHECK (cones > 0),
      created_at INTEGER NOT NULL
    ) STRICT, WITHOUT ROWID
  `;
  yield* sql`
    CREATE TRIGGER grove_cone_grants_apply
    AFTER INSERT ON grove_cone_grants
    BEGIN
      INSERT OR IGNORE INTO grove_totals (player_id, bloom, cones) VALUES (NEW.player_id, 0, 0);
      UPDATE grove_totals SET cones = cones + NEW.cones WHERE player_id = NEW.player_id;
    END
  `;

  // Every cone opened, one row each, the audit of the Grove's odds. The cone follows
  // from the roll and the pity before it (`openCone` in packages/core), so each row
  // can be checked. A retried request finds its cones here by its id.
  yield* sql`
    CREATE TABLE grove_openings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id   TEXT    NOT NULL,
      request_id  TEXT    NOT NULL,
      -- The cone's place in its request, from 0.
      position    INTEGER NOT NULL CHECK (position >= 0),
      banner      TEXT    NOT NULL,
      roll        INTEGER NOT NULL CHECK (roll >= 0),
      pity_before INTEGER NOT NULL CHECK (pity_before >= 0),
      pity_after  INTEGER NOT NULL CHECK (pity_after >= 0),
      rank        TEXT    NOT NULL,
      spirit      TEXT    NOT NULL,
      verdant     INTEGER NOT NULL CHECK (verdant IN (0, 1)),
      guaranteed  INTEGER NOT NULL CHECK (guaranteed IN (0, 1)),
      featured    INTEGER NOT NULL CHECK (featured IN (0, 1)),
      -- Which copy of the spirit it was for the member: 1 for a new one.
      copy        INTEGER NOT NULL CHECK (copy > 0),
      created_at  INTEGER NOT NULL,
      UNIQUE (player_id, request_id, position)
    ) STRICT
  `;
  yield* sql`CREATE INDEX grove_openings_by_player ON grove_openings (player_id, id)`;
  yield* sql`
    CREATE TRIGGER grove_openings_apply
    AFTER INSERT ON grove_openings
    BEGIN
      INSERT OR IGNORE INTO grove_totals (player_id, bloom, cones) VALUES (NEW.player_id, 0, 0);
      UPDATE grove_totals SET cones = cones - 1 WHERE player_id = NEW.player_id;
      INSERT OR IGNORE INTO grove_spirits (player_id, spirit, copies, verdant, first_found)
      VALUES (NEW.player_id, NEW.spirit, 0, 0, NEW.id);
      UPDATE grove_spirits SET copies = copies + 1, verdant = MAX(verdant, NEW.verdant)
      WHERE player_id = NEW.player_id AND spirit = NEW.spirit;
    END
  `;
  yield* sql`
    CREATE TRIGGER grove_openings_append_only_update
    BEFORE UPDATE ON grove_openings
    BEGIN
      SELECT RAISE(ABORT, 'grove_openings_append_only');
    END
  `;
  yield* sql`
    CREATE TRIGGER grove_openings_append_only_delete
    BEFORE DELETE ON grove_openings
    BEGIN
      SELECT RAISE(ABORT, 'grove_openings_append_only');
    END
  `;

  // Every care action, once by its request.
  yield* sql`
    CREATE TABLE grove_care (
      player_id  TEXT    NOT NULL,
      request_id TEXT    NOT NULL,
      tool       TEXT    NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (player_id, request_id)
    ) STRICT, WITHOUT ROWID
  `;

  // The event an activity was part of, the same for the whole party: `raid:<completion>`
  // or `war:<submission>`. The Grove lights a raid party's lanterns together by it.
  // Activities recorded before it was kept get theirs from their source key,
  // `<kind>:<id>:<player>`, whose player is a dashed UUID of 36 characters.
  yield* sql`ALTER TABLE activities ADD COLUMN event_key TEXT`;
  yield* sql`
    UPDATE activities SET event_key = substr(source_key, 1, length(source_key) - 37)
    WHERE substr(source_key, -37, 1) = ':'
  `;
  yield* sql`CREATE INDEX activities_by_event ON activities (event_key)`;
});
