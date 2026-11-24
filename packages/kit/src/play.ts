/**
 * A game played on Leaf, from the page's side. Leaf owns the game's state; the page holds a copy
 * to draw from and sends commands.
 *
 * - `openPlay(game, reader, { player })` fetches the state; `player` is who the page believes it
 *   is, sent with every batch. A page whose rules are older than Leaf's (the state will not read)
 *   loads again, and so does one Leaf answers `not_you` (signed in as someone else since it
 *   opened): nothing more is sent.
 * - With `of`, it opens that player's state as a visitor is given it (`visitPath`): `send` is
 *   refused `visiting` at once and sends nothing, and `refresh` reads it again. Nothing to visit
 *   there (no such state, or a game that cannot be visited) is the trouble `nothing`.
 * - `send(command, predict)` gives the command an id, queues it, and returns at once, with a promise
 *   of Leaf's answer for it. Commands go to Leaf in order, one request at a time, as many as are
 *   waiting in each (up to 32); after a network failure, or Leaf having trouble or asking to slow
 *   down, the same request goes again with the same ids, so nothing is done twice.
 * - `refresh()` asks Leaf for the state again, one question at a time: asked again meanwhile, it
 *   gives the one on its way. Its answer is let go if a command was sent meanwhile. With `differs`,
 *   it tells Leaf the tick at which the page found its copy not to be Leaf's. Read again, the state
 *   ends the page for what ends it at the opening (`endOf`): signed out, a state Leaf cannot read, or
 *   nothing to visit; any other failure is let go, for the page to ask again.
 * - `predict`, for a command the shared rules can work out without Leaf, gives the copy after it:
 *   it is shown at once. When Leaf answers, Leaf's state takes the copy's place (with what is still
 *   waiting worked out again on top), and if that is not what the page was showing, the page is
 *   told so it can draw again (`onState`). A refused command is the game's to show.
 * - A game whose page keeps a copy of its own with the same rules may be answered short
 *   (`PlayReader.short`, `Game.answer`): a batch's answer is then not the state, and the page hears
 *   it (`onAnswer`); only a read of the state (`refresh`) takes the copy's place.
 * - During a deploy a call can reach the Leaf before this one, which has no such route (404
 *   `not_found`) or cannot read the state the new one wrote (409 `state_unreadable`): either is asked
 *   again each second for 30 seconds (`NOT_YET`), and only then stops the page, for no server or a
 *   state that does not read, with nothing sent again: the page shows the kit's card for it.
 * - Every request the page waits on is let go at the kit's deadline (`net.ts`), as if Leaf had not
 *   answered: a batch goes again with the same ids, as after any failure (`RETRY`).
 * - As the page is hidden or put away, or the town closes the game (`outside.leaving`), everything
 *   Leaf has not answered is sent at once, in order, in one request that outlives the page
 *   (`flush`), so nothing done before leaving is lost. `close()` puts a play away: what is waiting
 *   is sent so and answered `put_away`, and the play hears the page no more.
 * - Where the play's line to Leaf is (idle, reading, sending, waiting to send again, stopped) is one
 *   value (`Line`), moved only by `stepLine`. Every way of stopping is the one stop: everything
 *   waiting is answered with why, and the page told what it must be (`onTrouble`, or loaded again).
 * - A page in view reads its state after a minute without a call to Leaf (`STILL_HERE`), so its
 *   copy is never long behind Leaf's; and it is read as the page comes back (`outside.wake`), but
 *   for a game answered short, which asks for its own reads. A visit does neither, nor does a page
 *   while `away()` (the town, while a game is open over it). Leaf counts the time played from where
 *   the player is and what they do, not from these (`visits.ts`).
 * - `waitingLook(element, answer)` gives what was asked for the kit's waiting look while Leaf takes
 *   more than a moment to answer.
 *
 * Every request reaches Leaf through `net.ts`, which the tests stand in for.
 */

import { type GameId, MOST_COMMANDS, MOST_FLUSHED, playPath, readBalances, visitPath } from "@sequoia-leaf/core";
import { rulesVersions } from "@sequoia-leaf/core/build/rules.ts" with { type: "macro" };

import { keepText, keptText } from "./keep.ts";
import { ask, type Backoff, backoff, isRecord, outside } from "./net.ts";
import { fromLeaf, owe, settle } from "./purse.ts";

/** Reads what Leaf sends into the game's own types; null for anything these rules could not have made. */
export interface PlayReader<View, Note, Short = never> {
  view(v: unknown): View | null;
  notes(v: unknown): Note[] | null;
  /** For a game Leaf answers short (`Game.answer`): a batch's answer, which is then never the state. */
  short?(v: unknown): Short | null;
}

/** What Leaf answered a command: what it did, or the code it was refused with. */
export type Answer<Note> = { readonly notes: Note[] } | { readonly refused: string };

/** A batch Leaf answered: each command with its answer, and for a game answered short, that answer (none when Leaf would not read the batch). */
export interface Answered<Command, Note, Short> {
  readonly done: readonly { readonly command: Command; readonly answer: Answer<Note> }[];
  readonly short: Short | undefined;
}

/**
 * Why the page cannot play on: signed out; Leaf will not have it (no answer, no such game, not let
 * in); no Leaf with the play service answered in time (`noserver`); the state Leaf keeps for the
 * player does not read (`unreadable`); or, for a visitor, there is nothing of the player's to visit.
 */
export type Trouble = "signedout" | "closed" | "noserver" | "unreadable" | "nothing";

export interface Play<View, Command extends object, Note, Short = never> {
  /** The copy to draw from: Leaf's state, with what is waiting for Leaf worked out on top. */
  readonly state: View;
  /** How many batches had changed the state when Leaf last answered. */
  readonly rev: number;
  /**
   * Sends a command. Returns at once; the promise is Leaf's answer for it. `coins`, the Coins the
   * page has worked out it pays (taking, below nothing), are shown in the purse until Leaf answers.
   */
  send(command: Command, predict?: (copy: View) => View, coins?: number): Promise<Answer<Note>>;
  /** Whether anything sent has not been answered yet. */
  waiting(): boolean;
  /** Whether a command's id is one this page gave (as Leaf tells a room each command's id: core's `did`). */
  owns(id: string): boolean;
  /** Hears each time Leaf's state takes the copy's place; `differs` when it is not what the page was showing. */
  onState(fn: (state: View, differs: boolean) => void): () => void;
  /** Hears each batch Leaf answers, before anything more is sent. */
  onAnswer(fn: (answered: Answered<Command, Note, Short>) => void): () => void;
  /** Hears when the page cannot send any more: signed out, or Leaf will not take it. */
  onTrouble(fn: (why: Trouble) => void): () => void;
  /**
   * Asks Leaf for the state again, when nothing is waiting for it: one question at a time, so asked
   * again meanwhile it gives the one on its way. The answer is let go if a command was sent meanwhile.
   * `differs` is the tick at which the page found its copy not to be Leaf's, for Leaf to log. What
   * ends the page at the opening ends it here too, told to `onTrouble`.
   */
  refresh(differs?: number): Promise<void>;
  /**
   * Sends what Leaf has not answered at once, without waiting for it: for a page about to go. The
   * client does this itself when the page is hidden or put away, and when the town closes a game.
   */
  flush(): void;
  /**
   * Puts the play away: what Leaf has not answered is sent (`flush`) and answered `put_away`, and
   * the play hears the page no more and does nothing after.
   */
  close(): void;
}

/** The most a batch's commands may come to, in characters: Leaf reads a body of at most 16 KiB. */
const MOST_BYTES = 12_000;
/** The most a page going away sends in its one request, in characters: all Leaf reads of a body, less the rest of it. */
const FLUSH_BYTES = 15_500;
/** What a command's id and the punctuation round it add to a body. */
const ID_ROOM = 40;

/** How a batch that failed is sent again: half a second, doubling to ten seconds. */
export const RETRY: Backoff = { first: 500, most: 10_000, jitter: 0.25 };

/** How the Leaf before this one, during a deploy (no play service yet, or a state it cannot read), is waited for: a try each `every` ms, `tries` times. */
export interface NotYet {
  every: number;
  tries: number;
}
/** Each second, for 30 seconds. */
export const NOT_YET: NotYet = { every: 1000, tries: 30 };

/** How long a page in view goes without a call to Leaf before it reads its state, checked every quarter of it. */
export const STILL_HERE = 60_000;

/** The version of each game's rules this page was built with (core's `rulesVersion`), made as it was built. */
const RULES = rulesVersions();

/** How long after loading again for Leaf's rules a page does not load again for the same: a deploy half done may serve the old page a moment longer. */
export const RULES_AGAIN = 30_000;

/**
 * The rules of Leaf's an answer says it was made by, when they are not this page's (an answer that
 * says none is from a Leaf from before it said); null when they are the page's.
 */
function otherRules(game: GameId, body: Record<string, unknown>): string | null {
  return typeof body.rules === "string" && body.rules !== RULES[game] ? body.rules : null;
}

/**
 * The page plays by rules other than Leaf's (`theirs`): it loads again, to be given Leaf's; but not
 * again for the same rules of Leaf's within `RULES_AGAIN`, when it stays as it is. Says whether it
 * loads again.
 */
function loadFor(game: GameId, theirs: string): boolean {
  const key = `play.rules.${game}`;
  const [version, at] = (keptText(key, "tab") ?? "").split(" ");
  if (version === theirs && outside.now() - Number(at) < RULES_AGAIN) return false;
  keepText(key, `${theirs} ${outside.now()}`, "tab");
  outside.reload();
  return true;
}

/** Whether an answer is the 404 of a Leaf that has no play service yet, rather than one about the game. */
const notYet = (reply: { status: number; body: unknown }): boolean =>
  reply.status === 404 && isRecord(reply.body) && reply.body.code === "not_found";
/** Whether an answer says the state Leaf keeps does not read. */
const unreadable = (reply: { status: number; body: unknown }): boolean =>
  reply.status === 409 && isRecord(reply.body) && reply.body.code === "state_unreadable";
/** What a read of the state says ends the page: signed out, a state Leaf cannot read, or nothing to visit; or nothing. */
function endOf(reply: { status: number; body: unknown }): Trouble | null {
  if (reply.status === 401) return "signedout";
  if (unreadable(reply)) return "unreadable";
  return reply.status === 404 && isRecord(reply.body) && reply.body.code === "nothing_to_visit" ? "nothing" : null;
}

/** Why a play sends nothing more: a trouble its page is told of, signed in as somebody else or rules older than Leaf's (the page loads again), or the page put it away (`close`). */
export type Stopped = Trouble | "not_you" | "outdated" | "put_away";

/** A command for Leaf: its id, what it is, what the page shows it doing, its size as sent, and who waits for its answer. */
interface Pending<View, Command, Note> {
  readonly id: string;
  readonly command: Command;
  readonly predict: ((copy: View) => View) | undefined;
  readonly size: number;
  readonly answer: (a: Answer<Note>) => void;
}

/**
 * Where a play's line to Leaf is, moved only by `stepLine`:
 * - `idle`: nothing on its way;
 * - `reading`: Leaf's state asked for again (`refresh`), and nothing sent since (`done` when it has come);
 * - `sending`: a batch on its way, and the commands queued behind it;
 * - `waiting`: the batch failed `tries` times, and goes again after a wait (`RETRY`);
 * - `stopped`: nothing more is sent, for `why`; nothing is queued.
 */
export type Line<P> =
  | { readonly at: "idle" }
  | { readonly at: "reading"; readonly done: Promise<void> }
  | {
      readonly at: "sending" | "waiting";
      readonly batch: readonly P[];
      readonly queue: readonly P[];
      readonly tries: number;
    }
  | { readonly at: "stopped"; readonly why: Stopped };

/** What moves a line on: a command sent, the state asked for, the request on its way answered or failed, its wait over, or a stop. */
export type LineEvent<P> =
  | { readonly do: "send"; readonly p: P }
  | { readonly do: "read"; readonly done: Promise<void> }
  | { readonly do: "answered" }
  | { readonly do: "failed" }
  | { readonly do: "again" }
  | { readonly do: "stop"; readonly why: Stopped };

/**
 * How many from the front of a line of commands one request holds: `MOST_COMMANDS`, and no more than
 * `MOST_BYTES` of them, so that a few long ones together do not make a body Leaf will not read.
 * Always at least the first.
 */
export function fitting(line: readonly { readonly size: number }[], most = MOST_COMMANDS, bytes = MOST_BYTES): number {
  let n = 0;
  let size = 0;
  for (const p of line) {
    size += p.size;
    if (n > 0 && (n >= most || size > bytes)) break;
    n++;
  }
  return n;
}

/**
 * The one way a play's line moves on. A command sent goes at once when nothing else is on its way,
 * and a read of the state is let go for it; else it is queued. A batch answered makes way for as
 * many queued as one request holds (`fitting`); one that failed waits, and goes again. A read goes
 * only from idle. Stopped, nothing moves it.
 */
export function stepLine<P extends { readonly size: number }>(l: Line<P>, e: LineEvent<P>): Line<P> {
  if (l.at === "stopped") return l;
  switch (e.do) {
    case "stop":
      return { at: "stopped", why: e.why };
    case "send":
      return l.at === "idle" || l.at === "reading"
        ? { at: "sending", batch: [e.p], queue: [], tries: 0 }
        : { ...l, queue: [...l.queue, e.p] };
    case "read":
      return l.at === "idle" ? { at: "reading", done: e.done } : l;
    case "answered": {
      if (l.at === "reading") return { at: "idle" };
      if (l.at !== "sending") return l;
      const n = fitting(l.queue);
      return n === 0
        ? { at: "idle" }
        : { at: "sending", batch: l.queue.slice(0, n), queue: l.queue.slice(n), tries: 0 };
    }
    case "failed":
      return l.at === "sending" ? { ...l, at: "waiting", tries: l.tries + 1 } : l;
    case "again":
      return l.at === "waiting" ? { ...l, at: "sending" } : l;
  }
}

/** Everything in a line Leaf has not answered, in order. */
const unanswered = <P>(l: Line<P>): readonly P[] =>
  l.at === "sending" || l.at === "waiting" ? [...l.batch, ...l.queue] : [];

/** A short name for this page, so that its commands' ids are its own among the player's other pages. */
function pageName(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(36).padStart(2, "0")).join("");
}

const json = (v: unknown): string => JSON.stringify(v);
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Opens a game on Leaf: its state as Leaf has it now, ready to send commands. Answers why not when
 * it cannot: `signedout`; `closed` for no answer, trouble, or a game Leaf does not play; `noserver`
 * when Leaf has had no play service for `notYet`; `unreadable` when the state it keeps has not read
 * for as long; `nothing` when there is nothing of `of`'s to visit.
 */
export async function openPlay<View, Command extends object, Note, Short = never>(
  game: GameId,
  reader: PlayReader<View, Note, Short>,
  options: {
    readonly player: string;
    readonly of?: string;
    /** Whether the page is put aside for now and says nothing of itself (the town, under a game). */
    readonly away?: () => boolean;
    readonly retry?: Backoff;
    readonly notYet?: NotYet;
  },
): Promise<Play<View, Command, Note, Short> | { trouble: Trouble }> {
  type P = Pending<View, Command, Note>;
  const path = playPath(game);
  const visiting = options.of !== undefined;
  /** Where the state is read: the player's own, or the one visited. */
  const read = options.of === undefined ? path : visitPath(game, options.of);
  const waitFor = options.notYet ?? NOT_YET;
  let line: Line<P> = { at: "idle" };
  /**
   * Asks, and while Leaf answers "not yet" or that the state does not read (the Leaf before this one,
   * during a deploy), asks the same again each `waitFor.every` ms, `waitFor.tries` times, until the page
   * stops: the last answer.
   */
  async function patiently(asking: () => ReturnType<typeof ask>, tried = 0): ReturnType<typeof ask> {
    const reply = await asking();
    if (tried >= waitFor.tries || !(notYet(reply) || unreadable(reply))) return reply;
    await wait(waitFor.every);
    return line.at === "stopped" ? reply : patiently(asking, tried + 1);
  }
  const first = await patiently(() => ask(read));
  if (notYet(first)) return { trouble: "noserver" };
  const end = endOf(first);
  if (end !== null) return { trouble: end };
  if (first.status !== 200 || !isRecord(first.body)) return { trouble: "closed" };
  // Rules other than Leaf's would show what Leaf does not do: the page loads again, or says Leaf is busy.
  const theirs = otherRules(game, first.body);
  if (theirs !== null) {
    loadFor(game, theirs);
    return { trouble: "closed" };
  }
  const opened = reader.view(first.body.state);
  if (opened === null) {
    // Leaf's rules are newer than this page's.
    outside.reload();
    return { trouble: "closed" };
  }
  const opening = readBalances(first.body.purse);
  if (opening) fromLeaf(opening);
  const retry = options.retry ?? RETRY;
  const name = pageName();
  let made = 0;
  /** Leaf's state as it last answered. */
  let base: View = opened;
  let rev = typeof first.body.rev === "number" ? first.body.rev : 0;
  /** What the page is showing: Leaf's state with what is waiting worked out on top. */
  let copy: View = base;
  /** When the page last called Leaf, and whether it says nothing of itself (a visit, or a page put aside). */
  let calledAt = outside.now();
  const call: typeof ask = (to, init) => {
    calledAt = outside.now();
    return ask(to, init);
  };
  const quiet = (): boolean => visiting || options.away?.() === true;
  /** The wait before a failed batch goes again. */
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** The rules of Leaf's the last answer this page could not take was made by, if it said. */
  let newer = "unread";
  const hearers = new Set<(state: View, differs: boolean) => void>();
  const answerers = new Set<(answered: Answered<Command, Note, Short>) => void>();
  const troubled = new Set<(why: Trouble) => void>();

  /** A prediction on a copy. It is the page's own; one that fails is let go, and Leaf's answer will say. */
  function predicted(p: P, on: View): View {
    if (!p.predict) return on;
    try {
      return p.predict(on);
    } catch {
      return on;
    }
  }
  /** Leaf's state with every prediction still waiting worked out on top. */
  const rebuild = (waiting: readonly P[]): View => waiting.reduce((on, p) => predicted(p, on), base);

  /** A batch as it goes to Leaf: who the page believes it is, and each command with its id. */
  const bodyOf = (batch: readonly P[]): string =>
    json({ player: options.player, commands: batch.map((p) => ({ ...p.command, id: p.id })) });

  function tell(differs: boolean): void {
    for (const fn of hearers) fn(copy, differs);
  }

  /** Tells whoever hears answers, and then each command, what Leaf answered a batch. */
  function answered(batch: readonly P[], answers: ReadonlyMap<string, Answer<Note>>, short?: Short): void {
    if (batch.length === 0) return;
    const done = batch.map((p) => ({ p, answer: answers.get(p.id) ?? { refused: "unanswered" } }));
    for (const fn of answerers) fn({ done: done.map(({ p, answer }) => ({ command: p.command, answer })), short });
    for (const { p, answer } of done) p.answer(answer);
  }

  /**
   * Takes Leaf's answer: its state replaces the copy (with what is still `behind` it worked out on
   * top), or for a batch of a game answered short, Leaf's answer is kept for the page. Gives how the
   * page and each command hear of it, or null when the page is too old to read it.
   */
  function took(body: Record<string, unknown>, batch: readonly P[], behind: readonly P[]): (() => void) | null {
    const rules = otherRules(game, body);
    if (rules !== null) {
      newer = rules;
      return null;
    }
    const short = batch.length > 0 && reader.short !== undefined;
    const view = short ? null : reader.view(body.state);
    if (!short && view === null) return null;
    const answers = new Map<string, Answer<Note>>();
    for (const r of Array.isArray(body.results) ? body.results : []) {
      if (!isRecord(r) || typeof r.id !== "string") continue;
      if (typeof r.refused === "string") {
        answers.set(r.id, { refused: r.refused });
        continue;
      }
      const notes = reader.notes(r.notes);
      if (notes === null) return null;
      answers.set(r.id, { notes });
    }
    if (typeof body.rev === "number") rev = body.rev;
    // Leaf's word on the purse as of the answer, taken as what the batch was shown to owe goes.
    const word = readBalances(body.purse);
    const ids = batch.map((p) => p.id);
    if (view === null) {
      const said = reader.short?.(body.state) ?? undefined;
      return () => {
        settle(ids, word);
        answered(batch, answers, said);
      };
    }
    // What the page was showing, as it stands now: whatever the page did to it shows as a difference.
    const shown = json(copy);
    base = view;
    copy = rebuild(behind);
    return () => {
      settle(ids, word);
      answered(batch, answers);
      tell(json(copy) !== shown);
    };
  }

  /**
   * Moves the line on (`stepLine`), and does what its new place asks: a batch sent, a wait, or the
   * stop. `heard`, the page hearing what moved it, comes first: after the line has moved, and before
   * anything more is sent.
   */
  function move(e: LineEvent<P>, heard?: () => void): void {
    const was = line;
    const next = stepLine(was, e);
    if (next === was) return;
    line = next;
    if (next.at === "stopped") return stopped(was, next.why);
    heard?.();
    // Whoever heard may have moved the line on, or sent: a batch is sent only while the line is at it.
    if (next.at === "sending" && (was.at !== "sending" || was.batch !== next.batch)) {
      if (line.at === "sending" && line.batch === next.batch) void post(next.batch);
    } else if (next.at === "waiting" && line === next) {
      timer = setTimeout(() => move({ do: "again" }), backoff(retry, next.tries - 1));
    }
  }

  /** Stopped: everything that was waiting is answered why, the page is let go of, and it is told what it must be. */
  function stopped(was: Line<P>, why: Stopped): void {
    if (timer !== null) clearTimeout(timer);
    unhear();
    const left = unanswered(was);
    settle(
      left.map((p) => p.id),
      null,
    );
    for (const p of left) p.answer({ refused: why });
    if (why === "not_you") outside.reload();
    else if (why === "outdated") {
      // Loaded again for Leaf's rules a moment ago: Leaf is busy, as far as the page can tell.
      if (!loadFor(game, newer)) for (const fn of troubled) fn("closed");
    } else if (why !== "put_away") for (const fn of troubled) fn(why);
  }

  /** Sends a batch, and moves the line on by Leaf's answer to it; an answer to a batch the line has left is let go. */
  async function post(batch: readonly P[]): Promise<void> {
    const body = bodyOf(batch);
    const reply = await patiently(() =>
      call(path, { method: "POST", headers: { "Content-Type": "application/json" }, body }),
    );
    if (line.at !== "sending" || line.batch !== batch) return;
    const behind = line.queue;
    if (reply.status === 200 && isRecord(reply.body)) {
      const heard = took(reply.body, batch, behind);
      return heard ? move({ do: "answered" }, heard) : move({ do: "stop", why: "outdated" });
    }
    if (reply.status === 401) return move({ do: "stop", why: "signedout" });
    // Signed in as somebody else since this page opened: nothing of theirs is sent from it.
    if (reply.status === 409 && isRecord(reply.body) && reply.body.code === "not_you") {
      return move({ do: "stop", why: "not_you" });
    }
    if (reply.status === 400 || reply.status === 413) {
      // Leaf will not take these commands as they are; sending them again would not change that.
      // A game answered short keeps no copy here to put right.
      if (!reader.short) copy = rebuild(behind);
      return move({ do: "answered" }, () => {
        settle(
          batch.map((p) => p.id),
          null,
        );
        answered(batch, new Map(batch.map((p) => [p.id, { refused: "invalid_command" }])));
        if (!reader.short) tell(true);
      });
    }
    // Still so once waited for: the page says so, and sends nothing more.
    if (unreadable(reply) || notYet(reply)) return move({ do: "stop", why: notYet(reply) ? "noserver" : "unreadable" });
    if (reply.status === 403 || reply.status === 404) return move({ do: "stop", why: "closed" });
    // No answer, trouble, or too fast: the same batch again in a moment, with the same ids.
    move({ do: "failed" });
  }

  /** Leaf's state read again and taken, unless the line has moved on from this read (a command sent, or a stop). */
  async function readNow(asked: Line<P>, differs: number | undefined): Promise<void> {
    const reply = await patiently(() => call(differs === undefined ? read : `${read}?differs=${differs}`));
    if (line !== asked) return;
    const ended = endOf(reply);
    if (ended !== null) return move({ do: "stop", why: ended });
    const fresh = reply.status === 200 && isRecord(reply.body) ? reply.body : null;
    const heard = fresh ? took({ ...fresh, results: [] }, [], []) : () => undefined;
    if (!heard) return move({ do: "stop", why: "outdated" });
    // Heard while the read is still the line's, so that a page asking again as it hears is given this one.
    heard();
    if (line === asked) move({ do: "answered" });
  }

  function refresh(differs?: number): Promise<void> {
    if (line.at === "reading") return line.done;
    if (line.at !== "idle") return Promise.resolve();
    const { promise, resolve } = Promise.withResolvers<void>();
    move({ do: "read", done: promise });
    void readNow(line, differs).finally(resolve);
    return promise;
  }

  /**
   * Everything Leaf has not answered, in order and with the ids it has, in one request that outlives
   * the page (as many as Leaf takes in one: `MOST_FLUSHED`, `FLUSH_BYTES`). Leaf does each command
   * once; if the page stays after all, they go again in turn and are answered as before.
   */
  function flush(): void {
    const left = unanswered(line);
    const n = fitting(left, MOST_FLUSHED, FLUSH_BYTES);
    if (n === 0) return;
    void outside.fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: bodyOf(left.slice(0, n)),
      keepalive: true,
    });
  }

  // What the play hears of the page, let go of as it stops.
  const unheard: (() => void)[] = [outside.leaving(flush)];
  if (!visiting) {
    // A game answered short keeps its own copy in step, and asks for its own reads.
    if (!reader.short)
      unheard.push(
        outside.wake(() => {
          if (!quiet()) void refresh();
        }),
      );
    if (typeof window !== "undefined") {
      const still = window.setInterval(() => {
        if (!document.hidden && !quiet() && outside.now() - calledAt >= STILL_HERE) void refresh();
      }, STILL_HERE / 4);
      unheard.push(() => window.clearInterval(still));
    }
  }
  function unhear(): void {
    for (const fn of unheard.splice(0)) fn();
  }

  return {
    get state() {
      return copy;
    },
    get rev() {
      return rev;
    },
    send(command, predict, coins = 0) {
      return new Promise<Answer<Note>>((answer) => {
        // A visitor changes nothing: nothing is queued, so nothing is ever sent or flushed.
        if (visiting) return answer({ refused: "visiting" });
        if (line.at === "stopped") return answer({ refused: line.why });
        const id = `${name}-${++made}`;
        const size = json(command).length + ID_ROOM;
        const pending: P = { id, command, predict, size, answer };
        copy = predicted(pending, copy);
        owe(id, coins);
        move({ do: "send", p: pending });
      });
    },
    waiting: () => line.at === "sending" || line.at === "waiting",
    owns: (id) => id.startsWith(`${name}-`),
    onState(fn) {
      hearers.add(fn);
      return () => hearers.delete(fn);
    },
    onAnswer(fn) {
      answerers.add(fn);
      return () => answerers.delete(fn);
    },
    onTrouble(fn) {
      troubled.add(fn);
      return () => troubled.delete(fn);
    },
    flush,
    refresh,
    close() {
      flush();
      move({ do: "stop", why: "put_away" });
    },
  };
}

/**
 * The one rule for holding off while Leaf answers a command only it can answer: that answer may
 * change what a later command means (another offer in the same place, a parcel that was not there),
 * so until it comes the page neither asks nor does anything more; but one that leaves everything a
 * command names where it is (`steady`, such as a purchase) may follow another such.
 */
export interface Hold {
  /** Whether a command is held off now. */
  held(steady: boolean): boolean;
  /** Whether Leaf is answering any such command. */
  asking(): boolean;
  /** Holds commands off until `answer` comes, and gives it. */
  until<T>(steady: boolean, answer: Promise<T>): Promise<T>;
}

export function makeHold(): Hold {
  let asking = 0;
  let turning = 0;
  return {
    held: (steady) => asking > 0 && (turning > 0 || !steady),
    asking: () => asking > 0,
    until(steady, answer) {
      asking++;
      if (!steady) turning++;
      return answer.finally(() => {
        asking--;
        if (!steady) turning--;
      });
    },
  };
}

/** How long Leaf may take before what was asked for shows that it is waiting. */
export const WAITING_AFTER = 150;

/**
 * Shows an element waiting (`k-wait`) while an answer takes longer than a moment, and stops when it
 * comes. Returns the answer, for chaining.
 */
export function waitingLook<T>(
  element: { readonly classList: { add(name: string): void; remove(name: string): void } } | null,
  answer: Promise<T>,
  after = WAITING_AFTER,
): Promise<T> {
  if (!element) return answer;
  const timer = setTimeout(() => element.classList.add("k-wait"), after);
  return answer.finally(() => {
    clearTimeout(timer);
    element.classList.remove("k-wait");
  });
}
