/**
 * The yard's plumbing, as the rules work it out from what stands where (`wire.ts`) and keep it on the
 * yard (`Yard.wire`) until it next changes: who hands to whom and in what order, what carries, works
 * and burns, and the rings in it.
 */
import type { Recipe } from "./tables.ts";

/**
 * The rings in the plumbing: parts of it where things handed on can come back round, each tile
 * handing to the next on a side that takes from it (a tunnel passes under), worked out by Tarjan's
 * walk (`walk.ts`). Round a ring no order puts each tile after the tile it hands to, so a ring takes
 * its turn as one (`round.ts`): over and over, each piece handing on at most once, until nothing on it
 * moves. So a full ring with a way off it moves as one at the belt's pace, as a full belt does, and a
 * full ring with none stays still.
 */
export interface Rings {
  readonly count: number;
  /** Each ring's tiles, ring by ring, each ring's in the handing order: ring `k`'s from `starts[k]` to `starts[k + 1]`. */
  readonly tiles: Int32Array;
  readonly starts: Int32Array;
  /** 1 for each ring with a way off it: a tile of it hands to a tile off it, on a side that takes from it. */
  readonly exits: Uint8Array;
  /** The ring tiles by tile, ascending, and each one's ring (`ringAt`). */
  readonly sorted: Int32Array;
  readonly ringOf: Int32Array;
  /** Room for which ring tiles have handed on this tick (`round.ts`). */
  readonly done: Uint8Array;
}

/** The yard's plumbing, worked out from what stands where (`wire.ts`). */
export interface Wire {
  /**
   * Tiles that hand things on, each after the tiles it hands to. In a yard with rings, each ring's
   * tiles are taken out of it, and where the last of them stood is -1 less the ring's number: the
   * ring takes its turn there, as one (`Rings`, `round.ts`).
   */
  readonly order: Int32Array;
  /** The rings in it, where things handed on come back round (`Rings`): none in most yards. */
  readonly rings: Rings;
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
