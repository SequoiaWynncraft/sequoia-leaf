/**
 * Feeding Greg from the page, with nothing of the page in it, so that it can be tested: which Greg
 * a figure from the bench would be fed to, and what letting it go on the feed target would do. The
 * rules say both (`mealFor`); this only picks the Greg.
 */
import { mealFor, type RunView, type Spot } from "@sequoia-leaf/raid";

/** The Greg with the most stars in a row of places (the board, or the bench), if there is one. */
const most = (row: RunView["board"], on: Spot["on"]): { spot: Spot; stars: number } | null =>
  row.reduce<{ spot: Spot; stars: number } | null>(
    (best, piece, at) =>
      piece?.kind === "greg" && (!best || piece.stars > best.stars) ? { spot: { on, at }, stars: piece.stars } : best,
    null,
  );

/** The party's Greg a figure is fed to: the one on the board with the most stars, else the one on the bench with the most. */
export function gregOf(run: RunView): Spot | null {
  return (most(run.board, "board") ?? most(run.bench, "bench"))?.spot ?? null;
}

/**
 * What the feed target says for the figure carried from `from`: Greg's place and what this one would
 * add (the number shown before letting go); that Greg is full (said, with no target); or nothing at
 * all, for no Greg, a figure not from the bench, or a Greg.
 */
export type FeedOffer = { to: Spot; gained: number } | { full: true } | null;

export function feedOffer(run: RunView, from: Spot): FeedOffer {
  const to = gregOf(run);
  if (!to || from.on !== "bench") return null;
  const meal = mealFor(run, from, to);
  if (meal.ok) return { to, gained: meal.gained };
  return meal.code === "greg_full" ? { full: true } : null;
}

/** The feed target's words: "Feed Greg +6%", or "Greg is full". */
export const feedWords = (offer: Exclude<FeedOffer, null>): string =>
  "full" in offer ? "Greg is full" : `Feed Greg +${offer.gained}%`;
