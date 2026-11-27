/**
 * Lore: a line for the almanac about where a figure or a trait comes from. The table is told at the
 * stump; the gnomes, who were not there, carve what they hear. The fight never reads this.
 *
 * Only the expansion's new figures and traits have a line yet; the rest come with the page's words.
 */
import type { FigureId } from "./figures.ts";
import type { TraitId } from "./traits.ts";

export const LORE: Readonly<Partial<Record<FigureId | TraitId, string>>> = {
  seqwawa: "What is left of the guild's own tree. It is still growing.",
  groot: "Carved from what the raiders said. A true form is what the raiders saw.",
  rooted: "It was a tree before it was a figure and sees no reason to move.",
};
