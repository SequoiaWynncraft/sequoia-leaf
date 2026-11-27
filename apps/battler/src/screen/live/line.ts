/**
 * The page's line to one of Leaf's sittings (a live table): the sitting as Leaf shows it to the
 * member, and the member's commands to it, in batches as the solo table's go (`/v1/game/sittings/{id}`).
 *
 * - The view is Leaf's last answer with what is still waiting for Leaf worked out on top (a
 *   prediction, as the solo table makes them); Leaf's answer always takes its place.
 * - Commands go in order, one request at a time, as many as are waiting in each; after a failure
 *   (no answer, trouble, too fast) the same batch goes again with the same ids, so nothing is done twice.
 * - Leaf's clock is kept as how far it is from the page's (`now`), from each answer's `now`.
 * - The sitting is read again when its stage's deadline passes, every 2 seconds while it is open or
 *   in a carousel (others sit, others take from the ring), and as the page comes back; each read
 *   sends the `rev` the page has and is mostly answered unchanged. A read answered while a command
 *   was on its way is let go: the command's answer is newer.
 * - A sitting Leaf no longer has, or cannot read, or a member signed out, ends the line (`onGone`).
 */
import { MOST_COMMANDS, readBalances } from "@sequoia-leaf/core";
import { ask, backoff, isRecord, outside } from "@sequoia-leaf/kit/net.ts";
import { RETRY } from "@sequoia-leaf/kit/play.ts";
import { fromLeaf } from "@sequoia-leaf/kit/purse.ts";
import type { Release, Scope } from "@sequoia-leaf/kit/scope.ts";
import { type RaidNote, readNotes } from "@sequoia-leaf/raid";
import type { SittingCommand } from "@sequoia-leaf/raid/sitting/commands.ts";
import type { SittingView } from "@sequoia-leaf/raid/sitting/view.ts";
import { readSittingView } from "@sequoia-leaf/raid/sitting/wire.ts";

/** What Leaf answered a command: what happened, or why not (the code and Leaf's own sentence). */
export type Answer = { readonly notes: RaidNote[] } | { readonly refused: string; readonly why: string };

/** Why a line ends: the sitting is gone or does not read, or the member is signed out. */
export type Gone = "missing" | "unreadable" | "signedout";

/** How often an open sitting or a carousel is read again. */
export const BUSY_EVERY = 2000;
/** How long after a deadline the sitting is read: Leaf brings it to its clock as it is read. */
export const AFTER_DEADLINE = 150;

export interface Line {
  readonly id: string;
  /** Whose line it is: the member's Leaf id. */
  readonly player: string;
  /** Leaf's view, with what is waiting for Leaf worked out on top. */
  readonly view: SittingView;
  /** Leaf's clock now, in its milliseconds, as near as the page can tell. */
  now(): number;
  send(command: SittingCommand, predict?: (view: SittingView) => SittingView): Promise<Answer>;
  /** Asks Leaf for the sitting again (with the `rev` the page has). */
  read(): Promise<void>;
  /** Whether anything sent has not been answered yet. */
  waiting(): boolean;
  /** Hears each time the view changes. */
  onView(fn: (view: SittingView) => void): void;
  onGone(fn: (why: Gone) => void): void;
  /** Puts the line away: what is waiting is sent once more (and answered `gone` here), and nothing is read again. */
  close(): void;
}

interface Pending {
  readonly id: string;
  readonly command: SittingCommand;
  readonly predict: ((view: SittingView) => SittingView) | undefined;
  readonly answer: (a: Answer) => void;
}

/** A sitting's answer: its view, `rev` and Leaf's clock; or, read with the page's `rev`, unchanged. */
interface Read {
  readonly rev: number;
  readonly leafNow: number;
  readonly view: SittingView | null;
  readonly results: readonly unknown[];
}
function readAnswer(body: unknown): Read | null {
  if (!isRecord(body) || typeof body.rev !== "number" || typeof body.now !== "string") return null;
  const leafNow = Date.parse(body.now);
  if (!Number.isFinite(leafNow)) return null;
  const word = readBalances(body.purse);
  if (word) fromLeaf(word);
  const results = Array.isArray(body.results) ? body.results : [];
  if (body.unchanged === true) return { rev: body.rev, leafNow, view: null, results };
  const view = readSittingView(body.state);
  return view ? { rev: body.rev, leafNow, view, results } : null;
}

/** What Leaf answered one command of a batch. */
function answerOf(results: readonly unknown[], id: string): Answer {
  const r = results.find((x) => isRecord(x) && x.id === id);
  if (!isRecord(r)) return { refused: "unanswered", why: "Leaf did not answer that." };
  if (typeof r.refused === "string") return { refused: r.refused, why: typeof r.why === "string" ? r.why : "" };
  return { notes: readNotes(r.notes) ?? [] };
}

/** The deadline of a stage, if it has one. */
const deadlineOf = (view: SittingView): number | null => (view.stage.at === "over" ? null : view.stage.until);
const busy = (view: SittingView): boolean => view.stage.at === "open" || view.stage.at === "carousel";

/** Ids for this page's commands at a sitting: a name of the page's own, and a count. */
function ids(): () => string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const name = [...bytes].map((b) => b.toString(36).padStart(2, "0")).join("");
  const made = { n: 0 };
  return () => `${name}-${++made.n}`;
}

/** A command as it goes to Leaf: what it is, with its id. */
const wire = (p: Pending): SittingCommand & { id: string } => Object.assign({ id: p.id }, p.command);

/** The line itself: Leaf's last word, what waits on top of it, and the clock to read it again by. */
class SittingLine implements Line {
  readonly id: string;
  readonly player: string;
  readonly #scope: Scope;
  readonly #path: string;
  readonly #next = ids();
  #base: SittingView;
  #copy: SittingView;
  #rev: number;
  /** How far Leaf's clock is ahead of the page's. */
  #skew: number;
  #queue: Pending[] = [];
  #batch: Pending[] = [];
  #tries = 0;
  /** Batches sent, so that a read answered meanwhile is let go. */
  #sent = 0;
  #over = false;
  #timer: Release | null = null;
  readonly #viewers: ((view: SittingView) => void)[] = [];
  readonly #goners: ((why: Gone) => void)[] = [];

  constructor(scope: Scope, id: string, player: string, opened: Read & { view: SittingView }) {
    this.id = id;
    this.player = player;
    this.#scope = scope;
    this.#path = `/v1/game/sittings/${id}`;
    this.#base = opened.view;
    this.#copy = opened.view;
    this.#rev = opened.rev;
    this.#skew = opened.leafNow - outside.now();
    scope.hold(outside.leaving(() => this.#flush()));
    scope.hold(outside.wake(() => void this.read()));
    this.#plan();
  }

  get view(): SittingView {
    return this.#copy;
  }
  now(): number {
    return outside.now() + this.#skew;
  }
  waiting(): boolean {
    return this.#batch.length > 0 || this.#queue.length > 0;
  }
  onView(fn: (view: SittingView) => void): void {
    this.#viewers.push(fn);
  }
  onGone(fn: (why: Gone) => void): void {
    this.#goners.push(fn);
  }

  send(command: SittingCommand, predict?: (view: SittingView) => SittingView): Promise<Answer> {
    return new Promise<Answer>((answer) => {
      if (this.#over) return answer({ refused: "gone", why: "" });
      this.#queue.push({ id: this.#next(), command, predict, answer });
      if (predict) this.#copy = predict(this.#copy);
      this.#post();
    });
  }

  async read(): Promise<void> {
    if (this.#over || this.#batch.length > 0) return;
    const sent = this.#sent;
    const reply = await ask(`${this.#path}?rev=${this.#rev}`);
    if (this.#over || sent !== this.#sent) return;
    if (reply.status !== 200) {
      if (this.#trouble(reply.status, reply.body) === "again") this.#plan();
      return;
    }
    const answer = readAnswer(reply.body);
    if (!answer) return outside.reload();
    this.#took(answer);
  }

  close(): void {
    this.#flush();
    // Whoever waits on a command hears that the line is put away: nothing is left waiting after leaving.
    this.#settle("gone");
    this.#over = true;
    this.#scope.close();
  }

  /** Leaf's view with every prediction still waiting worked out on top. */
  #rebuild(): SittingView {
    return [...this.#batch, ...this.#queue].reduce((v, p) => p.predict?.(v) ?? v, this.#base);
  }
  /**
   * Takes Leaf's answer, unless it is older than the sitting the page holds: two reads on their way at
   * once (a deadline's and the page coming back) may be answered in either order, and the older
   * answer must not roll the table back. Only a newer revision replaces the view; the same one only
   * says Leaf's clock again.
   */
  #took(answer: Read): void {
    if (answer.rev < this.#rev) return;
    this.#skew = answer.leafNow - outside.now();
    if (answer.view && answer.rev > this.#rev) this.#base = answer.view;
    this.#rev = answer.rev;
    this.#show();
    this.#plan();
  }
  /** The view again from Leaf's and what still waits on it; whoever hears is told if it changed. */
  #show(): void {
    const shown = JSON.stringify(this.#copy);
    this.#copy = this.#rebuild();
    if (JSON.stringify(this.#copy) !== shown) for (const fn of this.#viewers) fn(this.#copy);
  }
  #gone(why: Gone): void {
    if (this.#over) return;
    this.#over = true;
    this.#timer?.();
    this.#settle(why);
    for (const fn of this.#goners) fn(why);
  }
  /** Answers every command Leaf has not answered with why it never will be. */
  #settle(why: string): void {
    for (const p of [...this.#batch, ...this.#queue]) p.answer({ refused: why, why: "" });
    this.#batch = [];
    this.#queue = [];
  }
  /** What an answer that is not the sitting says: gone, outdated (the page loads again), or to try again. */
  #trouble(status: number, body: unknown): "again" | "stop" {
    const code = isRecord(body) ? body.code : null;
    if (status === 401) this.#gone("signedout");
    else if (status === 404) this.#gone("missing");
    else if (status === 409 && code === "state_unreadable") this.#gone("unreadable");
    else if (status === 409 && code === "not_you") outside.reload();
    else return "again";
    return "stop";
  }
  /** Reads the sitting again at its deadline, and every 2 seconds while it is open or in a carousel. */
  #plan(): void {
    this.#timer?.();
    this.#timer = null;
    if (this.#over) return;
    const due = deadlineOf(this.#base);
    const toDeadline = due === null ? Infinity : due - this.now() + AFTER_DEADLINE;
    const wait = Math.min(busy(this.#base) ? BUSY_EVERY : Infinity, Math.max(AFTER_DEADLINE, toDeadline));
    if (Number.isFinite(wait)) this.#timer = this.#scope.after(wait, () => void this.read());
  }

  #post(): void {
    if (this.#over || this.#batch.length > 0 || this.#queue.length === 0) return;
    this.#batch = this.#queue.splice(0, MOST_COMMANDS);
    this.#sent++;
    void this.#send(this.#batch);
  }
  async #send(batch: Pending[]): Promise<void> {
    const reply = await ask(this.#path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player: this.player, commands: batch.map(wire) }),
    });
    if (this.#over || this.#batch !== batch) return;
    const answer = reply.status === 200 ? readAnswer(reply.body) : null;
    if (reply.status === 200 && !answer) return outside.reload();
    if (answer) return this.#answered(batch, answer);
    if (reply.status === 400) return this.#answered(batch, null);
    if (this.#trouble(reply.status, reply.body) === "stop") return;
    // No answer, trouble, or too fast: the same batch again in a moment, with the same ids.
    this.#scope.after(backoff(RETRY, this.#tries++), () => void this.#send(batch));
  }
  /** A batch answered (or, `null`, turned away as not commands Leaf takes): each command hears, and the next goes. */
  #answered(batch: Pending[], answer: Read | null): void {
    this.#batch = [];
    this.#tries = 0;
    // The batch no longer waits: the view is Leaf's again, with what is still queued on top.
    if (answer) this.#took(answer);
    this.#show();
    for (const p of batch)
      p.answer(
        answer ? answerOf(answer.results, p.id) : { refused: "invalid_command", why: "Leaf would not take that." },
      );
    this.#post();
  }

  /** What Leaf has not answered, sent at once in one request that outlives the page. */
  #flush(): void {
    const left = [...this.#batch, ...this.#queue];
    if (left.length === 0) return;
    outside
      .fetch(this.#path, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player: this.player, commands: left.map(wire) }),
        keepalive: true,
      })
      .catch(() => undefined);
  }
}

/** Opens a line to a sitting Leaf has shown the page (`first`, its answer to a read or an opening), for the member `player`. */
export function openLine(parent: Scope, id: string, player: string, first: unknown): Line | null {
  const opened = readAnswer(first);
  return opened?.view ? new SittingLine(parent.child(), id, player, { ...opened, view: opened.view }) : null;
}
