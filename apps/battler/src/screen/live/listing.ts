/**
 * What the Versus card knows and asks of Leaf, apart from drawing it (`tables.ts` draws it): the
 * tables open to sit at, the member's record, their own sitting followed (its line, `seated.ts`),
 * and opening, sitting down, starting and leaving.
 *
 * The list is read every 2 seconds while the card is up and the member sits nowhere. The first read,
 * which gives a member who sits at a table their sitting back, is tried again on the kit's timer
 * until Leaf answers it, whether or not the card is up. Whatever was asked of Leaf before the
 * member took up or let go of a sitting (`T.gen` moves on) is not acted on when it answers: a list
 * read answered after Leave cannot follow the table just left again.
 */
import { ask, backoff, isRecord } from "@sequoia-leaf/kit/net.ts";
import { RETRY } from "@sequoia-leaf/kit/play.ts";
import type { Scope } from "@sequoia-leaf/kit/scope.ts";

import type { TablesRecord } from "../ui/modes.ts";
import { type Line, openLine } from "./line.ts";
import { refusalWords } from "./reads.ts";
import { doneWithTable, liveLine, onDone, takeUp } from "./seated.ts";

/** A table open to sit at, as Leaf lists it. */
export interface Listed {
  readonly id: string;
  readonly by: string;
  readonly sat: number;
}

export const T: {
  scope: Scope | null;
  me: { id: string; name: string } | null;
  redraw: () => void;
  open: readonly Listed[] | null;
  record: TablesRecord | null;
  recordAt: number;
  /** Why the last thing asked was not done, said under the buttons. */
  why: string | null;
  /** Leaving a started table is asked first. */
  leaving: boolean;
  asking: boolean;
  /** Moves on whenever the member takes up or lets go of a sitting: an answer asked for before it is not acted on. */
  gen: number;
} = {
  scope: null,
  me: null,
  redraw: () => undefined,
  open: null,
  record: null,
  recordAt: -Infinity,
  why: null,
  leaving: false,
  asking: false,
  gen: 0,
};

const RECORD_EVERY = 60_000;
const LIST_EVERY = 2000;

/** The list Leaf answers, and the member's own sitting. */
function readListed(body: unknown): { open: Listed[]; yours: string | null } | null {
  if (!isRecord(body) || !Array.isArray(body.open)) return null;
  const open = body.open.flatMap((t): Listed[] =>
    isRecord(t) &&
    typeof t.id === "string" &&
    isRecord(t.by) &&
    typeof t.by.name === "string" &&
    typeof t.sat === "number"
      ? [{ id: t.id, by: t.by.name, sat: t.sat }]
      : [],
  );
  return { open, yours: typeof body.yours === "string" ? body.yours : null };
}

/**
 * Reads the list, and follows the member's own sitting when they have one and the page does not.
 * Says whether it is done: Leaf answered, and the member's own sitting, if they have one, was read.
 */
export async function readList(): Promise<boolean> {
  const asked = T.gen;
  const answer = await ask("/v1/game/sittings");
  const listed = answer.status === 200 ? readListed(answer.body) : null;
  if (!listed) return false;
  // Asked before the member took up or let go of a sitting: it is old news.
  if (asked !== T.gen) return true;
  const before = JSON.stringify(T.open);
  T.open = listed.open;
  // Their own table not read (no answer, or trouble) is not done: the first read is tried again for it.
  const restored = listed.yours && !liveLine() ? (await follow(listed.yours)) !== null : true;
  if (JSON.stringify(T.open) !== before) T.redraw();
  return restored;
}

async function readRecord(): Promise<void> {
  T.recordAt = Date.now();
  const answer = await ask("/v1/game/sittings/record");
  const b = answer.body;
  if (answer.status !== 200 || !isRecord(b)) return;
  const { played, won, top_four: four } = b;
  if (typeof played !== "number" || typeof won !== "number" || typeof four !== "number") return;
  T.record = { played, won, four };
  T.redraw();
}
/** Reads the member's record again when it is a minute old, or was let go. */
export function recordIfOld(): void {
  if (Date.now() - T.recordAt >= RECORD_EVERY) void readRecord();
}

/** Takes up a sitting from Leaf's answer for it, asked when `T.gen` was `asked`: not if the member took up or let go of one since. */
function lineFrom(id: string, body: unknown, asked: number): Line | null {
  if (asked !== T.gen || !T.scope || !T.me) return null;
  const line = openLine(T.scope, id, T.me.id, body);
  if (!line) return null;
  takeUp(line);
  T.gen++;
  return line;
}

/** Follows the member's own sitting, as Leaf has it: the line to it, and the front page drawn again. */
async function follow(id: string): Promise<Line | null> {
  const asked = T.gen;
  const answer = await ask(`/v1/game/sittings/${id}`);
  const line = answer.status === 200 ? lineFrom(id, answer.body, asked) : null;
  T.redraw();
  return line;
}

/** Asks something of Leaf for the card, one thing at a time, and says why when it was not done. */
async function asking(what: () => Promise<string | null>): Promise<void> {
  if (T.asking) return;
  T.asking = true;
  T.why = null;
  try {
    T.why = await what();
  } finally {
    T.asking = false;
    T.redraw();
  }
}

/** Opens a table, with the member sat at it. */
export function openTable(): Promise<void> {
  return asking(async () => {
    const asked = T.gen;
    const answer = await ask("/v1/game/sittings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player: T.me?.id }),
    });
    if (answer.status === 200 && isRecord(answer.body) && typeof answer.body.id === "string") {
      return lineFrom(answer.body.id, answer.body, asked) ? null : "That table could not be read.";
    }
    return isRecord(answer.body) && typeof answer.body.message === "string"
      ? `${answer.body.message}.`
      : "Leaf did not answer. Try again.";
  });
}

/** Sits down at an open table. */
export function sitAt(id: string): Promise<void> {
  return asking(async () => {
    const line = await follow(id);
    if (!line) return "That table is gone.";
    const answer = await line.send({ do: "sit" });
    if (!("refused" in answer)) return null;
    doneWithTable();
    return refusalWords(answer.refused, answer.why);
  });
}

/** A command of the member's at their sitting, from the card; `then`, once Leaf has done it. */
export function command(c: { do: "start" } | { do: "leave" }, then: () => void = () => undefined): Promise<void> {
  return asking(async () => {
    const line = liveLine();
    if (!line) return null;
    const answer = await line.send(c);
    if ("refused" in answer) return refusalWords(answer.refused, answer.why);
    then();
    return null;
  });
}

/**
 * Leaves the member's sitting: before it starts the seat is free again, after it they go out. Leaf
 * answering that they have no seat there (they left in another tab) is what was asked: it is let go.
 */
export function leave(): Promise<void> {
  return asking(async () => {
    const line = liveLine();
    if (!line) return null;
    const answer = await line.send({ do: "leave" });
    if ("refused" in answer && answer.refused !== "not_seated") return refusalWords(answer.refused, answer.why);
    doneWithTable();
    return null;
  });
}

/** The member's record at the tables, for the card's board. */
export const tablesRecord = (): TablesRecord | null => T.record;

/** The first read of the list, again on the kit's timer (`RETRY`) until it is done: Leaf answered it, and the member's own table was read. */
async function firstRead(tries = 0): Promise<void> {
  if (await readList()) return;
  T.scope?.after(backoff(RETRY, tries), () => void firstRead(tries + 1));
}

/** Who the member is and how to draw the card again; and, done with a table, the list again with why. */
export function knowTables(scope: Scope, me: { id: string; name: string }, redraw: () => void): void {
  T.scope = scope;
  T.me = me;
  T.redraw = redraw;
  // Done with a table: the list again, and why when the page says so; a table over has a place in the record, read again.
  onDone((why) => {
    T.gen++;
    T.recordAt = -Infinity;
    T.leaving = false;
    if (why !== null) T.why = why;
    T.redraw();
  });
}

/** Starts following the live tables: the member's own sitting, if they are at one, and the list while the card is up (`shown`). */
export function followTables(
  scope: Scope,
  me: { id: string; name: string },
  redraw: () => void,
  shown: () => boolean,
): void {
  knowTables(scope, me, redraw);
  void firstRead();
  scope.every(LIST_EVERY, () => {
    if (!liveLine() && shown()) void readList();
  });
}
