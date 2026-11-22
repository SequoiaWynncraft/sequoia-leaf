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
 * - `waitingLook(element, answer)` gives what was asked for the kit's waiting look while Leaf takes
 *   more than a moment to answer.
 *
 * Every request reaches Leaf through `net.ts`, which the tests stand in for.
 */

import { type GameId, MOST_COMMANDS, playPath } from "@sequoia-leaf/core";

import { ask, isRecord, outside } from "./net.ts";

/** Reads what Leaf sends into the game's own types; null for anything these rules could not have made. */
export interface PlayReader<View, Note> {
  view(v: unknown): View | null;
  notes(v: unknown): Note[] | null;
}

/** What Leaf answered a command: what it did, or the code it was refused with. */
export type Answer<Note> = { readonly notes: Note[] } | { readonly refused: string };

/** Why the page cannot play on: signed out, or Leaf will not have it (no answer, no such game, not let in). */
export type Trouble = "signedout" | "closed";

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
}

/** How long to wait before sending a batch again after it failed, doubling each time up to `most`. */
export interface Retry {
  first: number;
  most: number;
}
const RETRY: Retry = { first: 500, most: 10_000 };

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
 * it cannot: `signedout`, or `closed` for no answer, trouble, or a game Leaf does not play.
 */
export async function openPlay<View, Command extends object, Note>(
  game: GameId,
  reader: PlayReader<View, Note>,
  options: { readonly player: string; readonly retry?: Retry },
): Promise<Play<View, Command, Note> | { trouble: Trouble }> {
  const path = playPath(game);
  const first = await ask(path);
  if (first.status === 401) return { trouble: "signedout" };
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
    const batch = queue.slice(0, MOST_COMMANDS);
    queue = queue.slice(batch.length);
    flying = batch;
    const body = json({ player: options.player, commands: batch.map((p) => ({ ...p.command, id: p.id })) });
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
      if (reply.status === 400) {
        // Leaf will not take these commands as they are; sending them again would not change that.
        flying = null;
        copy = rebuild();
        for (const p of batch) p.answer({ refused: "invalid_command" });
        tell(true);
        break;
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
    async refresh() {
      if (stopped || flying !== null || queue.length > 0) return;
      const reply = await ask(path);
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
