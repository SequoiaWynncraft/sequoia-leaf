import {
  leadingGoal,
  objectiveTarget,
  objectiveTitle,
  type Quest,
  type QuestGoal,
  questTitle,
} from "@sequoia-leaf/core";

/**
 * A quest as the API sends it. `goals` lists every way to finish it, each with its
 * own progress. `objective`, `progress` and `target` repeat the goal nearest to
 * being met, for clients that show one bar.
 */
export function questJson(quest: Quest) {
  const leading = leadingGoal(quest);
  return {
    id: `${quest.slot}:${quest.sequence}`,
    slot: quest.slot,
    title: questTitle(quest.goals.map((goal) => goal.objective)),
    objective: objectiveJson(leading),
    progress: leading.progress,
    target: objectiveTarget(leading.objective),
    goals: quest.goals.map((goal) => ({
      ...objectiveJson(goal),
      title: objectiveTitle(goal.objective),
      progress: goal.progress,
      target: objectiveTarget(goal.objective),
    })),
    reward: { leaf: quest.reward.leaf, xp: quest.reward.xp },
    started_at: iso(quest.startedAt),
    expires_at: quest.expiresAt === null ? null : iso(quest.expiresAt),
    completed_at: quest.completedAt === null ? null : iso(quest.completedAt),
  };
}

function objectiveJson({ objective }: QuestGoal) {
  return { type: objective.type, raid: objective.type === "raids" ? (objective.raid ?? null) : null };
}

function iso(at: number): string {
  return new Date(at).toISOString();
}
