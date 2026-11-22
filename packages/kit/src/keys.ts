/**
 * A key held down is one press. A browser says a held key again and again, and not every browser
 * marks those as repeats; a page that acts on each of them saves up whatever the key does (hops,
 * turns, panels opened and shut) for long after the key is let go.
 */

/** Each key down now, by which press put it down (presses are counted from 1). */
const down = new Map<string, number>();
let presses = 0;
/** What was said of each keydown, so that it can be asked again. */
const said = new WeakMap<object, boolean>();

if (typeof window !== "undefined") {
  // Before anything else hears it, so that whatever the key presses knows the key is down.
  window.addEventListener("keydown", (e) => void heldAgain(e), true);
  window.addEventListener("keyup", (e) => {
    down.delete(e.code);
  });
  window.addEventListener("blur", () => {
    down.clear();
  });
}

/**
 * Whether this `keydown` is a key already held saying itself again, by the browser's own word or
 * because the key has not come up since it last went down.
 */
export function heldAgain(e: Pick<KeyboardEvent, "repeat" | "code">): boolean {
  const known = said.get(e);
  if (known !== undefined) return known;
  const again = e.repeat || down.has(e.code);
  if (!again) down.set(e.code, ++presses);
  said.set(e, again);
  return again;
}

/** The keys that press a button with the keyboard on it. */
const PRESSES: ReadonlySet<string> = new Set(["Enter", "NumpadEnter", "Space"]);

/**
 * The keys down now that press a button, each by the press that put it down: to ask later whether
 * any is down still (`stillHeld`). Any other key held (Shift, a walking key) presses nothing.
 */
export const pressKeysHeld = (): ReadonlyMap<string, number> =>
  new Map([...down].filter(([code]) => PRESSES.has(code)));

/** Whether a key of `then` is still down from the same press: it has not come up since. */
export const stillHeld = (then: ReadonlyMap<string, number>): boolean =>
  [...then].some(([code, press]) => down.get(code) === press);

/** Whether a key is going into a field the player is typing in: the game leaves those keys alone. */
export const typing = (e: Pick<KeyboardEvent, "target">): boolean =>
  typeof HTMLElement !== "undefined" &&
  e.target instanceof HTMLElement &&
  (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement || e.target.isContentEditable);

/** Lets go of every key held: for the tests. */
export const noKeysHeld = (): void => {
  down.clear();
};
