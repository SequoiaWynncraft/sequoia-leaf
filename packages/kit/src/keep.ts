/**
 * Keeping view settings in the browser (the zoom, which nudges a member has had, the sound), or in
 * the tab only, until it closes (where the town was looking). Nothing of anybody's game is kept
 * here: that is Leaf's. A browser that will not keep anything still plays; it only forgets.
 */

import { outside, type Store } from "./net.ts";

/** Where a text is kept: in the browser, or in this tab only. */
export type Shelf = "browser" | "tab";

const storeOf = (shelf: Shelf): Store | null => (shelf === "tab" ? outside.tab() : outside.store());

/** Keeps a text under a name; `null` forgets it. Says whether it was written: not without storage. */
export function keepText(name: string, text: string | null, shelf: Shelf = "browser"): boolean {
  try {
    const store = storeOf(shelf);
    if (!store) return false;
    if (text === null) store.removeItem(name);
    else store.setItem(name, text);
    return true;
  } catch {
    return false;
  }
}

/** The text kept under a name, or null where there is none or no storage. */
export function keptText(name: string, shelf: Shelf = "browser"): string | null {
  try {
    return storeOf(shelf)?.getItem(name) ?? null;
  } catch {
    return null;
  }
}
