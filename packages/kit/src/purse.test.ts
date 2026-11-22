import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { isRecord, pretend } from "./net.ts";
import {
  balance,
  earn,
  earnMadeUp,
  flushCoins,
  forgetLedger,
  fromLeaf,
  fromLedger,
  grant,
  has,
  heardCoins,
  KEY,
  leafOpen,
  pretendPurse,
  refreshCoins,
  reset,
  settled,
  spend,
  watch,
} from "./purse.ts";
import { MemoryStore } from "./standin.ts";

describe("the purse", () => {
  beforeEach(reset);

  test("Coins are earned and Leaf is granted, in whole amounts", () => {
    const before = { ...balance() };
    earn(12.9, "daily_chest");
    grant(3.2, "a test");
    expect(balance()).toEqual({ leaf: before.leaf + 3, coins: before.coins + 12 });
  });

  test("nothing, or less than nothing, changes nothing", () => {
    const before = { ...balance() };
    earn(0, "daily_chest");
    earn(-5, "daily_chest");
    earn(0.5, "daily_chest");
    grant(-1, "a test");
    grant(Number.NaN, "a test");
    expect(balance()).toEqual(before);
  });

  test("spending takes the price only when the purse holds it", () => {
    const { leaf, coins } = balance();
    expect(spend("leaf", leaf + 1)).toBe(false);
    expect(balance().leaf).toBe(leaf);
    expect(spend("leaf", leaf)).toBe(true);
    expect(balance().leaf).toBe(0);
    expect(has("leaf", 1)).toBe(false);
    expect(spend("coins", -4, "camp_thing")).toBe(false);
    expect(balance().coins).toBe(coins);
  });

  test("whoever is watching hears each change, and why", () => {
    const heard: string[] = [];
    const stop = watch((_p, why) => heard.push(why));
    earn(5, "daily_chest");
    spend("coins", 2, "camp_thing");
    spend("coins", 1e9, "camp_thing");
    stop();
    earn(5, "daily_chest");
    expect(heard).toEqual(["daily_chest", "camp_thing"]);
  });

  test("a tour may set the made-up purse to what it likes", () => {
    pretendPurse(4000, 12);
    expect(balance()).toEqual({ coins: 4000, leaf: 12 });
  });

  test("the made-up guild's own Coins (its quests, its letter) are paid into it", () => {
    const heard: string[] = [];
    const stop = watch((_p, why) => heard.push(why));
    const before = balance().coins;
    earnMadeUp(40.7, "the quest board");
    earnMadeUp(0, "nothing");
    stop();
    expect(balance().coins).toBe(before + 40);
    expect(heard).toEqual(["the quest board"]);
  });
});

describe("the purse beside the guild's ledger, with the made-up guild's Coins", () => {
  let store = new MemoryStore();
  let done: (() => void) | null = null;
  beforeEach(() => {
    store = new MemoryStore();
    done = pretend({ store: () => store });
    reset();
    fromLedger(2450);
  });
  afterEach(() => {
    forgetLedger();
    done?.();
  });

  test("Leaf is what the ledger says, and only that", () => {
    expect(balance().leaf).toBe(2450);
    expect(leafOpen()).toBe(false);
    const heard: string[] = [];
    const stop = watch((p, why) => heard.push(`${p.leaf} ${why}`));
    fromLedger(2530);
    stop();
    expect(balance().leaf).toBe(2530);
    expect(heard).toEqual(["2530 the guild's ledger"]);
  });

  test("grant changes nothing", () => {
    const before = { ...balance() };
    grant(500, "a quest");
    expect(balance()).toEqual(before);
  });

  test("Leaf is never spent, even when the purse holds it", () => {
    expect(spend("leaf", 1)).toBe(false);
    expect(spend("leaf", 0)).toBe(false);
    expect(balance().leaf).toBe(2450);
  });

  test("Coins still come and go, and are kept without any Leaf beside them", () => {
    const coins = balance().coins;
    earn(40, "daily_chest");
    expect(spend("coins", 15, "camp_thing")).toBe(true);
    expect(balance()).toEqual({ leaf: 2450, coins: coins + 25 });
    expect(JSON.parse(store.getItem(KEY) ?? "null")).toEqual({ coins: coins + 25 });
  });
});

/** What a page sent Leaf about Coins, and who it said it was. */
interface Call {
  readonly path: string;
  readonly body: { id?: string; amount?: number; reason?: string } | null;
  readonly player: unknown;
  readonly keepalive: boolean;
}

/** A change to Coins as a page sends it, read back without trusting it. */
function readCall(v: unknown): Call["body"] {
  if (!isRecord(v)) return null;
  return {
    ...(typeof v.id === "string" ? { id: v.id } : {}),
    ...(typeof v.amount === "number" ? { amount: v.amount } : {}),
    ...(typeof v.reason === "string" ? { reason: v.reason } : {}),
  };
}

const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/**
 * Leaf's Coins, as `/v1/game/coins` and `/v1/game/me` answer them: a balance, each change done once
 * by its id, a spend refused below nothing. `gate` holds every answer back until it is opened, and
 * `offline` answers the next few with no network at all.
 */
function fakeLeaf(start: number) {
  const calls: Call[] = [];
  // `me` is who is signed in: a change from a page that says it is somebody else is not theirs.
  const leaf = { coins: start, done: new Set<string>(), calls, offline: 0, refuse: false, me: "p" };
  let open = true;
  let held: (() => void)[] = [];
  const fetch = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const body: unknown = typeof init.body === "string" ? JSON.parse(init.body) : null;
    const call: Call = {
      path,
      body: readCall(body),
      player: isRecord(body) ? body.player : undefined,
      keepalive: init.keepalive === true,
    };
    leaf.calls.push(call);
    if (!open) await new Promise<void>((resolve) => held.push(resolve));
    if (leaf.offline > 0) {
      leaf.offline--;
      throw new TypeError("Failed to fetch");
    }
    if (path === "/v1/game/me") return answer(200, { coins: leaf.coins });
    if (call.player !== leaf.me) return answer(409, { code: "not_you", message: "Load it again" });
    const { id = "", amount = 0 } = call.body ?? {};
    if (leaf.done.has(id)) return answer(200, { coins: leaf.coins });
    if (leaf.refuse || leaf.coins + amount < 0) return answer(409, { code: "not_enough_coins", message: "No" });
    leaf.done.add(id);
    leaf.coins += amount;
    return answer(200, { coins: leaf.coins });
  };
  return {
    leaf,
    fetch,
    hold() {
      open = false;
    },
    let() {
      open = true;
      for (const go of held.splice(0)) go();
    },
    /** Lets the oldest held answer go, and no other. */
    one() {
      held.shift()?.();
    },
    reset() {
      held = [];
    },
  };
}

/** Lets the page's promises run until the purse has nothing on its way. */
async function idle(): Promise<void> {
  await settled();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("the purse on the guild's server, whose Coins are Leaf's", () => {
  let store = new MemoryStore();
  let leaf = fakeLeaf(300);
  let done: (() => void) | null = null;
  beforeEach(() => {
    store = new MemoryStore();
    leaf = fakeLeaf(300);
    done = pretend({ store: () => store, fetch: leaf.fetch });
    fromLedger(2450);
    fromLeaf(300, "p");
  });
  afterEach(() => {
    leaf.let();
    forgetLedger();
    done?.();
  });

  test("start from what Leaf says, change at once, and reach Leaf behind, with the reason; nothing is kept in the browser", async () => {
    expect(balance()).toEqual({ leaf: 2450, coins: 300 });
    earn(3, "daily_chest", "chest-2026-11-22");
    expect(spend("coins", 120, "camp_thing")).toBe(true);
    expect(balance().coins).toBe(183);
    await idle();
    expect(leaf.leaf.coins).toBe(183);
    expect(balance().coins).toBe(183);
    expect(leaf.leaf.calls.map((c) => c.body)).toEqual([
      { id: "chest-2026-11-22", amount: 3, reason: "daily_chest" },
      { id: expect.stringMatching(/^[a-z0-9]+-\d+$/), amount: -120, reason: "camp_thing" },
    ]);
    expect(store.getItem(KEY)).toBeNull();
    expect(store.length).toBe(0);
  });

  test("go to Leaf in order, one at a time; earnings for one reason waiting together go as one", async () => {
    leaf.hold();
    earn(5, "daily_chest");
    earn(2, "daily_chest");
    earn(4, "daily_chest");
    earn(10, "daily_chest");
    expect(spend("coins", 300, "camp_thing")).toBe(true);
    // Spent from the page's number, at once: what is on its way counts.
    expect(spend("coins", 22, "camp_thing")).toBe(false);
    expect(balance().coins).toBe(21);
    await Promise.resolve();
    await Promise.resolve();
    expect(leaf.leaf.calls).toHaveLength(1);
    leaf.let();
    await idle();
    // The town has one reason to earn by, so all that waited goes together.
    expect(leaf.leaf.calls.map((c) => [c.body?.amount, c.body?.reason])).toEqual([
      [5, "daily_chest"],
      [16, "daily_chest"],
      [-300, "camp_thing"],
    ]);
    expect([leaf.leaf.coins, balance().coins]).toEqual([21, 21]);
  });

  test("an earning larger than one change may be goes as several", async () => {
    earn(12_000, "daily_chest");
    expect(balance().coins).toBe(12_300);
    await idle();
    expect(leaf.leaf.calls.map((c) => c.body?.amount)).toEqual([5000, 5000, 2000]);
  });

  test("is sent again with the same id after a network failure", async () => {
    leaf.leaf.offline = 2;
    earn(7, "daily_chest");
    await idle();
    const ids = leaf.leaf.calls.map((c) => c.body?.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(1);
    expect([leaf.leaf.coins, balance().coins]).toEqual([307, 307]);
  });

  test("a change Leaf refuses puts the page's number back to Leaf's, and the watchers hear it", async () => {
    // Spent elsewhere meanwhile: Leaf holds less than the page believes.
    leaf.leaf.coins = 50;
    const heard: string[] = [];
    const stop = watch((p, why) => heard.push(`${p.coins} ${why}`));
    expect(spend("coins", 120, "camp_thing")).toBe(true);
    expect(balance().coins).toBe(180);
    await idle();
    stop();
    expect(balance().coins).toBe(50);
    expect(heard).toEqual(["180 camp_thing", "300 refused", "50 Leaf"]);
    expect(leaf.leaf.calls.map((c) => c.path)).toEqual(["/v1/game/coins", "/v1/game/me"]);
  });

  test("asks Leaf again when told to, after what is on its way, and takes another page's number when nothing is", async () => {
    leaf.hold();
    earn(5, "daily_chest");
    refreshCoins();
    // Another page earned meanwhile.
    leaf.leaf.coins += 40;
    leaf.let();
    await idle();
    expect(leaf.leaf.calls.map((c) => c.path)).toEqual(["/v1/game/coins", "/v1/game/me"]);
    expect(balance().coins).toBe(345);
    heardCoins(400);
    expect(balance().coins).toBe(400);
    // With something on its way, it asks Leaf rather than take the number.
    leaf.hold();
    earn(1, "daily_chest");
    heardCoins(999);
    expect(balance().coins).toBe(401);
    leaf.let();
    await idle();
    expect(balance().coins).toBe(346);
  });

  test("sends everything Leaf has not answered as the page goes away, the change on its way too, each with its own id", async () => {
    leaf.hold();
    earn(5, "daily_chest");
    earn(10, "daily_chest");
    await Promise.resolve();
    await Promise.resolve();
    flushCoins();
    const [first] = leaf.leaf.calls;
    const away = leaf.leaf.calls.filter((c) => c.keepalive).map((c) => c.body);
    expect(away).toEqual([
      { id: first?.body?.id, amount: 5, reason: "daily_chest" },
      { id: expect.any(String), amount: 10, reason: "daily_chest" },
    ]);
    expect(away[1]?.id).not.toBe(first?.body?.id);
    leaf.let();
    await idle();
    // The same change, sent twice, is done once.
    expect(leaf.leaf.coins).toBe(315);
  });

  test("closing with a request on its way sends it again to keep, with the same id, and it is done once", async () => {
    leaf.hold();
    earn(5, "daily_chest");
    await Promise.resolve();
    await Promise.resolve();
    expect(leaf.leaf.calls).toHaveLength(1);
    flushCoins();
    const [own, kept] = leaf.leaf.calls;
    expect(own?.body).toEqual({ id: expect.any(String), amount: 5, reason: "daily_chest" });
    expect([own?.keepalive, kept?.keepalive]).toEqual([false, true]);
    expect(kept?.body).toEqual(own?.body ?? null);
    // The page's own request is lost as it closes; the one sent to keep reaches Leaf.
    leaf.leaf.offline = 1;
    leaf.let();
    await idle();
    expect(leaf.leaf.coins).toBe(305);
    expect(new Set(leaf.leaf.calls.filter((c) => c.path === "/v1/game/coins").map((c) => c.body?.id)).size).toBe(1);
  });

  test("closing while a change waits to be sent again sends it, and it is done once", async () => {
    leaf.leaf.offline = 1;
    earn(7, "daily_chest");
    // Found no answer: it waits a moment before being sent again.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(leaf.leaf.calls).toHaveLength(1);
    flushCoins();
    const kept = leaf.leaf.calls.filter((c) => c.keepalive);
    expect(kept.map((c) => c.body)).toEqual([leaf.leaf.calls[0]?.body ?? null]);
    expect(leaf.leaf.coins).toBe(307);
    await idle();
    expect(leaf.leaf.coins).toBe(307);
    expect(balance().coins).toBe(307);
  });

  test("after a flush, more earnings for the same reason are a new change: a sent one never grows", async () => {
    leaf.hold();
    earn(5, "daily_chest");
    earn(10, "daily_chest");
    await Promise.resolve();
    flushCoins();
    earn(5, "daily_chest");
    earn(2, "daily_chest");
    leaf.let();
    await idle();
    // Each id always carried the same amount, and every Coin reached Leaf once.
    const amounts = new Map<string, Set<number>>();
    for (const c of leaf.leaf.calls) {
      if (c.path !== "/v1/game/coins" || c.body?.id === undefined) continue;
      const seen = amounts.get(c.body.id) ?? new Set<number>();
      seen.add(c.body.amount ?? 0);
      amounts.set(c.body.id, seen);
    }
    expect([...amounts.values()].map((seen) => Array.from(seen))).toEqual([[5], [10], [7]]);
    expect([leaf.leaf.coins, balance().coins]).toEqual([322, 322]);
  });

  test("every change says who the page believes the member is", async () => {
    earn(3, "daily_chest");
    spend("coins", 1, "camp_thing");
    await idle();
    leaf.hold();
    earn(4, "daily_chest");
    await Promise.resolve();
    earn(5, "daily_chest");
    flushCoins();
    expect(new Set(leaf.leaf.calls.filter((c) => c.path === "/v1/game/coins").map((c) => c.player))).toEqual(
      new Set(["p"]),
    );
  });

  test("signed in as somebody else since the page opened: nothing more is sent or kept, and the page loads again", async () => {
    let reloaded = 0;
    done?.();
    done = pretend({ store: () => store, fetch: leaf.fetch, reload: () => void reloaded++ });
    leaf.leaf.me = "q";
    earn(5, "daily_chest");
    earn(6, "daily_chest");
    await idle();
    expect(reloaded).toBe(1);
    expect(leaf.leaf.calls.map((c) => c.body?.amount)).toEqual([5]);
    expect(leaf.leaf.coins).toBe(300);
    // Nothing more goes, however much the page earns or spends, nor as it goes away.
    earn(7, "daily_chest");
    expect(spend("coins", 1, "camp_thing")).toBe(true);
    flushCoins();
    await idle();
    expect(leaf.leaf.calls).toHaveLength(1);
    expect(store.map.size).toBe(0);
  });

  test("the made-up guild's tools leave Leaf's Coins alone", () => {
    pretendPurse(99_999);
    reset();
    earnMadeUp(50, "the quest board");
    expect(balance().coins).toBe(300);
    expect(leaf.leaf.calls).toEqual([]);
  });
});
