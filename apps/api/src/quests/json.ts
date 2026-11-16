import { type Quest, questTitle } from "@sequoia-leaf/core";

/** A quest as the API sends it. */
export function questJson(quest: Quest) {
  return {
    id: `${quest.slot}:${quest.sequence}`,
    slot: quest.slot,
    title: questTitle(quest.objective),
    objective: {
      type: quest.objective.type,
      raid: quest.objective.type === "raids" ? (quest.objective.raid ?? null) : null,
    },
    progress: quest.progress,
    target: quest.objective.count,
    reward: { leaf: quest.reward.leaf, xp: quest.reward.xp },
    started_at: iso(quest.startedAt),
    expires_at: quest.expiresAt === null ? null : iso(quest.expiresAt),
    completed_at: quest.completedAt === null ? null : iso(quest.completedAt),
  };
}

function iso(at: number): string {
  return new Date(at).toISOString();
}
