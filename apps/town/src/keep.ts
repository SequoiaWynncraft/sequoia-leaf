/**
 * Keeping things in the browser: the town's own record (see `save.ts` for what is in it), and any
 * other text a part of the town wants kept under a name. A browser that will not keep anything
 * still plays; it only forgets. Everything is written through the kit's `keepText`, so a page that
 * has let go of the browser's game (`stopped()`) writes none of it.
 *
 * `?fresh` in the address starts over: the record, the made-up guild's memory, the purse and the
 * sound setting all go back to how a new member finds them. It is taken out of the address again,
 * so that the next reload does not start over a second time. On the guild's own server it is only
 * taken out.
 */

import { keepText, keptNames, keptText } from "@sequoia-leaf/kit/keep.ts";
import { where } from "@sequoia-leaf/kit/live.ts";
import { reset as resetPurse } from "@sequoia-leaf/kit/purse.ts";
import { setMuted } from "@sequoia-leaf/kit/sound.ts";

import { blank, type Kept, parse, write } from "./save.ts";

const KEY = "town.save.v1";
/** Everything the town itself keeps is under a name that starts like this. */
const OURS = /^town\.(save|guild)\./;

export { keepText, keptText as kept };

export function load(): Kept {
  return parse(keptText(KEY)) ?? blank();
}

export function store(k: Kept): void {
  keepText(KEY, write(k));
}

function startOver(): void {
  for (const name of keptNames()) if (OURS.test(name)) keepText(name, null);
  resetPurse();
  setMuted(false);
}

const asked = typeof location !== "undefined" && new URLSearchParams(location.search).has("fresh");

/** Whether this visit began by starting over. On the guild's server it never does: that game is the member's account's. */
export const fresh = asked && where().mode !== "live";

if (asked) {
  if (fresh) startOver();
  const url = new URL(location.href);
  url.searchParams.delete("fresh");
  history.replaceState(null, "", url);
}
