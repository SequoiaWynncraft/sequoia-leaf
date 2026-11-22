/**
 * A game played on Leaf, from the page's side. Leaf owns the game's state; the page holds a copy
 * to draw from and sends commands.
 *
 * - `openPlay(game, reader, { player })` fetches the state; `player` is who the page believes it
 *   is, sent with every batch. A page whose rules are older than Leaf's (the state will not read)
 *   loads again, and so does one Leaf answers `not_you` (signed in as someone else since it
 *   opened): nothing more is sent.
 * - `send(command, predict)` gives the command an id, queues it, and returns at once, with a promise
 *   of Leaf's answer for it. Commands go to Leaf in order, one request at a time, as many as are
 *   waiting in each (up to 32); after a network failure, or Leaf having trouble or asking to slow
 *   down, the same request goes again with the same ids, so nothing is done twice.
 * - `predict`, for a command the shared rules can work out without Leaf, gives the copy after it:
 *   it is shown at once. When Leaf answers, Leaf's state takes the copy's place (with what is still
 *   waiting worked out again on top), and if that is not what the page was showing, the page is
 *   told so it can draw again (`onState`). A refused command is the game's to show.
 * - A state Leaf cannot read (`state_unreadable`) stops the page at once, with nothing sent again:
 *   the page shows the kit's card for it. During a deploy a call can reach the Leaf before this one,
 *   which has no such route (404 `not_found`): that is "not yet", tried again each second for 30
 *   seconds before the page gives up for no server.
 * - As the page is hidden or put away, or the town closes the game, everything Leaf has not
 *   answered is sent at once in a request that outlives the page (`flush`), so the last thing done
 *   before leaving is not lost.
 * - `waitingLook(element, answer)` gives what was asked for the kit's waiting look while Leaf takes
 *   more than a moment to answer.
 *
 * Every request reaches Leaf through `net.ts`, which the tests stand in for.
 */

import { type GameId, MOST_COMMANDS, playPath } from "@sequoia-leaf/core";

import { ask, isRecord, outside } from "./net.ts";
import { fromTown } from "./shell.ts";

/** Reads what Leaf sends into the game's own types; null for anything these rules could not have made. */
export interface PlayReader<View, Note> {
  view(v: unknown): View | null;
  notes(v: unknown): Note[] | null;
}

/** What Leaf answered a command: what it did, or the code it was refused with. */
export type Answer<Note> = { readonly notes: Note[] } | { readonly refused: string };

/**
 * Why the page cannot play on: signed out; Leaf will not have it (no answer, no such game, not let
 * in); no Leaf with the play service answered in time (`noserver`); or the state Leaf keeps for the
 * player does not read (`unreadable`).
 */
export type Trouble = "signedout" | "closed" | "noserver" | "unreadable";

export interface Play<View, Command extends object, Note> {
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
  /** Hears when the page cannot send any more: signed out, or Leaf will not take it. */
  onTrouble(fn: (why: Trouble) => void): () => void;
  /** Asks Leaf for the state again, when nothing is waiting for it. */
  refresh(): Promise<void>;
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

/** How a Leaf without the play service yet (a deploy half done) is waited for: a try each `every` ms, `tries` times. */
export interface NotYet {
  every: number;
  tries: number;
}
/** Each second, for 30 seconds. */
export const NOT_YET: NotYet = { every: 1000, tries: 30 };

/** Whether an answer is the 404 of a Leaf that has no play service yet, rather than one about the game. */
const notYet = (reply: { status: number; body: unknown }): boolean =>
  reply.status === 404 && isRecord(reply.body) && reply.body.code === "not_found";
/** Whether an answer says the state Leaf keeps does not read. */
const unreadable = (reply: { status: number; body: unknown }): boolean =>
  reply.status === 409 && isRecord(reply.body) && reply.body.code === "state_unreadable";

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
 * when Leaf has had no play service for `notYet`; `unreadable` when the state it keeps does not read.
 */
export async function openPlay<View, Command extends object, Note>(
  game: GameId,
  reader: PlayReader<View, Note>,
  options: { readonly player: string; readonly retry?: Retry; readonly notYet?: NotYet },
): Promise<Play<View, Command, Note> | { trouble: Trouble }> {
  const path = playPath(game);
  const waitFor = options.notYet ?? NOT_YET;
  let first = await ask(path);
  for (let tried = 0; notYet(first); tried++) {
    if (tried >= waitFor.tries) return { trouble: "noserver" };
    // oxlint-disable-next-line no-await-in-loop -- the same question, a moment later
    await wait(waitFor.every);
    // oxlint-disable-next-line no-await-in-loop -- the same question, a moment later
    first = await ask(path);
  }
  if (first.status === 401) return { trouble: "signedout" };
  if (unreadable(first)) return { trouble: "unreadable" };
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
  let stopped = false;
  let pause = retry.first;
  const hearers = new Set<(state: View, differs: boolean) => void>();
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

  /** Takes Leaf's answer: its state replaces the copy, and each command hears what it did. False when the page is too old. */
  function took(body: Record<string, unknown>, batch: readonly Pending<View, Command, Note>[]): boolean {
    const view = reader.view(body.state);
    if (view === null) {
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
    // What the page was showing, as it stands now: whatever the page did to it shows as a difference.
    const shown = json(copy);
    base = view;
    if (typeof body.rev === "number") rev = body.rev;
    flying = null;
    copy = rebuild();
    for (const p of batch) p.answer(answers.get(p.id) ?? { refused: "unanswered" });
    tell(json(copy) !== shown);
    return true;
  }

  async function pump(): Promise<void> {
    if (stopped || flying !== null || queue.length === 0) return;
    const batch = fitting(queue);
    queue = queue.slice(batch.length);
    flying = batch;
    const body = bodyOf(batch);
    let notYetTries = 0;
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- the same batch, again, until Leaf has it
      const reply = await ask(path, { method: "POST", headers: { "Content-Type": "application/json" }, body });
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
        copy = rebuild();
        for (const p of batch) p.answer({ refused: "invalid_command" });
        tell(true);
        break;
      }
      if (unreadable(reply)) {
        // Sending it again would not change that: the page says so, and sends nothing more.
        stop("unreadable");
        return;
      }
      if (notYet(reply)) {
        // A Leaf from before the play service, during a deploy: the same batch again in a moment.
        if (notYetTries >= waitFor.tries) {
          stop("noserver");
          return;
        }
        notYetTries++;
        // oxlint-disable-next-line no-await-in-loop -- waiting before trying again
        await wait(waitFor.every);
        if (stopped) return;
        continue;
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
   * with the ids they have, in a request that outlives the page. Leaf does each once; if the page
   * stays after all, they go again in turn and are answered as before.
   */
  function flush(): void {
    const left = fitting([...(flying ?? []), ...queue]);
    if (stopped || left.length === 0) return;
    void outside.fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: bodyOf(left),
      keepalive: true,
    });
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

  return {
    get state() {
      return copy;
    },
    get rev() {
      return rev;
    },
    send(command, predict) {
      return new Promise<Answer<Note>>((answer) => {
        if (stopped) {
          answer({ refused: "closed" });
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
    onTrouble(fn) {
      troubled.add(fn);
      return () => troubled.delete(fn);
    },
    flush,
    async refresh() {
      if (stopped || flying !== null || queue.length > 0) return;
      const reply = await ask(path);
      if (reply.status === 401) return stop("signedout");
      if (reply.status === 200 && isRecord(reply.body) && flying === null && queue.length === 0) {
        took({ ...reply.body, results: [] }, []);
      }
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
