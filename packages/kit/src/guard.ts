/**
 * A page's guard against opening half built, as it can while Leaf is updating. For a moment the old
 * Leaf and the new one both answer, each with only its own build of the pages, whose styles and
 * script are named by a hash of what they hold: a page from one Leaf can ask the other for them and
 * get nothing, and it opens as raw HTML.
 *
 * The guard is a script of its own, `/play/guard.js`, under the same name in every build, which
 * `tools/build-pages.ts` puts first on each page; so it runs whichever Leaf answers. When the page's
 * own styles or script do not load, it hides the page, waits `SETTLE_MS` for the update to finish,
 * asks again for what failed past the browser's cache, and loads the page again: at most once for
 * each build of the page in a tab, a build named by its files. Failing again, it says `UPDATING` in
 * place of the page, and reports `assets`.
 */

import {
  browserOf,
  type Page,
  PAGE_ERROR_MESSAGE,
  PAGE_ERRORS_PATH,
  type PageError,
} from "@sequoia-leaf/core/page-errors.ts";

import { Scope } from "./scope.ts";

/** How long the guard waits after a failure before loading the page again: long enough for an update to finish. */
export const SETTLE_MS = 2000;
/** What the page says when it failed again after loading itself again. */
export const UPDATING = "Leaf is updating. Reload in a moment.";
/** The tab's storage key under which the builds of a page already loaded again are kept. */
export const TRIED = "guard.tried.";
/** How many builds of one page a tab keeps having loaded again. */
const KEPT = 8;

/** Where the guard runs: the page, as `guard-page.ts` reads it, or a test's stand-in. */
export interface GuardWorld {
  /** The page and the version of its rules (`data-page`, `data-version` on the guard's tag), for its report. */
  readonly page: Page | null;
  readonly version: string;
  /** The page's own address, without query or fragment. */
  readonly path: string;
  readonly agent: string;
  /** How long to wait after a failure (`SETTLE_MS` unless a test says). */
  readonly settleMs?: number;
  /** Where load failures and the page's `load` are heard (the window). */
  readonly events: EventTarget;
  /** The tab's storage, or null where there is none. */
  tab(): Pick<Storage, "getItem" | "setItem"> | null;
  /** The address of the page's own styles or script that `target` is, else null. */
  assetOf(target: EventTarget | null): string | null;
  /** The addresses of the page's own styles and scripts. */
  assets(): readonly string[];
  /** The addresses of the page's own styles that hold nothing, once the page has loaded. */
  unloaded(): readonly string[];
  hide(): void;
  /** Puts `line` in place of the page. */
  show(line: string): void;
  /** Asks for `url` again past the browser's cache, so a failure it kept is replaced. */
  refetch(url: string): Promise<unknown>;
  reload(): void;
  send(path: string, init: RequestInit): Promise<unknown>;
}

/** The build of a page: its own files, by name, in order. */
export function buildOf(assets: readonly string[]): string {
  return assets
    .map((url) => url.split(/[?#]/, 1)[0]?.split("/").pop() ?? "")
    .toSorted()
    .join(" ");
}

/** Whether the tab has loaded this build of the page again before, and if not, notes that it now does. False without storage: the page is not loaded again without a note that it was. */
export function firstTry(tab: Pick<Storage, "getItem" | "setItem"> | null, path: string, build: string): boolean {
  if (tab === null) return false;
  try {
    const tried = (tab.getItem(TRIED + path) ?? "").split("\n").filter((b) => b !== "");
    if (tried.includes(build)) return false;
    tab.setItem(TRIED + path, [...tried, build].slice(-KEPT).join("\n"));
    return true;
  } catch {
    return false;
  }
}

/** Starts guarding the page. Returns how to stop. */
export function guard(world: GuardWorld): () => void {
  const scope = new Scope();
  const failed = new Set<string>();
  const fail = (url: string): void => {
    if (failed.size === 0) {
      world.hide();
      scope.after(world.settleMs ?? SETTLE_MS, () => void settle());
    }
    failed.add(url);
  };
  const settle = async (): Promise<void> => {
    scope.close();
    if (firstTry(world.tab(), world.path, buildOf(world.assets()))) {
      await Promise.allSettled([...failed].map((url) => world.refetch(url)));
      world.reload();
      return;
    }
    world.show(UPDATING);
    report(world, [...failed]);
  };
  scope.on(
    world.events,
    "error",
    (e) => {
      const url = world.assetOf(e.target);
      if (url !== null) fail(url);
    },
    { capture: true },
  );
  scope.on(world.events, "load", () => world.unloaded().forEach(fail));
  return () => scope.close();
}

/** Tells Leaf the page could not load `urls`, again after loading itself again. */
function report(world: GuardWorld, urls: readonly string[]): void {
  if (world.page === null) return;
  const body: PageError = {
    page: world.page,
    kind: "assets",
    version: world.version.slice(0, 64),
    browser: browserOf(world.agent),
    message: `Could not load ${buildOf(urls)}`.slice(0, PAGE_ERROR_MESSAGE),
    stack: "",
  };
  void world
    .send(PAGE_ERRORS_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    })
    .catch(() => undefined);
}
