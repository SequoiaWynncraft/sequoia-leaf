import type { Database } from "bun:sqlite";

import {
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
  type RaidKey,
} from "@sequoia-leaf/core";

import { insertEntry } from "../ledger/store.ts";

interface QuestRow {
  slot: string;
  sequence: number;
  template_id: string;
  objective_type: string;
  objective_raid: string | null;
  target: number;
  reward_leaf: number;
  reward_xp: number;
  progress: number;
  started_at: number;
  expires_at: number | null;
  completed_at: number | null;
  alternative_type: string | null;
  alternative_raid: string | null;
  alternative_target: number | null;
  alternative_progress: number | null;
}

const QUEST_COLUMNS =
  "slot, sequence, template_id, objective_type, objective_raid, target, reward_leaf, reward_xp, progress, started_at, expires_at, completed_at, alternative_type, alternative_raid, alternative_target, alternative_progress";

/** A quest row holds its first goal in the objective columns and a second, when it has one, in the alternative ones. */
const MAX_GOALS = 2;

function isSlot(value: string): value is QuestSlot {
  return QUEST_SLOTS.some((slot) => slot === value);
}

function isRaidKey(value: string): value is RaidKey {
  return RAID_KEYS.some((key) => key === value);
}

function toObjective(type: string, raid: string | null, target: number): QuestObjective {
  if (type === "wars") {
    return { type: "wars", count: target };
  }
  if (type === "season_rating") {
    return { type: "season_rating", amount: target };
  }
  if (type !== "raids") {
    throw new Error(`Quest has an unknown objective type: ${type}`);
  }
  if (raid === null) {
    return { type: "raids", count: target };
  }
  if (!isRaidKey(raid)) {
    throw new Error(`Quest names an unknown raid: ${raid}`);
  }
  return { type: "raids", raid, count: target };
}

function toGoals(row: QuestRow): QuestGoal[] {
  const goals = [
    { objective: toObjective(row.objective_type, row.objective_raid, row.target), progress: row.progress },
  ];
  if (row.alternative_type !== null && row.alternative_target !== null && row.alternative_progress !== null) {
    goals.push({
      objective: toObjective(row.alternative_type, row.alternative_raid, row.alternative_target),
      progress: row.alternative_progress,
    });
  }
  return goals;
}

/** The columns one goal is stored in, or all NULL for an alternative the quest doesn't have. */
function goalColumns(goal: QuestGoal | undefined): [string | null, string | null, number | null, number | null] {
  if (goal === undefined) {
    return [null, null, null, null];
  }
  const { objective, progress } = goal;
  return [
    objective.type,
    objective.type === "raids" ? (objective.raid ?? null) : null,
    objectiveTarget(objective),
    progress,
  ];
}

function toQuest(row: QuestRow): Quest {
  if (!isSlot(row.slot)) {
    throw new Error(`Quest has an unknown slot: ${row.slot}`);
  }
  return {
    slot: row.slot,
    sequence: row.sequence,
    templateId: row.template_id,
    goals: toGoals(row),
    reward: { leaf: row.reward_leaf, xp: row.reward_xp },
    startedAt: row.started_at,
    expiresAt: row.expires_at,
    completedAt: row.completed_at,
  };
}

type JoinedRow = { daily_charges: number; daily_charged_day: number } & {
  [Column in keyof QuestRow]: QuestRow[Column] | null;
};

/** The quest columns are all NULL when the player has no quest yet, and all set otherwise. */
function hasQuest(row: JoinedRow): row is JoinedRow & QuestRow {
  return row.slot !== null;
}

/** A player's quest book, or undefined for a player who has never had a quest. */
export function loadQuestBook(db: Database, playerId: PlayerId): QuestBook | undefined {
  // One row per slot's latest quest, each carrying the player's daily charges;
  // a single row of NULL quest columns for a player with charges but no quest.
  const rows = db
    .query<JoinedRow, [string]>(
      `SELECT player.daily_charges, player.daily_charged_day, ${QUEST_COLUMNS.split(", ")
        .map((column) => `quest.${column}`)
        .join(", ")}
       FROM quest_players AS player
       LEFT JOIN quests AS quest
         ON quest.player_id = player.player_id
        AND quest.sequence = (SELECT MAX(later.sequence) FROM quests AS later
                              WHERE later.player_id = quest.player_id AND later.slot = quest.slot)
       WHERE player.player_id = ?`,
    )
    .all(playerId);
  const [first] = rows;
  if (first === undefined) {
    return undefined;
  }
  const latest: { [slot in QuestSlot]?: Quest } = {};
  for (const row of rows) {
    if (hasQuest(row)) {
      const quest = toQuest(row);
      latest[quest.slot] = quest;
    }
  }
  return { dailyCharges: first.daily_charges, dailyChargedDay: first.daily_charged_day, latest };
}

/**
 * Saves a step: the player's daily charges, every quest handed out or
 * changed, and the reward of every quest finished. Call it in the same
 * transaction as the activities that caused the step.
 */
export function saveQuestStep(db: Database, playerId: PlayerId, step: QuestStep, now: number): void {
  db.query(
    `INSERT INTO quest_players (player_id, daily_charges, daily_charged_day) VALUES (?, ?, ?)
     ON CONFLICT (player_id) DO UPDATE
     SET daily_charges = excluded.daily_charges, daily_charged_day = excluded.daily_charged_day`,
  ).run(playerId, step.book.dailyCharges, step.book.dailyChargedDay);
  for (const quest of step.written) {
    const [first, second] = quest.goals;
    if (first === undefined || quest.goals.length > MAX_GOALS) {
      throw new Error(
        `Quest ${quest.slot}:${quest.sequence} has ${quest.goals.length} goals; it can have 1 to ${MAX_GOALS}`,
      );
    }
    const [type, raid, target, progress] = goalColumns(first);
    db.query(
      `INSERT INTO quests (player_id, ${QUEST_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (player_id, slot, sequence) DO UPDATE
       SET progress = excluded.progress, alternative_progress = excluded.alternative_progress,
           expires_at = excluded.expires_at, completed_at = excluded.completed_at`,
    ).run(
      playerId,
      quest.slot,
      quest.sequence,
      quest.templateId,
      type,
      raid,
      target,
      quest.reward.leaf,
      quest.reward.xp,
      progress,
      quest.startedAt,
      quest.expiresAt,
      quest.completedAt,
      ...goalColumns(second),
    );
  }
  for (const quest of step.completed) {
    const draft = draftEntry({
      kind: "earn",
      playerId,
      amount: leaf(quest.reward.leaf),
      xp: quest.reward.xp,
      source: "quest",
      idempotencyKey: `quest:${playerId}:${quest.slot}:${quest.sequence}`,
    });
    insertEntry(db, draft, now);
  }
}

/** A player's quests finished at or after a moment, newest first. */
export function listCompletedSince(db: Database, playerId: PlayerId, since: number): Quest[] {
  return db
    .query<QuestRow, [string, number]>(
      `SELECT ${QUEST_COLUMNS} FROM quests
       WHERE player_id = ? AND completed_at >= ?
       ORDER BY completed_at DESC, slot, sequence DESC
       LIMIT 20`,
    )
    .all(playerId, since)
    .map(toQuest);
}
