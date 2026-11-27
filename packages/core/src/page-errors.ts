// What a page tells Leaf when it fails (`POST /v1/game/page-errors`), as both sides read it.

import type { GameId } from "./games.ts";

export const PAGE_ERRORS_PATH = "/v1/game/page-errors";

/** The game's pages, each a page of its own (a game in the town's frame reports as itself). */
export const PAGES = ["town", "works", "battler"] as const;
export type Page = (typeof PAGES)[number];

/** The game whose rules each page is built with, whose version its reports carry. */
export const GAME_OF = { town: "town", works: "works", battler: "raid" } as const satisfies Record<Page, GameId>;

/**
 * What went wrong: an error nothing caught, a promise rejected that nothing handled, the page could
 * not sign in (the server answered, but not with who the player is), found no server, could not read
 * its game, loaded itself again three times running, has been out of its live room a minute, or
 * could not load its own styles or script, again after loading itself again (`assets`).
 */
export const PAGE_ERROR_KINDS = [
  "error",
  "rejection",
  "sign_in",
  "no_server",
  "first_read",
  "reloads",
  "live",
  "assets",
] as const;
export type PageErrorKind = (typeof PAGE_ERROR_KINDS)[number];

/** The browser a page ran in, by family. */
export const BROWSERS = ["firefox", "chrome", "edge", "safari", "other"] as const;
export type Browser = (typeof BROWSERS)[number];

/** The browser's family, from its user agent. */
export function browserOf(agent: string): Browser {
  if (/\bEdg(A|iOS)?\//.test(agent)) return "edge";
  if (/\b(Firefox|FxiOS)\//.test(agent)) return "firefox";
  if (/\b(Chrome|CriOS|Chromium)\//.test(agent)) return "chrome";
  if (/\bSafari\//.test(agent)) return "safari";
  return "other";
}

/** The longest message a report carries, and the longest stack, in characters. */
export const PAGE_ERROR_MESSAGE = 300;
export const PAGE_ERROR_STACK = 1024;

/** A page's report of its failure. */
export interface PageError {
  readonly page: Page;
  readonly kind: PageErrorKind;
  /** The version of the rules the page was built with. */
  readonly version: string;
  readonly browser: Browser;
  readonly message: string;
  readonly stack: string;
}
