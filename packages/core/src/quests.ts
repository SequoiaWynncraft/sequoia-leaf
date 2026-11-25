import { type Activity, type RaidKey } from "./activity.ts";
import { DAY_MS, utcDay, utcWeekStart, WEEK_MS } from "./days.ts";
import type { PlayerId } from "./player.ts";
import { whole } from "./say.ts";

/**
 * - `daily`: one becomes available each UTC day and they bank up, so a player
 *   who plays every third day loses nothing. There are no streaks.
 * - `weekly`: one per week, Monday to Monday in UTC. It expires when the week ends.
 * - `timed`: the same quest for the whole guild, open for a short window that
 *   comes round every few hours (see {@link TimedQuestRules}). Bigger rewards
 *   for a shorter time.
 * - `repeatable`: always one; finishing it unlocks the next. Only handed out
 *   while the rules have templates for it, which the default rules don't.
 */
export const QUEST_SLOTS = ["daily", "weekly", "timed", "repeatable"] as const;
export type QuestSlot = (typeof QUEST_SLOTS)[number];

export type QuestObjective =
  /** Complete this many raids: of one kind when `raid` is set, of any kind otherwise. */
  | { readonly type: "raids"; readonly raid?: RaidKey; readonly count: number }
  /** Take part in this many wars. */
  | { readonly type: "wars"; readonly count: number }
  /** Take part in raids and wars that together earn the guild this much season rating. */
  | { readonly type: "season_rating"; readonly amount: number };

export interface QuestReward {
  readonly leaf: number;
  readonly xp: number;
}

/** A quest that can be handed out. The id is stored with every quest made from it, so never reuse one. */
export interface QuestTemplate {
  readonly id: string;
  readonly slot: QuestSlot;
  /**
   * The ways to finish the quest, at least one: meeting any of them finishes it.
   * Most quests have a raid goal and a war goal, so raiders and warrers both can.
   */
  readonly objectives: readonly QuestObjective[];
  readonly reward: QuestReward;
}

/** One way to finish a quest, and how far along it is. */
export interface QuestGoal {
  readonly objective: QuestObjective;
  /** From 0 to the objective's target. It never goes past the target. */
  readonly progress: number;
}

export interface QuestRules {
  readonly templates: readonly QuestTemplate[];
  /** How many dailies can be banked, counting the one in progress. */
  readonly dailyChargeCap: number;
  /** When timed quests are open; none are handed out without it. */
  readonly timed?: TimedQuestRules;
  /** Which quests a player can swap for another, and what it costs; none can without it. */
  readonly reroll?: RerollRules;
}

/**
 * Rerolling swaps the quest in progress in a slot for another from the same
 * slot. Each slot has a few free rerolls a UTC day; after those, each one costs
 * Leaf.
 */
export interface RerollRules {
  readonly slots: readonly QuestSlot[];
  /** Rerolls each slot gets free per UTC day. */
  readonly freePerDay: number;
  /** What each further reroll that day costs. */
  readonly leaf: number;
  /**
   * How long after a reroll the quest it replaced still takes a raid or war from before the
   * reroll that is reported late (the backend holds a raid back, and the sync waits for it to
   * settle), in milliseconds.
   */
  readonly heldMs: number;
}

/**
 * Timed quests open on a fixed UTC schedule: one window starts every
 * `everyMs`, counted from midnight, and stays open for `openMs`. No window
 * starts before `firstAt`, so an activity reported late from before timed
 * quests began never earns one.
 */
export interface TimedQuestRules {
  readonly everyMs: number;
  readonly openMs: number;
  readonly firstAt: number;
}

/** One timed quest window: open from `start` until `end`, numbered from the Unix epoch. */
export interface TimedWindow {
  readonly index: number;
  readonly start: number;
  readonly end: number;
}

/** The timed window open at this moment, or undefined between windows. */
export function timedWindowAt(at: number, rules: TimedQuestRules): TimedWindow | undefined {
  const index = Math.floor(at / rules.everyMs);
  const start = index * rules.everyMs;
  return start >= rules.firstAt && at < start + rules.openMs ? { index, start, end: start + rules.openMs } : undefined;
}

/** When the next timed window opens after this moment. */
export function nextTimedWindowAt(at: number, rules: TimedQuestRules): number {
  const first = Math.ceil(rules.firstAt / rules.everyMs) * rules.everyMs;
  return Math.max(first, (Math.floor(at / rules.everyMs) + 1) * rules.everyMs);
}

/**
 * The template for a timed window, the same for everyone. The timed templates
 * take turns in a fixed, shuffled order, so a window never gets the one the
 * window before had while there are two or more; with six windows a day and a
 * different number of templates, each hour of the day sees them all in turn.
 */
export function timedTemplateFor(rules: QuestRules, windowIndex: number): QuestTemplate | undefined {
  const timed = rules.templates
    .filter((template) => template.slot === "timed")
    .toSorted((a, b) => hash(a.id) - hash(b.id) || a.id.localeCompare(b.id));
  if (timed.length === 0) {
    return undefined;
  }
  return timed[((windowIndex % timed.length) + timed.length) % timed.length];
}

/** A quest handed to a player. `(playerId, slot, sequence)` identifies it. */
export interface Quest {
  readonly slot: QuestSlot;
  /** Counts this player's quests in this slot, starting at 1. */
  readonly sequence: number;
  readonly templateId: string;
  /** One goal for each of the template's objectives, in the same order. The first one met finishes the quest. */
  readonly goals: readonly QuestGoal[];
  readonly reward: QuestReward;
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
  /**
   * The quests rerolls replaced lately (within `RerollRules.heldMs`), oldest first: each still
   * takes an activity from its own time that is reported late. None is kept for a book without.
   */
  readonly replaced?: readonly Quest[];
}

/** The book of a player who has never had a quest: one daily is ready on the day they start. */
export function openQuestBook(at: number): QuestBook {
  return { dailyCharges: 1, dailyChargedDay: utcDay(at), latest: {} };
}

/** The progress at which an objective is met. */
export function objectiveTarget(objective: QuestObjective): number {
  return objective.type === "season_rating" ? objective.amount : objective.count;
}

/** Whether a goal's objective is met. */
export function goalMet(goal: QuestGoal): boolean {
  return goal.progress >= objectiveTarget(goal.objective);
}

/**
 * The goal nearest to being met, by the share of its target reached; the
 * earlier one on a tie. It is the one to show where there is room for only one.
 */
export function leadingGoal(quest: Quest): QuestGoal {
  const share = (goal: QuestGoal) => goal.progress / objectiveTarget(goal.objective);
  const [first, ...rest] = quest.goals;
  if (first === undefined) {
    throw new Error(`Quest ${quest.slot}:${quest.sequence} has no goal`);
  }
  return rest.reduce((leading, goal) => (share(goal) > share(leading) ? goal : leading), first);
}

/**
 * How far one activity moves an objective: 1 for a raid or war that is being
 * counted, the season rating it earned when that is being added up, and 0 for
 * an activity that does not count.
 */
export function progressFrom(objective: QuestObjective, activity: Activity): number {
  switch (objective.type) {
    case "raids":
      return activity.kind === "raid" && (objective.raid === undefined || objective.raid === activity.raid) ? 1 : 0;
    case "wars":
      return activity.kind === "war" ? 1 : 0;
    case "season_rating":
      return Number.isFinite(activity.seasonRating) ? Math.max(0, Math.floor(activity.seasonRating)) : 0;
  }
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
  /**
   * The rerolls this step undid: those of a slot from a quest's `sequence` on, after an activity
   * reported late finished the quest they replaced. What each cost is given back.
   */
  readonly undone?: readonly { readonly slot: QuestSlot; readonly from: number }[];
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
 *
 * An activity from before a slot's quest began, reported late, counts toward
 * the quest a reroll replaced, if that one was open then and nothing in the
 * slot has finished since (`QuestBook.replaced`). Should it finish it, the
 * reroll is undone (`QuestStep.undone`): the quest the reroll gave stands only
 * where the slot would have handed it out anyway, a daily with a banked daily
 * left; otherwise it is withdrawn, ending where it began, and a finished
 * weekly keeps its week.
 */
export function applyActivityToQuests(book: QuestBook, activity: Activity, rules: QuestRules): QuestStep {
  const step = startStep(book, activity.playerId, rules);
  const at = activity.occurredAt;
  refresh(step, at);
  // The quests are fixed before counting, so one handed out below never sees this activity.
  for (const latest of QUEST_SLOTS.map((slot) => step.latest[slot])) {
    if (latest === undefined || latest.completedAt !== null) {
      continue;
    }
    const replaced = at < latest.startedAt ? openAt(step.replaced, latest.slot, at) : undefined;
    const quest = replaced ?? latest;
    if (at < quest.startedAt || (quest.expiresAt !== null && at >= quest.expiresAt)) {
      continue;
    }
    const gains = quest.goals.map((goal) => progressFrom(goal.objective, activity));
    if (gains.every((gained) => gained === 0)) {
      continue;
    }
    const goals = quest.goals.map((goal, index) => ({
      objective: goal.objective,
      progress: Math.min(objectiveTarget(goal.objective), goal.progress + (gains[index] ?? 0)),
    }));
    if (!goals.some(goalMet)) {
      keep(step, { ...quest, goals });
      continue;
    }
    const done: Quest = { ...quest, goals, completedAt: at };
    keep(step, done);
    step.completed.push(done);
    if (replaced !== undefined) {
      undo(step, latest, done);
      continue;
    }
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
  /** The quests rerolls replaced lately, as this step leaves them. */
  replaced: readonly Quest[];
  readonly written: Map<string, Quest>;
  readonly completed: Quest[];
  readonly undone: { readonly slot: QuestSlot; readonly from: number }[];
}

function startStep(book: QuestBook, playerId: PlayerId, rules: QuestRules): Step {
  return {
    playerId,
    rules,
    dailyCharges: book.dailyCharges,
    dailyChargedDay: book.dailyChargedDay,
    latest: { ...book.latest },
    replaced: book.replaced ?? [],
    written: new Map(),
    completed: [],
    undone: [],
  };
}

function finishStep(step: Step): QuestStep {
  return {
    book: {
      dailyCharges: step.dailyCharges,
      dailyChargedDay: step.dailyChargedDay,
      latest: step.latest,
      replaced: step.replaced,
    },
    written: [...step.written.values()],
    completed: step.completed,
    undone: step.undone,
  };
}

/** The quest a reroll replaced in a slot that was open at `at`, unfinished, if it is still held. */
function openAt(replaced: readonly Quest[], slot: QuestSlot, at: number): Quest | undefined {
  return replaced.find(
    (q) => q.slot === slot && q.completedAt === null && q.startedAt <= at && q.expiresAt !== null && at < q.expiresAt,
  );
}

/** Writes a quest a reroll replaced, changed, where it is kept; or the slot's latest. */
function keep(step: Step, quest: Quest): void {
  if (step.latest[quest.slot]?.sequence === quest.sequence) {
    write(step, quest);
    return;
  }
  step.replaced = step.replaced.map((q) => (q.slot === quest.slot && q.sequence === quest.sequence ? quest : q));
  step.written.set(`${quest.slot}:${quest.sequence}`, quest);
}

/**
 * A quest a reroll replaced (`done`) has just finished, on an activity reported late: the rerolls
 * of its slot from it on are undone. Its finishing uses a banked daily, as finishing does; the
 * quest the slot holds now (`latest`, the rerolls' last) stands as the next daily while one is
 * left, and is otherwise withdrawn: ended where it began, so that it never held the slot.
 */
function undo(step: Step, latest: Quest, done: Quest): void {
  step.undone.push({ slot: done.slot, from: done.sequence });
  if (done.slot === "daily") {
    step.dailyCharges = Math.max(0, step.dailyCharges - 1);
    if (step.dailyCharges > 0) return;
  }
  write(step, { ...latest, expiresAt: latest.startedAt });
}

function refresh(step: Step, at: number): void {
  // A slot the rules hand nothing out in is off. A quest still open there, however
  // it got there, ends where it began, so nothing counts toward it or shows it.
  for (const slot of QUEST_SLOTS) {
    const quest = step.latest[slot];
    if (
      quest?.completedAt === null &&
      holdsSlot(quest, quest.startedAt) &&
      !step.rules.templates.some((template) => template.slot === slot)
    ) {
      write(step, { ...quest, expiresAt: quest.startedAt });
    }
  }
  const day = utcDay(at);
  if (day > step.dailyChargedDay) {
    step.dailyCharges = Math.min(step.rules.dailyChargeCap, step.dailyCharges + (day - step.dailyChargedDay));
    step.dailyChargedDay = day;
  }
  if (step.dailyCharges > 0 && !holdsSlot(step.latest.daily, at)) {
    issue(step, "daily", day * DAY_MS, null);
  }
  // One weekly a week: a week whose weekly was withdrawn, a quest it replaced having finished, gets no other.
  const weekStart = utcWeekStart(at);
  const weekly = step.latest.weekly;
  if (!holdsSlot(weekly, at) && !(weekly !== undefined && withdrawn(weekly) && weekly.startedAt >= weekStart)) {
    issue(step, "weekly", weekStart, weekStart + WEEK_MS);
  }
  const window = step.rules.timed === undefined ? undefined : timedWindowAt(at, step.rules.timed);
  if (window !== undefined && !holdsSlot(step.latest.timed, at)) {
    issue(step, "timed", window.start, window.end, timedTemplateFor(step.rules, window.index));
  }
  if (!holdsSlot(step.latest.repeatable, at)) {
    issue(step, "repeatable", at, null);
  }
}

/**
 * The quests a player sees at this moment, in slot order: the one in progress
 * for each slot, and a finished weekly or timed quest until it ends.
 */
export function currentQuests(book: QuestBook, at: number): Quest[] {
  return QUEST_SLOTS.map((slot) => book.latest[slot]).filter(
    (quest): quest is Quest => quest !== undefined && holdsSlot(quest, at),
  );
}

/**
 * What rerolling a quest costs, or null when it can't be rerolled: its slot
 * doesn't allow it, it is finished, or the slot has no other quest to swap it
 * for. `rerollsToday` is how many times the player rerolled that slot this UTC day.
 */
export function rerollCost(quest: Quest, rerollsToday: number, rules: QuestRules): number | null {
  const reroll = rules.reroll;
  if (
    reroll === undefined ||
    !reroll.slots.includes(quest.slot) ||
    quest.completedAt !== null ||
    !rules.templates.some((template) => template.slot === quest.slot && template.id !== quest.templateId)
  ) {
    return null;
  }
  return rerollsToday < reroll.freePerDay ? 0 : reroll.leaf;
}

export type RerollStep =
  | (QuestStep & {
      readonly status: "rerolled";
      /** The quest swapped out, now ended. */
      readonly replaced: Quest;
      /** The quest that took its place. */
      readonly quest: Quest;
      /** The Leaf it costs. */
      readonly cost: number;
    })
  | {
      readonly status: "refused";
      /**
       * - `not_current`: the quest asked for is not the one in its slot any more;
       *   it was finished, rerolled or replaced since the player saw it.
       * - `not_rerollable`: see {@link rerollCost}.
       */
      readonly reason: "not_current" | "not_rerollable";
    };

/**
 * Swaps the quest in progress in a slot for another from the same slot, as the
 * player asked at `at`. `sequence` names the quest they saw, so a request sent
 * twice swaps once. The slot is brought up to `at` first, as
 * {@link refreshQuests} does, and the step includes what that wrote.
 *
 * Only that slot changes. The others stay as they were, so an activity from
 * before `at` that is counted late still reaches them: a daily rerolled just
 * after Monday leaves last week's weekly to take Sunday's raids.
 *
 * The old quest ends at `at` and keeps the progress it had. The new one is a
 * different template, counts activities from `at` on, and ends when the old one
 * would have. A rerolled daily is the same banked daily: none is granted or used up.
 */
export function rerollQuest(
  book: QuestBook,
  playerId: PlayerId,
  slot: QuestSlot,
  sequence: number,
  at: number,
  rerollsToday: number,
  rules: QuestRules,
): RerollStep {
  const step = startStep(book, playerId, rules);
  refresh(step, at);
  const current = step.latest[slot];
  if (current === undefined || current.sequence !== sequence || !holdsSlot(current, at)) {
    return { status: "refused", reason: "not_current" };
  }
  const cost = rerollCost(current, rerollsToday, rules);
  if (cost === null) {
    return { status: "refused", reason: "not_rerollable" };
  }
  const replaced: Quest = { ...current, expiresAt: at };
  write(step, replaced);
  issue(step, slot, at, current.expiresAt);
  const quest = step.latest[slot];
  if (quest === undefined || quest.sequence !== sequence + 1) {
    throw new Error(`Rerolling ${slot}:${sequence} handed out no quest`);
  }
  // The daily charges belong to the daily slot, so only a daily's reroll moves them on.
  const daily = slot === "daily" ? step : book;
  return {
    status: "rerolled",
    book: {
      dailyCharges: daily.dailyCharges,
      dailyChargedDay: daily.dailyChargedDay,
      latest: { ...book.latest, [slot]: quest },
    },
    written: [...step.written.values()].filter((written) => written.slot === slot),
    completed: [],
    replaced,
    quest,
    cost,
  };
}

/** When the next daily becomes available, or null while the player holds as many as can be banked. */
export function nextDailyChargeAt(book: QuestBook, rules: QuestRules): number | null {
  return book.dailyCharges >= rules.dailyChargeCap ? null : (book.dailyChargedDay + 1) * DAY_MS;
}

/** Whether a quest ended where it began: it never held its slot (withdrawn, or of a slot the rules gave up). */
const withdrawn = (quest: Quest): boolean => quest.expiresAt !== null && quest.expiresAt <= quest.startedAt;

/** Whether the slot's latest quest still occupies the slot at this moment. */
function holdsSlot(quest: Quest | undefined, at: number): boolean {
  // A quest that expires where it began never held its slot: it was retired.
  if (
    quest === undefined ||
    (quest.expiresAt !== null && (at >= quest.expiresAt || quest.expiresAt <= quest.startedAt))
  ) {
    return false;
  }
  // A finished weekly or timed quest occupies the slot until it ends; other finished quests free it at once.
  return quest.completedAt === null || quest.slot === "weekly" || quest.slot === "timed";
}

function issue(step: Step, slot: QuestSlot, startedAt: number, expiresAt: number | null, shared?: QuestTemplate): void {
  const previous = step.latest[slot];
  const sequence = (previous?.sequence ?? 0) + 1;
  const template = shared ?? pickTemplate(step.rules, slot, step.playerId, sequence, previous?.templateId);
  if (template === undefined) {
    return;
  }
  write(step, {
    slot,
    sequence,
    templateId: template.id,
    goals: template.objectives.map((objective) => ({ objective, progress: 0 })),
    reward: template.reward,
    startedAt,
    expiresAt,
    completedAt: null,
  });
}

function write(step: Step, quest: Quest): void {
  step.latest[quest.slot] = quest;
  step.written.set(`${quest.slot}:${quest.sequence}`, quest);
}

/** A short sentence for one objective, such as "Complete 3 NOL raids". */
export function objectiveTitle(objective: QuestObjective): string {
  if (objective.type === "season_rating") {
    return `Earn ${amountOf(objective)}`;
  }
  return `${objective.type === "wars" ? "Take part in" : "Complete"} ${amountOf(objective)}`;
}

/** A short sentence for a quest, such as "Complete 3 NOL raids or 9 wars". */
export function questTitle(objectives: readonly QuestObjective[]): string {
  const [first, ...rest] = objectives;
  if (first === undefined) {
    return "";
  }
  return [objectiveTitle(first), ...rest.map(amountOf)].join(" or ");
}

/** What an objective asks for, without the verb: "3 NOL raids", "1 war", "1,000 season rating". */
function amountOf(objective: QuestObjective): string {
  switch (objective.type) {
    case "season_rating":
      return `${whole(objective.amount)} season rating`;
    case "wars":
      return objective.count === 1 ? "1 war" : `${objective.count} wars`;
    case "raids": {
      const kind = objective.raid === undefined ? "" : `${objective.raid.toUpperCase()} `;
      return objective.count === 1 ? `1 ${kind}raid` : `${objective.count} ${kind}raids`;
    }
  }
}
