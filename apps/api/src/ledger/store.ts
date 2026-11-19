import {
  type Account,
  draftEntry,
  EARN_SOURCES,
  type EarnSource,
  ENTRY_KINDS,
  type EntryDraft,
  type LedgerEntry,
  type PlayerId,
  type Posting,
  sameDraft,
  SPEND_SINKS,
} from "@sequoia-leaf/core";
import { Context, Effect, Layer, Option, Predicate, Schema } from "effect";
import { SqlClient, type SqlError, SqlSchema } from "effect/sql";

import { PlayerUuid } from "../wire.ts";

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

/** An earn entry, and whether a reversal has undone it. */
export interface Earn {
  readonly entry: LedgerEntry;
  readonly reversed: boolean;
}

/**
 * A ledger entry as stored. Rows are decoded as they leave the database, so a
 * row written by anything other than this module fails loudly here instead of
 * flowing on as a wrongly typed entry.
 */
const Entry = Schema.Struct({
  id: Schema.Int,
  playerId: PlayerUuid,
  kind: Schema.Literals(ENTRY_KINDS),
  balanceDelta: Schema.Int,
  xpDelta: Schema.Int,
  origin: Schema.Literals([...EARN_SOURCES, ...SPEND_SINKS]),
  idempotencyKey: Schema.String,
  reversesId: Schema.NullOr(Schema.Int),
  actor: Schema.NullOr(Schema.String),
  memo: Schema.NullOr(Schema.String),
  createdAt: Schema.Int,
});

/** The entry columns, named as the code names them. */
const ENTRY_COLUMNS = `id, player_id AS playerId, kind, balance_delta AS balanceDelta, xp_delta AS xpDelta, origin,
  idempotency_key AS idempotencyKey, reverses_id AS reversesId, actor, memo, created_at AS createdAt`;

const Totals = Schema.Struct({ balance: Schema.Int, xp: Schema.Int });

/**
 * Why the database refused an entry, when it is a refusal the ledger expects:
 * the balance does not cover a spend, or a unique column is taken.
 */
function refusal(error: SqlError.SqlError): "insufficient_leaf" | "unique" | undefined {
  const { reason } = error;
  if (Predicate.isTagged(reason, "UniqueViolation")) {
    return "unique";
  }
  const message = Predicate.hasProperty(reason.cause, "message") ? String(reason.cause.message) : "";
  return Predicate.isTagged(reason, "ConstraintError") && message.includes("insufficient_leaf")
    ? "insufficient_leaf"
    : undefined;
}

/**
 * The Leaf ledger. Every change to a balance is one entry here; a trigger
 * applies it to the player's account in the same statement. A database
 * failure that is not one of the refusals below is a defect.
 */
export class Ledger extends Context.Service<
  Ledger,
  {
    /**
     * Inserts one entry, and through the trigger applies it to the account.
     * Dies when the database refuses it. Use it in a transaction to record an
     * entry together with what caused it, as the feed syncs do.
     */
    readonly insert: (draft: EntryDraft, now: number) => Effect.Effect<LedgerEntry>;
    /**
     * Adds one entry. Posting the same fact twice is safe: the second post
     * answers `duplicate` with the original entry and changes nothing.
     */
    readonly post: (posting: Posting, now: number) => Effect.Effect<PostResult>;
    /** A player's totals. A player with no entries has an account of zero. */
    readonly account: (playerId: PlayerId) => Effect.Effect<Account>;
    /** A player's earn entries from one source, oldest first. */
    readonly earns: (playerId: PlayerId, source: EarnSource) => Effect.Effect<readonly Earn[]>;
    /** Whether an entry with this idempotency key exists. */
    readonly isRecorded: (idempotencyKey: string) => Effect.Effect<boolean>;
  }
>()("leaf/Ledger") {
  static readonly layer = Layer.effect(
    Ledger,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const decodeEntry = Schema.decodeUnknownEffect(Entry);
      const byKey = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: Entry,
        execute: (key) => sql`SELECT ${sql.literal(ENTRY_COLUMNS)} FROM ledger_entries WHERE idempotency_key = ${key}`,
      });
      const totals = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: Totals,
        execute: (playerId) => sql`SELECT balance, xp FROM accounts WHERE player_id = ${playerId}`,
      });
      const earnRows = SqlSchema.findAll({
        Request: Schema.Struct({ playerId: Schema.String, source: Schema.String }),
        Result: Schema.Struct({ ...Entry.fields, reversed: Schema.Literals([0, 1]) }),
        execute: ({ playerId, source }) => sql`
          SELECT ${sql.literal(ENTRY_COLUMNS)},
                 EXISTS (SELECT 1 FROM ledger_entries AS reversal WHERE reversal.reverses_id = earn.id) AS reversed
          FROM ledger_entries AS earn
          WHERE player_id = ${playerId} AND kind = 'earn' AND origin = ${source}
          ORDER BY id
        `,
      });

      const insert = (draft: EntryDraft, now: number) =>
        sql`INSERT INTO ledger_entries ${sql.insert({ ...draft, createdAt: now })} RETURNING ${sql.literal(ENTRY_COLUMNS)}`.pipe(
          Effect.flatMap(([row]) => decodeEntry(row)),
        );

      const post = Effect.fn("Ledger.post")(function* (posting: Posting, now: number) {
        const draft = draftEntry(posting);
        return yield* insert(draft, now).pipe(
          Effect.map((entry): PostResult => ({ status: "posted", entry })),
          Effect.catchTag("SqlError", (error) => {
            const why = refusal(error);
            if (why === undefined) {
              return Effect.fail(error);
            }
            if (why === "insufficient_leaf") {
              return Effect.succeed<PostResult>({ status: "rejected", reason: why });
            }
            // The key or the reversed entry is taken. A retried reversal takes both,
            // and SQLite names only one, so the key decides which case this is.
            return byKey(draft.idempotencyKey).pipe(
              Effect.map(
                Option.match({
                  onNone: (): PostResult => ({ status: "rejected", reason: "already_reversed" }),
                  onSome: (existing): PostResult =>
                    sameDraft(existing, draft)
                      ? { status: "duplicate", entry: existing }
                      : { status: "rejected", reason: "idempotency_conflict" },
                }),
              ),
            );
          }),
          Effect.orDie,
        );
      });

      return Ledger.of({
        insert: (draft, now) => insert(draft, now).pipe(Effect.orDie),
        post,
        account: (playerId) =>
          totals(playerId).pipe(
            Effect.map((row) => ({ playerId, ...Option.getOrElse(row, () => ({ balance: 0, xp: 0 })) })),
            Effect.orDie,
          ),
        earns: (playerId, source) =>
          earnRows({ playerId, source }).pipe(
            Effect.map((rows) => rows.map(({ reversed, ...entry }) => ({ entry, reversed: reversed === 1 }))),
            Effect.orDie,
          ),
        isRecorded: (idempotencyKey) => byKey(idempotencyKey).pipe(Effect.map(Option.isSome), Effect.orDie),
      });
    }),
  );
}
