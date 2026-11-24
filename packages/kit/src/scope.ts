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

/** A new scope, owned by whoever made it. */
export const scope = (): Scope => new Scope();
