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

/**
 * The scope of each thing the browser holds for one (a listener, a timer's or a frame's function, an
 * observer, a socket), kept while the browser keeps that thing: a scope lives as long as anything it
 * started is live, so the page can still close it (`pageScopes`), and no longer than that.
 */
const KEPT = new WeakMap<object, Scope>();

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
    KEPT.set(heard, this);
    target.addEventListener(kind, heard, opts);
    return this.#own(() => target.removeEventListener(kind, heard, opts));
  }

  /** Runs `fn` once, `ms` from now. */
  after(ms: number, fn: () => void): Release {
    if (this.closed) return nothing;
    const ran = (): void => {
      off();
      fn();
    };
    KEPT.set(ran, this);
    const id = setTimeout(ran, ms);
    const off = this.#own(() => clearTimeout(id));
    return off;
  }

  /** Runs `fn` every `ms`. */
  every(ms: number, fn: () => void): Release {
    if (this.closed) return nothing;
    const ran = (): void => fn();
    KEPT.set(ran, this);
    const id = setInterval(ran, ms);
    return this.#own(() => clearInterval(id));
  }

  /** Runs `fn` before the next frame is drawn, once. */
  frame(fn: (t: number) => void): Release {
    if (this.closed) return nothing;
    const drawn = (t: number): void => {
      off();
      fn(t);
    };
    KEPT.set(drawn, this);
    const id = requestAnimationFrame(drawn);
    const off = this.#own(() => cancelAnimationFrame(id));
    return off;
  }

  /** Runs `fn` when `node` changes (`what` says how, as a MutationObserver's options), or when its size does (`"size"`). */
  observe(node: Element, what: MutationObserverInit | "size", fn: () => void): Release {
    if (this.closed) return nothing;
    if (what === "size") {
      const sized = new ResizeObserver(fn);
      KEPT.set(sized, this);
      sized.observe(node);
      return this.#own(() => sized.disconnect());
    }
    const changed = new MutationObserver(fn);
    KEPT.set(changed, this);
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
    KEPT.set(socket, this);
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

/**
 * A page's maker of scopes: every scope it makes closes when `events` hears `TAKEN`, so nothing the
 * page opened runs on against a page the guard has taken, and one made after that is closed from the
 * start. It holds them only weakly: a scope lives while anything it started is live (`KEPT`), so one
 * on an element that is thrown away goes with the element, and one listening on the window stays
 * until it is closed.
 */
export function pageScopes(events: EventTarget | null): () => Scope {
  const live = new Set<WeakRef<Scope>>();
  const gone = new FinalizationRegistry<WeakRef<Scope>>((ref) => live.delete(ref));
  const page = { taken: false };
  if (events !== null)
    new Scope().on(events, TAKEN, () => {
      page.taken = true;
      for (const ref of live) ref.deref()?.close();
      live.clear();
    });
  return () => {
    const made = new Scope();
    if (page.taken) {
      made.close();
      return made;
    }
    const ref = new WeakRef(made);
    live.add(ref);
    gone.register(made, ref);
    return made;
  };
}

/** Scopes for this page, on the window (none closed by a takeover where there is no window, as in tests). */
const made = pageScopes("addEventListener" in globalThis ? globalThis : null);

/** A new scope, owned by whoever made it, and closed when the guard takes the page over. */
export const scope = (): Scope => made();
