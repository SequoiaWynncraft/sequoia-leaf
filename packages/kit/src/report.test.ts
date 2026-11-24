import { afterEach, describe, expect, test } from "bun:test";

import { type Browser, PAGE_ERRORS_PATH } from "@sequoia-leaf/core";

import { restart } from "./live.ts";
import { AGAIN_MS, browserOf, failedToOpen, heardLive, MOST, plain, watchPage } from "./report.ts";
import { HELLO, type Reply, type Standin, standin, TESTER } from "./standin.ts";

let world: Standin | null = null;
let unwatch: (() => void) | null = null;
afterEach(() => {
  unwatch?.();
  unwatch = null;
  world?.done();
  world = null;
  restart();
});

/** The page on a stand-in Leaf that answers `/v1/game/me` with `me`, watched as the town, on `target`. */
function open(me: Reply = { status: 200, body: TESTER }, reloaded = false, target = new EventTarget()) {
  world = standin({
    "GET /v1/game/hello": HELLO,
    "GET /v1/game/me": me,
    [`POST ${PAGE_ERRORS_PATH}`]: { status: 204 },
  });
  unwatch = watchPage("town", { target, reloaded, liveDownMs: 20 });
  return { world, target };
}

/** What the page reported, as it sent it. */
const reported = (w: Standin) => w.sent.filter((s) => s.path === PAGE_ERRORS_PATH).map((s) => s.body);
const settle = () => Bun.sleep(5);

describe("a page's reports of its failures", () => {
  test("an error nothing caught says the page, its rules, the browser, the message and the stack, without queries", async () => {
    const { world: w, target } = open();
    const error = new Error("Cannot read x of /play/town/chunk.js?v=3#top");
    error.stack = "Error: boom\n    at draw (https://leaf.seqwawa.com/play/town/chunk.js?v=3:1:2)";
    target.dispatchEvent(new ErrorEvent("error", { error, message: error.message }));
    await settle();

    expect(reported(w)).toEqual([
      {
        page: "town",
        kind: "error",
        version: expect.any(String),
        browser: "other",
        message: "Error: Cannot read x of /play/town/chunk.js",
        stack: "Error: boom\n    at draw (https://leaf.seqwawa.com/play/town/chunk.js:1:2)",
      },
    ]);
    expect(w.sent.find((s) => s.path === PAGE_ERRORS_PATH)?.keepalive).toBe(true);
  });

  test("a promise rejected that nothing handled is reported, each thing once, at most a few a load", async () => {
    const { world: w, target } = open();
    for (const n of [1, 1, 2, 3, 4, 5, 6, 7]) {
      target.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: new Error(`lost ${n}`) }));
    }
    await settle();

    expect(reported(w).map((r) => Object(r).message)).toEqual(
      ["Error: lost 1", "Error: lost 2", "Error: lost 3", "Error: lost 4", "Error: lost 5"].slice(0, MOST),
    );
  });

  test("a page that cannot sign in says so; one signed out, or let in, says nothing", async () => {
    let w = open({ status: 503, body: { code: "identity_unavailable" } }).world;
    await settle();
    expect(reported(w).map((r) => Object(r).kind)).toEqual(["sign_in"]);

    for (const me of [
      { status: 200, body: TESTER },
      { status: 403, body: { code: "not_a_member" } },
    ]) {
      unwatch?.();
      world?.done();
      restart();
      w = open(me).world;
      // oxlint-disable-next-line no-await-in-loop -- one page after another
      await settle();
      expect(reported(w)).toEqual([]);
    }
  });

  test("a game that cannot be opened says why, unless the player is signed out or there is nothing to visit", async () => {
    const { world: w } = open();
    for (const trouble of ["signedout", "nothing", "unreadable", "closed"] as const) failedToOpen(trouble);
    await settle();

    expect(reported(w).map((r) => [Object(r).kind, Object(r).message])).toEqual([
      ["first_read", "Could not open the game: unreadable"],
      ["first_read", "Could not open the game: closed"],
    ]);
  });

  test("a third load again in a row is reported; a load after a pause, or not again, starts the count over", async () => {
    const { world: w } = open();
    /** The page loaded in the same tab, `after` ms on: again (a reload), or not. */
    const load = async (after: number, again = true) => {
      w.clock.now += after;
      unwatch?.();
      unwatch = watchPage("town", { target: new EventTarget(), reloaded: again });
      await settle();
    };
    const reloads = () => reported(w).filter((r) => Object(r).kind === "reloads").length;

    await load(2000);
    await load(2000);
    expect(reloads()).toBe(0);
    await load(2000);
    await load(2000);
    expect(reloads()).toBe(1);
    await load(AGAIN_MS + 1);
    await load(2000, false);
    await load(2000);
    await load(2000);
    expect(reloads()).toBe(1);
    await load(2000);
    expect(reloads()).toBe(2);
  });

  test("out of the live room for a while, still trying, is reported; back in it in time is not", async () => {
    const { world: w } = open();
    heardLive("connecting");
    heardLive("open");
    heardLive("closed");
    heardLive("open");
    await Bun.sleep(40);
    expect(reported(w)).toEqual([]);

    heardLive("closed");
    heardLive("connecting");
    await Bun.sleep(40);
    expect(reported(w).map((r) => Object(r).kind)).toEqual(["live"]);
  });
});

describe("what a report says", () => {
  test("the browser by its family", () => {
    const agents: [string, Browser][] = [
      ["Mozilla/5.0 (X11; Linux x86_64; rv:146.0) Gecko/20100101 Firefox/146.0", "firefox"],
      ["Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36", "chrome"],
      [
        "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0",
        "edge",
      ],
      [
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1",
        "safari",
      ],
      ["Bun/1.4.4", "other"],
    ];
    expect(agents.map(([agent]) => browserOf(agent))).toEqual(agents.map(([, family]) => family));
  });

  test("every address without its query or fragment, cut short", () => {
    expect(plain("GET /v1/game/play/works?differs=12 failed at https://x.test/a.js?v=1#L3:4:5", 200)).toBe(
      "GET /v1/game/play/works failed at https://x.test/a.js:4:5",
    );
    expect(plain("x".repeat(50), 10)).toBe("x".repeat(10));
  });
});
