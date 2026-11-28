/**
 * The yard's plumbing, as the rules work it out from what stands where (`wire.ts`) and keep it on the
 * yard (`Yard.wire`) until it next changes: who hands to whom and in what order, what carries, works
 * and burns, and the rings in it.
 */
import type { Recipe } from "./tables.ts";

/**
 * The rings in the plumbing: parts of it where things handed on can come back round, each tile handing
 * to the next as it stands now, a thing it may hand on to one that takes it from that side (a tunnel
 * passes under), worked out by Tarjan's walk (`walk.ts`, `rings.ts`). For status alone: the tick reads
 * none of it.
 */
export interface Rings {
  readonly count: number;
  /** Each ring's tiles, ring by ring, in the handing order: ring `k`'s from `starts[k]` to `starts[k + 1]`. */
  readonly tiles: Int32Array;
  readonly starts: Int32Array;
  /** The ring tiles by tile, ascending, and each one's ring (`ringAt`). */
  readonly sorted: Int32Array;
  readonly ringOf: Int32Array;
}

/** The yard's plumbing, worked out from what stands where (`wire.ts`). */
export interface Wire {
  /** Tiles that hand things on, each after the tiles it hands to. */
  readonly order: Int32Array;
  /** The rings in it, where things handed on come back round (`Rings`), once status has asked: for status alone, none in most yards. */
  rings: Rings | null;
  /** Tiles that carry, tiles that work, and tiles that burn for power (a boiler) within reach of power. */
  readonly carry: Int32Array;
  /** Tunnels' way-in mouths, which carry things under the ground too. */
  readonly mouths: Int32Array;
  readonly work: Int32Array;
  readonly burners: Int32Array;
  /** For each tile, the sides it takes things in from, a bit each (`sidesTaken`). */
  readonly taken: Uint8Array;
  /** For each kind of machine, the recipes it may make (`recipesFor`): all a machine reads of what is unlocked. */
  readonly recipes: readonly (readonly Recipe[])[];
  /** Power always there (the depot, and what gives it steadily: the waterwheels), and power drawn. */
  readonly steady: number;
  readonly demand: number;
  /**
   * 1 for each tile that waits: it holds a thing the tile it hands to has no room for, so handing
   * on passes it over until a tile beside it may have room (`tick.ts`). Forgotten whenever the yard
   * is changed other than by its ticks: with the plumbing, and after a command (`waitingFrom`).
   */
  readonly waiting: Uint8Array;
  /** The yard's `rev` when `waiting` was last forgotten. */
  waitingFrom: number;
}
