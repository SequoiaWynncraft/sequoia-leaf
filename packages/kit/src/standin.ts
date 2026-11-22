/**
 * A stand-in for the guild's server and the browser, for tests: answers requests from a table of
 * routes, keeps what is put in storage in a map, and writes down every request, every address
 * the page tried to go to, and every time it loaded itself again. Pages never load this.
 */

import { CLOSE, decodeMove, encodeSnapshot, type Entry, type ToClient } from "@sequoia-leaf/core";

import { isRecord, type LiveSocket, pretend, type Store } from "./net.ts";

export { CLOSE };

export interface Sent {
  method: string;
  path: string;
  body: unknown;
  keepalive: boolean;
}

/** What a route answers: a status and JSON, a whole Response, or nothing at all (no network). */
export type Reply = { status: number; body?: unknown } | Response | "offline";
export type Route = (sent: Sent) => Reply;

export class MemoryStore implements Store {
  readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
}

export interface Standin {
  store: MemoryStore;
  sent: Sent[];
  went: string[];
  /** How many times the page loaded itself again. */
  reloaded: { count: number };
  /** Sets the time the page sees. */
  clock: { now: number };
  /** Puts the real world back. */
  done(): void;
}

/**
 * Stands in for the outside world. `routes` maps `"GET /v1/game/hello"` (the path without its
 * query) to what it answers; anything else is a 404.
 */
export function standin(
  routes: Record<string, Route | Reply>,
  opts: { href?: string; top?: boolean; store?: MemoryStore } = {},
): Standin {
  const store = opts.store ?? new MemoryStore();
  const sent: Sent[] = [];
  const went: string[] = [];
  const reloaded = { count: 0 };
  const clock = { now: 1_800_000_000_000 };
  const done = pretend({
    async fetch(path, init = {}) {
      await Promise.resolve();
      const method = (init.method ?? "GET").toUpperCase();
      const body: unknown = typeof init.body === "string" ? JSON.parse(init.body) : null;
      const s: Sent = { method, path, body, keepalive: init.keepalive === true };
      sent.push(s);
      const route = routes[`${method} ${path.split("?")[0] ?? path}`];
      const reply = typeof route === "function" ? route(s) : (route ?? { status: 404, body: { code: "not_found" } });
      if (reply === "offline") throw new TypeError("Failed to fetch");
      if (reply instanceof Response) return reply;
      return new Response(JSON.stringify(reply.body ?? null), {
        status: reply.status,
        headers: { "Content-Type": "application/json" },
      });
    },
    store: () => store,
    href: () => opts.href ?? "https://leaf.example/play/town/?x=1",
    top: () => opts.top ?? true,
    go: (url) => {
      went.push(url);
    },
    reload: () => {
      reloaded.count++;
    },
    now: () => clock.now,
    socket: () => {
      throw new Error("No live connection in this test");
    },
  });
  return { store, sent, went, reloaded, clock, done };
}

/** The member `/v1/game/me` answers with in tests. */
export const TESTER = {
  player: { id: "10000000-0000-0000-0000-00000000000a", username: "Tester" },
  rank: "captain",
  guest: false,
  leaf: 2450,
  xp: 5230,
  level: { number: 7, xp_into_level: 230, xp_for_next_level: 1400 },
  event_cursor: 140,
};

/** A guest, as `/v1/game/me` answers for somebody signed in who is not in the guild. */
export const GUEST = {
  player: { id: "10000000-0000-0000-0000-00000000000b", username: "Wanderer" },
  rank: null,
  guest: true,
  leaf: 0,
  xp: 0,
  level: { number: 1, xp_into_level: 0, xp_for_next_level: 1000 },
  event_cursor: 0,
};

/**
 * The routes only a member's page may ask for: a guest's page asking any of them is a mistake. As
 * stand-in routes, each answers 403 as the server would, and writes down that it was asked.
 */
export function membersOnly(asked: string[]): Record<string, Route> {
  const refuse = (s: Sent): Reply => {
    asked.push(s.path);
    return { status: 403, body: { code: "not_a_member" } };
  };
  return Object.fromEntries(
    [
      "GET /v1/me",
      "GET /v1/me/quests",
      "GET /v1/me/events",
      "GET /v1/me/events/stream",
      "GET /v1/game/guild/events",
      "GET /v1/game/guild/events/stream",
    ].map((route) => [route, refuse]),
  );
}

export const HELLO = {
  status: 200,
  body: { sign_in: "https://api.example/auth/web/start?return_to=", leaf_spending: false },
};

// ---------- Leaf's side of a live connection ----------

/** A WebSocket a test plays Leaf's side of: what the game sent, and Leaf's words and snapshots to it. */
export class FakeSocket implements LiveSocket {
  binaryType: BinaryType = "blob";
  readonly sent: (string | Uint8Array)[] = [];
  closed: number | null = null;
  readonly url: string;
  private readonly opens: ((e: Event) => void)[] = [];
  private readonly messages: ((e: MessageEvent) => void)[] = [];
  private readonly closes: ((e: CloseEvent) => void)[] = [];

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(
    ...ear: ["open", (e: Event) => void] | ["message", (e: MessageEvent) => void] | ["close", (e: CloseEvent) => void]
  ): void {
    if (ear[0] === "open") this.opens.push(ear[1]);
    else if (ear[0] === "message") this.messages.push(ear[1]);
    else this.closes.push(ear[1]);
  }

  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }

  close(code: number = CLOSE.done): void {
    this.closed = code;
  }

  /** The connection opens. */
  open(): void {
    for (const fn of this.opens) fn(new Event("open"));
  }

  /** Leaf says something in words. */
  says(m: ToClient): void {
    for (const fn of this.messages) fn(new MessageEvent("message", { data: JSON.stringify(m) }));
  }

  /** Leaf sends a frame as it is. */
  sends(bytes: Uint8Array<ArrayBuffer>): void {
    for (const fn of this.messages) fn(new MessageEvent("message", { data: bytes.buffer }));
  }

  /** Leaf sends a snapshot of everybody's motion that changed, at `time` by its clock. */
  snapshot(time: number, entries: readonly Entry[], tick = 1): void {
    this.sends(encodeSnapshot(tick, time, entries));
  }

  /** The connection closes from Leaf's side, or the network's, with this code. */
  drop(code = 1006): void {
    for (const fn of this.closes) fn(new CloseEvent("close", { code }));
  }

  /** The text frames the game sent, as JSON objects. */
  texts(): Record<string, unknown>[] {
    return this.sent.flatMap((s) => {
      if (typeof s !== "string") return [];
      const v: unknown = JSON.parse(s);
      return isRecord(v) ? [v] : [];
    });
  }

  /** The moves the game sent, read. */
  moves() {
    return this.sent.flatMap((s) => (typeof s === "string" ? [] : [decodeMove(s)]));
  }
}

/** Stands in for opening live connections: every one the page opens is a `FakeSocket`, kept in order. Returns them, and how to stop. */
export function liveSockets(): { sockets: FakeSocket[]; done: () => void } {
  const sockets: FakeSocket[] = [];
  const done = pretend({
    socket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
  });
  return { sockets, done };
}
