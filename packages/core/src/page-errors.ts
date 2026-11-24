// What a page tells Leaf when it fails (`POST /v1/game/page-errors`), as both sides read it.

export const PAGE_ERRORS_PATH = "/v1/game/page-errors";

/** The game's pages, each a page of its own (a game in the town's frame reports as itself). */
export const PAGES = ["town", "works", "battler"] as const;
export type Page = (typeof PAGES)[number];

/**
 * What went wrong: an error nothing caught, a promise rejected that nothing handled, the page could
 * not sign in (the server answered, but not with who the player is), found no server, could not read
 * its game, loaded itself again three times running, or has been out of its live room a minute.
 */
export const PAGE_ERROR_KINDS = [
  "error",
  "rejection",
  "sign_in",
  "no_server",
  "first_read",
  "reloads",
  "live",
] as const;
export type PageErrorKind = (typeof PAGE_ERROR_KINDS)[number];

/** The browser a page ran in, by family. */
export const BROWSERS = ["firefox", "chrome", "edge", "safari", "other"] as const;
export type Browser = (typeof BROWSERS)[number];

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
