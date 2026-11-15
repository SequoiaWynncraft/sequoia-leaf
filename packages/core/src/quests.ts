import { type Activity, type RaidKey } from "./activity.ts";
import type { PlayerId } from "./player.ts";

/**
 * - `daily`: one becomes available each UTC day and they bank up, so a player
 *   who plays every third day loses nothing. There are no streaks.
 * - `weekly`: one per week, Monday to Monday in UTC. It expires when the week ends.
 * - `repeatable`: always one; finishing it unlocks the next.
 */
export const QUEST_SLOTS = ["daily", "weekly", "repeatable"] as const;
export type QuestSlot = (typeof QUEST_SLOTS)[number];

export type QuestObjective =
  /** Complete this many raids: of one kind when `raid` is set, of any kind otherwise. */
  | { readonly type: "raids"; readonly raid?: RaidKey; readonly count: number }
  /** Take part in this many wars. */
  | { readonly type: "wars"; readonly count: number };

export interface QuestReward {
  readonly leaf: number;
  readonly xp: number;
}

/** A quest that can be handed out. The id is stored with every quest made from it, so never reuse one. */
export interface QuestTemplate {
  readonly id: string;
  readonly slot: QuestSlot;
  readonly objective: QuestObjective;
  readonly reward: QuestReward;
}

export interface QuestRules {
  readonly templates: readonly QuestTemplate[];
  /** How many dailies can be banked, counting the one in progress. */
  readonly dailyChargeCap: number;
}

/** A quest handed to a player. `(playerId, slot, sequence)` identifies it. */
export interface Quest {
  readonly slot: QuestSlot;
  /** Counts this player's quests in this slot, starting at 1. */
  readonly sequence: number;
  readonly templateId: string;
  readonly objective: QuestObjective;
  readonly reward: QuestReward;
  readonly progress: number;
  /** Activities from this moment on count toward it. */
  readonly startedAt: number;
  /** Activities from this moment on no longer count. Null for a quest that never expires. */
  readonly expiresAt: number | null;
  readonly completedAt: number | null;
}

/** Everything about one player's quests that the next step depends on. */
export interface QuestBook {
  /** Dailies available to the player, counting the one in progress. */
  readonly dailyCharges: number;
  /** The UTC day, as days since the Unix epoch, of the last charge granted. */
  readonly dailyChargedDay: number;
  /** The most recent quest of each slot, finished or not. */
  readonly latest: { readonly [slot in QuestSlot]?: Quest };
}

export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;
/** 1970-01-05 was a Monday, so weeks counted from here start on Mondays. */
const FIRST_MONDAY_MS = 4 * DAY_MS;

export function utcDay(at: number): number {
  return Math.floor(at / DAY_MS);
}

export function utcWeekStart(at: number): number {
  return FIRST_MONDAY_MS + Math.floor((at - FIRST_MONDAY_MS) / WEEK_MS) * WEEK_MS;
}

/** The book of a player who has never had a quest: one daily is ready on the day they start. */
export function openQuestBook(at: number): QuestBook {
  return { dailyCharges: 1, dailyChargedDay: utcDay(at), latest: {} };
}

export function countsToward(objective: QuestObjective, activity: Activity): boolean {
  if (objective.type === "wars") {
    return activity.kind === "war";
  }
  return activity.kind === "raid" && (objective.raid === undefined || objective.raid === activity.raid);
}

/**
 * Chooses the template for a player's next quest in a slot. The choice
 * depends only on the player and the quest's sequence number, so it is the
 * same however often it is computed, and it differs from player to player.
 * It never repeats the template the player just had when there is another.
 */
export function pickTemplate(
  rules: QuestRules,
  slot: QuestSlot,
  playerId: PlayerId,
  sequence: number,
  previousTemplateId: string | undefined,
): QuestTemplate | undefined {
  const inSlot = rules.templates.filter((template) => template.slot === slot);
  const fresh = inSlot.filter((template) => template.id !== previousTemplateId);
  const candidates = fresh.length > 0 ? fresh : inSlot;
  return candidates[hash(`${playerId}:${slot}:${sequence}`) % candidates.length];
}

/** FNV-1a, a small stable string hash. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

export interface QuestStep {
  readonly book: QuestBook;
  /** Every quest this step handed out or changed, in its new state. */
  readonly written: readonly Quest[];
  /** The quests this step finished. Each pays its reward once. */
  readonly completed: readonly Quest[];
}

/**
 * Brings a book up to a moment in time without any activity: grants the
 * dailies for the days that have passed and hands out a quest for every slot
 * that should have one. Calling it again for the same or an earlier moment
 * changes nothing.
 */
export function refreshQuests(book: QuestBook, playerId: PlayerId, at: number, rules: QuestRules): QuestStep {
  const step = startStep(book, playerId, rules);
  refresh(step, at);
  return finishStep(step);
}

/**
 * Applies one activity: refreshes the book to the activity's time, counts the
 * activity toward every quest it fits, finishes the ones it completes, and
 * hands out their successors. The activity that finishes a quest does not
 * count toward the quest that replaces it.
 */
export function applyActivityToQuests(book: QuestBook, activity: Activity, rules: QuestRules): QuestStep {
  const step = startStep(book, activity.playerId, rules);
  const at = activity.occurredAt;
  refresh(step, at);
  // The quests are fixed before counting, so one handed out below never sees this activity.
  for (const quest of QUEST_SLOTS.map((slot) => step.latest[slot])) {
    if (quest === undefined || quest.completedAt !== null || !countsToward(quest.objective, activity)) {
      continue;
    }
    if (at < quest.startedAt || (quest.expiresAt !== null && at >= quest.expiresAt)) {
      continue;
    }
    const progress = quest.progress + 1;
    if (progress < quest.objective.count) {
      write(step, { ...quest, progress });
      continue;
    }
    const done: Quest = { ...quest, progress, completedAt: at };
    write(step, done);
    step.completed.push(done);
    if (quest.slot === "daily") {
      step.dailyCharges -= 1;
      if (step.dailyCharges > 0) {
        issue(step, "daily", at, null);
      }
    } else if (quest.slot === "repeatable") {
      issue(step, "repeatable", at, null);
    }
    // A finished weekly keeps its slot until the week ends.
  }
  return finishStep(step);
}

interface Step {
  readonly playerId: PlayerId;
  readonly rules: QuestRules;
  dailyCharges: number;
  dailyChargedDay: number;
  readonly latest: { [slot in QuestSlot]?: Quest };
  readonly written: Map<string, Quest>;
  readonly completed: Quest[];
}

function startStep(book: QuestBook, playerId: PlayerId, rules: QuestRules): Step {
  return {
    playerId,
    rules,
    dailyCharges: book.dailyCharges,
    dailyChargedDay: book.dailyChargedDay,
    latest: { ...book.latest },
    written: new Map(),
    completed: [],
  };
}

function finishStep(step: Step): QuestStep {
  return {
    book: { dailyCharges: step.dailyCharges, dailyChargedDay: step.dailyChargedDay, latest: step.latest },
    written: [...step.written.values()],
    completed: step.completed,
  };
}

function refresh(step: Step, at: number): void {
  const day = utcDay(at);
  if (day > step.dailyChargedDay) {
    step.dailyCharges = Math.min(step.rules.dailyChargeCap, step.dailyCharges + (day - step.dailyChargedDay));
    step.dailyChargedDay = day;
  }
  if (step.dailyCharges > 0 && !holdsSlot(step.latest.daily, at)) {
    issue(step, "daily", day * DAY_MS, null);
  }
  if (!holdsSlot(step.latest.weekly, at)) {
    const weekStart = utcWeekStart(at);
    issue(step, "weekly", weekStart, weekStart + WEEK_MS);
  }
  if (!holdsSlot(step.latest.repeatable, at)) {
    issue(step, "repeatable", at, null);
  }
}

/** Whether the slot's latest quest still occupies the slot at this moment. */
function holdsSlot(quest: Quest | undefined, at: number): boolean {
  if (quest === undefined || (quest.expiresAt !== null && at >= quest.expiresAt)) {
    return false;
  }
  // A finished weekly occupies the slot until its week ends; other finished quests free it at once.
  return quest.completedAt === null || quest.slot === "weekly";
}

function issue(step: Step, slot: QuestSlot, startedAt: number, expiresAt: number | null): void {
  const previous = step.latest[slot];
  const sequence = (previous?.sequence ?? 0) + 1;
  const template = pickTemplate(step.rules, slot, step.playerId, sequence, previous?.templateId);
  if (template === undefined) {
    return;
  }
  write(step, {
    slot,
    sequence,
    templateId: template.id,
    objective: template.objective,
    reward: template.reward,
    progress: 0,
    startedAt,
    expiresAt,
    completedAt: null,
  });
}

function write(step: Step, quest: Quest): void {
  step.latest[quest.slot] = quest;
  step.written.set(`${quest.slot}:${quest.sequence}`, quest);
}

/** A short sentence for the quest, such as "Complete 3 NOL raids". */
export function questTitle(objective: QuestObjective): string {
  if (objective.type === "wars") {
    return objective.count === 1 ? "Take part in 1 war" : `Take part in ${objective.count} wars`;
  }
  const kind = objective.raid === undefined ? "" : `${objective.raid.toUpperCase()} `;
  return objective.count === 1 ? `Complete 1 ${kind}raid` : `Complete ${objective.count} ${kind}raids`;
}
