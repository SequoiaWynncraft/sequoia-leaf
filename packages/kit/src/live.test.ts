import { afterEach, describe, expect, test } from "bun:test";

import { type Balances, readBalances } from "@sequoia-leaf/core";

import {
  followLeaf,
  isGuest,
  keepLeaf,
  linkNotice,
  type Notice,
  passPurse,
  readMember,
  refreshLeaf,
  restart,
  shutNotice,
  start,
  where,
} from "./live.ts";
import { isRecord, type Listening } from "./net.ts";
import { balance, forgetLedger, fromLeaf, LEAF_NOT_HERE, LEAF_SHUT, leafFor, leafOpen, leafShut } from "./purse.ts";
import {
  GUEST,
  HELLO,
  keptOpen,
  membersOnly,
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

/** What a notice says: its title, its line, and the word on each button. */
const words = (n: Notice): string[] => [n.title, n.line, ...n.buttons.map((b) => b.word)];

/** Presses the button of a notice with this word on it; `away` is how the notice is taken away. */
function press(n: Notice, word: string, away: () => void = () => undefined): void {
  const button = n.buttons.find((b) => b.word === word);
  if (!button) throw new Error(`no ${word} button`);
  button.go(away);
}

describe("finding out where the game is", () => {
  test.each([
    ["no network", "offline"],
    ["a 404", { status: 404, body: { code: "not_found" } }],
    ["a page", { status: 200, body: "<!doctype html>" }],
    ["something else", { status: 200, body: { leaf_spending: false } }],
    ["a 503", { status: 503, body: null }],
  ] as const)("%s for hello: no Leaf, asked nothing more", async (_why, hello) => {
    world = standin({ "GET /v1/game/hello": hello });
    expect(await start()).toEqual({ mode: "none" });
    expect(world.sent.map((s) => s.path)).toEqual(["/v1/game/hello"]);
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
        signedInWith: "sequoia",
        linked: true,
        askLink: false,
      },
    });
    expect(where()).toBe(w);
    expect(balance().leaf).toBe(2450);
  });

  test("200 as a guest: live, as them, with the ledger's Leaf, to spend on what is for everyone but not for members", async () => {
    world = live({ status: 200, body: GUEST });
    const w = await start();
    expect(w).toMatchObject({ mode: "live", me: { id: GUEST.player.id, name: "Wanderer", rank: null, guest: true } });
    expect(isGuest()).toBe(true);
    expect(balance().leaf).toBe(1500);
    expect([leafShut(), leafFor("everyone"), leafFor("members")]).toEqual([LEAF_SHUT, true, false]);
  });

  test("a member's Leaf buttons keep the play-test's line, and anything is theirs to buy", async () => {
    world = live({ status: 200, body: TESTER });
    await start();
    expect([isGuest(), leafShut(), leafFor("members")]).toEqual([false, LEAF_SHUT, true]);
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
      signedInWith: "sequoia",
      linked: true,
      askLink: false,
    });
    expect(readBalances(isRecord(r) ? r.body : null)).toEqual({ coins: 300, leaf: 0, version: 0 });
    expect(readBalances({ coins: "lots", leaf: 0, version: 1 })).toBeNull();
  });

  test("it asks once per page", async () => {
    world = live({ status: 200, body: TESTER });
    await Promise.all([start(), start()]);
    await start();
    expect(world.sent.length).toBe(2);
  });

  test("reads how the player signed in, and whether to ask them to link an account", () => {
    expect(readMember({ ...GUEST, signed_in_with: "discord", ask_link: true })).toMatchObject({
      signedInWith: "discord",
      askLink: true,
    });
    expect(readMember({ ...GUEST, signed_in_with: "discord", ask_link: false })).toMatchObject({
      signedInWith: "discord",
      linked: false,
      askLink: false,
    });
    // Linked since, in another browser: a Discord sign-in, linked.
    expect(readMember({ ...GUEST, signed_in_with: "discord", linked: true, ask_link: false })).toMatchObject({
      signedInWith: "discord",
      linked: true,
    });
    expect(readMember({ ...TESTER, signed_in_with: "sequoia", ask_link: false })).toMatchObject({
      signedInWith: "sequoia",
      askLink: false,
    });
    // A Leaf that says neither: signed in as everyone was before, and nothing to ask.
    expect(readMember(TESTER)).toMatchObject({ signedInWith: "sequoia", askLink: false });
  });

  test("401: the gate, the town's name and one button, which signs in with Discord and comes back to this page", async () => {
    world = live({ status: 401, body: { code: "unauthorized" } });
    const w = await start();
    expect(w).toMatchObject({ mode: "shut", why: "signedout" });
    // Nothing goes anywhere by itself, and nothing is kept.
    expect([world.went, world.store.length]).toEqual([[], 0]);
    const gate = shutNotice("signedout");
    expect(words(gate)).toEqual(["Guild Town", "", "Sign in with Discord"]);
    press(gate, "Sign in with Discord");
    expect(world.went).toEqual(["/v1/game/sign-in?to=%2Fplay%2Ftown%2F%3Fx%3D1"]);
  });

  test("the gate comes back to the page it is on, whichever game that is, with whose it is", () => {
    world = live({ status: 401 }, { href: "https://leaf.example/play/works/?of=someone#top" });
    press(shutNotice("signedout"), "Sign in with Discord");
    expect(world.went).toEqual(["/v1/game/sign-in?to=%2Fplay%2Fworks%2F%3Fof%3Dsomeone"]);
  });

  test("401 in the town's frame: signed out, with the way back to town and nowhere else to go", async () => {
    world = live({ status: 401 }, { top: false });
    expect(await start()).toMatchObject({ mode: "shut", why: "signedout" });
    expect(words(shutNotice("signedout"))).toEqual(["Signed out", "", "Back to town"]);
    expect(world.went).toEqual([]);
  });

  test("not a member, or the books closed: a card that says so, and Try again loads the page again", () => {
    world = live({ status: 403 });
    expect(words(shutNotice("member"))).toEqual(["Members only", "Guild Town is for Sequoia members.", "Try again"]);
    const closed = shutNotice("closed");
    expect(words(closed)).toEqual([
      "Just a moment",
      "The guild's books are closed for a moment. Try again.",
      "Try again",
    ]);
    press(closed, "Try again");
    expect(world.reloaded.count).toBe(1);
  });

  test("403: not one of the guild", async () => {
    world = live({ status: 403, body: { code: "not_a_member" } });
    expect(await start()).toMatchObject({ mode: "shut", why: "member" });
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

describe("asking a member with no account linked to link one", () => {
  /** A member of the guild's Discord who signed in with Discord alone. */
  const UNLINKED = { ...GUEST, signed_in_with: "discord", ask_link: true };

  test("they are asked, in the game's face: Link account goes to the guild's sign-in and comes back to this page", async () => {
    world = live({ status: 200, body: UNLINKED });
    const asked = linkNotice(await start(), () => undefined);
    if (!asked) throw new Error("not asked");
    expect([...words(asked), asked.ask]).toEqual([
      "Link your Wynncraft account",
      "Link the account you play on to collect the Leaf your raids and wars earned.",
      "Link account",
      "Later",
      true,
    ]);
    expect(asked.buttons.map((b) => b.quiet === true)).toEqual([false, true]);
    press(asked, "Link account");
    expect(world.went).toEqual([
      `https://api.example/auth/web/start?return_to=${encodeURIComponent("https://leaf.example/play/town/?x=1")}`,
    ]);
  });

  test("Later takes the card away, the town opens, and they are not asked again in this tab; a new tab asks", async () => {
    world = live({ status: 200, body: UNLINKED });
    const w = await start();
    const did: string[] = [];
    const asked = linkNotice(w, () => did.push("opens"));
    if (!asked) throw new Error("not asked");
    press(asked, "Later", () => did.push("away"));
    expect(did).toEqual(["away", "opens"]);
    expect(linkNotice(w, () => undefined)).toBeNull();
    // Nothing of it is kept in the browser: only in the tab.
    expect(world.store.length).toBe(0);
    world.done();
    restart();

    world = live({ status: 200, body: UNLINKED });
    expect(linkNotice(await start(), () => undefined)).not.toBeNull();
  });

  test.each([
    ["a member signed in on the website", TESTER],
    ["somebody who signed in with Discord and is not in the guild's Discord", { ...GUEST, signed_in_with: "discord" }],
  ] as const)("%s is not asked", async (_who, me) => {
    world = live({ status: 200, body: me });
    expect(linkNotice(await start(), () => undefined)).toBeNull();
  });

  test("nobody is asked where the game is not live", async () => {
    world = live({ status: 401 });
    expect(linkNotice(await start(), () => undefined)).toBeNull();
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

/** Leaf earned, as the member's stream says it. */
const earned = (id: number): string => `id: ${id}\nevent: leaf_earned\ndata: {"leaf":125}\n\n`;

describe("following the member's Leaf", () => {
  test("Leaf paid between the first look and the stream opening is heard at once, and the purse fetched again", async () => {
    const raid = { id: 141, type: "leaf_earned", data: { source: "raid", leaf: 110, xp: 110 } };
    // The member as first looked at (newest event 140), and as they are by the time anything listens.
    const now = { ...TESTER, leaf: TESTER.leaf + 110, event_cursor: 141, version: TESTER.version + 1 };
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

  test("a question about the purse Leaf never answers does not keep the next news from being heard", async () => {
    const stream = keptOpen();
    let asked = 0;
    world = standin(
      {
        "GET /v1/game/hello": HELLO,
        // The first look, then a question that never comes back, then Leaf's newer word.
        "GET /v1/game/me": () => {
          asked++;
          if (asked === 1) return { status: 200, body: TESTER };
          if (asked === 2) return new Promise<never>(() => undefined);
          return { status: 200, body: { ...TESTER, leaf: 2700, version: TESTER.version + 1 } };
        },
        "GET /v1/me/events/stream": stream.open,
      },
      { deadline: 20 },
    );
    await start();
    ears = followLeaf();
    await Bun.sleep(5);
    stream.say(`id: 140\n\n${earned(141)}`);
    await Bun.sleep(500);
    stream.say(earned(142));
    await Bun.sleep(500);
    expect([asked, balance().leaf]).toEqual([3, 2700]);
  });
});

const ORIGIN = "https://leaf.example";

/**
 * Stands in for a game's page in the town's frame: a window whose parent is the town, on the same
 * origin, that hears messages. Returns how the town says something to it, and what the game said
 * to the town.
 */
function aFramedPage(): { say: (data: unknown) => void; told: unknown[] } {
  const told: unknown[] = [];
  const town = { location: { origin: ORIGIN }, postMessage: (msg: unknown): void => void told.push(msg) };
  const win = Object.assign(new EventTarget(), { location: { origin: ORIGIN }, parent: town });
  Object.defineProperty(globalThis, "window", { value: win, configurable: true });
  page = () => {
    Reflect.deleteProperty(globalThis, "window");
  };
  return {
    say: (data) => {
      win.dispatchEvent(new MessageEvent("message", { data, origin: ORIGIN }));
    },
    told,
  };
}

/** Leaf's word, `by` versions on from the tester's. */
const word = (by: number, over: Partial<Balances> = {}): Balances => ({
  coins: TESTER.coins,
  leaf: TESTER.leaf,
  version: TESTER.version + by,
  ...over,
});

describe("the member's purse on the guild's server", () => {
  test("starts from what /v1/game/me says, a guest's as a member's, and nothing is kept in the browser", async () => {
    world = standin({
      "GET /v1/game/hello": HELLO,
      "GET /v1/game/me": { status: 200, body: { ...GUEST, coins: 812 } },
    });
    await start();
    expect(balance()).toEqual({ coins: 812, leaf: GUEST.leaf });
    expect(world.store.length).toBe(0);
  });

  test("in the town's frame, the town's word is taken when it is newer, and the game says its own newer word to the town", async () => {
    world = live({ status: 200, body: TESTER }, { top: false });
    await start();
    const town = aFramedPage();
    const stop = keepLeaf();
    town.say({ town: "purse", purse: word(2, { coins: 420, leaf: 2560 }) });
    expect(balance()).toEqual({ coins: 420, leaf: 2560 });
    // Older, or not Leaf's word at all: nothing.
    for (const purse of [word(1, { coins: 5 }), { coins: -1, leaf: 0, version: 99 }, { coins: 3.5 }, "9", null]) {
      town.say({ town: "purse", purse });
    }
    town.say({ town: "coins", coins: 7 });
    expect(balance()).toEqual({ coins: 420, leaf: 2560 });
    // The game's own answers bring newer words: the town is told.
    fromLeaf(word(3, { coins: 400 }));
    expect(town.told.at(-1)).toEqual({ town: "purse", purse: word(3, { coins: 400 }) });
    // In the frame the town listens to the member's news, so the game does not.
    expect(world.sent.map((s) => s.path)).toEqual(["/v1/game/hello", "/v1/game/me"]);
    stop();
    town.say({ town: "purse", purse: word(4, { coins: 1 }) });
    expect(balance().coins).toBe(400);
  });

  test("without Leaf, the town's word is not taken", async () => {
    world = standin({ "GET /v1/game/hello": "offline" }, { top: false });
    await start();
    const town = aFramedPage();
    const stop = keepLeaf();
    const before = balance();
    town.say({ town: "purse", purse: word(5, { leaf: 99_999 }) });
    expect(balance()).toEqual(before);
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

  test("the town says Leaf's word to a game once it is ready, and each newer one after", async () => {
    world = live({ status: 200, body: TESTER });
    await start();
    const passed: Balances[] = [];
    const purse = passPurse((w) => passed.push(w));
    // Paid while the game is still opening: said when it is ready, and only the newest.
    fromLeaf(word(1, { leaf: 2500 }));
    fromLeaf(word(2, { leaf: 2560 }));
    expect(passed).toEqual([]);
    purse.ready();
    expect(passed).toEqual([word(2, { leaf: 2560 })]);
    // An older word is nothing to say.
    fromLeaf(word(1, { leaf: 2500 }));
    fromLeaf(word(3, { leaf: 2670 }));
    expect(passed).toEqual([word(2, { leaf: 2560 }), word(3, { leaf: 2670 })]);
    purse.stop();
    fromLeaf(word(4));
    expect(passed).toHaveLength(2);
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
    expect(w.me).toMatchObject({ name: "Alice", rank: "CAPTAIN", level: { number: 13 } });
    expect(balance().leaf).toBe(w.me.leaf);
  });

  test("signed out, and a guest", async () => {
    world = standin({
      "GET /v1/game/hello": said("GET /v1/game/hello"),
      "GET /v1/game/me": said("GET /v1/game/me, signed out"),
    });
    expect(await start()).toMatchObject({ mode: "shut", why: "signedout" });
    expect(world.went).toEqual([]);
    world.done();
    restart();
    world = standin({
      "GET /v1/game/hello": said("GET /v1/game/hello"),
      "GET /v1/game/me": said("GET /v1/game/me, a guest"),
    });
    expect(await start()).toMatchObject({ mode: "live", me: { name: "Visitor", guest: true } });
    // Leaf's spending is on, for a guest as for a member, and the purse asks the ledger again after a spend.
    expect([leafOpen(), leafShut(), leafFor("members")]).toEqual([true, LEAF_NOT_HERE, false]);
    expect(await refreshLeaf()).toMatchObject({ name: "Visitor", guest: true, leaf: 0 });
  });

  test("spending on: a command may take a member's Leaf, any other Leaf button stays closed, and the purse asks again after", async () => {
    let asked = 0;
    world = standin({
      "GET /v1/game/hello": said("GET /v1/game/hello"),
      "GET /v1/game/me": () => said(asked++ === 0 ? "GET /v1/game/me" : "GET /v1/game/me, after a look bought"),
    });
    await start();
    // `closeLeaf` closes every Leaf button beside the ledger; a page passes it one with a command only while `leafOpen()` is false.
    expect([leafOpen(), leafShut()]).toEqual([true, LEAF_NOT_HERE]);
    const passed: number[] = [];
    const purse = passPurse((w) => passed.push(w.leaf));
    purse.ready();
    const before = balance().leaf;
    expect(await refreshLeaf()).toMatchObject({ name: "Alice", leaf: before - 28_000 });
    expect(balance().leaf).toBe(before - 28_000);
    // The town still passes Leaf's word on to a game in its frame.
    expect(passed).toEqual([before, before - 28_000]);
    purse.stop();
  });
});

describe("a guest's page", () => {
  test("follows no news and asks nothing only a member may, and keeps the Leaf the ledger gave them", async () => {
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
    expect(balance().leaf).toBe(GUEST.leaf);
  });
});
