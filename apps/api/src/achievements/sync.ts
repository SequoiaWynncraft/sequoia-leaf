import { type AchievementAward, draftEntry, leaf, leafForAward, type PlayerId, type Rules } from "@sequoia-leaf/core";
import { Effect } from "effect";

import { Events } from "../events/store.ts";
import { Ledger } from "../ledger/store.ts";
import { levelOf, levelUp } from "../levels/pay.ts";
import { type SyncMode, windowedSync } from "../sync/windowed.ts";

/** Reads the achievement milestones players reached during [from, to), in milliseconds since the Unix epoch. */
export type AwardSource<E = never, R = never> = (
  from: number,
  to: number,
) => Effect.Effect<readonly AchievementAward[], E, R>;

/**
 * Pays the Leaf each new achievement milestone earns, with an event for each.
 * Milestones reached before the first run pay nothing, so nothing is paid for
 * history. Each award pays once: its ledger entry is keyed by the award's id,
 * so reading a window again, or the same award in two windows, changes nothing.
 */
export const syncAchievements = <E, R>(source: AwardSource<E, R>, rules: Rules, now: number, mode: SyncMode) =>
  windowedSync("achievements", now, mode, source, (awards, from, to) =>
    Effect.gen(function* () {
      const ledger = yield* Ledger;
      const events = yield* Events;
      const levelBefore = new Map<PlayerId, number>();
      let recorded = 0;
      let leafPaid = 0;
      for (const award of inWindow(awards, from, to)) {
        const amount = leafForAward(award, rules.achievements);
        const idempotencyKey = `achievement:${award.awardId}`;
        if (amount === 0 || award.milestoneId === null || (yield* ledger.isRecorded(idempotencyKey))) {
          continue;
        }
        if (!levelBefore.has(award.playerId)) {
          levelBefore.set(award.playerId, yield* levelOf(award.playerId, rules.levels));
        }
        const entry = yield* ledger.insert(
          draftEntry({
            kind: "earn",
            playerId: award.playerId,
            amount: leaf(amount),
            source: "achievement",
            idempotencyKey,
          }),
          now,
        );
        yield* events.insert(
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
        leafPaid += yield* levelUp(playerId, before, rules.levels, now);
      }
      return { recorded, leafPaid };
    }),
  );

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
