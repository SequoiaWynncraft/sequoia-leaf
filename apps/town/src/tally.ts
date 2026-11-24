/**
 * The Tally as the page has it: a board as Leaf sends it (`GET /v1/game/tally/{board}/{period}`),
 * read back; how a board writes its score; and how a board is laid out: the top three on the
 * podium, the rest of the ten under it, and the member's own place at the foot when they are not
 * among them; whether the member has opened it yet; and which board shows, asked of Leaf, with the
 * notes it rises to. No page in it: `tallyui.ts` draws it.
 */

import { type Period, TALLY_KEPT_MS, type TallyBoard, tallyPath, type TallyUnit } from "@sequoia-leaf/core";
import { keepText, keptText } from "@sequoia-leaf/kit/keep.ts";
import { isRecord } from "@sequoia-leaf/kit/net.ts";
import { duration } from "@sequoia-leaf/kit/person.ts";
import type { Scope } from "@sequoia-leaf/kit/scope.ts";

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

/** A note as a board rises: when, in milliseconds from the start, and what it plays. */
export type Note = readonly [ms: number, play: () => void];

/** What Leaf answered for a board and span, and when: the board, or that it could not be read. */
export interface Answer {
  readonly at: number;
  readonly board: Board | "unread";
}

/** What the panel shows of the board and span chosen: Leaf being asked, that it could not be read, or the board. */
export type Shown =
  | { readonly at: "asking"; readonly of: TallyBoard }
  | { readonly at: "unread"; readonly of: TallyBoard; readonly again: () => void }
  | { readonly at: "board"; readonly of: TallyBoard; readonly board: Board; readonly rise: boolean };

/** What the boards need of the page: Leaf's board at a path (null for none it can read), and to draw what shows, giving back the notes of a board rising. */
export interface TallyPage {
  ask(path: string): Promise<Board | null>;
  draw(shown: Shown): readonly Note[];
}

/** The board and span the panel shows. */
export interface TallyBoards {
  /** Shows a board for a span: at once, as its board if Leaf's answer is kept, or as being asked. */
  show(of: TallyBoard, period: Period): void;
  /** Asks Leaf again for the board shown, if its answer is older than `TALLY_KEPT_MS`. */
  again(): void;
  /** Draws the board shown again, without rising: the faces on it have come. */
  redraw(): void;
}

/** A board and span shown, in a scope of its own, and whether a board has risen in it yet. */
interface View {
  readonly of: TallyBoard;
  readonly path: string;
  readonly scope: Scope;
  risen: boolean;
}

/**
 * One board and span shown at a time, each in a scope of its own, held by `life` (the panel).
 * Showing another closes the one before, and the notes of its rising with it, so nothing of it
 * plays or draws after. An answer draws only in its own board's view, and only when it differs from
 * what was kept; the first board a view draws rises. `answers` outlives the panel, so a board shown
 * again shows at once.
 */
export function tallyBoards(life: Scope, answers: Map<string, Answer>, page: TallyPage): TallyBoards {
  let view: View | null = null;
  const asking = new Set<string>();
  const shown = (): View | null => (view === null || view.scope.closed ? null : view);
  const draw = (v: View): void => {
    const got = answers.get(v.path)?.board;
    if (got === undefined) page.draw({ at: "asking", of: v.of });
    else if (got === "unread") page.draw({ at: "unread", of: v.of, again: () => retry(v) });
    else {
      for (const [ms, play] of page.draw({ at: "board", of: v.of, board: got, rise: !v.risen }))
        v.scope.after(ms, play);
      v.risen = true;
    }
  };
  const ask = async (v: View): Promise<void> => {
    const had = answers.get(v.path);
    if ((had && Date.now() - had.at < TALLY_KEPT_MS) || asking.has(v.path)) return;
    asking.add(v.path);
    const board = (await page.ask(v.path)) ?? "unread";
    asking.delete(v.path);
    const was = JSON.stringify(answers.get(v.path)?.board);
    answers.set(v.path, { at: Date.now(), board });
    const now = shown();
    if (now?.path === v.path && JSON.stringify(board) !== was) draw(now);
  };
  const retry = (v: View): void => {
    if (shown() !== v) return;
    answers.delete(v.path);
    draw(v);
    void ask(v);
  };
  return {
    show(of, period) {
      const path = tallyPath(of.id, period);
      if (shown()?.path === path) return;
      view?.scope.close();
      const v: View = { of, path, scope: life.child(), risen: false };
      view = v;
      draw(v);
      void ask(v);
    },
    again() {
      const v = shown();
      if (v) void ask(v);
    },
    redraw() {
      const v = shown();
      if (v) draw(v);
    },
  };
}
