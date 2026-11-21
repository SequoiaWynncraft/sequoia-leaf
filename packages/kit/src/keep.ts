/**
 * Writing the game into the browser. Every page writes what it keeps through `keepText`, so that a
 * page that has let go of the browser's game writes nothing more into it: not as it goes away, and
 * not from a timer that fires on the way out.
 *
 * A page lets go (`stop`, from `cloud.ts`) when the browser turns out to hold another member's game:
 * what this page still holds in memory is the member it started as, and written into the browser it
 * would become the other member's, and be sent to their account by their own page. So that no write
 * slips in before the page hears of it, each write first asks the cloud (`askFirst`) whether the
 * browser's game is still this page's; when it is not, the page stops there and then.
 *
 * What is not anybody's game (the sound, where the member was last sent to sign in) is written
 * straight into storage, and may still be written after that.
 */

import { outside } from "./net.ts";

let halted = false;
/** Asked before each write: whether the browser's game is still this page's. */
let ours: () => boolean = () => true;

/** Whether this page has let go of the browser's game, and writes nothing of it any more. */
export const stopped = (): boolean => halted;

/** From now on this page writes nothing of the game into the browser. For good: only loading again starts over. */
export function stop(): void {
  halted = true;
}

/** Has every later write first ask `check` whether the browser's game is still this page's (from `cloud.ts`). */
export function askFirst(check: () => boolean): void {
  ours = check;
}

/**
 * Keeps a text under a name; `null` forgets it. Says whether it was written: not after `stop`, and
 * not without storage (the game then only holds it for this visit).
 */
export function keepText(name: string, text: string | null): boolean {
  if (halted || !ours()) return false;
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

/** Every name kept in the browser now. */
export function keptNames(): string[] {
  const names: string[] = [];
  try {
    const store = outside.store();
    if (!store) return names;
    for (let i = 0; i < store.length; i++) {
      const name = store.key(i);
      if (name !== null) names.push(name);
    }
  } catch {
    // Nothing kept that can be listed.
  }
  return names;
}

/** Lets the page write again, without asking first (for tests). */
export function forgetStop(): void {
  halted = false;
  ours = () => true;
}
