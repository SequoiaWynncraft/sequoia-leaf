/**
 * The guard on a real page (`guard.ts`): built on its own into `/play/guard.js`, a plain script
 * that runs before the page's styles and script are asked for, so it hears them fail. It reads the
 * page and its rules' version off its own tag, `<script src="../guard.js" data-page data-version>`.
 *
 * Its report goes out by the browser's own `fetch`, not the kit's `ask`: the guard carries nothing
 * of the kit but its scope, since it runs when nothing else of the page does.
 */

import { PAGES } from "@sequoia-leaf/core/page-errors.ts";

import { guard } from "./guard.ts";

/** The page's own styles and scripts: every stylesheet and every script with an address, but the guard. */
const OWN = 'link[rel~="stylesheet"][href], script[src]:not([data-guard])';

/** Where a stylesheet or script of the page's own is, in full. */
function addressOf(el: Element): string | null {
  if (el instanceof HTMLLinkElement) return el.href;
  if (el instanceof HTMLScriptElement) return el.src;
  return null;
}

const me = document.currentScript;
const named = me?.dataset["page"];

/** Hidden by a style on the root itself, which needs nothing loaded. */
const root = document.documentElement;

guard({
  page: PAGES.find((p) => p === named) ?? null,
  version: me?.dataset["version"] ?? "",
  path: location.pathname,
  agent: navigator.userAgent,
  events: window,
  tab: () => {
    try {
      return sessionStorage;
    } catch {
      return null;
    }
  },
  assetOf: (target) => (target instanceof Element && target.matches(OWN) ? addressOf(target) : null),
  assets: () => [...document.querySelectorAll(OWN)].map((el) => addressOf(el) ?? ""),
  unloaded: () =>
    [...document.querySelectorAll(OWN)]
      .filter((el): el is HTMLLinkElement => el instanceof HTMLLinkElement && el.sheet === null)
      .map((el) => el.href),
  hide: () => {
    root.style.visibility = "hidden";
  },
  show: (line) => {
    const said = document.createElement("p");
    said.textContent = line;
    said.style.cssText = "margin:0;padding:24px;font:16px/1.4 system-ui,sans-serif;color:#e9e3d3";
    const body = document.body ?? root.appendChild(document.createElement("body"));
    body.replaceChildren(said);
    body.style.cssText = "margin:0;background:#1d1b24";
    root.style.visibility = "";
  },
  // Bounded: a request that stalls through the swap gives up after 5 s, and the page reloads anyway.
  refetch: (url) => fetch(url, { cache: "reload", credentials: "same-origin", signal: AbortSignal.timeout(5_000) }),
  reload: () => {
    location.reload();
  },
  send: (path, init) => fetch(path, init),
});
