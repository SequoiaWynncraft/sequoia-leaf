import type { Database } from "bun:sqlite";

import {
  draftEntry,
  leaf,
  leafForLevel,
  type LedgerEntry,
  levelForXp,
  type LevelRules,
  parsePlayerId,
  type PlayerId,
} from "@sequoia-leaf/core";

import { getAccount, insertEntry, listEarns } from "../ledger/store.ts";

/**
 * The key of a level's payout. The first time a player reaches a level it is
 * `level:<player>:<level>`; the n-th time, after the earlier payouts were
 * reversed because the player lost the XP, it is `level:<player>:<level>:<n>`.
 */
function levelKey(playerId: PlayerId, level: number, time: number): string {
  return time === 1 ? `level:${playerId}:${level}` : `level:${playerId}:${level}:${time}`;
}

const LEVEL_KEY = /^level:[0-9a-f-]{36}:(\d+)(?::\d+)?$/;

function levelOfKey(key: string): number {
  const level = LEVEL_KEY.exec(key)?.[1];
  if (level === undefined) {
    throw new Error(`Not the key of a level payout: ${key}`);
  }
  return Number(level);
}

/** The player's level payouts, each with the level it paid for. */
function levelPayouts(db: Database, playerId: PlayerId): { level: number; entry: LedgerEntry; reversed: boolean }[] {
  return listEarns(db, playerId, "level").map(({ entry, reversed }) => ({
    level: levelOfKey(entry.idempotencyKey),
    entry,
    reversed,
  }));
}

/**
 * Pays the Leaf for every level the player has reached and is not paid for,
 * lowest first, and returns the Leaf paid. A level is paid for while its
 * payout stands, so paying again changes nothing. A payout that was reversed,
 * because a correction took back the XP that reached the level, no longer
 * counts: reaching the level again pays it again, once. The Leaf grants no XP,
 * so it can never reach a level by itself.
 *
 * Call it in the transaction that added the XP.
 */
export function payLevels(db: Database, playerId: PlayerId, rules: LevelRules, now: number): number {
  const reached = levelForXp(getAccount(db, playerId).xp, rules).level;
  const standing = new Set<number>();
  const times = new Map<number, number>();
  for (const payout of levelPayouts(db, playerId)) {
    times.set(payout.level, (times.get(payout.level) ?? 0) + 1);
    if (!payout.reversed) {
      standing.add(payout.level);
    }
  }
  let total = 0;
  for (let level = 2; level <= reached; level += 1) {
    const amount = leafForLevel(level, rules);
    if (amount === 0 || standing.has(level)) {
      continue;
    }
    const idempotencyKey = levelKey(playerId, level, (times.get(level) ?? 0) + 1);
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
 * nothing. Immediate, for the reason the credit sync's write is
 * (`windowedSync`): it reads before it writes.
 */
export function payMissedLevels(db: Database, rules: LevelRules, now: number): { players: number; leaf: number } {
  return db
    .transaction(() => {
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
    })
    .immediate();
}
