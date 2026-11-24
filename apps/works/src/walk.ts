/**
 * Walking a group of pieces in trouble (the yard's sheet, `ui/views.ts`), as one value moved by one
 * function: not walking, or walking a group (by what is wrong with it) at one of its pieces. The bar
 * that shows it, and the page's look while it is up, follow from this value alone. Nothing here
 * touches the page or the yard: the group's tiles as they are now are handed in.
 */

export type Walk = { readonly is: "idle" } | { readonly is: "walking"; readonly title: string; readonly tile: number };

export type WalkEvent =
  /** A group was pressed: its tiles, the first first. */
  | { readonly do: "start"; readonly title: string; readonly tiles: readonly number[] }
  /** Back (-1) or on (1) along the group, as it is now (null: mended, nothing in it is in trouble). */
  | { readonly do: "step"; readonly by: 1 | -1; readonly tiles: readonly number[] | null }
  /**
   * Looked at again: the group as it is now, and whether the bar has somewhere to be (the panel
   * beside the yard is open, or the screen is a phone's, where it sits under the top row).
   */
  | { readonly do: "look"; readonly tiles: readonly number[] | null; readonly shown: boolean }
  | { readonly do: "stop" };

export const NOT_WALKING: Walk = { is: "idle" };

/** The tile to go to from `here` along `tiles`: the next one that way, or from a piece no longer in trouble, the nearest still in it that way. */
function along(tiles: readonly number[], here: number, by: 1 | -1): number | undefined {
  const at = tiles.indexOf(here);
  if (at >= 0) return tiles[(at + by + tiles.length) % tiles.length];
  return by > 0 ? (tiles.find((t) => t > here) ?? tiles[0]) : (tiles.findLast((t) => t < here) ?? tiles.at(-1));
}

/** The walk after an event: its group mended, or nowhere for the bar to be, it ends. */
export function walkStep(w: Walk, e: WalkEvent): Walk {
  switch (e.do) {
    case "start": {
      const first = e.tiles[0];
      return first === undefined ? NOT_WALKING : { is: "walking", title: e.title, tile: first };
    }
    case "stop":
      return NOT_WALKING;
    case "step": {
      if (w.is === "idle") return w;
      const next = e.tiles ? along(e.tiles, w.tile, e.by) : undefined;
      return next === undefined ? NOT_WALKING : { ...w, tile: next };
    }
    case "look":
      return w.is === "walking" && (e.tiles === null || e.tiles.length === 0 || !e.shown) ? NOT_WALKING : w;
  }
}

/** Which of how many the walk is at, as the bar says it; from a piece no longer in trouble, how many are left. */
export const walkAt = (tile: number, tiles: readonly number[]): string => {
  const at = tiles.indexOf(tile);
  return at >= 0 ? `${at + 1} of ${tiles.length}` : `${tiles.length} left`;
};
