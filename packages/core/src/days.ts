/**
 * Days and weeks by UTC, as every part of the game counts them: the quests' days and weeks, the
 * report's days, and a game's day turning. A module of its own, so that what uses only these does
 * not use the quests (core's `rulesVersion` follows modules).
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;
/** 1970-01-05 was a Monday, so weeks counted from here start on Mondays. */
const FIRST_MONDAY_MS = 4 * DAY_MS;

/** The UTC day of a moment, as days since 1970. */
export function utcDay(at: number): number {
  return Math.floor(at / DAY_MS);
}

/** The moment the week of `at` began, weeks starting on Mondays, UTC. */
export function utcWeekStart(at: number): number {
  return FIRST_MONDAY_MS + Math.floor((at - FIRST_MONDAY_MS) / WEEK_MS) * WEEK_MS;
}
