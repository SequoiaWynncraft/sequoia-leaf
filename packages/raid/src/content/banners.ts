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
  },
];

/** The pool that is always open, with no headliner. */
export const GROVE = "grove";
