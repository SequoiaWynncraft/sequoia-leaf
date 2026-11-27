/**
 * Scopes: what a page, a panel, a press or a socket attempt holds of the browser, let go of
 * together. A scope listens, waits, ticks, asks for frames, watches nodes and opens sockets; each of
 * those gives back how to let go of it alone, and closing the scope lets go of everything it still
 * holds, its children's too, the newest first. Closing twice is closing once, and a closed scope
 * starts nothing.
 *
 * This is the one file that may call the browser's own `addEventListener`, `setTimeout`,
 * `setInterval`, `requestAnimationFrame`, `MutationObserver`, `ResizeObserver` and `new WebSocket`
 * (`.oxlintrc.json` holds that): everything else asks a scope.
 */

/** Lets go of one thing a scope holds. Letting go twice is letting go once. */
export type Release = () => void;

/** How a listener listens: on the way down (`capture`), and whether it promises not to stop scrolling. */
export interface Listen {
  readonly capture?: boolean;
  readonly passive?: boolean;
}

const nothing: Release = () => undefined;

export class Scope {
  /** What it holds, as how to let go of each; null once it has closed. */
  #held: Set<Release> | null = new Set();

  get closed(): boolean {
    return this.#held === null;
  }

  /** Holds something that `release` lets go of: at once, if this scope has closed. */
  #own(release: () => void): Release {
    const held = this.#held;
    if (held === null) {
      release();
      return nothing;
    }
    let live = true;
    const off = (): void => {
      if (!live) return;
      live = false;
      held.delete(off);
      release();
    };
    held.add(off);
    return off;
  }

  /** Holds a listener of the page's own (a keymap's, the settings'), given as how to stop it: stopped as the scope closes. */
  hold(stop: () => void): Release {
    return this.#own(stop);
  }

  /** A scope of its own that closes when this one does, and may close before it. */
  child(): Scope {
    const child = new Scope();
    child.#own(this.#own(() => child.close()));
    return child;
  }

  /**
   * Children for one thing at a time: the tab on show, the card on top, what the hand is doing.
   * Each call names the thing on show now; while it is the same as the last (`Object.is`), the same
   * child is given back, and for anything else that child closes and a new one opens. Whoever tells
   * it of every change (a tab leaving, a panel shutting) has the thing's own scope from it.
   */
  turns(): (now: unknown) => Scope {
    let shown: { readonly what: unknown; readonly scope: Scope } | null = null;
    return (now) => {
      if (shown && !shown.scope.closed && Object.is(shown.what, now)) return shown.scope;
      shown?.scope.close();
      shown = { what: now, scope: this.child() };
      return shown.scope;
    };
  }

  /**
   * Hears `kind` on `target` until let go of. Each call listens with a function of its own, so the
   * same `fn` given twice, here or in another scope, is two listeners, and letting go of one leaves
   * the other.
   */
  on<K extends keyof GlobalEventHandlersEventMap>(
    target: EventTarget,
    kind: K,
    fn: (e: GlobalEventHandlersEventMap[K]) => void,
    opts?: Listen,
  ): Release;
  on(target: EventTarget, kind: string, fn: (e: Event) => void, opts?: Listen): Release;
  on(target: EventTarget, kind: string, fn: (e: Event) => void, opts: Listen = {}): Release {
    if (this.closed) return nothing;
    const heard = (e: Event): void => fn(e);
    target.addEventListener(kind, heard, opts);
    return this.#own(() => target.removeEventListener(kind, heard, opts));
  }

  /** Runs `fn` once, `ms` from now. */
  after(ms: number, fn: () => void): Release {
    if (this.closed) return nothing;
    const id = setTimeout(() => {
      off();
      fn();
    }, ms);
    const off = this.#own(() => clearTimeout(id));
    return off;
  }

  /** Runs `fn` every `ms`. */
  every(ms: number, fn: () => void): Release {
    if (this.closed) return nothing;
    const id = setInterval(fn, ms);
    return this.#own(() => clearInterval(id));
  }

  /** Runs `fn` before the next frame is drawn, once. */
  frame(fn: (t: number) => void): Release {
    if (this.closed) return nothing;
    const id = requestAnimationFrame((t) => {
      off();
      fn(t);
    });
    const off = this.#own(() => cancelAnimationFrame(id));
    return off;
  }

  /** Runs `fn` when `node` changes (`what` says how, as a MutationObserver's options), or when its size does (`"size"`). */
  observe(node: Element, what: MutationObserverInit | "size", fn: () => void): Release {
    if (this.closed) return nothing;
    if (what === "size") {
      const sized = new ResizeObserver(fn);
      sized.observe(node);
      return this.#own(() => sized.disconnect());
    }
    const changed = new MutationObserver(fn);
    changed.observe(node, what);
    return this.#own(() => changed.disconnect());
  }

  /** A socket, closed when let go of; none from a scope that has closed. */
  socket(
    url: string | URL,
    protocols?: string | string[],
  ): { readonly socket: WebSocket; readonly release: Release } | null {
    if (this.closed) return null;
    const socket = new WebSocket(url, protocols);
    return { socket, release: this.#own(() => socket.close()) };
  }

  /** Lets go of everything it holds, the newest first. */
  close(): void {
    const held = this.#held;
    if (held === null) return;
    this.#held = null;
    for (const off of [...held].toReversed()) off();
  }
}

/** What the page hears as the guard (`guard.ts`) takes it over, to show its line or load it again. */
export const TAKEN = "leaf:taken";

/** A whole page's scope, which closes when `events` hears `TAKEN`: nothing the page opened runs on against a page the guard has taken. */
export function pageScope(events: EventTarget | null): Scope {
  const root = new Scope();
  if (events !== null) root.on(events, TAKEN, () => root.close());
  return root;
}

/** The page's scope, on the window (none where there is no window, as in tests). */
const page = pageScope("addEventListener" in globalThis ? globalThis : null);

/** A new scope, owned by whoever made it, and closed with the page's when the guard takes the page over. */
export const scope = (): Scope => page.child();
