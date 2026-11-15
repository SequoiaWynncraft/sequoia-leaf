-- The Leaf ledger.
--
-- `ledger_entries` is the source of truth and is append-only. `accounts` holds
-- each player's running totals and is maintained only by the trigger below, so
-- the totals cannot drift from the entries. Application code inserts entries
-- and reads accounts; it never writes to `accounts`.

CREATE TABLE accounts (
  player_id       TEXT    PRIMARY KEY,
  balance         INTEGER NOT NULL,
  xp              INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
) STRICT;

CREATE TABLE ledger_entries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id       TEXT    NOT NULL,
  kind            TEXT    NOT NULL,
  balance_delta   INTEGER NOT NULL,
  xp_delta        INTEGER NOT NULL,
  origin          TEXT    NOT NULL,
  idempotency_key TEXT    NOT NULL UNIQUE,
  reverses_id     INTEGER UNIQUE REFERENCES ledger_entries (id),
  actor           TEXT,
  memo            TEXT,
  created_at      INTEGER NOT NULL,
  CHECK (
    (kind = 'earn' AND balance_delta > 0 AND xp_delta >= 0 AND reverses_id IS NULL)
    OR (kind = 'spend' AND balance_delta < 0 AND xp_delta = 0 AND reverses_id IS NULL)
    OR (kind = 'reversal' AND balance_delta <> 0 AND reverses_id IS NOT NULL)
  )
) STRICT;

CREATE INDEX ledger_entries_by_player ON ledger_entries (player_id, id);

CREATE TRIGGER ledger_entries_append_only_update
BEFORE UPDATE ON ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'ledger_append_only');
END;

CREATE TRIGGER ledger_entries_append_only_delete
BEFORE DELETE ON ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'ledger_append_only');
END;

-- A reversal must be the exact opposite of one earn or spend of the same player.
CREATE TRIGGER ledger_entries_reversal_matches
BEFORE INSERT ON ledger_entries
WHEN NEW.kind = 'reversal'
BEGIN
  SELECT RAISE(ABORT, 'reversal_mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM ledger_entries AS original
    WHERE original.id = NEW.reverses_id
      AND original.player_id = NEW.player_id
      AND original.kind <> 'reversal'
      AND original.origin = NEW.origin
      AND original.balance_delta = -NEW.balance_delta
      AND original.xp_delta = -NEW.xp_delta
  );
END;

-- Applies each entry to the player's account in the same statement that
-- inserts it. A spend that the balance cannot cover aborts the insert, and
-- with it the whole batch it is part of. Reversals are allowed to take the
-- balance below zero: Leaf that was credited wrongly and already spent
-- becomes a debt rather than disappearing.
CREATE TRIGGER ledger_entries_apply
AFTER INSERT ON ledger_entries
BEGIN
  INSERT OR IGNORE INTO accounts (player_id, balance, xp, updated_at)
  VALUES (NEW.player_id, 0, 0, NEW.created_at);

  SELECT RAISE(ABORT, 'insufficient_leaf')
  WHERE NEW.kind = 'spend'
    AND (SELECT balance FROM accounts WHERE player_id = NEW.player_id) + NEW.balance_delta < 0;

  UPDATE accounts
  SET balance = balance + NEW.balance_delta,
      xp = xp + NEW.xp_delta,
      updated_at = NEW.created_at
  WHERE player_id = NEW.player_id;
END;
