/**
 * The page telling Leaf when it fails (`PAGE_ERRORS_PATH`), so that a player's "I can't get back in"
 * leaves a line in Leaf's log and a number on its dashboard. A page calls `watchPage` first thing in
 * its boot; it reports, at most `MOST` times a load and each thing once:
 *
 * - an error nothing caught, or a promise rejected that nothing handled;
 * - the page could not sign in: Leaf answered, but not with who the player is (`start()` closed), or
 *   no Leaf answered at all;
 * - the page could not read its game (`failedToOpen`, from the boot's own failure);
 * - the page loaded itself again a third time in a row, each within `AGAIN_MS` of the last;
 * - it has been out of its live room for `LIVE_DOWN_MS`, while still trying (`heardLive`).
 *
 * Each report says the page, the rules it was built with, the browser's family, the message and the
 * first of the stack, every address in them without its query or fragment. Nothing the player typed
 * is sent. Leaf limits the reports too, and answers each the same.
 */

import {
  type Browser,
  type Page,
  PAGE_ERROR_MESSAGE,
  PAGE_ERROR_STACK,
  PAGE_ERRORS_PATH,
  type PageError,
  type PageErrorKind,
} from "@sequoia-leaf/core";
import { rulesVersions } from "@sequoia-leaf/core/build/rules.ts" with { type: "macro" };

import { start, type Where } from "./live.ts";
import { ask, outside } from "./net.ts";
import type { Trouble } from "./play.ts";
import type { LiveStatus } from "./realtime.ts";

/** The version of each game's rules this page was built with, made as it was built. */
const RULES = rulesVersions();
/** The game whose rules each page is built with. */
const GAME_OF = { town: "town", works: "works", battler: "raid" } as const satisfies Record<Page, keyof typeof RULES>;

/** The most reports one load of a page sends: an error in a drawing loop would send one a frame. */
export const MOST = 5;
/** How long a page goes out of its live room, still trying, before it says so. */
export const LIVE_DOWN_MS = 60_000;
/** A load of the page again this soon after the one before is one in a row. */
export const AGAIN_MS = 15_000;
/** How many loads in a row, after the first, the page says so at. */
const RELOADS = 3;

/** The browser's family, from its user agent. */
export function browserOf(agent: string): Browser {
  if (/\bEdg(A|iOS)?\//.test(agent)) return "edge";
  if (/\b(Firefox|FxiOS)\//.test(agent)) return "firefox";
  if (/\b(Chrome|CriOS|Chromium)\//.test(agent)) return "chrome";
  if (/\bSafari\//.test(agent)) return "safari";
  return "other";
}

/** Text with every address's query and fragment taken out (a stack frame's line and column kept), cut to `most` characters. */
export function plain(text: string, most: number): string {
  return text
    .replace(/([\w/.:%-])([?#][^\s)'"`]*)/g, (_, before: string, query: string) => {
      const at = /:\d+:\d+$/.exec(query);
      return before + (at?.[0] ?? "");
    })
    .slice(0, most);
}

/** What the watch on a page holds: the page, what it has sent, and how to stop. */
interface Watch {
  readonly page: Page;
  readonly said: Set<string>;
  readonly liveDownMs: number;
  /** When the page lost its live room, until it is back in it; and the wait for saying so. */
  liveTimer: ReturnType<typeof setTimeout> | null;
  stop: () => void;
}

let watch: Watch | null = null;

/** Tells Leaf the page failed, unless it has said as much this load, or said `MOST` things already. */
export function report(kind: PageErrorKind, message: string, stack = ""): void {
  if (watch === null || watch.said.size >= MOST) return;
  const key = `${kind} ${message}`;
  if (watch.said.has(key)) return;
  watch.said.add(key);
  const body: PageError = {
    page: watch.page,
    kind,
    version: RULES[GAME_OF[watch.page]].slice(0, 64),
    browser: browserOf(typeof navigator === "undefined" ? "" : navigator.userAgent),
    message: plain(message, PAGE_ERROR_MESSAGE),
    stack: plain(stack, PAGE_ERROR_STACK),
  };
  void ask(PAGE_ERRORS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  });
}

/** The message and stack of whatever was thrown. */
function thrown(what: unknown): [string, string] {
  if (what instanceof Error) return [`${what.name}: ${what.message}`, what.stack ?? ""];
  return [String(what), ""];
}

/** An error nothing caught, as the window tells of it. */
function onError(e: Event): void {
  const [message, stack] = "error" in e && e.error !== null && e.error !== undefined ? thrown(e.error) : ["", ""];
  report("error", message || ("message" in e && typeof e.message === "string" ? e.message : "An error"), stack);
}

/** A promise rejected that nothing handled, as the window tells of it. */
function onRejection(e: Event): void {
  report("rejection", ...thrown("reason" in e ? e.reason : undefined));
}

/** Whether this load of the page was the browser loading it again. */
function wasReloaded(): boolean {
  if (typeof performance === "undefined") return false;
  const [navigation] = performance.getEntriesByType("navigation");
  return navigation !== undefined && "type" in navigation && navigation.type === "reload";
}

/**
 * Starts telling Leaf when this page fails, as `page`: errors nothing caught on `target` (the
 * window), how signing in went, and whether this load is a third in a row. Returns how to stop.
 */
export function watchPage(
  page: Page,
  options: { target?: EventTarget; reloaded?: boolean; liveDownMs?: number } = {},
): () => void {
  watch?.stop();
  const target = options.target ?? (typeof window === "undefined" ? new EventTarget() : window);
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  const mine: Watch = {
    page,
    said: new Set(),
    liveDownMs: options.liveDownMs ?? LIVE_DOWN_MS,
    liveTimer: null,
    stop: () => {
      target.removeEventListener("error", onError);
      target.removeEventListener("unhandledrejection", onRejection);
      if (mine.liveTimer !== null) clearTimeout(mine.liveTimer);
      if (watch === mine) watch = null;
    },
  };
  watch = mine;
  countLoad(page, options.reloaded ?? wasReloaded());
  void start().then(signedIn);
  return mine.stop;
}

/** How signing in went (`start()`): no Leaf, or a Leaf that did not say who the player is, is reported. */
function signedIn(where: Where): void {
  if (where.mode === "none") report("no_server", "No Leaf answered /v1/game/hello");
  else if (where.mode === "shut" && where.why === "closed") report("sign_in", "Leaf did not say who the player is");
}

/** Counts this load among the page's loads in a row, in the tab's storage, and says so at the third again. */
function countLoad(page: Page, reloaded: boolean): void {
  const tab = outside.tab();
  const key = `report.loads.${page}`;
  const now = outside.now();
  try {
    const [count, at] = (tab?.getItem(key) ?? "0 0").split(" ").map(Number);
    const inRow = reloaded && now - (at ?? 0) < AGAIN_MS ? (count ?? 0) + 1 : 0;
    tab?.setItem(key, `${inRow} ${now}`);
    if (inRow === RELOADS) report("reloads", `Loaded itself again ${RELOADS} times in a row`);
  } catch {
    // No storage: no count.
  }
}

/**
 * The page could not open its game from Leaf (`play.ts`'s `Trouble`): said for Leaf answering
 * something else, no play service, or a state that does not read; not for being signed out or
 * having nothing to visit.
 */
export function failedToOpen(trouble: Trouble): void {
  if (trouble === "closed" || trouble === "noserver" || trouble === "unreadable") {
    report("first_read", `Could not open the game: ${trouble}`);
  }
}

/** Where the page's live room is (`LiveEars.status`): out of it, still trying, for `LIVE_DOWN_MS`, it says so. */
export function heardLive(status: LiveStatus): void {
  const mine = watch;
  if (mine === null) return;
  if (status === "connecting" || status === "closed") {
    mine.liveTimer ??= setTimeout(
      () => report("live", `Out of the live room for ${Math.round(mine.liveDownMs / 1000)} s`),
      mine.liveDownMs,
    );
    return;
  }
  // In the room, or let go of it on purpose (playing elsewhere, signed out).
  if (mine.liveTimer !== null) clearTimeout(mine.liveTimer);
  mine.liveTimer = null;
}
