import { afterEach, describe, expect, test } from "bun:test";

import {
  followLeaf,
  isGuest,
  keepLeaf,
  passCoins,
  passLeaf,
  readCoins,
  readMember,
  restart,
  start,
  where,
} from "./live.ts";
import { isRecord, type Listening } from "./net.ts";
import {
  balance,
  earn,
  forgetLedger,
  fromLedger,
  grant,
  LEAF_GUEST,
  LEAF_SHUT,
  leafOpen,
  leafShown,
  leafShut,
  settled,
  spend,
} from "./purse.ts";
import {
  GUEST,
  HELLO,
  membersOnly,
  MemoryStore,
  type Reply,
  type Sent,
  type Standin,
  standin,
  TESTER,
} from "./standin.ts";

/** What Leaf's game routes really answer, from the contract its own tests write. */
const GAME: unknown = await Bun.file(new URL("../../../contracts/leaf-game-v1.json", import.meta.url)).json();

let world: Standin | null = null;
let ears: Listening | null = null;
let page: (() => void) | null = null;
afterEach(() => {
  ears?.stop();
  ears = null;
  page?.();
  page = null;
  world?.done();
  world = null;
  restart();
  forgetLedger();
});

const live = (me: Reply, opts: Parameters<typeof standin>[1] = {}): Standin =>
  standin({ "GET /v1/game/hello": HELLO, "GET /v1/game/me": me }, opts);

describe("finding out where the game is", () => {
  test.each([
    ["no network", "offline"],
    ["a 404", { status: 404, body: { code: "not_found" } }],
    ["a page", { status: 200, body: "<!doctype html>" }],
    ["something else", { status: 200, body: { leaf_spending: false } }],
    ["a 503", { status: 503, body: null }],
  ] as const)("%s for hello: the made-up guild, asked nothing more", async (_why, hello) => {
    world = standin({ "GET /v1/game/hello": hello });
    expect(await start()).toEqual({ mode: "madeup" });
    expect(world.sent.map((s) => s.path)).toEqual(["/v1/game/hello"]);
    expect(leafOpen()).toBe(true);
  });

  test("200 and 200: live, as the member, and the purse keeps the ledger's Leaf", async () => {
    world = live({ status: 200, body: TESTER });
    const w = await start();
    expect(w).toEqual({
      mode: "live",
      signIn: HELLO.body.sign_in,
      me: {
        id: TESTER.player.id,
        name: "Tester",
        rank: "captain",
        guest: false,
        leaf: 2450,
        level: { number: 7, into: 230, next: 1400 },
        cursor: 140,
      },
    });
    expect(where()).toBe(w);
    expect(balance().leaf).toBe(2450);
    expect(leafOpen()).toBe(false);
  });

  test("200 as a guest: live, as them, with no Leaf to show or spend, and every Leaf button says why", async () => {
    world = live({ status: 200, body: GUEST });
    const w = await start();
    expect(w).toMatchObject({ mode: "live", me: { id: GUEST.player.id, name: "Wanderer", rank: null, guest: true } });
    expect(isGuest()).toBe(true);
    expect(balance().leaf).toBe(0);
    expect(leafOpen()).toBe(false);
    expect(leafShown()).toBe(false);
    expect(leafShut()).toBe(LEAF_GUEST);
    expect(LEAF_GUEST).toBe("Leaf is earned by raiding with Sequoia.");
    grant(500, "a stand-in raid");
    expect(spend("leaf", 0)).toBe(false);
    expect(balance().leaf).toBe(0);
    // Coins are a guest's as a member's.
    earn(40, "works_order");
    expect(balance().coins).toBeGreaterThanOrEqual(40);
  });

  test("a member's Leaf buttons keep the play-test's line, and their Leaf shows", async () => {
    world = live({ status: 200, body: TESTER });
    await start();
    expect([isGuest(), leafShown(), leafShut()]).toEqual([false, true, LEAF_SHUT]);
  });

  test("reads a guest from what Leaf really answers", () => {
    const r = isRecord(GAME) ? GAME["GET /v1/game/me, a guest"] : null;
    expect(readMember(isRecord(r) ? r.body : null)).toEqual({
      id: "10000000-0000-0000-0000-000000000003",
      name: "Visitor",
      rank: null,
      guest: true,
      leaf: 0,
      level: { number: 1, into: 0, next: 1000 },
      cursor: 0,
    });
    expect(readCoins(isRecord(r) ? r.body : null)).toBe(300);
    expect(readCoins({ coins: "lots" })).toBeNull();
  });

  test("it asks once per page", async () => {
    world = live({ status: 200, body: TESTER });
    await Promise.all([start(), start()]);
    await start();
    expect(world.sent.length).toBe(2);
  });

  test("401: the whole window goes to sign in, to come back to this page", async () => {
    world = live({ status: 401, body: { code: "unauthorized" } });
    expect(await start()).toMatchObject({ mode: "shut", why: "signin" });
    expect(world.went).toEqual([
      `https://api.example/auth/web/start?return_to=${encodeURIComponent("https://leaf.example/play/town/?x=1")}`,
    ]);
  });

  test("401 again within a minute of going: a card, not another trip", async () => {
    const store = new MemoryStore();
    world = live({ status: 401 }, { store });
    await start();
    expect(world.went.length).toBe(1);
    const sentAt = world.clock.now;
    world.done();
    restart();

    // Back from signing in 40 seconds later, and still refused.
    world = live({ status: 401 }, { store });
    world.clock.now = sentAt + 40_000;
    expect(await start()).toMatchObject({ mode: "shut", why: "signedout" });
    expect(world.went).toEqual([]);
    world.done();
    restart();

    // Long after, it may go again.
    world = live({ status: 401 }, { store });
    world.clock.now = sentAt + 61_000;
    expect(await start()).toMatchObject({ mode: "shut", why: "signin" });
    expect(world.went.length).toBe(1);
  });

  test("401 in a frame: signed out, and nowhere to go", async () => {
    world = live({ status: 401 }, { top: false });
    expect(await start()).toMatchObject({ mode: "shut", why: "signedout" });
    expect(world.went).toEqual([]);
  });

  test("403: not one of the guild", async () => {
    world = live({ status: 403, body: { code: "not_a_member" } });
    expect(await start()).toMatchObject({ mode: "shut", why: "member" });
    expect(leafOpen()).toBe(true);
  });

  test.each([
    ["a 503", { status: 503, body: { code: "identity_unavailable" } }],
    ["a 500", { status: 500 }],
    ["no network", "offline"],
    ["nonsense", { status: 200, body: { player: { id: "x" } } }],
  ] as const)("%s after hello: the guild's books are closed", async (_why, me) => {
    world = live(me);
    expect(await start()).toMatchObject({ mode: "shut", why: "closed" });
  });
});

/**
 * The member's event stream as Leaf sends it: from the position asked (`?after=`), or else from
 * their newest event; it opens with a frame saying where it starts.
 */
function memberStream(events: readonly { id: number; type: string; data: unknown }[], newest: number) {
  return (s: Sent): Reply => {
    const asked = /[?&]after=(\d+)/.exec(s.path)?.[1];
    const from = asked === undefined ? newest : Number(asked);
    const after = events.filter((e) => e.id > from);
    const text = `id: ${from}\n\n${after.map((e) => `id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("")}`;
    return new Response(text, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  };
}

describe("following the member's Leaf", () => {
  test("Leaf paid between the first look and the stream opening is heard at once, and the purse fetched again", async () => {
    const raid = { id: 141, type: "leaf_earned", data: { source: "raid", leaf: 110, xp: 110 } };
    // The member as first looked at (newest event 140), and as they are by the time anything listens.
    const now = { ...TESTER, leaf: TESTER.leaf + 110, event_cursor: 141 };
    let asked = 0;
    world = standin({
      "GET /v1/game/hello": HELLO,
      "GET /v1/game/me": () => ({ status: 200, body: ++asked === 1 ? TESTER : now }),
      "GET /v1/me/events/stream": memberStream([raid], 141),
    });
    await start();
    expect(balance().leaf).toBe(2450);
    const heard: number[] = [];
    ears = followLeaf((_type, _data, id) => heard.push(id));
    await Bun.sleep(500);
    expect(world.sent.map((s) => s.path)).toContain("/v1/me/events/stream?after=140");
    expect(heard).toEqual([141]);
    expect(balance().leaf).toBe(2560);
  });
});

const ORIGIN = "https://leaf.example";

/**
 * Stands in for a game's page in the town's frame: a window whose parent is the town, on the same
 * origin, that hears messages. Returns how the town says something to it.
 */
function aFramedPage(): (data: unknown) => void {
  const town = { location: { origin: ORIGIN }, postMessage: (): void => undefined };
  const win = Object.assign(new EventTarget(), { location: { origin: ORIGIN }, parent: town });
  Object.defineProperty(globalThis, "window", { value: win, configurable: true });
  page = () => {
    Reflect.deleteProperty(globalThis, "window");
  };
  return (data) => {
    win.dispatchEvent(new MessageEvent("message", { data, origin: ORIGIN }));
  };
}

describe("the member's Coins on the guild's server", () => {
  test("start from what /v1/game/me says, a guest's as a member's, and every change goes to Leaf", async () => {
    world = standin({
      "GET /v1/game/hello": HELLO,
      "GET /v1/game/me": { status: 200, body: { ...GUEST, coins: 812 } },
      "POST /v1/game/coins": (s) => ({
        status: 200,
        body: { coins: 812 + (isRecord(s.body) && typeof s.body.amount === "number" ? s.body.amount : 0) },
      }),
    });
    await start();
    expect(balance().coins).toBe(812);
    expect(spend("coins", 12, "camp_thing")).toBe(true);
    await settled();
    expect(balance().coins).toBe(800);
    expect(world.sent.filter((s) => s.method === "POST")).toMatchObject([
      { path: "/v1/game/coins", body: { amount: -12, reason: "camp_thing" } },
    ]);
    expect(world.store.length).toBe(0);
  });

  test("in the town's frame, the town's word about Coins is taken while nothing of the game's is on its way", async () => {
    world = live({ status: 200, body: TESTER }, { top: false });
    await start();
    const town = aFramedPage();
    const stop = keepLeaf();
    town({ town: "coins", coins: 420 });
    expect(balance().coins).toBe(420);
    for (const coins of [-1, 3.5, "9", null]) town({ town: "coins", coins });
    expect(balance().coins).toBe(420);
    stop();
  });

  test("the town says each change to its Coins to a game once it is ready, and nothing with the made-up guild", async () => {
    world = live({ status: 200, body: TESTER });
    await start();
    const said: number[] = [];
    const coins = passCoins((n) => said.push(n));
    earn(40, "works_order");
    expect(said).toEqual([]);
    coins.ready();
    expect(said).toEqual([340]);
    coins.stop();
    forgetLedger();
    restart();
    world.done();
    world = standin({ "GET /v1/game/hello": "offline" });
    await start();
    const quiet = passCoins((n) => said.push(n));
    quiet.ready();
    earn(40, "works_order");
    expect(said).toEqual([340]);
    quiet.stop();
  });
});

describe("the member's Leaf in a game in the town's frame", () => {
  test("the town's word is taken as a fresh read of the ledger", async () => {
    world = live({ status: 200, body: TESTER }, { top: false });
    await start();
    const town = aFramedPage();
    const stop = keepLeaf();
    expect(balance().leaf).toBe(2450);
    town({ town: "leaf", leaf: 2560 });
    expect(balance().leaf).toBe(2560);
    expect(leafOpen()).toBe(false);
    // In the frame the town listens to the member's news, so the game does not.
    expect(world.sent.map((s) => s.path)).toEqual(["/v1/game/hello", "/v1/game/me"]);
    stop();
    town({ town: "leaf", leaf: 2700 });
    expect(balance().leaf).toBe(2560);
  });

  test("nothing but a whole number of Leaf, none below nothing, is taken", async () => {
    world = live({ status: 200, body: TESTER }, { top: false });
    await start();
    const town = aFramedPage();
    const stop = keepLeaf();
    for (const leaf of [-1, 2600.5, "2600", Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, null, undefined, [2600]]) {
      town({ town: "leaf", leaf });
    }
    town({ town: "leaf" });
    town({ town: "purse", leaf: 2600 });
    expect(balance().leaf).toBe(2450);
    town({ town: "leaf", leaf: 0 });
    expect(balance().leaf).toBe(0);
    stop();
  });

  test("with the made-up guild, the town's word about Leaf is not taken", async () => {
    world = standin({ "GET /v1/game/hello": "offline" }, { top: false });
    await start();
    const town = aFramedPage();
    const stop = keepLeaf();
    const before = balance().leaf;
    town({ town: "leaf", leaf: before + 500 });
    expect(balance().leaf).toBe(before);
    expect(leafOpen()).toBe(true);
    stop();
  });

  test("opened on its own, the game listens to the member's news itself", async () => {
    world = standin({
      "GET /v1/game/hello": HELLO,
      "GET /v1/game/me": { status: 200, body: TESTER },
      "GET /v1/me/events/stream": memberStream([], 140),
    });
    await start();
    const stop = keepLeaf();
    await Bun.sleep(20);
    expect(world.sent.map((s) => s.path)).toContain("/v1/me/events/stream?after=140");
    stop();
  });

  test("the town says each new Leaf the ledger gives, once the game is ready to hear it", async () => {
    world = live({ status: 200, body: TESTER });
    await start();
    const said: number[] = [];
    const leaf = passLeaf((n) => said.push(n));
    // Paid while the game is still opening: said when it is ready, and only the newest.
    fromLedger(2500);
    fromLedger(2560);
    expect(said).toEqual([]);
    leaf.ready();
    expect(said).toEqual([2560]);
    // The same Leaf again, or Coins, is nothing to say.
    fromLedger(2560);
    earn(40, "works_order");
    expect(said).toEqual([2560]);
    fromLedger(2670);
    expect(said).toEqual([2560, 2670]);
    leaf.stop();
    fromLedger(2800);
    expect(said).toEqual([2560, 2670]);
  });

  test("with the made-up guild, the town says nothing about Leaf", async () => {
    world = standin({ "GET /v1/game/hello": "offline" });
    await start();
    const said: number[] = [];
    const leaf = passLeaf((n) => said.push(n));
    leaf.ready();
    grant(300, "a test");
    expect(said).toEqual([]);
    leaf.stop();
  });
});

const said = (route: string): { status: number; body: unknown } => {
  const r = isRecord(GAME) ? GAME[route] : null;
  if (!isRecord(r) || typeof r.status !== "number") throw new Error(`no ${route} in the contract`);
  return { status: r.status, body: r.body };
};

describe("against what Leaf really answers", () => {
  test("hello and me: live, as the member the contract signs in", async () => {
    world = standin({ "GET /v1/game/hello": said("GET /v1/game/hello"), "GET /v1/game/me": said("GET /v1/game/me") });
    const w = await start();
    expect(w.mode).toBe("live");
    if (w.mode !== "live") return;
    expect(w.signIn.endsWith("return_to=")).toBe(true);
    expect(w.me).toMatchObject({ name: "Alice", rank: "CAPTAIN", level: { number: 2 } });
    expect(balance().leaf).toBe(w.me.leaf);
  });

  test("signed out, and a guest", async () => {
    world = standin({
      "GET /v1/game/hello": said("GET /v1/game/hello"),
      "GET /v1/game/me": said("GET /v1/game/me, signed out"),
    });
    expect(await start()).toMatchObject({ mode: "shut", why: "signin" });
    world.done();
    restart();
    world = standin({
      "GET /v1/game/hello": said("GET /v1/game/hello"),
      "GET /v1/game/me": said("GET /v1/game/me, a guest"),
    });
    expect(await start()).toMatchObject({ mode: "live", me: { name: "Visitor", guest: true } });
    expect(leafShown()).toBe(false);
  });
});

describe("a guest's page", () => {
  test("follows no Leaf and asks nothing only a member may: on its own, in the town, or when told Leaf by the town", async () => {
    const asked: string[] = [];
    world = standin({
      "GET /v1/game/hello": HELLO,
      "GET /v1/game/me": { status: 200, body: GUEST },
      ...membersOnly(asked),
    });
    await start();
    ears = followLeaf();
    const stop = keepLeaf();
    await Bun.sleep(20);
    stop();
    expect(asked).toEqual([]);
    expect(world.sent.map((s) => s.path)).toEqual(["/v1/game/hello", "/v1/game/me"]);
    expect(balance().leaf).toBe(0);
  });
});
