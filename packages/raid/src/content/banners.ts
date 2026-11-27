/**
 * The pull banners: the one list of them, which the pulls game reads and has none of its own. A
 * banner opens with a release (`opens`): what its pulls give is what that release had brought
 * (`pullsEra`), and its headliner arrives with it. It is open on Leaf's clock from `from` until
 * `until`, opening no earlier than its release does; the first opened by a date of its own, during
 * the base. `banner-1` is gaz's figure's id as well as the banner's; a new headliner has its own id,
 * and its banner names it.
 */
import type { FigureId } from "./figures.ts";
import type { ReleaseId } from "./releases.ts";

export interface Banner {
  readonly id: string;
  /** What the banner is called, where it has a name of its own ("Groot Night"); one without goes by its headliner. */
  readonly name?: string;
  readonly opens: ReleaseId;
  readonly from: number;
  readonly until: number;
  /**
   * A five-acorn figure that a run with the member's own figures sells only to whoever pulled it,
   * and everyone's ways sell once a release makes it one of everyone's figures (`Figure.everyones`).
   */
  readonly headliner: FigureId;
  /**
   * How the headliner is drawn: by the set, or (`skin`) from the skin of the member Leaf says it is
   * (`banner_people`), who is all a page waits for before it shows the banner.
   */
  readonly look: Look;
  /**
   * What a skin's headliner is called: the member's name as Leaf says it (`name`), or (`title`) the
   * name the rules give the figure, so that the member's skin is shown and never their name.
   */
  readonly shows: "name" | "title";
  /**
   * The figures a draw of their rarity favours in this banner's pulls (`RATES.featured`): one of
   * them, evenly, half the time, and anything of that rarity otherwise. A rarity with none draws as
   * the grove does. Never the headliner, who is the top prize already.
   */
  readonly featured: readonly FigureId[];
}
/** How a figure is drawn: by the set, or from a member's skin. */
export type Look = "set" | "skin";

export const BANNERS: readonly Banner[] = [
  {
    id: "banner-1",
    opens: "base",
    from: Date.UTC(2026, 10, 23),
    until: Date.UTC(2026, 11, 8),
    headliner: "banner-1",
    look: "skin",
    shows: "name",
    featured: [],
  },
  // Groot Night: the Nest's banner. Its headliner is drawn from a member's skin and shown as the
  // Commodore; the four grooters he calls are four more members, in order (`called`, Leaf's).
  {
    id: "groot-night",
    name: "Groot Night",
    opens: "groot-night",
    from: Date.UTC(2026, 11, 8),
    until: Date.UTC(2026, 11, 22),
    headliner: "commodore",
    look: "skin",
    shows: "title",
    featured: ["crab8", "clutch", "crab31", "munch", "peep", "seqwawa"],
  },
];

/** The pool that is always open, with no headliner. */
export const GROVE = "grove";
