import type { Database } from "bun:sqlite";

import {
  type Account,
  draftEntry,
  type EarnSource,
  type EntryDraft,
  isEntryKind,
  isEntryOrigin,
  type LedgerEntry,
  parsePlayerId,
  type PlayerId,
  type Posting,
  sameDraft,
} from "@sequoia-leaf/core";

export type PostRejection =
  /** The balance does not cover the spend. */
  | "insufficient_leaf"
  /** The idempotency key was already used to record a different fact. */
  | "idempotency_conflict"
  /** The entry being reversed already has a reversal. */
  | "already_reversed";

export type PostResult =
  | { readonly status: "posted"; readonly entry: LedgerEntry }
  /** The same fact was posted before; `entry` is the one written then. Safe to treat as success. */
  | { readonly status: "duplicate"; readonly entry: LedgerEntry }
  | { readonly status: "rejected"; readonly reason: PostRejection };

interface EntryRow {
  id: number;
  player_id: string;
  kind: string;
  balance_delta: number;
  xp_delta: number;
  origin: string;
  idempotency_key: string;
  reverses_id: number | null;
  actor: string | null;
  memo: string | null;
  created_at: number;
}

const ENTRY_COLUMNS =
  "id, player_id, kind, balance_delta, xp_delta, origin, idempotency_key, reverses_id, actor, memo, created_at";

// Rows are checked as they leave the database, so a row written by anything
// other than this module fails loudly here instead of flowing on as a
// wrongly typed entry.
function toEntry(row: EntryRow): LedgerEntry {
  const playerId = parsePlayerId(row.player_id);
  if (playerId === undefined || !isEntryKind(row.kind) || !isEntryOrigin(row.origin)) {
    throw new Error(`Ledger entry ${row.id} is not a valid entry`);
  }
  return {
    id: row.id,
    playerId,
    kind: row.kind,
    balanceDelta: row.balance_delta,
    xpDelta: row.xp_delta,
    origin: row.origin,
    idempotencyKey: row.idempotency_key,
    reversesId: row.reverses_id,
    actor: row.actor,
    memo: row.memo,
    createdAt: row.created_at,
  };
}

/**
 * Inserts one entry, and through the table's trigger applies it to the
 * player's account. It throws when the database refuses the entry. Call it
 * inside a transaction to record an entry together with what caused it, as
 * the credit sync does; use `postEntry` to post a single entry.
 */
export function insertEntry(db: Database, draft: EntryDraft, now: number): LedgerEntry {
  const row = db
    .query<
      EntryRow,
      [string, string, number, number, string, string, number | null, string | null, string | null, number]
    >(
      `INSERT INTO ledger_entries
         (player_id, kind, balance_delta, xp_delta, origin, idempotency_key, reverses_id, actor, memo, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING ${ENTRY_COLUMNS}`,
    )
    .get(
      draft.playerId,
      draft.kind,
      draft.balanceDelta,
      draft.xpDelta,
      draft.origin,
      draft.idempotencyKey,
      draft.reversesId,
      draft.actor,
      draft.memo,
      now,
    );
  if (row === null) {
    throw new Error("Ledger insert returned no row");
  }
  return toEntry(row);
}

/**
 * Adds one entry to the ledger and applies it to the player's account, as one
 * atomic statement. `now` is milliseconds since the Unix epoch.
 *
 * Posting the same fact twice is safe: the second call returns `duplicate`
 * with the original entry and changes nothing.
 */
export function postEntry(db: Database, posting: Posting, now: number): PostResult {
  const draft = draftEntry(posting);
  try {
    return { status: "posted", entry: insertEntry(db, draft, now) };
  } catch (error) {
    const rejection = explainFailure(db, draft, error);
    if (rejection === undefined) {
      throw error;
    }
    return rejection;
  }
}

/** Maps a failed insert to a result, or returns undefined when the failure is not one the ledger expects. */
function explainFailure(db: Database, draft: EntryDraft, error: unknown): PostResult | undefined {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("insufficient_leaf")) {
    return { status: "rejected", reason: "insufficient_leaf" };
  }
  const keyTaken = message.includes("ledger_entries.idempotency_key");
  const alreadyReversed = message.includes("ledger_entries.reverses_id");
  if (!keyTaken && !alreadyReversed) {
    return undefined;
  }
  // A retried reversal collides on both unique columns and SQLite reports only
  // one of them, so the key lookup decides which case this is.
  const existing = findByIdempotencyKey(db, draft.idempotencyKey);
  if (existing === undefined) {
    return { status: "rejected", reason: "already_reversed" };
  }
  if (sameDraft(existing, draft)) {
    return { status: "duplicate", entry: existing };
  }
  return { status: "rejected", reason: "idempotency_conflict" };
}

function findByIdempotencyKey(db: Database, idempotencyKey: string): LedgerEntry | undefined {
  const row = db
    .query<EntryRow, [string]>(`SELECT ${ENTRY_COLUMNS} FROM ledger_entries WHERE idempotency_key = ?`)
    .get(idempotencyKey);
  return row === null ? undefined : toEntry(row);
}

/** A player's totals. A player with no entries has an account of zero. */
export function getAccount(db: Database, playerId: PlayerId): Account {
  const row = db
    .query<{ balance: number; xp: number }, [string]>("SELECT balance, xp FROM accounts WHERE player_id = ?")
    .get(playerId);
  return {
    playerId,
    balance: row?.balance ?? 0,
    xp: row?.xp ?? 0,
  };
}

/** An earn entry, and whether a reversal has undone it. */
export interface Earn {
  readonly entry: LedgerEntry;
  readonly reversed: boolean;
}

/** A player's earn entries from one source, oldest first. */
export function listEarns(db: Database, playerId: PlayerId, source: EarnSource): Earn[] {
  return db
    .query<EntryRow & { reversed: number }, [string, string]>(
      `SELECT ${ENTRY_COLUMNS},
         EXISTS (SELECT 1 FROM ledger_entries AS reversal WHERE reversal.reverses_id = earn.id) AS reversed
       FROM ledger_entries AS earn
       WHERE player_id = ? AND kind = 'earn' AND origin = ?
       ORDER BY id`,
    )
    .all(playerId, source)
    .map((row) => ({ entry: toEntry(row), reversed: row.reversed === 1 }));
}

export interface ListEntriesOptions {
  /** Maximum number of entries to return. */
  readonly limit: number;
  /** Return only entries older than this entry id, for paging backwards. */
  readonly beforeId?: number;
}

/** A player's entries, newest first. */
export function listEntries(db: Database, playerId: PlayerId, options: ListEntriesOptions): LedgerEntry[] {
  return db
    .query<EntryRow, [string, number, number]>(
      `SELECT ${ENTRY_COLUMNS} FROM ledger_entries
       WHERE player_id = ? AND id < ?
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(playerId, options.beforeId ?? Number.MAX_SAFE_INTEGER, options.limit)
    .map(toEntry);
}
