/**
 * The links to Leaf's Privacy and Terms pages, on notes.supply, at the foot of the settings menu of
 * every page (`menu.ts`), under every tab, the Account tab too. Each opens in a new tab. Where a page
 * cannot open a tab of its own, as in a Discord call, it says how to open an address (`open`), and a
 * press goes there instead.
 */
import { el } from "./dom.ts";

/** The two pages, as the links name them, and where they are. */
export const LEGAL_LINKS = [
  { word: "Privacy", url: "https://legal.notes.supply/games/leaf/privacy" },
  { word: "Terms", url: "https://legal.notes.supply/games/leaf/terms" },
] as const;

/** The two links: each to a new tab, or with `open`, a press calls it with the link's address instead. */
export function legalLinks(open?: (url: string) => void): HTMLElement {
  return el(
    "nav",
    "k-settings-legal",
    { "aria-label": "Privacy and terms" },
    ...LEGAL_LINKS.map(({ word, url }) =>
      el("a", "", {
        href: url,
        target: "_blank",
        rel: "noopener",
        text: word,
        onclick: open
          ? (e: Event) => {
              e.preventDefault();
              open(url);
            }
          : null,
      }),
    ),
  );
}
