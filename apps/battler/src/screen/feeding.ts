/**
 * Feeding Greg from the page, with nothing of the page in it, so that it can be tested: which Greg
 * a figure from the bench would be fed to, and what letting it go on the feed target would do. The
 * rules say both (`mealFor`); this only picks the Greg.
 */
import { mealFor, type RunView, type Spot } from "@sequoia-leaf/raid";

/** The Gregs in a row of places (the board, or the bench), the most stars first. */
const gregsIn = (row: RunView["board"], on: Spot["on"]): { spot: Spot; stars: number }[] =>
  row
    .flatMap((piece, at) => (piece?.kind === "greg" ? [{ spot: { on, at }, stars: piece.stars }] : []))
    .toSorted((a, b) => b.stars - a.stars);

/** The party's Gregs in the order a figure is offered to them: those fielded first, then those on the bench, the most stars first. */
export const gregsOf = (run: RunView): Spot[] =>
  [...gregsIn(run.board, "board"), ...gregsIn(run.bench, "bench")].map((g) => g.spot);

/**
 * What the feed target says for the figure carried from `from`: the first Greg that still has room
 * (`gregsOf`) and what this one would add him (the number shown before letting go); that Greg is
 * full, when every Greg is (said, with no target); or nothing at all, for no Greg, a figure not from
 * the bench, or a Greg.
 */
export type FeedOffer = { to: Spot; gained: number } | { full: true } | null;

export function feedOffer(run: RunView, from: Spot): FeedOffer {
  const gregs = gregsOf(run);
  if (gregs.length === 0 || from.on !== "bench") return null;
  for (const to of gregs) {
    const meal = mealFor(run, from, to);
    if (meal.ok) return { to, gained: meal.gained };
    if (meal.code !== "greg_full") return null;
  }
  return { full: true };
}

/** The feed target's words: "Feed Greg +6%", or "Greg is full". */
export const feedWords = (offer: Exclude<FeedOffer, null>): string =>
  "full" in offer ? "Greg is full" : `Feed Greg +${offer.gained}%`;
