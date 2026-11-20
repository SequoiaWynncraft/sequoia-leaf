import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// Claims of Leaf out to LE, tomes and aspects, which staff pay in-game. A claim's
// Leaf is spent when it is made (`conversion:<id>`), and given back by that
// spend's reversal (`undo:conversion:<id>`) when it is declined or cancelled. A
// claim waits until staff pay or decline it; once it has, it never changes.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE conversions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id       TEXT    NOT NULL,
      -- The Minecraft name they signed in with, which staff pay in-game.
      username        TEXT    NOT NULL,
      -- The member's id for the request that made it, so a retried request makes one claim.
      request_id      TEXT    NOT NULL,
      kind            TEXT    NOT NULL CHECK (kind IN ('le', 'tome', 'aspect')),
      -- LE for a claim of LE; 1 for a tome or an aspect.
      units           INTEGER NOT NULL CHECK (units > 0),
      leaf            INTEGER NOT NULL CHECK (leaf > 0),
      -- What the member asked for in words, such as which aspect.
      note            TEXT,
      -- The calendar month it was made in, in UTC, counted from January 1970 as 0.
      requested_month INTEGER NOT NULL,
      status          TEXT    NOT NULL CHECK (status IN ('pending', 'paid', 'declined', 'cancelled')),
      -- The month whose allowance paid it, once paid.
      paid_month      INTEGER,
      -- When it was paid, declined or cancelled, by whom (staff, or the member), and why.
      closed_at       INTEGER,
      closed_by       TEXT,
      close_note      TEXT,
      created_at      INTEGER NOT NULL,
      UNIQUE (player_id, request_id),
      CHECK ((status = 'paid') = (paid_month IS NOT NULL)),
      CHECK ((status = 'pending') = (closed_at IS NULL)),
      CHECK ((status = 'pending') = (closed_by IS NULL))
    ) STRICT
  `;
  // The queue of each kind, in order, and what each month paid out.
  yield* sql`CREATE INDEX conversions_queue ON conversions (kind, status, id)`;
  yield* sql`CREATE INDEX conversions_paid ON conversions (kind, paid_month) WHERE status = 'paid'`;
  yield* sql`CREATE INDEX conversions_by_player ON conversions (player_id, requested_month)`;
  // A claim is closed once, and then never changes; what it claims never does.
  yield* sql`
    CREATE TRIGGER conversions_closed_once
    BEFORE UPDATE ON conversions
    WHEN OLD.status <> 'pending'
      OR NEW.player_id IS NOT OLD.player_id OR NEW.request_id IS NOT OLD.request_id
      OR NEW.kind IS NOT OLD.kind OR NEW.units IS NOT OLD.units OR NEW.leaf IS NOT OLD.leaf
      OR NEW.requested_month IS NOT OLD.requested_month OR NEW.created_at IS NOT OLD.created_at
    BEGIN
      SELECT RAISE(ABORT, 'conversion_closed');
    END
  `;
  yield* sql`
    CREATE TRIGGER conversions_kept
    BEFORE DELETE ON conversions
    BEGIN
      SELECT RAISE(ABORT, 'conversion_closed');
    END
  `;
});
