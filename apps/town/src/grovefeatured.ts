/**
 * What the Grove says at the head of a pool: until when a banner is open, or that the always-open
 * pool always is; and for a banner that has featured figures (Groot Night's), its headliner's
 * traits and ability in a few words, under the figure on its stand, and a row "Featured" of the
 * figures a draw of their rarity gives half the time, which its rules name too (`featuredOf`, the
 * pulls' own list). All of it read from the catalogue of Leaf's view, so a banner before its
 * release opens has nothing to show.
 */
import { portrait } from "@sequoia-leaf/figures/sprites.ts";
import { el } from "@sequoia-leaf/kit/dom.ts";
import { featuredOf, type PullsView, type Rarity } from "@sequoia-leaf/pulls";
import { catalogOf } from "@sequoia-leaf/raid/content/catalog.ts";
import { abilityShort, figureIn, traitsOf } from "@sequoia-leaf/raid/content/figures.ts";
import { traitIn } from "@sequoia-leaf/raid/content/traits.ts";

import { dayAndTime, rules, type Showing } from "./pulls.ts";

/** The rarities a banner has featured figures of, in its order: what its rules' featured line names. */
const featuredRarities = (view: Pick<PullsView, "era">, pool: string): Rarity[] => [
  ...new Set(featuredOf(catalogOf(view), pool).map((f) => f.rarity)),
];

/** The rules for the pool on show: a banner's (by its headliner, with its featured line), or the always-open pool's. */
export const rulesFor = (view: Pick<PullsView, "era">, b: Showing | null): string[] =>
  rules(b?.name ?? null, b ? featuredRarities(view, b.id) : []);

/** The head of the pool on show, beside an open banner: until when (or "Always open"), then a banner's featured block. */
export function bannerHead(view: Pick<PullsView, "era">, open: Showing | null, b: Showing | null): HTMLElement[] {
  if (!open) return [];
  return [el("div", "k-over", { text: b ? `Until ${dayAndTime(b.until)}` : "Always open" }), ...featuredBlock(view, b)];
}

/** The headliner's traits as chips and its ability in a few words, and the row of featured figures; nothing for a banner with none. */
function featuredBlock(view: Pick<PullsView, "era">, b: Showing | null): HTMLElement[] {
  const featured = b ? featuredOf(catalogOf(view), b.id) : [];
  if (!b || featured.length === 0) return [];
  const cat = catalogOf(view);
  const headliner = figureIn(cat, b.headliner);
  return [
    el(
      "div",
      "k-plaque grove-headliner",
      {},
      el(
        "span",
        "k-row",
        {},
        ...traitsOf(cat, b.headliner).map((t) => el("span", "k-chip", { text: traitIn(cat, t).name })),
      ),
      headliner.ability ? el("span", "k-read", { text: abilityShort(cat, b.headliner, 1) }) : null,
    ),
    el(
      "div",
      "grove-featured",
      {},
      el("span", "k-over", { text: "Featured" }),
      el(
        "span",
        "k-row",
        {},
        ...featured.map((f) => {
          const c = portrait(f.id);
          c.setAttribute("role", "img");
          c.setAttribute("aria-label", figureIn(cat, f.id).name);
          return c;
        }),
      ),
    ),
  ];
}
