/**
 * Everything the game asks of the world outside its page, in one place so tests can stand in for
 * it: the guild's server, the browser's storage, where the page is and how to go somewhere else,
 * and the clock. Every request to the server goes through `ask` or `listen` here, under one policy:
 *
 * - every request has a deadline (`Outside.deadline`): one not answered by then is let go as no
 *   answer, so nothing waits on a request that will never come back;
 * - whatever is tried again after a failure waits by one rule (`Backoff`, `backoff`), with numbers
 *   of its own for each channel;
 * - an answer that is no longer news is let go by what it answers: a state's `rev`, the purse's
 *   `version`, the connection it came on; never by a flag kept beside the question;
 * - an answer that moved the player's Leaf outside the play service says Leaf's word beside it
 *   (`PURSE_HEADER`), which the purse is given here, whoever asked.
 */

import { PURSE_HEADER, readBalances } from "@sequoia-leaf/core";

import { fromLeaf } from "./purse.ts";
import { fromTown } from "./shell.ts";

/** The part of a WebSocket the game uses. */
export interface LiveSocket {
  binaryType: BinaryType;
  send(data: string | Uint8Array<ArrayBuffer>): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", fn: (e: Event) => void): void;
  addEventListener(type: "message", fn: (e: MessageEvent) => void): void;
  addEventListener(type: "close", fn: (e: CloseEvent) => void): void;
}

/** The part of the browser's storage the game uses. */
export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

export interface Outside {
  fetch(path: string, init?: RequestInit): Promise<Response>;
  /** The browser's storage, or null where there is none. */
  store(): Store | null;
  /** The tab's own storage, gone when the tab closes, or null where there is none. */
  tab(): Store | null;
  /** The page's own address. */
  href(): string;
  /** Whether the page is the whole window, rather than in a frame. */
  top(): boolean;
  /** Leaves the page for another address. */
  go(url: string): void;
  /** Loads the page again. */
  reload(): void;
  now(): number;
  /** Opens a WebSocket to an address. */
  socket(url: string): LiveSocket;
  /** How wide the window is, in CSS pixels (0 where there is none). */
  width(): number;
  /**
   * Calls `fn` whenever the page may have been away and is back: it becomes visible again, it gains
   * focus, or the browser says the network is back. Returns how to stop.
   */
  wake(fn: () => void): () => void;
  /**
   * Calls `fn` whenever the page may be going: hidden, put away, or closed by the town it is
   * framed in. Returns how to stop.
   */
  leaving(fn: () => void): () => void;
  /** How long a request may go unanswered before it is let go as no answer, in milliseconds. */
  deadline: number;
}

/** The browser's `wake`: the page shown again, focused, or back on the network. */
export function onWake(fn: () => void): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => undefined;
  const shown = (): void => {
    if (document.visibilityState === "visible") fn();
  };
  document.addEventListener("visibilitychange", shown);
  window.addEventListener("focus", fn);
  window.addEventListener("online", fn);
  return () => {
    document.removeEventListener("visibilitychange", shown);
    window.removeEventListener("focus", fn);
    window.removeEventListener("online", fn);
  };
}

/** The browser's `leaving`: the page hidden or put away, or the town closing the game in its frame. */
export function onLeaving(fn: () => void): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => undefined;
  const hidden = (): void => {
    if (document.visibilityState === "hidden") fn();
  };
  window.addEventListener("pagehide", fn);
  document.addEventListener("visibilitychange", hidden);
  const town = fromTown((msg) => {
    if (msg.town === "closing") fn();
  });
  return () => {
    window.removeEventListener("pagehide", fn);
    document.removeEventListener("visibilitychange", hidden);
    town();
  };
}

function browserStore(kind: "localStorage" | "sessionStorage"): Store | null {
  try {
    return typeof globalThis[kind] === "undefined" ? null : globalThis[kind];
  } catch {
    return null;
  }
}

function isTop(): boolean {
  try {
    return typeof window !== "undefined" && window.top === window;
  } catch {
    return false;
  }
}

export const outside: Outside = {
  fetch: (path, init) => fetch(path, init),
  store: () => browserStore("localStorage"),
  tab: () => browserStore("sessionStorage"),
  href: () => (typeof location === "undefined" ? "" : location.href),
  top: isTop,
  go: (url) => {
    location.assign(url);
  },
  reload: () => {
    location.reload();
  },
  now: () => Date.now(),
  socket: (url) => new WebSocket(url),
  width: () => (typeof innerWidth === "number" ? innerWidth : 0),
  wake: onWake,
  leaving: onLeaving,
  deadline: 10_000,
};

/** Puts stand-ins in place of parts of the outside world (for tests). Returns how to put them back. */
export function pretend(parts: Partial<Outside>): () => void {
  const was = { ...outside };
  Object.assign(outside, parts);
  return () => {
    Object.assign(outside, was);
  };
}

/** What the server said: its status and its JSON, or status 0 when there was no answer at all. */
export interface Answer {
  status: number;
  body: unknown;
}

/** A signal that lets a request go after `ms`, or when `also` does. */
const within = (ms: number, also?: AbortSignal | null): AbortSignal =>
  also ? AbortSignal.any([also, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);

/** Leaf's word on the purse an answer says beside it, if it says one. */
function purseOf(res: Response): void {
  const said = res.headers.get(PURSE_HEADER);
  if (said === null) return;
  try {
    const word = readBalances(JSON.parse(said));
    if (word) fromLeaf(word);
  } catch {
    // Not Leaf's word: nothing.
  }
}

/**
 * Asks the server something. Never throws: no answer, or none within the deadline, is status 0, and
 * a body that is not JSON is null. Leaf's word on the purse beside the answer is taken (`purseOf`).
 */
export async function ask(path: string, init: RequestInit = {}): Promise<Answer> {
  let res: Response;
  const signal = within(outside.deadline, init.signal);
  try {
    res = await outside.fetch(path, { credentials: "same-origin", ...init, signal });
  } catch {
    return { status: 0, body: null };
  }
  purseOf(res);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

/** Sends JSON with a PUT. */
export const put = (path: string, body: unknown, keepalive = false): Promise<Answer> =>
  ask(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive,
  });

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * How long to wait before trying again: `first` after the first failure, twice as long after each
 * one after it, up to `most`; each with up to `jitter` (a fraction of it) more by chance, so that
 * pages that failed together do not all come back in the same instant.
 */
export interface Backoff {
  readonly first: number;
  readonly most: number;
  readonly jitter: number;
}

/** The wait before try `tries` (0, the first after a failure), with `chance` from 0 to 1. */
export const backoff = (b: Backoff, tries: number, chance: number = Math.random()): number =>
  Math.min(b.most, b.first * 2 ** Math.max(0, tries)) * (1 + b.jitter * chance);

// ---------- streams ----------

/** One message of a server-sent event stream. A frame with only an id says where the stream starts. */
export interface Frame {
  id: number | null;
  type: string;
  data: string | null;
}

/**
 * Reads whole frames out of what a stream has sent so far; gives back the frames and what is left
 * over, the start of a frame still on its way. Comment lines (`:`) are passed over.
 */
export function frames(text: string): { frames: Frame[]; rest: string } {
  const out: Frame[] = [];
  const parts = text.replace(/\r\n?/g, "\n").split("\n\n");
  const rest = parts.pop() ?? "";
  for (const part of parts) {
    let id: number | null = null;
    let type = "message";
    const data: string[] = [];
    for (const line of part.split("\n")) {
      if (line === "" || line.startsWith(":")) continue;
      const at = line.indexOf(":");
      const field = at < 0 ? line : line.slice(0, at);
      const value = at < 0 ? "" : line.slice(at + 1).replace(/^ /, "");
      if (field === "id" && /^\d+$/.test(value)) id = Number(value);
      else if (field === "event") type = value;
      else if (field === "data") data.push(value);
    }
    if (id === null && data.length === 0) continue;
    out.push({ id, type, data: data.length > 0 ? data.join("\n") : null });
  }
  return { frames: out, rest };
}

/** An event as a stream carries it: its id, its type and its JSON. */
export interface Heard {
  id: number;
  type: string;
  data: unknown;
}

export interface Listening {
  stop(): void;
}

/** How a stream is opened again after it ended or failed: two seconds, doubling to a minute. */
export const STREAM_BACKOFF: Backoff = { first: 2000, most: 60_000, jitter: 0.25 };
/**
 * How long an open stream may say nothing before it is let go and opened again: Leaf writes a
 * comment on every stream every 20 seconds, so this much quiet is a connection that has died.
 */
export const STREAM_QUIET = 45_000;

/**
 * Keeps a server-sent event stream open, and opens it again from where it got to whenever it ends
 * (the server closes one every quarter of an hour), fails, or goes quiet (`STREAM_QUIET`); one that
 * does not start answering within the deadline is let go as failed. `after` is where to start;
 * without it, only what happens from now on. A stream the server refuses because the member is
 * signed out or not a member is let go.
 */
export function listen(
  path: string,
  hear: (e: Heard) => void,
  opts: { after?: number; opened?: (at: number) => void } = {},
): Listening {
  let last = opts.after ?? null;
  let stopped = false;
  /** Tries since the stream last opened. */
  let tries = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Lets go of the connection open now, if any. */
  let current: AbortController | null = null;

  function take(text: string, held: { rest: string }): void {
    const read = frames(held.rest + text);
    held.rest = read.rest;
    for (const f of read.frames) {
      if (f.id !== null) last = f.id;
      if (f.data === null) {
        if (f.id !== null) opts.opened?.(f.id);
        continue;
      }
      let data: unknown = null;
      try {
        data = JSON.parse(f.data);
      } catch {
        continue;
      }
      if (f.id !== null) hear({ id: f.id, type: f.type, data });
    }
  }

  /** One connection, read until it ends: whether to open another. */
  async function once(): Promise<"again" | "done"> {
    const url = last === null ? path : `${path}${path.includes("?") ? "&" : "?"}after=${last}`;
    const conn = new AbortController();
    current = conn;
    // Let go if it has not started answering by the deadline, or once it has, if it goes quiet.
    let quiet = setTimeout(() => conn.abort(), outside.deadline);
    try {
      const res = await outside.fetch(url, {
        credentials: "same-origin",
        headers: { Accept: "text/event-stream" },
        signal: conn.signal,
      });
      if (res.status === 401 || res.status === 403) return "done";
      if (!res.ok || !res.body) return "again";
      tries = 0;
      const reader = res.body.getReader();
      // Let go, the read on its way ends at once.
      conn.signal.addEventListener("abort", () => void reader.cancel().catch(() => undefined), { once: true });
      const decoder = new TextDecoder();
      const held = { rest: "" };
      for (;;) {
        clearTimeout(quiet);
        quiet = setTimeout(() => conn.abort(), STREAM_QUIET);
        // oxlint-disable-next-line no-await-in-loop -- a stream is read a piece at a time
        const { done, value } = await reader.read();
        if (done || stopped) return "again";
        take(decoder.decode(value, { stream: true }), held);
      }
    } catch {
      // No answer, or the connection dropped or went quiet: open it again from where it got to.
      return "again";
    } finally {
      clearTimeout(quiet);
      conn.abort();
    }
  }

  async function go(): Promise<void> {
    timer = null;
    const next = await once();
    if (stopped || next === "done") return;
    timer = setTimeout(() => void go(), backoff(STREAM_BACKOFF, tries++));
  }
  void go();
  return {
    stop() {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      current?.abort();
    },
  };
}
