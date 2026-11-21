/**
 * The quest board kept in step with the quests. Each note is drawn for one quest and brought up to
 * date in place as it moves. When the quests themselves are no longer the ones on the board (one
 * expired, or was swapped from another page, and another took its slot), the board is drawn again
 * whole, so that no note is left up for a quest that is gone.
 */

/** Quest ids as a set, written out the same whatever order they came in. */
const setOf = (ids: readonly string[]): string => [...new Set(ids)].toSorted((a, b) => a.localeCompare(b)).join("\n");

/**
 * A board drawn by `draw`, which gives back how to bring what it drew up to date. The function
 * given back draws the board again whole when the ids `ids` gives are not the set it was last drawn
 * for, and otherwise brings it up to date in place.
 */
export function redrawn(ids: () => readonly string[], draw: () => () => void): () => void {
  let shown = setOf(ids());
  let update = draw();
  return () => {
    const now = setOf(ids());
    if (now !== shown) {
      shown = now;
      update = draw();
    }
    update();
  };
}
