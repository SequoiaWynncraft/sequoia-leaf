/**
 * A stand-in for the guild's server and the browser, for tests: answers requests from a table of
 * routes, keeps what is put in storage in a map, and writes down every request and every address
 * the page tried to go to. Pages never load this.
 */

import { pretend, type Store } from "./net.ts";

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
    now: () => clock.now,
  });
  return { store, sent, went, clock, done };
}

/** The member `/v1/game/me` answers with in tests. */
export const TESTER = {
  player: { id: "10000000-0000-0000-0000-00000000000a", username: "Tester" },
  rank: "captain",
  leaf: 2450,
  xp: 5230,
  level: { number: 7, xp_into_level: 230, xp_for_next_level: 1400 },
  event_cursor: 140,
};

export const HELLO = {
  status: 200,
  body: { sign_in: "https://api.example/auth/web/start?return_to=", leaf_spending: false },
};
