import { pieceOf, tilesAt } from "./sizes.ts";
/**
 * Where a piece of more than one tile may stand (`sizes.ts`): every tile it covers must be the yard's
 * own clear ground, not water and not a redwood; a deposit is ground. Over a piece already standing
 * there (itself, laid again or turned) its own tiles count as clear.
 */
import { NONE } from "./tables.ts";
import { ground } from "./tiles.ts";
import type { Yard } from "./yard.ts";

/** Why a piece of a kind cannot stand with its own tile on (x, z) facing `d`, but over the piece standing on `self`'s tiles; nothing if it can. */
export function coverRefusal(y: Yard, k: number, x: number, z: number, d: number, self = -1): string | null {
  const { w, h } = y.land;
  for (const t of tilesAt(k, x, z, d, w, h)) {
    if (t < 0) return "That is off the map";
    const bad = ground(y, t % w, Math.floor(t / w));
    if (bad !== null) return bad;
    if (y.kind[t] !== NONE && (self < 0 || pieceOf(y, t) !== self)) return "Something is here already";
  }
  return null;
}
