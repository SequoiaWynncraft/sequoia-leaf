/**
 * Everything the game asks of the world outside its page, in one place so tests can stand in for
 * it: the guild's server, the browser's storage, where the page is and how to go somewhere else,
 * and the clock. Every request to the server goes through `ask` or `listen` here.
 */

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
}

function browserStore(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
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
  store: browserStore,
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

/** Asks the server something. Never throws: no answer is status 0, and a body that is not JSON is null. */
export async function ask(path: string, init: RequestInit = {}): Promise<Answer> {
  let res: Response;
  try {
    res = await outside.fetch(path, { credentials: "same-origin", ...init });
  } catch {
    return { status: 0, body: null };
  }
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

/** The longest wait between two tries at a stream that keeps failing, in milliseconds. */
const MOST_WAIT = 60_000;

/**
 * Keeps a server-sent event stream open, and opens it again from where it got to whenever it ends
 * (the server closes one every quarter of an hour). `after` is where to start; without it, only
 * what happens from now on. A stream the server refuses because the member is signed out or not a
 * member is let go.
 */
export function listen(
  path: string,
  hear: (e: Heard) => void,
  opts: { after?: number; opened?: (at: number) => void } = {},
): Listening {
  let last = opts.after ?? null;
  let stopped = false;
  let waitFor = 2000;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const abort = new AbortController();

  async function once(): Promise<"again" | "done"> {
    const url = last === null ? path : `${path}${path.includes("?") ? "&" : "?"}after=${last}`;
    let res: Response;
    try {
      res = await outside.fetch(url, {
        credentials: "same-origin",
        headers: { Accept: "text/event-stream" },
        signal: abort.signal,
      });
    } catch {
      return "again";
    }
    if (res.status === 401 || res.status === 403) return "done";
    if (!res.ok || !res.body) return "again";
    waitFor = 2000;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let held = "";
    const take = (text: string): void => {
      held += text;
      const read = frames(held);
      held = read.rest;
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
    };
    const pump = async (): Promise<void> => {
      const { done, value } = await reader.read();
      if (done || stopped) return;
      take(decoder.decode(value, { stream: true }));
      await pump();
    };
    try {
      await pump();
    } catch {
      // The connection dropped: open it again from where it got to.
    }
    return "again";
  }

  async function go(): Promise<void> {
    timer = null;
    const next = await once();
    if (stopped || next === "done") return;
    timer = setTimeout(() => void go(), waitFor);
    waitFor = Math.min(MOST_WAIT, waitFor * 2);
  }
  void go();
  return {
    stop() {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      abort.abort();
    },
  };
}
