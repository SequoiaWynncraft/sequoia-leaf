/**
 * A stand-in for the guild's server and the browser, for tests: answers requests from a table of
 * routes, keeps what is put in storage in a map, and writes down every request, every address
 * the page tried to go to, and every time it loaded itself again. Pages never load this.
 */

import { CLOSE, decodeMove, encodeSnapshot, type Entry, type ToClient } from "@sequoia-leaf/core";

import { heard } from "./dom.ts";
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
/** A route answers at once, or when its promise does: an answer that takes its time. */
export type Route = (sent: Sent) => Reply | Promise<Reply>;

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

/** What a route answers, unless the page lets the request go first (`init.signal`): then it fails, as a browser's fetch does. */
function unlessLetGo<T>(reply: T | Promise<T>, signal: AbortSignal | null | undefined): Promise<T> {
  return new Promise((resolve, reject) => {
    signal?.addEventListener("abort", () => reject(new DOMException("Let go", "AbortError")), { once: true });
    Promise.resolve(reply).then(resolve, reject);
  });
}

/** An event target that counts the listeners on it: for a test that what listened has let go. */
export class Listened extends EventTarget {
  listening = 0;
  override addEventListener(...args: Parameters<EventTarget["addEventListener"]>): void {
    super.addEventListener(...args);
    this.listening++;
  }
  override removeEventListener(...args: Parameters<EventTarget["removeEventListener"]>): void {
    super.removeEventListener(...args);
    this.listening--;
  }
}

export interface Standin {
  store: MemoryStore;
  sent: Sent[];
  went: string[];
  /** How many times the page loaded itself again. */
  reloaded: { count: number };
  /** Sets the time the page sees: by the wall clock (`now`), and by the one that only goes forward (`elapsed`). */
  clock: { now: number; elapsed: number };
  /** The page comes back: visible again, focused, or back on the network. */
  wake(): void;
  /** The page may be going: hidden, put away, or closed by the town. */
  leave(): void;
  /** How many are listening for the page coming back or going. */
  hearing(): number;
  /** Puts the real world back. */
  done(): void;
}

/**
 * Waits until something holds, a moment at a time, however long the machine takes to get there: a
 * test waits for what it means to wait for, never for a guess of how long that takes. Past `ms` it
 * fails, saying what it waited for.
 */
export async function until(holds: () => boolean, what: string, ms = 5000): Promise<void> {
  const by = performance.now() + ms;
  while (!holds()) {
    if (performance.now() > by) throw new Error(`Waited ${ms} ms for ${what}`);
    // oxlint-disable-next-line no-await-in-loop -- waiting on the page, a moment at a time
    await Bun.sleep(1);
  }
}

/**
 * Stands in for the outside world. `routes` maps `"GET /v1/game/hello"` (the path without its
 * query) to what it answers; anything else is a 404.
 */
export function standin(
  routes: Record<string, Route | Reply>,
  opts: { href?: string; top?: boolean; store?: MemoryStore; width?: number; deadline?: number } = {},
): Standin {
  const store = opts.store ?? new MemoryStore();
  const tab = new MemoryStore();
  const sent: Sent[] = [];
  const went: string[] = [];
  const reloaded = { count: 0 };
  const clock = { now: 1_800_000_000_000, elapsed: 0 };
  const woken = new Set<() => void>();
  const leavers = new Set<() => void>();
  const done = pretend({
    async fetch(path, init = {}) {
      await Promise.resolve();
      const method = (init.method ?? "GET").toUpperCase();
      const body: unknown = typeof init.body === "string" ? JSON.parse(init.body) : null;
      const s: Sent = { method, path, body, keepalive: init.keepalive === true };
      sent.push(s);
      const route = routes[`${method} ${path.split("?")[0] ?? path}`];
      const reply =
        typeof route === "function"
          ? await unlessLetGo(route(s), init.signal)
          : (route ?? { status: 404, body: { code: "not_found" } });
      if (reply === "offline") throw new TypeError("Failed to fetch");
      if (reply instanceof Response) return reply;
      return new Response(JSON.stringify(reply.body ?? null), {
        status: reply.status,
        headers: { "Content-Type": "application/json" },
      });
    },
    store: () => store,
    tab: () => tab,
    href: () => opts.href ?? "https://leaf.example/play/town/?x=1",
    top: () => opts.top ?? true,
    go: (url) => {
      went.push(url);
    },
    away: (url) => {
      went.push(url);
    },
    reload: () => {
      reloaded.count++;
    },
    now: () => clock.now,
    elapsed: () => clock.elapsed,
    socket: () => {
      throw new Error("No live connection in this test");
    },
    width: () => opts.width ?? 1280,
    deadline: opts.deadline ?? 10_000,
    wake: (fn) => {
      woken.add(fn);
      return () => {
        woken.delete(fn);
      };
    },
    leaving: (fn) => {
      leavers.add(fn);
      return () => {
        leavers.delete(fn);
      };
    },
  });
  const wake = (): void => {
    for (const fn of woken) fn();
  };
  const leave = (): void => {
    for (const fn of leavers) fn();
  };
  const hearing = (): number => woken.size + leavers.size;
  return { store, sent, went, reloaded, clock, wake, leave, hearing, done };
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
  coins: 300,
  version: 90,
};

/** A guest, as `/v1/game/me` answers for somebody signed in who is not in the guild: with Leaf they earned as a member. */
export const GUEST = {
  player: { id: "10000000-0000-0000-0000-00000000000b", username: "Wanderer" },
  rank: null,
  guest: true,
  leaf: 1500,
  xp: 0,
  level: { number: 1, xp_into_level: 0, xp_for_next_level: 1000 },
  event_cursor: 0,
  coins: 300,
  version: 12,
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

/**
 * A stream that stays open, for a route of server-sent events: each `open()` is a new connection's
 * answer, and `say(text)` sends more on the newest one.
 */
export function keptOpen(): { open: () => Response; say: (text: string) => void } {
  const encoder = new TextEncoder();
  let newest: ReadableStreamDefaultController<Uint8Array> | null = null;
  return {
    open: () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            newest = c;
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ),
    say: (text) => newest?.enqueue(encoder.encode(text)),
  };
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

// ---------- a page to press on ----------

/**
 * The player presses: a pointer goes down on `on`, or on a test's page that has none, on nothing in
 * particular. A button that spends is done only on the press after the one that asked (`pressedTwice`).
 */
export const press = (on: EventTarget | null = null): void => heard({ is: "down", on });

/** The selectors a stand-in element matches: a tag (`button`), a role (`[role='button']`), a link (`a[href]`). */
const matchesOne = (e: Part, one: string): boolean =>
  one === e.localName ||
  (one === "[role='button']" && e.getAttribute("role") === "button") ||
  (one === "a[href]" && e.localName === "a" && e.getAttribute("href") !== null);

/** A canvas's drawing on the stand-in page: it takes anything and keeps none of it. */
const inert: () => unknown = new Proxy(() => inert, { get: () => inert, set: () => true });

/**
 * An element of the stand-in page, as `el` makes one: its classes, attributes and children, what
 * holds it, whether it is on the page (under the page's body), and whether it can be seen (neither
 * it nor anything holding it hidden, by `hidden` or the kit's `hid`). A canvas draws nothing.
 */
export class Part extends EventTarget {
  readonly localName: string;
  readonly attrs = new Map<string, string>();
  readonly kids: Part[] = [];
  holder: Part | null = null;
  className = "";
  textContent = "";
  hidden = false;
  readonly dataset: Record<string, string> = {};
  /** Its inline style: what the kit writes there (a card's place, `transform`) is kept as written. */
  readonly style: Record<string, string> & { setProperty: () => void } = Object.assign(Object.create(null), {
    setProperty: (): void => undefined,
  });
  scrollTop = 0;
  readonly classList = {
    add: (name: string): void => {
      if (!this.className.split(" ").includes(name)) this.className = `${this.className} ${name}`.trim();
    },
    remove: (name: string): void => {
      this.className = this.className
        .split(" ")
        .filter((c) => c !== "" && c !== name)
        .join(" ");
    },
    contains: (name: string): boolean => this.className.split(" ").includes(name),
    toggle: (name: string, on = !this.className.split(" ").includes(name)): boolean => {
      if (on) this.classList.add(name);
      else this.classList.remove(name);
      return on;
    },
  };
  readonly #root: boolean;
  constructor(tag: string, root = false) {
    super();
    this.localName = tag;
    this.#root = root;
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }
  getAttributeNames(): string[] {
    return [...this.attrs.keys()];
  }
  get childNodes(): Part[] {
    return [...this.kids];
  }
  get lastElementChild(): Part | null {
    return this.kids.at(-1) ?? null;
  }
  appendChild<T>(kid: T): T {
    if (kid instanceof Part) this.#put(kid, this.kids.length);
    return kid;
  }
  /** Puts what is given just before it, in what holds it. */
  before(...kids: unknown[]): void {
    for (const kid of kids)
      if (kid instanceof Part && this.holder) this.holder.#put(kid, this.holder.kids.indexOf(this));
  }
  /** Holds `kid` at `at`, written down if that puts it on the page (`aPage`'s `put`), as it is then. */
  #put(kid: Part, at: number): void {
    kid.remove();
    kid.holder = this;
    this.kids.splice(at, 0, kid);
    if (this.isConnected) page.put.push({ part: kid, transform: kid.style.transform ?? "" });
  }
  append(...kids: unknown[]): void {
    for (const kid of kids) this.appendChild(kid);
  }
  replaceChildren(...kids: unknown[]): void {
    for (const kid of this.kids.splice(0)) kid.holder = null;
    this.append(...kids);
  }
  remove(): void {
    const from = this.holder;
    if (!from) return;
    from.kids.splice(from.kids.indexOf(this), 1);
    this.holder = null;
  }
  /** It, and each that holds it, out to the page. */
  *#out(): Generator<Part> {
    yield this;
    if (this.holder) yield* this.holder.#out();
  }
  get isConnected(): boolean {
    return [...this.#out()].some((at) => at.#root);
  }
  contains(other: unknown): boolean {
    return other instanceof Part && [...other.#out()].includes(this);
  }
  matches(selector: string): boolean {
    return selector.split(",").some((one) => matchesOne(this, one.trim()));
  }
  /** Everything it holds, at any depth. */
  *#within(): Generator<Part> {
    for (const kid of this.kids) {
      yield kid;
      yield* kid.#within();
    }
  }
  /** What it holds with a class (`.name`): the only selector the stand-in page looks for within. */
  querySelectorAll(selector: string): Part[] {
    const name = selector.replace(/^\./, "");
    return [...this.#within()].filter((at) => at.className.split(" ").includes(name) || at.localName === name);
  }
  querySelector(selector: string): Part | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  /** Where it is on the page: at its place (`translate` in its style), as big as nothing. */
  getBoundingClientRect(): { left: number; top: number; right: number; bottom: number; width: number; height: number } {
    const [x = 0, y = 0] =
      /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/
        .exec(this.style.transform ?? "")
        ?.slice(1)
        .map(Number) ?? [];
    return { left: x, top: y, right: x, bottom: y, width: 0, height: 0 };
  }
  closest(selector: string): Part | null {
    return [...this.#out()].find((at) => at.matches(selector)) ?? null;
  }
  checkVisibility(): boolean {
    const hidden = (at: Part): boolean =>
      at.hidden || at.attrs.has("hidden") || at.className.split(" ").includes("hid");
    return this.isConnected && ![...this.#out()].some(hidden);
  }
  getClientRects(): unknown[] {
    return this.checkVisibility() ? [{}] : [];
  }
  focus(): void {
    page.focused = this;
  }
  getContext(): unknown {
    return inert;
  }
}

/** The stand-in page's one keyboard, the element that has it; and every element put on the page, with its place then. */
const page: { focused: Part | null; put: { part: Part; transform: string }[] } = { focused: null, put: [] };

/** The globals a page has that the stand-in page stands in for, by name. */
const PAGE_GLOBALS = ["document", "Element", "HTMLElement", "HTMLButtonElement"] as const;

/**
 * Stands in for a page the kit draws on and a player presses on: `el` makes `Part`s, and `body`
 * is the page (what is under it is on it). `put` lists every element put on the page, in turn, with
 * its place (`transform`) as it went on. `done` puts the real world back.
 */
export function aPage(): { body: Part; put: { part: Part; transform: string }[]; done: () => void } {
  const body = new Part("body", true);
  page.focused = null;
  page.put = [];
  const doc = {
    body,
    createElement: (tag: string) => new Part(tag),
    createTextNode: (text: string) => Object.assign(new Part("#text"), { textContent: text }),
    get activeElement(): Part | null {
      return page.focused;
    },
    querySelector: (): null => null,
  };
  const values: Record<(typeof PAGE_GLOBALS)[number], unknown> = {
    document: doc,
    Element: Part,
    HTMLElement: Part,
    HTMLButtonElement: Part,
  };
  for (const name of PAGE_GLOBALS) Object.defineProperty(globalThis, name, { value: values[name], configurable: true });
  return {
    body,
    put: page.put,
    done: () => {
      for (const name of PAGE_GLOBALS) Reflect.deleteProperty(globalThis, name);
    },
  };
}

/**
 * Stands in for drawing with no page: a canvas that takes any drawing and gives back blank pixels,
 * and a picture (a skin) that never loads. `noCanvas` takes them away again.
 */
export function blankCanvas(): void {
  const pen: object = new Proxy(
    {},
    {
      get: (_, name) =>
        name === "getImageData"
          ? (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) })
          : () => undefined,
      set: () => true,
    },
  );
  class Picture {
    src = "";
    addEventListener(): void {}
  }
  Object.assign(globalThis, {
    document: { createElement: () => ({ width: 1, height: 1, getContext: () => pen }) },
    Image: Picture,
    HTMLImageElement: Picture,
  });
}
/** Takes away what `blankCanvas` stood in. */
export const noCanvas = (): void =>
  void Object.assign(globalThis, { document: undefined, Image: undefined, HTMLImageElement: undefined });
