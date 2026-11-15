import {
  type Account,
  draftEntry,
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
  lifetime_delta: number;
  origin: string;
  idempotency_key: string;
  reverses_id: number | null;
  actor: string | null;
  memo: string | null;
  created_at: number;
}

const ENTRY_COLUMNS =
  "id, player_id, kind, balance_delta, lifetime_delta, origin, idempotency_key, reverses_id, actor, memo, created_at";

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
    lifetimeDelta: row.lifetime_delta,
    origin: row.origin,
    idempotencyKey: row.idempotency_key,
    reversesId: row.reverses_id,
    actor: row.actor,
    memo: row.memo,
    createdAt: row.created_at,
  };
}

/**
 * Adds one entry to the ledger and applies it to the player's account, as one
 * atomic statement. `now` is milliseconds since the Unix epoch.
 *
 * Posting the same fact twice is safe: the second call returns `duplicate`
 * with the original entry and changes nothing.
 */
export async function postEntry(db: D1Database, posting: Posting, now: number): Promise<PostResult> {
  const draft = draftEntry(posting);
  try {
    const row = await db
      .prepare(
        `INSERT INTO ledger_entries
           (player_id, kind, balance_delta, lifetime_delta, origin, idempotency_key, reverses_id, actor, memo, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING ${ENTRY_COLUMNS}`,
      )
      .bind(
        draft.playerId,
        draft.kind,
        draft.balanceDelta,
        draft.lifetimeDelta,
        draft.origin,
        draft.idempotencyKey,
        draft.reversesId,
        draft.actor,
        draft.memo,
        now,
      )
      .first<EntryRow>();
    if (row === null) {
      throw new Error("Ledger insert returned no row");
    }
    return { status: "posted", entry: toEntry(row) };
  } catch (error) {
    const rejection = await explainFailure(db, draft, error);
    if (rejection === undefined) {
      throw error;
    }
    return rejection;
  }
}

/** Maps a failed insert to a result, or returns undefined when the failure is not one the ledger expects. */
async function explainFailure(db: D1Database, draft: EntryDraft, error: unknown): Promise<PostResult | undefined> {
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
  const existing = await findByIdempotencyKey(db, draft.idempotencyKey);
  if (existing === undefined) {
    return { status: "rejected", reason: "already_reversed" };
  }
  if (sameDraft(existing, draft)) {
    return { status: "duplicate", entry: existing };
  }
  return { status: "rejected", reason: "idempotency_conflict" };
}

async function findByIdempotencyKey(db: D1Database, idempotencyKey: string): Promise<LedgerEntry | undefined> {
  const row = await db
    .prepare(`SELECT ${ENTRY_COLUMNS} FROM ledger_entries WHERE idempotency_key = ?`)
    .bind(idempotencyKey)
    .first<EntryRow>();
  return row === null ? undefined : toEntry(row);
}

/** A player's totals. A player with no entries has an account of zero. */
export async function getAccount(db: D1Database, playerId: PlayerId): Promise<Account> {
  const row = await db
    .prepare("SELECT balance, lifetime_earned FROM accounts WHERE player_id = ?")
    .bind(playerId)
    .first<{ balance: number; lifetime_earned: number }>();
  return {
    playerId,
    balance: row?.balance ?? 0,
    lifetimeEarned: row?.lifetime_earned ?? 0,
  };
}

export interface ListEntriesOptions {
  /** Maximum number of entries to return. */
  readonly limit: number;
  /** Return only entries older than this entry id, for paging backwards. */
  readonly beforeId?: number;
}

/** A player's entries, newest first. */
export async function listEntries(
  db: D1Database,
  playerId: PlayerId,
  options: ListEntriesOptions,
): Promise<LedgerEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT ${ENTRY_COLUMNS} FROM ledger_entries
       WHERE player_id = ? AND id < ?
       ORDER BY id DESC
       LIMIT ?`,
    )
    .bind(playerId, options.beforeId ?? Number.MAX_SAFE_INTEGER, options.limit)
    .all<EntryRow>();
  return results.map(toEntry);
}
