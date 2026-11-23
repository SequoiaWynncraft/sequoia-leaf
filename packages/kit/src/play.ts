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
 * - Every request the page waits on is let go after `DEADLINE`, as if Leaf had not answered: a batch
 *   goes again with the same ids, as after any failure.
 * - As the page is hidden or put away, or the town closes the game, everything Leaf has not
 *   answered is sent at once in a request that outlives the page (`flush`), so the last thing done
 *   before leaving is not lost.
 * - Leaf counts the time played from the calls it hears, so a page says it is open: while it is in
 *   view, a minute without a call to Leaf reads the state (`STILL_HERE`); with nothing waiting as it
 *   is hidden or put away, the state is read in a request that outlives it; and it is read as the
 *   page comes back (`outside.wake`), but for a game answered short, which asks for its own reads. A
 *   visit says none of this, nor does a page while `away()` (the town, while a game is open over it).
 * - `waitingLook(element, answer)` gives what was asked for the kit's waiting look while Leaf takes
 *   more than a moment to answer.
 *
 * Every request reaches Leaf through `net.ts`, which the tests stand in for.
 */

import { type GameId, MOST_COMMANDS, playPath, visitPath } from "@sequoia-leaf/core";

import { ask, isRecord, outside } from "./net.ts";
import { fromTown } from "./shell.ts";

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
  /** Sends a command. Returns at once; the promise is Leaf's answer for it. */
  send(command: Command, predict?: (copy: View) => View): Promise<Answer<Note>>;
  /** Whether anything sent has not been answered yet. */
  waiting(): boolean;
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
}

/** The most a batch's commands may come to, in characters: Leaf reads a body of at most 16 KiB. */
const MOST_BYTES = 12_000;
/** What a command's id and the punctuation round it add to a body. */
const ID_ROOM = 40;

/** How long to wait before sending a batch again after it failed, doubling each time up to `most`. */
export interface Retry {
  first: number;
  most: number;
}
const RETRY: Retry = { first: 500, most: 10_000 };

/** How the Leaf before this one, during a deploy (no play service yet, or a state it cannot read), is waited for: a try each `every` ms, `tries` times. */
export interface NotYet {
  every: number;
  tries: number;
}
/** Each second, for 30 seconds. */
export const NOT_YET: NotYet = { every: 1000, tries: 30 };

/** How long a page in view goes without a call to Leaf before it reads its state, checked every quarter of it. */
export const STILL_HERE = 60_000;

/** How long a request may go unanswered before it is let go as no answer: ten seconds. */
export const DEADLINE = 10_000;

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

interface Pending<View, Command, Note> {
  readonly id: string;
  readonly command: Command;
  readonly predict: ((copy: View) => View) | undefined;
  readonly answer: (a: Answer<Note>) => void;
}

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
    readonly retry?: Retry;
    readonly notYet?: NotYet;
    readonly deadline?: number;
  },
): Promise<Play<View, Command, Note, Short> | { trouble: Trouble }> {
  const path = playPath(game);
  const visiting = options.of !== undefined;
  /** Where the state is read: the player's own, or the one visited. */
  const read = options.of === undefined ? path : visitPath(game, options.of);
  const waitFor = options.notYet ?? NOT_YET;
  const deadline = options.deadline ?? DEADLINE;
  /** A request to Leaf, let go as no answer once it has gone unanswered past the deadline. */
  const timed: typeof ask = (to, init) => ask(to, { ...init, signal: AbortSignal.timeout(deadline) });
  let stopped = false;
  /**
   * Asks, and while Leaf answers "not yet" or that the state does not read (the Leaf before this one,
   * during a deploy), asks the same again each `waitFor.every` ms, `waitFor.tries` times, until the page
   * stops: the last answer.
   */
  async function patiently(asking: () => ReturnType<typeof ask>, tried = 0): ReturnType<typeof ask> {
    const reply = await asking();
    if (tried >= waitFor.tries || !(notYet(reply) || unreadable(reply))) return reply;
    await wait(waitFor.every);
    return stopped ? reply : patiently(asking, tried + 1);
  }
  const first = await patiently(() => timed(read));
  if (notYet(first)) return { trouble: "noserver" };
  const end = endOf(first);
  if (end !== null) return { trouble: end };
  if (first.status !== 200 || !isRecord(first.body)) return { trouble: "closed" };
  const opened = reader.view(first.body.state);
  if (opened === null) {
    // Leaf's rules are newer than this page's.
    outside.reload();
    return { trouble: "closed" };
  }
  const retry = options.retry ?? RETRY;
  const name = pageName();
  let made = 0;
  /** Leaf's state as it last answered. */
  let base: View = opened;
  let rev = typeof first.body.rev === "number" ? first.body.rev : 0;
  /** What the page is showing: Leaf's state with what is waiting worked out on top. */
  let copy: View = base;
  let queue: Pending<View, Command, Note>[] = [];
  let flying: Pending<View, Command, Note>[] | null = null;
  /** When the page last called Leaf, and whether it says nothing of itself (a visit, or a page put aside). */
  let calledAt = outside.now();
  const call: typeof ask = (to, init) => {
    calledAt = outside.now();
    return timed(to, init);
  };
  const quiet = (): boolean => visiting || options.away?.() === true;
  let pause = retry.first;
  /** The question for the state again on its way, if one is. */
  let asking: Promise<void> | null = null;
  const hearers = new Set<(state: View, differs: boolean) => void>();
  const answerers = new Set<(answered: Answered<Command, Note, Short>) => void>();
  const troubled = new Set<(why: Trouble) => void>();

  /** A prediction on a copy. It is the page's own; one that fails is let go, and Leaf's answer will say. */
  function predicted(p: Pending<View, Command, Note>, on: View): View {
    if (!p.predict) return on;
    try {
      return p.predict(on);
    } catch {
      return on;
    }
  }
  /** Leaf's state with every prediction still waiting worked out on top. */
  const rebuild = (): View => [...(flying ?? []), ...queue].reduce((on, p) => predicted(p, on), base);

  /**
   * As many from the front of a line of commands as one request holds: `MOST_COMMANDS`, and no more
   * than `MOST_BYTES` of them, so that a few long ones together do not make a body Leaf will not
   * read. Always at least the first.
   */
  function fitting(line: readonly Pending<View, Command, Note>[]): Pending<View, Command, Note>[] {
    const batch: Pending<View, Command, Note>[] = [];
    let size = 0;
    for (const p of line) {
      size += json(p.command).length + ID_ROOM;
      if (batch.length > 0 && (batch.length >= MOST_COMMANDS || size > MOST_BYTES)) break;
      batch.push(p);
    }
    return batch;
  }

  /** A batch as it goes to Leaf: who the page believes it is, and each command with its id. */
  const bodyOf = (batch: readonly Pending<View, Command, Note>[]): string =>
    json({ player: options.player, commands: batch.map((p) => ({ ...p.command, id: p.id })) });

  function tell(differs: boolean): void {
    for (const fn of hearers) fn(copy, differs);
  }

  /** Sends nothing more: everything waiting is answered `refused`. */
  function halt(refused: string): void {
    stopped = true;
    const left = [...(flying ?? []), ...queue];
    flying = null;
    queue = [];
    for (const p of left) p.answer({ refused });
  }

  function stop(why: Trouble): void {
    if (stopped) return;
    halt(why);
    for (const fn of troubled) fn(why);
  }

  /** Tells whoever hears answers, and then each command, what Leaf answered a batch. */
  function answered(
    batch: readonly Pending<View, Command, Note>[],
    answers: ReadonlyMap<string, Answer<Note>>,
    short?: Short,
  ): void {
    if (batch.length === 0) return;
    const done = batch.map((p) => ({ p, answer: answers.get(p.id) ?? { refused: "unanswered" } }));
    for (const fn of answerers) fn({ done: done.map(({ p, answer }) => ({ command: p.command, answer })), short });
    for (const { p, answer } of done) p.answer(answer);
  }

  /**
   * Takes Leaf's answer: its state replaces the copy, or for a batch of a game answered short, the
   * page hears Leaf's answer; and each command hears what it did. False when the page is too old.
   */
  function took(body: Record<string, unknown>, batch: readonly Pending<View, Command, Note>[]): boolean {
    const short = batch.length > 0 && reader.short !== undefined;
    const view = short ? null : reader.view(body.state);
    if (!short && view === null) {
      outside.reload();
      return false;
    }
    const answers = new Map<string, Answer<Note>>();
    for (const r of Array.isArray(body.results) ? body.results : []) {
      if (!isRecord(r) || typeof r.id !== "string") continue;
      if (typeof r.refused === "string") {
        answers.set(r.id, { refused: r.refused });
        continue;
      }
      const notes = reader.notes(r.notes);
      if (notes === null) {
        outside.reload();
        return false;
      }
      answers.set(r.id, { notes });
    }
    if (typeof body.rev === "number") rev = body.rev;
    flying = null;
    if (view === null) {
      answered(batch, answers, reader.short?.(body.state) ?? undefined);
      return true;
    }
    // What the page was showing, as it stands now: whatever the page did to it shows as a difference.
    const shown = json(copy);
    base = view;
    copy = rebuild();
    answered(batch, answers);
    tell(json(copy) !== shown);
    return true;
  }

  async function pump(): Promise<void> {
    if (stopped || flying !== null || queue.length === 0) return;
    const batch = fitting(queue);
    queue = queue.slice(batch.length);
    flying = batch;
    const body = bodyOf(batch);
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- the same batch, again, until Leaf has it
      const reply = await patiently(() =>
        call(path, { method: "POST", headers: { "Content-Type": "application/json" }, body }),
      );
      if (stopped) return;
      if (reply.status === 200 && isRecord(reply.body)) {
        pause = retry.first;
        if (!took(reply.body, batch)) {
          stopped = true;
          return;
        }
        break;
      }
      if (reply.status === 401) {
        stop("signedout");
        return;
      }
      if (reply.status === 409 && isRecord(reply.body) && reply.body.code === "not_you") {
        // Signed in as somebody else since this page opened: nothing of theirs is sent from it.
        halt("not_you");
        outside.reload();
        return;
      }
      if (reply.status === 400 || reply.status === 413) {
        // Leaf will not take these commands as they are; sending them again would not change that.
        flying = null;
        answered(batch, new Map(batch.map((p) => [p.id, { refused: "invalid_command" }])));
        // A game answered short keeps no copy here to put right.
        if (!reader.short) {
          copy = rebuild();
          tell(true);
        }
        break;
      }
      if (unreadable(reply) || notYet(reply)) {
        // Still so once waited for: the page says so, and sends nothing more.
        stop(notYet(reply) ? "noserver" : "unreadable");
        return;
      }
      if (reply.status === 403 || reply.status === 404) {
        stop("closed");
        return;
      }
      // No answer, trouble, or too fast: the same batch again in a moment, with the same ids.
      // oxlint-disable-next-line no-await-in-loop -- waiting before trying again
      await wait(pause);
      pause = Math.min(retry.most, pause * 2);
      if (stopped) return;
    }
    void pump();
  }

  /**
   * The batch on its way and what is queued behind it (as many as one request holds), in order and
   * with the ids they have, in a request that outlives the page; with none, a read of the state.
   * Leaf does each command once; if the page stays after all, they go again in turn and are
   * answered as before.
   */
  function flush(): void {
    const left = fitting([...(flying ?? []), ...queue]);
    if (stopped || (left.length === 0 && quiet())) return;
    const post = { method: "POST", headers: { "Content-Type": "application/json" }, body: bodyOf(left) };
    void outside.fetch(path, { ...(left.length > 0 ? post : {}), credentials: "same-origin", keepalive: true });
  }

  /** Leaf's state read again and taken, unless anything was sent meanwhile. */
  async function readAgain(differs: number | undefined): Promise<void> {
    const before = made;
    const reply = await patiently(() => call(differs === undefined ? read : `${read}?differs=${differs}`));
    const ended = endOf(reply);
    if (ended !== null) return stop(ended);
    // A command sent and answered while this was on its way has told the page more than this has.
    if (reply.status === 200 && isRecord(reply.body) && flying === null && queue.length === 0 && made === before) {
      took({ ...reply.body, results: [] }, []);
    }
  }

  function refresh(differs?: number): Promise<void> {
    if (stopped || flying !== null || queue.length > 0) return asking ?? Promise.resolve();
    asking ??= readAgain(differs).finally(() => {
      asking = null;
    });
    return asking;
  }

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", flush);
    fromTown((msg) => {
      if (msg.town === "closing") flush();
    });
  }
  if (typeof document !== "undefined")
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  if (!visiting) {
    // A game answered short keeps its own copy in step, and asks for its own reads.
    if (!reader.short)
      outside.wake(() => {
        if (!quiet()) void refresh();
      });
    if (typeof window !== "undefined")
      window.setInterval(() => {
        if (!document.hidden && !quiet() && outside.now() - calledAt >= STILL_HERE) void refresh();
      }, STILL_HERE / 4);
  }

  return {
    get state() {
      return copy;
    },
    get rev() {
      return rev;
    },
    send(command, predict) {
      return new Promise<Answer<Note>>((answer) => {
        // A visitor changes nothing: nothing is queued, so nothing is ever sent or flushed.
        if (stopped || visiting) {
          answer({ refused: stopped ? "closed" : "visiting" });
          return;
        }
        const pending: Pending<View, Command, Note> = { id: `${name}-${++made}`, command, predict, answer };
        queue.push(pending);
        copy = predicted(pending, copy);
        void pump();
      });
    },
    waiting: () => flying !== null || queue.length > 0,
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
