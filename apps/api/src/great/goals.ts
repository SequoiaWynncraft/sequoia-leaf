import { goalProgress, type GreatRules, greatWeek } from "@sequoia-leaf/core";
import { Effect } from "effect";

import { GuildEvents } from "../guild/store.ts";
import { Great } from "./store.ts";

/**
 * Tells the guild feed of each of the Great Sequoia's goals met in the week of
 * `at`, once per week and goal however often it is checked. Call it in the
 * transaction that recorded what counts toward the goals, after it did. A goal
 * met and then unmet by a refund stays told.
 */
export const announceGoalsMet = Effect.fn("announceGoalsMet")(function* (at: number, now: number, rules: GreatRules) {
  const great = yield* Great;
  const feed = yield* GuildEvents;
  const week = greatWeek(at);
  const totals = yield* great.totals(week.start);
  const weekStartsAt = new Date(week.start).toISOString();
  for (const goal of rules.goals) {
    if (!goalProgress(goal, totals).met) {
      continue;
    }
    yield* feed.insert(
      `great:${weekStartsAt}:${goal.id}`,
      {
        type: "great.goal_met",
        data: {
          goal: goal.id,
          kind: goal.kind,
          title: goal.title,
          target: goal.target,
          reward: goal.reward,
          week_starts_at: weekStartsAt,
        },
      },
      now,
    );
  }
});
