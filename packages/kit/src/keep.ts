/**
 * Keeping view settings in the browser (the zoom, which nudges a member has had, the sound). Nothing
 * of anybody's game is kept here: that is Leaf's. A browser that will not keep anything still
 * plays; it only forgets.
 */

import { outside } from "./net.ts";

/** Keeps a text under a name; `null` forgets it. Says whether it was written: not without storage. */
export function keepText(name: string, text: string | null): boolean {
  try {
    const store = outside.store();
    if (!store) return false;
    if (text === null) store.removeItem(name);
    else store.setItem(name, text);
    return true;
  } catch {
    return false;
  }
}

/** The text kept under a name, or null where there is none or no storage. */
export function keptText(name: string): string | null {
  try {
    return outside.store()?.getItem(name) ?? null;
  } catch {
    return null;
  }
}
