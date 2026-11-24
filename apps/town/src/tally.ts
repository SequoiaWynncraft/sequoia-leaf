/**
 * The Tally as the page has it: a board as Leaf sends it (`GET /v1/game/tally/{board}/{period}`),
 * read back; how a board writes its score; and how a board is laid out: the top three on the
 * podium, the rest of the ten under it, and the member's own place at the foot when they are not
 * among them; and whether the member has opened it yet. No page in it: `tallyui.ts` draws it.
 */

import type { Period, TallyUnit } from "@sequoia-leaf/core";
import { keepText, keptText } from "@sequoia-leaf/kit/keep.ts";
import { isRecord } from "@sequoia-leaf/kit/net.ts";
import { duration } from "@sequoia-leaf/kit/person.ts";

/** Kept in the browser once the member has opened the Tally. */
export const SEEN = "town.tally.seen";

/** Whether the member has yet to open the Tally: its board in town carries a mark until then. */
export const tallyNew = (): boolean => keptText(SEEN) !== "1";

/** The member opens the Tally: says whether it is the first time. */
export function sawTally(): boolean {
  const first = tallyNew();
  if (first) keepText(SEEN, "1");
  return first;
}

/** Somebody on a board: their place (a tie shares one), who they are, and their score. */
export interface Row {
  readonly place: number;
  readonly id: string;
  readonly name: string;
  readonly guest: boolean;
  readonly score: number;
  readonly you: boolean;
}

/** A place on a board, and the score it is for. */
export interface Place {
  readonly place: number;
  readonly score: number;
}

/** A board for a span: the week it is of (null for all time), its top ten, and the member's own place, if they are on it. */
export interface Board {
  readonly board: string;
  readonly period: Period;
  readonly from: string | null;
  readonly top: readonly Row[];
  readonly you: Place | null;
}

const whole = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

function placeOf(v: unknown): Place | null {
  return isRecord(v) && whole(v.place) && whole(v.score) ? { place: v.place, score: v.score } : null;
}

function rowOf(v: unknown): Row | null {
  const place = placeOf(v);
  if (!place || !isRecord(v) || typeof v.id !== "string" || typeof v.name !== "string") return null;
  return { ...place, id: v.id, name: v.name, guest: v.guest === true, you: v.you === true };
}

/** A board from Leaf's answer, or null for one that makes no sense. */
export function readBoard(v: unknown): Board | null {
  if (!isRecord(v) || typeof v.board !== "string" || !Array.isArray(v.top)) return null;
  const period = v.period === "week" || v.period === "all" ? v.period : null;
  const from = typeof v.from === "string" || v.from === null ? v.from : undefined;
  const top = v.top.map(rowOf);
  const you = v.you === null ? null : placeOf(v.you);
  if (period === null || from === undefined || (v.you !== null && you === null)) return null;
  const rows = top.filter((r) => r !== null);
  return rows.length === top.length ? { board: v.board, period, from, top: rows, you } : null;
}

/** A score as its board writes it: a count or an amount with its thousands, a time played, a level. */
export function scoreText(unit: TallyUnit, score: number): string {
  if (unit === "time") return duration(score);
  if (unit === "level") return `Level ${score}`;
  return score.toLocaleString("en-US");
}

/** A board laid out: up to three on the podium, the rest of the top under it, and the member's own place when it is not among them. */
export function laidOut(board: Board): { podium: readonly Row[]; rest: readonly Row[]; own: Place | null } {
  return {
    podium: board.top.slice(0, 3),
    rest: board.top.slice(3),
    own: board.top.some((r) => r.you) ? null : board.you,
  };
}
