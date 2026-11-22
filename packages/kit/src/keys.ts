/**
 * A key held down is one press. A browser says a held key again and again, and not every browser
 * marks those as repeats; a page that acts on each of them saves up whatever the key does (hops,
 * turns, panels opened and shut) for long after the key is let go.
 */

const down = new Set<string>();

if (typeof window !== "undefined") {
  window.addEventListener("keyup", (e) => {
    down.delete(e.code);
  });
  window.addEventListener("blur", () => {
    down.clear();
  });
}

/**
 * Whether this `keydown` is a key already held saying itself again, by the browser's own word or
 * because the key has not come up since it last went down. Ask once for each `keydown`.
 */
export function heldAgain(e: Pick<KeyboardEvent, "repeat" | "code">): boolean {
  const again = e.repeat || down.has(e.code);
  down.add(e.code);
  return again;
}

/** Whether a key is going into a field the player is typing in: the game leaves those keys alone. */
export const typing = (e: Pick<KeyboardEvent, "target">): boolean =>
  typeof HTMLElement !== "undefined" &&
  e.target instanceof HTMLElement &&
  (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement || e.target.isContentEditable);

/** Forgets every key held: for the tests. */
export const noKeysHeld = (): void => {
  down.clear();
};
