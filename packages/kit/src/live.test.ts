import { afterEach, describe, expect, test } from "bun:test";

import { followLeaf, restart, start, where } from "./live.ts";
import { isRecord, type Listening } from "./net.ts";
import { balance, forgetLedger, leafOpen } from "./purse.ts";
import { HELLO, MemoryStore, type Reply, type Sent, type Standin, standin, TESTER } from "./standin.ts";

let world: Standin | null = null;
let ears: Listening | null = null;
afterEach(() => {
  ears?.stop();
  ears = null;
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
        leaf: 2450,
        level: { number: 7, into: 230, next: 1400 },
        cursor: 140,
      },
    });
    expect(where()).toBe(w);
    expect(balance().leaf).toBe(2450);
    expect(leafOpen()).toBe(false);
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

/** What Leaf's game routes really answer, from the contract its own tests write. */
const GAME: unknown = await Bun.file(new URL("../../../contracts/leaf-game-v1.json", import.meta.url)).json();
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

  test("signed out, and not a member", async () => {
    world = standin({
      "GET /v1/game/hello": said("GET /v1/game/hello"),
      "GET /v1/game/me": said("GET /v1/game/me, signed out"),
    });
    expect(await start()).toMatchObject({ mode: "shut", why: "signin" });
    world.done();
    restart();
    world = standin({
      "GET /v1/game/hello": said("GET /v1/game/hello"),
      "GET /v1/game/me": said("GET /v1/game/me, not a member"),
    });
    expect(await start()).toMatchObject({ mode: "shut", why: "member" });
  });
});
