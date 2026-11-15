import { type Leaf, MAX_LEAF } from "./leaf.ts";
import type { PlayerId } from "./player.ts";

/** Where earned Leaf comes from. */
export const EARN_SOURCES = ["raid", "war", "quest", "achievement", "event", "staff"] as const;
export type EarnSource = (typeof EARN_SOURCES)[number];

/** What Leaf is spent on. */
export const SPEND_SINKS = ["shop"] as const;
export type SpendSink = (typeof SPEND_SINKS)[number];

export type EntryOrigin = EarnSource | SpendSink;

export const ENTRY_KINDS = ["earn", "spend", "reversal"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export function isEntryKind(value: string): value is EntryKind {
  return ENTRY_KINDS.some((kind) => kind === value);
}

export function isEntryOrigin(value: string): value is EntryOrigin {
  return EARN_SOURCES.some((source) => source === value) || SPEND_SINKS.some((sink) => sink === value);
}

/** One immutable row of the ledger. A player's account is the sum of their entries. */
export interface LedgerEntry {
  readonly id: number;
  readonly playerId: PlayerId;
  readonly kind: EntryKind;
  /** Signed change to the spendable balance. */
  readonly balanceDelta: number;
  /** Signed change to XP, which drives SEQ level and never drops when Leaf is spent. */
  readonly xpDelta: number;
  readonly origin: EntryOrigin;
  readonly idempotencyKey: string;
  readonly reversesId: number | null;
  /** Who caused the entry, for staff actions. Null when the system did. */
  readonly actor: string | null;
  readonly memo: string | null;
  /** Milliseconds since the Unix epoch. */
  readonly createdAt: number;
}

export interface Account {
  readonly playerId: PlayerId;
  readonly balance: number;
  readonly xp: number;
}

interface PostingBase {
  readonly playerId: PlayerId;
  /**
   * Names the real-world fact this entry records, such as one raid completion
   * for one player. Posting the same key twice records the fact once.
   */
  readonly idempotencyKey: string;
  readonly actor?: string;
  readonly memo?: string;
}

/** A request to add one entry to the ledger. */
export type Posting =
  | (PostingBase & {
      readonly kind: "earn";
      readonly amount: Leaf;
      readonly source: EarnSource;
      /** XP granted with the Leaf. Defaults to the amount, so earned Leaf levels a player one for one. */
      readonly xp?: number;
    })
  | (PostingBase & { readonly kind: "spend"; readonly amount: Leaf; readonly sink: SpendSink })
  | (PostingBase & { readonly kind: "reversal"; readonly reverses: LedgerEntry });

/** The parts of an entry that a posting decides. The store adds the id and the time. */
export type EntryDraft = Omit<LedgerEntry, "id" | "createdAt">;

export class InvalidPostingError extends Error {
  override readonly name = "InvalidPostingError";
}

/**
 * Turns a posting into the entry it would write.
 *
 * - Earning raises the balance and grants XP, by default as much XP as Leaf.
 * - Spending lowers the balance only.
 * - A reversal undoes exactly one earlier earn or spend, in full.
 */
export function draftEntry(posting: Posting): EntryDraft {
  const base = {
    playerId: posting.playerId,
    idempotencyKey: posting.idempotencyKey,
    actor: posting.actor ?? null,
    memo: posting.memo ?? null,
  };
  switch (posting.kind) {
    case "earn": {
      const xp = posting.xp ?? posting.amount;
      if (!Number.isInteger(xp) || xp < 0 || xp > MAX_LEAF) {
        throw new InvalidPostingError(`XP must be a whole number from 0 to ${MAX_LEAF}, got ${xp}`);
      }
      return {
        ...base,
        kind: "earn",
        balanceDelta: posting.amount,
        xpDelta: xp,
        origin: posting.source,
        reversesId: null,
      };
    }
    case "spend":
      return {
        ...base,
        kind: "spend",
        balanceDelta: 0 - posting.amount,
        xpDelta: 0,
        origin: posting.sink,
        reversesId: null,
      };
    case "reversal": {
      const original = posting.reverses;
      if (original.kind === "reversal") {
        throw new InvalidPostingError("A reversal cannot be reversed; post a new earn or spend instead");
      }
      if (original.playerId !== posting.playerId) {
        throw new InvalidPostingError("A reversal must belong to the same player as the entry it reverses");
      }
      return {
        ...base,
        kind: "reversal",
        // Subtracting from zero rather than negating keeps a zero delta from becoming -0.
        balanceDelta: 0 - original.balanceDelta,
        xpDelta: 0 - original.xpDelta,
        origin: original.origin,
        reversesId: original.id,
      };
    }
  }
}

/** True when two drafts would record the same fact, so a repeat can be treated as a retry. */
export function sameDraft(a: EntryDraft, b: EntryDraft): boolean {
  return (
    a.playerId === b.playerId &&
    a.kind === b.kind &&
    a.balanceDelta === b.balanceDelta &&
    a.xpDelta === b.xpDelta &&
    a.origin === b.origin &&
    a.idempotencyKey === b.idempotencyKey &&
    a.reversesId === b.reversesId
  );
}
