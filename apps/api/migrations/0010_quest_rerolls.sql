-- Rerolls: a member swapped the quest in progress in a slot for another. Each
-- slot has a few free rerolls a UTC day (see rules.ts), which these rows count;
-- the Leaf a paid one cost is its spend in the ledger.

CREATE TABLE quest_rerolls (
  player_id   TEXT    NOT NULL,
  slot        TEXT    NOT NULL,
  -- The quest swapped out. The one that took its place is the next in the slot.
  sequence    INTEGER NOT NULL,
  leaf        INTEGER NOT NULL CHECK (leaf >= 0),
  rerolled_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, slot, sequence)
) STRICT, WITHOUT ROWID;

CREATE INDEX quest_rerolls_by_day ON quest_rerolls (player_id, rerolled_at);
