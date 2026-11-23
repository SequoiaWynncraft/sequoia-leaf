import {
  DAY_MS,
  draftEntry,
  leaf,
  objectiveTarget,
  type PlayerId,
  type Quest,
  QUEST_SLOTS,
  type QuestBook,
  type QuestGoal,
  type QuestObjective,
  type QuestSlot,
  type QuestStep,
  RAID_KEYS,
  utcDay,
} from "@sequoia-leaf/core";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { Ledger } from "../ledger/store.ts";

/** A quest row holds its first goal in the objective columns and a second, when it has one, in the alternative ones. */
const MAX_GOALS = 2;

const ObjectiveType = Schema.Literals(["raids", "wars", "season_rating"]);
const Raid = Schema.NullOr(Schema.Literals(RAID_KEYS));

const QuestRow = Schema.Struct({
  slot: Schema.Literals(QUEST_SLOTS),
  sequence: Schema.Int,
  templateId: Schema.String,
  objectiveType: ObjectiveType,
  objectiveRaid: Raid,
  target: Schema.Int,
  rewardLeaf: Schema.Int,
  rewardXp: Schema.Int,
  progress: Schema.Int,
  startedAt: Schema.Int,
  expiresAt: Schema.NullOr(Schema.Int),
  completedAt: Schema.NullOr(Schema.Int),
  alternativeType: Schema.NullOr(ObjectiveType),
  alternativeRaid: Raid,
  alternativeTarget: Schema.NullOr(Schema.Int),
  alternativeProgress: Schema.NullOr(Schema.Int),
});
type QuestRow = typeof QuestRow.Type;

/** The quest columns, named as the code names them. */
const QUEST_COLUMNS = `slot, sequence, template_id AS templateId, objective_type AS objectiveType,
  objective_raid AS objectiveRaid, target, reward_leaf AS rewardLeaf, reward_xp AS rewardXp, progress,
  started_at AS startedAt, expires_at AS expiresAt, completed_at AS completedAt,
  alternative_type AS alternativeType, alternative_raid AS alternativeRaid,
  alternative_target AS alternativeTarget, alternative_progress AS alternativeProgress`;

const Charges = { dailyCharges: Schema.Int, dailyChargedDay: Schema.Int };

/** A player's daily charges, with the latest quest of one slot, or with NULL quest columns when they have no quest yet. */
const BookRow = Schema.Union([
  Schema.Struct({ ...Charges, ...QuestRow.fields }),
  Schema.Struct({ ...Charges, slot: Schema.Null }),
]);

function toObjective(type: typeof ObjectiveType.Type, raid: typeof Raid.Type, target: number): QuestObjective {
  switch (type) {
    case "wars":
      return { type, count: target };
    case "season_rating":
      return { type, amount: target };
    case "raids":
      return raid === null ? { type, count: target } : { type, raid, count: target };
  }
}

function toQuest(row: QuestRow): Quest {
  const goals: QuestGoal[] = [
    { objective: toObjective(row.objectiveType, row.objectiveRaid, row.target), progress: row.progress },
  ];
  if (row.alternativeType !== null && row.alternativeTarget !== null && row.alternativeProgress !== null) {
    goals.push({
      objective: toObjective(row.alternativeType, row.alternativeRaid, row.alternativeTarget),
      progress: row.alternativeProgress,
    });
  }
  return {
    slot: row.slot,
    sequence: row.sequence,
    templateId: row.templateId,
    goals,
    reward: { leaf: row.rewardLeaf, xp: row.rewardXp },
    startedAt: row.startedAt,
    expiresAt: row.expiresAt,
    completedAt: row.completedAt,
  };
}

/** The columns one goal is stored in, all NULL for an alternative the quest doesn't have. */
function goalColumns(goal: QuestGoal | undefined) {
  const objective = goal?.objective;
  return {
    type: objective?.type ?? null,
    raid: objective?.type === "raids" ? (objective.raid ?? null) : null,
    target: objective === undefined ? null : objectiveTarget(objective),
    progress: goal?.progress ?? null,
  };
}

/**
 * Each player's quests, their daily charges and their rerolls. Saving a step
 * also pays the quests it finished, through the ledger. A database failure is
 * a defect.
 */
export class Quests extends Context.Service<
  Quests,
  {
    /** A player's quest book, or undefined for a player who has never had a quest. */
    readonly book: (playerId: PlayerId) => Effect.Effect<QuestBook | undefined>;
    /**
     * Saves a step: the player's daily charges, every quest handed out or
     * changed, the reward of every quest finished, and for every reroll the
     * step undid (`QuestStep.undone`) the Leaf it cost given back, once. Call
     * it in the same transaction as what caused the step.
     */
    readonly saveStep: (playerId: PlayerId, step: QuestStep, now: number) => Effect.Effect<void>;
    /**
     * The quests rerolls replaced at or after `since`, oldest first, that have not finished: each
     * still takes an activity from its own time reported late (`QuestBook.replaced`).
     */
    readonly replaced: (playerId: PlayerId, since: number) => Effect.Effect<readonly Quest[]>;
    /** A player's quests finished at or after a moment, newest first. */
    readonly completedSince: (playerId: PlayerId, since: number) => Effect.Effect<readonly Quest[]>;
    /** How many times a player rerolled each slot on the UTC day of `at`. Slots not rerolled that day are absent. */
    readonly rerollsOnDay: (playerId: PlayerId, at: number) => Effect.Effect<ReadonlyMap<QuestSlot, number>>;
    /** Records that a player swapped quest `slot:sequence` for the next, and what it cost. */
    readonly recordReroll: (
      playerId: PlayerId,
      slot: QuestSlot,
      sequence: number,
      cost: number,
      now: number,
    ) => Effect.Effect<void>;
  }
>()("leaf/Quests") {
  static readonly layer = Layer.effect(
    Quests,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const ledger = yield* Ledger;

      // One row per slot's latest quest, each carrying the player's daily charges;
      // a single row of NULL quest columns for a player with charges but no quest.
      const bookRows = SqlSchema.findAll({
        Request: Schema.String,
        Result: BookRow,
        execute: (playerId) => sql`
          SELECT daily_charges AS dailyCharges, daily_charged_day AS dailyChargedDay, ${sql.literal(QUEST_COLUMNS)}
          FROM quest_players AS player
          LEFT JOIN quests AS quest
            ON quest.player_id = player.player_id
           AND quest.sequence = (SELECT MAX(later.sequence) FROM quests AS later
                                 WHERE later.player_id = quest.player_id AND later.slot = quest.slot)
          WHERE player.player_id = ${playerId}
        `,
      });
      const replacedSince = SqlSchema.findAll({
        Request: Schema.Struct({ playerId: Schema.String, since: Schema.Int }),
        Result: QuestRow,
        execute: ({ playerId, since }) => sql`
          SELECT ${sql.literal(QUEST_COLUMNS)} FROM quests
          WHERE player_id = ${playerId} AND completed_at IS NULL AND (slot, sequence) IN (
            SELECT slot, sequence FROM quest_rerolls WHERE player_id = ${playerId} AND rerolled_at >= ${since}
          )
          ORDER BY expires_at, slot
        `,
      });
      const rerollsFrom = SqlSchema.findAll({
        Request: Schema.Struct({ playerId: Schema.String, slot: Schema.String, from: Schema.Int }),
        Result: Schema.Struct({ sequence: Schema.Int }),
        execute: ({ playerId, slot, from }) => sql`
          SELECT sequence FROM quest_rerolls
          WHERE player_id = ${playerId} AND slot = ${slot} AND sequence >= ${from} AND leaf > 0
          ORDER BY sequence
        `,
      });
      const completedSince = SqlSchema.findAll({
        Request: Schema.Struct({ playerId: Schema.String, since: Schema.Int }),
        Result: QuestRow,
        execute: ({ playerId, since }) => sql`
          SELECT ${sql.literal(QUEST_COLUMNS)} FROM quests
          WHERE player_id = ${playerId} AND completed_at >= ${since}
          ORDER BY completed_at DESC, slot, sequence DESC
          LIMIT 20
        `,
      });
      const rerollCounts = SqlSchema.findAll({
        Request: Schema.Struct({ playerId: Schema.String, from: Schema.Int, to: Schema.Int }),
        Result: Schema.Struct({ slot: Schema.Literals(QUEST_SLOTS), rerolls: Schema.Int }),
        execute: ({ playerId, from, to }) => sql`
          SELECT slot, COUNT(*) AS rerolls FROM quest_rerolls
          WHERE player_id = ${playerId} AND rerolled_at >= ${from} AND rerolled_at < ${to}
          GROUP BY slot
        `,
      });

      const saveQuest = (playerId: PlayerId, quest: Quest) => {
        const [first, second] = quest.goals;
        if (first === undefined || quest.goals.length > MAX_GOALS) {
          return Effect.die(
            new Error(
              `Quest ${quest.slot}:${quest.sequence} has ${quest.goals.length} goals; it can have 1 to ${MAX_GOALS}`,
            ),
          );
        }
        const goal = goalColumns(first);
        const alternative = goalColumns(second);
        return sql`
          INSERT INTO quests ${sql.insert({
            playerId,
            slot: quest.slot,
            sequence: quest.sequence,
            templateId: quest.templateId,
            objectiveType: goal.type,
            objectiveRaid: goal.raid,
            target: goal.target,
            rewardLeaf: quest.reward.leaf,
            rewardXp: quest.reward.xp,
            progress: goal.progress,
            startedAt: quest.startedAt,
            expiresAt: quest.expiresAt,
            completedAt: quest.completedAt,
            alternativeType: alternative.type,
            alternativeRaid: alternative.raid,
            alternativeTarget: alternative.target,
            alternativeProgress: alternative.progress,
          })}
          ON CONFLICT (player_id, slot, sequence) DO UPDATE
          SET progress = excluded.progress, alternative_progress = excluded.alternative_progress,
              expires_at = excluded.expires_at, completed_at = excluded.completed_at
        `;
      };

      const saveStep = Effect.fn("Quests.saveStep")(function* (playerId: PlayerId, step: QuestStep, now: number) {
        const { dailyCharges, dailyChargedDay } = step.book;
        yield* sql`
          INSERT INTO quest_players ${sql.insert({ playerId, dailyCharges, dailyChargedDay })}
          ON CONFLICT (player_id) DO UPDATE
          SET daily_charges = excluded.daily_charges, daily_charged_day = excluded.daily_charged_day
        `.pipe(Effect.orDie);
        for (const quest of step.written) {
          yield* saveQuest(playerId, quest).pipe(Effect.orDie);
        }
        // A reroll undone gives back what it cost, once.
        for (const { slot, from } of step.undone ?? []) {
          for (const { sequence } of yield* rerollsFrom({ playerId, slot, from }).pipe(Effect.orDie)) {
            const spent = yield* ledger.entry(`reroll:${playerId}:${slot}:${sequence}`);
            if (Option.isNone(spent)) continue;
            yield* ledger.post(
              {
                kind: "reversal",
                playerId,
                reverses: spent.value,
                idempotencyKey: `reroll-undone:${playerId}:${slot}:${sequence}`,
              },
              now,
            );
          }
        }
        for (const quest of step.completed) {
          yield* ledger.insert(
            draftEntry({
              kind: "earn",
              playerId,
              amount: leaf(quest.reward.leaf),
              xp: quest.reward.xp,
              source: "quest",
              idempotencyKey: `quest:${playerId}:${quest.slot}:${quest.sequence}`,
            }),
            now,
          );
        }
      });

      return Quests.of({
        book: (playerId) =>
          bookRows(playerId).pipe(
            Effect.map((rows): QuestBook | undefined => {
              const [first] = rows;
              if (first === undefined) {
                return undefined;
              }
              const latest: { [slot in QuestSlot]?: Quest } = {};
              for (const row of rows) {
                if (row.slot !== null) {
                  latest[row.slot] = toQuest(row);
                }
              }
              return { dailyCharges: first.dailyCharges, dailyChargedDay: first.dailyChargedDay, latest };
            }),
            Effect.orDie,
          ),
        saveStep,
        replaced: (playerId, since) =>
          replacedSince({ playerId, since }).pipe(
            Effect.map((rows) => rows.map(toQuest)),
            Effect.orDie,
          ),
        completedSince: (playerId, since) =>
          completedSince({ playerId, since }).pipe(
            Effect.map((rows) => rows.map(toQuest)),
            Effect.orDie,
          ),
        rerollsOnDay: (playerId, at) => {
          const from = utcDay(at) * DAY_MS;
          return rerollCounts({ playerId, from, to: from + DAY_MS }).pipe(
            Effect.map((rows) => new Map(rows.map((row) => [row.slot, row.rerolls]))),
            Effect.orDie,
          );
        },
        recordReroll: (playerId, slot, sequence, cost, now) =>
          sql`INSERT INTO quest_rerolls ${sql.insert({ playerId, slot, sequence, leaf: cost, rerolledAt: now })}`.pipe(
            Effect.asVoid,
            Effect.orDie,
          ),
      });
    }),
  );
}
