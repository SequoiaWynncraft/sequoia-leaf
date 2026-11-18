import type { Database } from "bun:sqlite";

import {
  draftEntry,
  leaf,
  leafForLevel,
  levelForXp,
  type LevelRules,
  parsePlayerId,
  type PlayerId,
} from "@sequoia-leaf/core";

import { getAccount, insertEntry } from "../ledger/store.ts";

/**
 * Pays the Leaf for every level the player has reached and not been paid
 * for, lowest first, and returns the Leaf paid. Each level pays once: its
 * entry is keyed by the player and the level, so paying again changes
 * nothing, and neither does reaching a level again after a reversal took XP
 * away. The Leaf grants no XP, so it can never reach a level by itself.
 *
 * Call it in the transaction that added the XP.
 */
export function payLevels(db: Database, playerId: PlayerId, rules: LevelRules, now: number): number {
  const reached = levelForXp(getAccount(db, playerId).xp, rules).level;
  const paid = new Set(
    db
      .query<{ idempotency_key: string }, [string]>(
        "SELECT idempotency_key FROM ledger_entries WHERE player_id = ? AND kind = 'earn' AND origin = 'level'",
      )
      .all(playerId)
      .map((row) => row.idempotency_key),
  );
  let total = 0;
  for (let level = 2; level <= reached; level += 1) {
    const amount = leafForLevel(level, rules);
    const idempotencyKey = `level:${playerId}:${level}`;
    if (amount === 0 || paid.has(idempotencyKey)) {
      continue;
    }
    insertEntry(
      db,
      draftEntry({ kind: "earn", playerId, amount: leaf(amount), xp: 0, source: "level", idempotencyKey }),
      now,
    );
    total += amount;
  }
  return total;
}

/**
 * Pays every player for the levels they have reached and not been paid for,
 * such as the ones reached before levels paid Leaf. It writes no events: those
 * levels were announced when they were reached. Running it again changes
 * nothing.
 */
export function payMissedLevels(db: Database, rules: LevelRules, now: number): { players: number; leaf: number } {
  return db.transaction(() => {
    let players = 0;
    let total = 0;
    const rows = db.query<{ player_id: string }, []>("SELECT player_id FROM accounts ORDER BY player_id").all();
    for (const row of rows) {
      const playerId = parsePlayerId(row.player_id);
      if (playerId === undefined) {
        continue;
      }
      const paid = payLevels(db, playerId, rules, now);
      if (paid > 0) {
        players += 1;
        total += paid;
      }
    }
    return { players, leaf: total };
  })();
}
