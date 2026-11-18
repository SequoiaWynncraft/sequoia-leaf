import type { Database } from "bun:sqlite";

import {
  type AchievementAward,
  draftEntry,
  leaf,
  leafForAward,
  levelForXp,
  type PlayerId,
  type Rules,
} from "@sequoia-leaf/core";

import { insertEvent } from "../events/store.ts";
import { getAccount, insertEntry } from "../ledger/store.ts";
import { payLevels } from "../levels/pay.ts";
import { type SyncMode, type SyncResult, windowedSync } from "../sync/windowed.ts";

/** Returns the achievement milestones players reached during [from, to), in milliseconds since the Unix epoch. */
export type AwardSource = (from: number, to: number) => Promise<readonly AchievementAward[]>;

/**
 * Pays the Leaf each new achievement milestone earns, with an event for each.
 * Milestones reached before the first run pay nothing, so nothing is paid for
 * history. Each award pays once: its ledger entry is keyed by the award's id,
 * so reading a window again, or the same award in two windows, changes nothing.
 */
export async function syncAchievements(
  db: Database,
  source: AwardSource,
  rules: Rules,
  now: number,
  mode: SyncMode,
): Promise<SyncResult> {
  return windowedSync(db, "achievements", now, mode, source, (awards, from, to) => {
    const levelBefore = new Map<PlayerId, number>();
    let recorded = 0;
    let leafPaid = 0;
    for (const award of inWindow(awards, from, to)) {
      const amount = leafForAward(award, rules.achievements);
      const idempotencyKey = `achievement:${award.awardId}`;
      if (amount === 0 || award.milestoneId === null || isPaid(db, idempotencyKey)) {
        continue;
      }
      if (!levelBefore.has(award.playerId)) {
        levelBefore.set(award.playerId, levelForXp(getAccount(db, award.playerId).xp, rules.levels).level);
      }
      const draft = draftEntry({
        kind: "earn",
        playerId: award.playerId,
        amount: leaf(amount),
        source: "achievement",
        idempotencyKey,
      });
      const entry = insertEntry(db, draft, now);
      insertEvent(
        db,
        award.playerId,
        {
          type: "achievement_paid",
          data: {
            award_id: award.awardId,
            ladder: award.ladder,
            milestone: award.milestoneId,
            tier: award.tier,
            threshold: award.threshold,
            label: award.label,
            leaf: entry.balanceDelta,
            xp: entry.xpDelta,
            earned_at: new Date(award.earnedAt).toISOString(),
          },
        },
        now,
      );
      recorded += 1;
      leafPaid += amount;
    }
    for (const [playerId, before] of levelBefore) {
      const after = levelForXp(getAccount(db, playerId).xp, rules.levels).level;
      if (after > before) {
        const levelLeaf = payLevels(db, playerId, rules.levels, now);
        leafPaid += levelLeaf;
        insertEvent(db, playerId, { type: "level_up", data: { level: after, leaf: levelLeaf } }, now);
      }
    }
    return { recorded, leafPaid };
  });
}

/** The awards earned in [from, to), each once, oldest first. */
function inWindow(awards: readonly AchievementAward[], from: number, to: number): AchievementAward[] {
  const unique = new Map<string, AchievementAward>();
  for (const award of awards) {
    if (award.earnedAt >= from && award.earnedAt < to) {
      unique.set(award.awardId, award);
    }
  }
  return [...unique.values()].toSorted((a, b) => a.earnedAt - b.earnedAt || a.awardId.localeCompare(b.awardId));
}

function isPaid(db: Database, idempotencyKey: string): boolean {
  return (
    db
      .query<{ found: number }, [string]>("SELECT 1 AS found FROM ledger_entries WHERE idempotency_key = ?")
      .get(idempotencyKey) !== null
  );
}
