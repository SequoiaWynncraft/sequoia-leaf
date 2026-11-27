import { describe, expect, test } from "bun:test";

import { PAGE_ERRORS_PATH } from "@sequoia-leaf/core";

import { buildOf, firstTry, guard, type GuardWorld, TRIED, UPDATING } from "./guard.ts";
import { pageScopes, TAKEN } from "./scope.ts";
import { aPage } from "./standin.ts";
import { must } from "./util.ts";

/** A thing on the page: its own style or script (`own`), or anything else, by address. */
class Asset extends EventTarget {
  readonly url: string;
  readonly own: boolean;
  constructor(url: string, own = true) {
    super();
    this.url = url;
    this.own = own;
  }
}

const CSS = "https://leaf.test/play/battler/index-aaaa1111.css";
const JS = "https://leaf.test/play/battler/index-bbbb2222.js";

/** A page of styles and a script on a stand-in browser, whose tab is `tab`, and what the guard did to it. */
function page(tab: Map<string, string> | null, assets = [CSS, JS], empty: readonly string[] = []) {
  const events = new EventTarget();
  const did: string[] = [];
  const sent: unknown[] = [];
  const world: GuardWorld = {
    page: "battler",
    version: "abc123",
    path: "/play/battler/",
    agent: "Mozilla/5.0 Chrome/140.0",
    settleMs: 5,
    events,
    tab: () =>
      tab && {
        getItem: (k) => tab.get(k) ?? null,
        setItem: (k, v) => void tab.set(k, v),
      },
    assetOf: (t) => (t instanceof Asset && t.own ? t.url : null),
    assets: () => assets,
    unloaded: () => empty,
    hide: () => did.push("hide"),
    show: (line) => did.push(`show ${line}`),
    refetch: async (url) => did.push(`refetch ${url}`),
    reload: () => did.push("reload"),
    send: async (path, init) => sent.push([path, JSON.parse(typeof init.body === "string" ? init.body : "")]),
  };
  const stop = guard(world);
  return { events, did, sent, stop };
}

/** A failed load as the browser tells the window of it: an `error` whose target is the element, heard on the way down (it does not bubble). */
function failAt(events: EventTarget, asset: Asset): void {
  const e = new Event("error");
  Object.defineProperty(e, "target", { value: asset });
  events.dispatchEvent(e);
}

const settle = () => Bun.sleep(20);

describe("a page whose own styles or script do not load", () => {
  test("hides at once, asks again past the cache for what failed, and loads itself again once", async () => {
    const tab = new Map<string, string>();
    const p = page(tab);
    failAt(p.events, new Asset(CSS));
    expect(p.did).toEqual(["hide"]);
    await settle();
    expect(p.did).toEqual(["hide", `refetch ${CSS}`, "reload"]);
    expect(tab.get(`${TRIED}/play/battler/`)).toBe(buildOf([CSS, JS]));
    expect(p.sent).toEqual([]);
  });

  test("failing again with the same build, says Leaf is updating in place of the page and reports it", async () => {
    const tab = new Map([[`${TRIED}/play/battler/`, buildOf([JS, CSS])]]);
    const p = page(tab);
    failAt(p.events, new Asset(JS));
    failAt(p.events, new Asset(CSS));
    await settle();
    expect(p.did).toEqual(["hide", `show ${UPDATING}`]);
    expect(p.sent).toEqual([
      [
        PAGE_ERRORS_PATH,
        {
          page: "battler",
          kind: "assets",
          version: "abc123",
          browser: "chrome",
          message: "Could not load index-aaaa1111.css index-bbbb2222.js",
          stack: "",
        },
      ],
    ]);
  });

  test("a styles file that loaded empty, with no failure heard, counts once the page has loaded", async () => {
    const p = page(new Map(), [CSS, JS], [CSS]);
    p.events.dispatchEvent(new Event("load"));
    await settle();
    expect(p.did).toEqual(["hide", `refetch ${CSS}`, "reload"]);
  });

  test("loads itself again once for each build: another build in the same tab gets its own try", async () => {
    const tab = new Map([[`${TRIED}/play/battler/`, "index-old.css index-old.js"]]);
    const p = page(tab);
    failAt(p.events, new Asset(CSS));
    await settle();
    expect(p.did.at(-1)).toBe("reload");
    expect(tab.get(`${TRIED}/play/battler/`)).toBe(`index-old.css index-old.js\n${buildOf([CSS, JS])}`);
  });

  test("without the tab's storage it never loads itself again, which it could not stop doing", async () => {
    const p = page(null);
    failAt(p.events, new Asset(CSS));
    await settle();
    expect(p.did).toEqual(["hide", `show ${UPDATING}`]);
    expect(firstTry(null, "/", "x")).toBe(false);
  });

  test("anything else failing to load, or nothing failing, leaves the page alone", async () => {
    const p = page(new Map());
    failAt(p.events, new Asset("https://leaf.test/play/battler/face.png", false));
    p.events.dispatchEvent(new Event("load"));
    await settle();
    expect(p.did).toEqual([]);
    p.stop();
  });
});

/** Stands in for the browser's frames and size watchers, run by hand: `frame` draws what is asked for, `resize` tells every watcher still on. */
function aBrowser() {
  const frames = new Map<number, (t: number) => void>();
  const watchers = new Set<{ fn: () => void; on: boolean }>();
  let next = 0;
  const values = {
    requestAnimationFrame: (fn: (t: number) => void) => (frames.set(++next, fn), next),
    cancelAnimationFrame: (id: number) => void frames.delete(id),
    ResizeObserver: class {
      readonly #w: { fn: () => void; on: boolean };
      constructor(fn: () => void) {
        this.#w = { fn, on: false };
        watchers.add(this.#w);
      }
      observe(): void {
        this.#w.on = true;
      }
      disconnect(): void {
        this.#w.on = false;
      }
    },
  };
  for (const [name, value] of Object.entries(values))
    Object.defineProperty(globalThis, name, { value, configurable: true });
  return {
    frame: (t: number) => {
      const due = [...frames.values()];
      frames.clear();
      for (const fn of due) fn(t);
    },
    resize: () => [...watchers].filter((w) => w.on).forEach((w) => w.fn()),
    done: () => Object.keys(values).forEach((name) => Reflect.deleteProperty(globalThis, name)),
  };
}

describe("a page the guard takes over", () => {
  for (const [what, tab] of [
    ["to say Leaf is updating", new Map([[`${TRIED}/play/battler/`, buildOf([CSS, JS])]])],
    ["to load it again", new Map<string, string>()],
  ] as const) {
    test(`${what}, stops everything the page opened first: nothing of it runs against the page after`, async () => {
      const browser = aBrowser();
      const shown = aPage();
      try {
        const p = page(tab);
        const life = pageScopes(p.events)();
        /** The page's own parts, gone once the guard has put its line in place of the page or loaded it again. */
        const top = (): object | null => (p.did.some((d) => d.startsWith("show") || d === "reload") ? null : {});
        const ran: string[] = [];
        const errors: unknown[] = [];
        const run = (name: string): void => {
          ran.push(name);
          try {
            must(top(), name);
          } catch (e) {
            errors.push(e);
          }
        };
        life.observe(document.createElement("div"), "size", () => run("top"));
        const loop = (): void => void life.frame(() => (run("coach"), loop()));
        loop();
        browser.frame(16);
        browser.resize();
        expect(ran).toEqual(["coach", "top"]);
        failAt(p.events, new Asset(CSS));
        await settle();
        expect(p.did.at(-1)).toMatch(/^show|^reload$/);
        ran.length = 0;
        browser.frame(32);
        browser.resize();
        expect(ran).toEqual([]);
        expect(errors).toEqual([]);
        expect(life.closed).toBe(true);
      } finally {
        browser.done();
        shown.done();
      }
    });
  }
});

describe("a page's build", () => {
  test("is its own files by name, whatever their order, query or folder", () => {
    expect(buildOf([JS, `${CSS}?v=1`])).toBe("index-aaaa1111.css index-bbbb2222.js");
  });
});

describe("a page's scopes", () => {
  test("are not kept by the page: one nobody closes, on a thing thrown away, goes with it", async () => {
    const make = pageScopes(new EventTarget());
    const lost = (() => {
      const made = make();
      made.on(new EventTarget(), "input", () => undefined);
      return new WeakRef(made);
    })();
    await Bun.sleep(0);
    Bun.gc(true);
    expect(lost.deref()).toBeUndefined();
  });

  test("are kept while what they started is live, so the page still closes one nobody else holds", async () => {
    const events = new EventTarget();
    const make = pageScopes(events);
    const window = new EventTarget();
    const heard: string[] = [];
    const kept = (() => {
      const made = make();
      made.on(window, "resize", () => heard.push("resize"));
      return new WeakRef(made);
    })();
    await Bun.sleep(0);
    Bun.gc(true);
    expect(kept.deref()).toBeDefined();
    window.dispatchEvent(new Event("resize"));
    events.dispatchEvent(new Event(TAKEN));
    window.dispatchEvent(new Event("resize"));
    expect(heard).toEqual(["resize"]);
  });

  test("close as the page is taken, and one made after is closed from the start", () => {
    const events = new EventTarget();
    const make = pageScopes(events);
    const before = make();
    expect(before.closed).toBe(false);
    events.dispatchEvent(new Event(TAKEN));
    expect([before.closed, make().closed]).toEqual([true, true]);
  });
});
