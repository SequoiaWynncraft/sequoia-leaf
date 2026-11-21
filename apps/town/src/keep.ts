/**
 * Keeping things in the browser: the town's own record (see `save.ts` for what is in it), and any
 * other text a part of the town wants kept under a name. A browser that will not keep anything
 * still plays; it only forgets.
 *
 * `?fresh` in the address starts over: the record, the made-up guild's memory, the purse and the
 * sound setting all go back to how a new member finds them. It is taken out of the address again,
 * so that the next reload does not start over a second time.
 */

import { reset as resetPurse } from "@sequoia-leaf/kit/purse.ts";
import { setMuted } from "@sequoia-leaf/kit/sound.ts";

import { blank, type Kept, parse, write } from "./save.ts";

const KEY = "town.save.v1";
/** Everything the town itself keeps is under a name that starts like this. */
const OURS = /^town\.(save|guild)\./;

export function kept(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function keepText(key: string, text: string): void {
  try {
    localStorage.setItem(key, text);
  } catch {
    // It still holds for this visit.
  }
}

export function load(): Kept {
  return parse(kept(KEY)) ?? blank();
}

export function store(k: Kept): void {
  keepText(KEY, write(k));
}

function startOver(): void {
  try {
    const names: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const name = localStorage.key(i);
      if (name !== null && OURS.test(name)) names.push(name);
    }
    for (const name of names) localStorage.removeItem(name);
  } catch {
    // Nothing was kept, so there is nothing to forget.
  }
  resetPurse();
  setMuted(false);
}

/** Whether this visit began by starting over. */
export const fresh = typeof location !== "undefined" && new URLSearchParams(location.search).has("fresh");

if (fresh) {
  startOver();
  const url = new URL(location.href);
  url.searchParams.delete("fresh");
  history.replaceState(null, "", url);
}
