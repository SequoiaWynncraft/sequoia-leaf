/** The model in the browser: kept in localStorage, and anyone interested told when it changes. */

import { type GroveState, parseState, STORAGE_KEY } from "./state.ts";

/** localStorage, or nothing in a private window or a preview, where the state then lasts the visit. */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export class Store {
  private current: GroveState;
  private readonly listeners = new Set<() => void>();

  constructor(reset: boolean) {
    const s = storage();
    if (reset) s?.removeItem(STORAGE_KEY);
    this.current = parseState(s?.getItem(STORAGE_KEY) ?? null);
  }

  get state(): GroveState {
    return this.current;
  }

  set(next: GroveState): void {
    this.current = next;
    try {
      storage()?.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // A full or blocked store: the change still holds for this visit.
    }
    for (const fn of this.listeners) fn();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
