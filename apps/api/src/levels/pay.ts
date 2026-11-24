import { draftEntry, leaf, leafForLevel, levelForXp, type LevelRules, type PlayerId } from "@sequoia-leaf/core";
import { Effect } from "effect";

import { Events } from "../events/store.ts";
import { Ledger } from "../ledger/store.ts";

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
export const payLevels = Effect.fn("payLevels")(function* (playerId: PlayerId, rules: LevelRules, now: number) {
  const ledger = yield* Ledger;
  const reached = levelForXp((yield* ledger.account(playerId)).xp, rules).level;
  const standing = new Set<number>();
  const times = new Map<number, number>();
  for (const { entry, reversed } of yield* ledger.earns(playerId, "level")) {
    const level = levelOfKey(entry.idempotencyKey);
    times.set(level, (times.get(level) ?? 0) + 1);
    if (!reversed) {
      standing.add(level);
    }
  }
  let total = 0;
  for (let level = 2; level <= reached; level += 1) {
    const amount = leafForLevel(level, rules);
    if (amount === 0 || standing.has(level)) {
      continue;
    }
    const idempotencyKey = levelKey(playerId, level, (times.get(level) ?? 0) + 1);
    yield* ledger.insert(
      draftEntry({ kind: "earn", playerId, amount: leaf(amount), xp: 0, source: "level", idempotencyKey }),
      now,
    );
    total += amount;
  }
  return total;
});

/** The level a player's XP has reached. */
export const levelOf = (playerId: PlayerId, rules: LevelRules) =>
  Ledger.use((ledger) => ledger.account(playerId)).pipe(Effect.map((account) => levelForXp(account.xp, rules).level));

/**
 * When the player's XP has passed `levelBefore`, pays the levels reached and
 * says so with a `level_up` event. Returns the Leaf paid. Call it in the
 * transaction that added the XP.
 */
export const levelUp = Effect.fn("levelUp")(function* (
  playerId: PlayerId,
  levelBefore: number,
  rules: LevelRules,
  now: number,
) {
  const level = yield* levelOf(playerId, rules);
  if (level <= levelBefore) {
    return 0;
  }
  const paid = yield* payLevels(playerId, rules, now);
  yield* Events.use((events) => events.insert(playerId, { type: "level_up", data: { level, leaf: paid } }, now));
  return paid;
});
