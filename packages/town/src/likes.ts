/**
 * Likes of camps: one person's like of another's camp, given and taken back. Leaf keeps one for
 * each person and camp from the first time it is given, standing or taken back, so that the camp's
 * owner is told of it once, ever. A like pays nothing.
 */

/** A like as Leaf keeps it: when it was first given, when it was last given, and whether it stands. */
export interface Like {
  readonly first: number;
  readonly at: number;
  readonly liked: boolean;
}

/** Why a like is refused: it is the liker's own camp, or the owner has no camp. */
export type NoLike = "own_camp" | "no_camp";

/** What a like or taking one back does: the like to keep (null: none was ever given), and whether the owner is told. */
export interface Liking {
  readonly kept: Like | null;
  readonly tell: boolean;
}

/**
 * Gives (`on`) or takes back a like of `owner`'s camp by `liker`, who had `was` (null: never
 * liked it), as of `now`: the like to keep, and whether the owner is told, which is only the first
 * time it is ever given. Giving one that stands, or taking back one that does not, changes nothing.
 */
export function liking(o: {
  readonly liker: string;
  readonly owner: string;
  readonly hasCamp: boolean;
  readonly was: Like | null;
  readonly on: boolean;
  readonly now: number;
}): Liking | { readonly refused: NoLike } {
  if (o.liker === o.owner) return { refused: "own_camp" };
  if (!o.hasCamp) return { refused: "no_camp" };
  const { was, on, now } = o;
  if (was === null) return { kept: on ? { first: now, at: now, liked: true } : null, tell: on };
  if (was.liked === on) return { kept: was, tell: false };
  return { kept: on ? { ...was, at: now, liked: true } : { ...was, liked: false }, tell: false };
}
