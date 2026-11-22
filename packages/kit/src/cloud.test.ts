import { afterEach, describe, expect, test } from "bun:test";

import { before, flush, forget, pull, push, PUSH_EVERY, type Slot, SLOTS, stopped, sumOf, tick } from "./cloud.ts";
import { keepText } from "./keep.ts";
import { restart, start } from "./live.ts";
import { isRecord, pretend } from "./net.ts";
import { post } from "./postcard.ts";
import { balance, earn, forgetLedger, KEY as PURSE_KEY } from "./purse.ts";
import { HELLO, type MemoryStore, type Sent, type Standin, standin, TESTER } from "./standin.ts";

interface Row {
  version: number;
  data: { saved_at: number; keys: Record<string, string> };
}

const slot = (s: Sent): string => s.path.split("/").pop() ?? "";

/**
 * The server's saves, as the spec has them: one row a slot, written only by the member signed in
 * (the tester), and only over the version last read.
 */
function saves(rows: Record<string, Row>, also: Record<string, (s: Sent) => { status: number; body?: unknown }> = {}) {
  return {
    "GET /v1/game/hello": HELLO,
    "GET /v1/game/me": { status: 200, body: TESTER },
    ...Object.fromEntries(
      Object.keys(SLOTS).flatMap((name) => [
        [
          `GET /v1/game/saves/${name}`,
          (s: Sent) => {
            const row = rows[slot(s)];
            return row
              ? { status: 200, body: { slot: slot(s), version: row.version, updated_at: "x", data: row.data } }
              : { status: 404, body: { code: "no_save" } };
          },
        ],
        [
          `PUT /v1/game/saves/${name}`,
          (s: Sent) => {
            const row = rows[slot(s)];
            const body = isRecord(s.body) ? s.body : {};
            const data = isRecord(body.data) ? body.data : {};
            const keys = isRecord(data.keys) ? data.keys : {};
            const version = typeof body.version === "number" ? body.version : -1;
            if (body.player !== TESTER.player.id) return { status: 409, body: { code: "not_you" } };
            if ((row?.version ?? 0) !== version) return { status: 409, body: { code: "version_conflict" } };
            rows[slot(s)] = {
              version: version + 1,
              data: {
                saved_at: typeof data.saved_at === "number" ? data.saved_at : 0,
                keys: Object.fromEntries(
                  Object.entries(keys).filter((e): e is [string, string] => typeof e[1] === "string"),
                ),
              },
            };
            return { status: 200, body: { version: version + 1, updated_at: "x" } };
          },
        ],
      ]),
    ),
    ...also,
  };
}

let world: Standin | null = null;
afterEach(() => {
  world?.done();
  world = null;
  restart();
  forget();
  forgetLedger();
});

const meta = (store: MemoryStore): Record<string, unknown> => JSON.parse(store.getItem("town.cloud.v1") ?? "null");
/** A page that does nothing when another device's copy wins. */
const page = { onReplaced: (): void => undefined };
const putsOf = (w: Standin): Sent[] => w.sent.filter((s) => s.method === "PUT");
/** A page's own savers, as the games have them: the yard and a postcard. */
const saveAsAGame = (): void => {
  keepText("works.save.v2", "this page's yard");
  post("works", { waiting: "mine", trophies: [], till: 1 });
};

/** The town's record, standing in for `save.ts`'s: what the member owns, and when they were last in town. */
const record = (lastSeen: number, owned: string[] = []): string => JSON.stringify({ v: 1, owned, lastSeen });

/**
 * Stands in for the page around the saves: its window and document, so that `pull` listens to them
 * as it does in a browser, and the page can be hidden. Returns how to hide it and how to take it away.
 */
function aPage(): { hide: () => void; done: () => void } {
  const win = Object.assign(new EventTarget(), { setInterval: (): number => 0 });
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  Object.defineProperty(globalThis, "window", { value: win, configurable: true });
  Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
  return {
    hide: () => {
      doc.visibilityState = "hidden";
      doc.dispatchEvent(new Event("visibilitychange"));
    },
    done: () => {
      Reflect.deleteProperty(globalThis, "window");
      Reflect.deleteProperty(globalThis, "document");
    },
  };
}

describe("saves on the member's account", () => {
  test("pull writes the server's texts into the browser before the page reads them", async () => {
    const rows: Record<string, Row> = {
      town: { version: 2, data: { saved_at: 100, keys: { "town.save.v1": '{"v":1,"town":"yes"}' } } },
    };
    world = standin(saves(rows));
    // A browser this member played in before, holding an old copy and a postcard the server does not have.
    world.store.setItem("town.cloud.v1", JSON.stringify({ player: TESTER.player.id, slots: {} }));
    world.store.setItem("town.save.v1", "old");
    world.store.setItem("town.postcard.raid.v1", "old card");
    await start();
    expect(await pull(["town"], page)).toBe(true);
    expect(world.store.getItem("town.save.v1")).toBe('{"v":1,"town":"yes"}');
    expect(world.store.getItem("town.postcard.raid.v1")).toBeNull();
    // The Coins are Leaf's, from who the member is; no slot holds any.
    expect(balance()).toEqual({ leaf: TESTER.leaf, coins: TESTER.coins });
    expect(meta(world.store)).toMatchObject({ player: TESTER.player.id, slots: { town: { version: 2 } } });
  });

  test("a slot the server has never had starts at version 0", async () => {
    const rows: Record<string, Row> = {};
    world = standin(saves(rows));
    await start();
    await pull(["works"], page);
    world.store.setItem("works.save.v2", "a yard");
    tick();
    await Bun.sleep(1);
    expect(world.sent.at(-1)).toMatchObject({ method: "PUT", path: "/v1/game/saves/works", body: { version: 0 } });
    expect(rows.works?.data.keys).toEqual({ "works.save.v2": "a yard" });
  });

  test("a change is pushed with the version last read, and no oftener than every five seconds", async () => {
    const rows: Record<string, Row> = {
      town: { version: 7, data: { saved_at: 100, keys: { "town.guild.v1": "a" } } },
    };
    world = standin(saves(rows));
    world.store.setItem("town.cloud.v1", JSON.stringify({ player: TESTER.player.id, slots: {} }));
    await start();
    await pull(["town"], page);
    tick();
    expect(world.sent.filter((s) => s.method === "PUT")).toEqual([]);

    world.store.setItem("town.guild.v1", "b");
    world.clock.now += 1000;
    tick();
    await Bun.sleep(1);
    const first = world.sent.filter((s) => s.method === "PUT");
    expect(first.length).toBe(1);
    expect(first[0]?.body).toEqual({
      player: TESTER.player.id,
      version: 7,
      data: { saved_at: world.clock.now, keys: { "town.guild.v1": "b" } },
    });
    expect(rows.town?.version).toBe(8);

    world.store.setItem("town.guild.v1", "c");
    world.clock.now += 1000;
    tick();
    await Bun.sleep(1);
    expect(world.sent.filter((s) => s.method === "PUT").length).toBe(1);
    world.clock.now += PUSH_EVERY;
    tick();
    await Bun.sleep(1);
    const puts = world.sent.filter((s) => s.method === "PUT");
    expect(puts.length).toBe(2);
    expect(puts[1]?.body).toMatchObject({ version: 8 });
  });

  test("on a conflict, a later save somewhere else is kept", async () => {
    const rows: Record<string, Row> = {
      works: { version: 3, data: { saved_at: 100, keys: { "works.save.v2": "mine" } } },
    };
    world = standin(saves(rows));
    world.store.setItem("town.cloud.v1", JSON.stringify({ player: TESTER.player.id, slots: {} }));
    await start();
    await pull(["works"], page);
    world.store.setItem("works.save.v2", "changed here");
    world.clock.now = 5000;
    tick();
    // Another device saved meanwhile, later than the change here.
    rows.works = { version: 4, data: { saved_at: 9000, keys: { "works.save.v2": "from the phone" } } };
    world.clock.now += PUSH_EVERY;
    expect(await push("works")).toBe(false);
    expect(world.store.getItem("works.save.v2")).toBe("from the phone");
    expect(rows.works).toEqual({ version: 4, data: { saved_at: 9000, keys: { "works.save.v2": "from the phone" } } });
  });

  test("on a conflict, a later save here is sent again over the server's version", async () => {
    const rows: Record<string, Row> = {
      works: { version: 3, data: { saved_at: 100, keys: { "works.save.v2": "mine" } } },
    };
    world = standin(saves(rows));
    world.store.setItem("town.cloud.v1", JSON.stringify({ player: TESTER.player.id, slots: {} }));
    await start();
    await pull(["works"], page);
    rows.works = { version: 4, data: { saved_at: 200, keys: { "works.save.v2": "older, elsewhere" } } };
    world.store.setItem("works.save.v2", "later, here");
    world.clock.now = 9000;
    tick();
    await Bun.sleep(5);
    expect(rows.works).toEqual({ version: 5, data: { saved_at: 9000, keys: { "works.save.v2": "later, here" } } });
    expect(world.store.getItem("works.save.v2")).toBe("later, here");
  });

  test("when another device's later copy wins, that slot is sent no more and the page is told once", async () => {
    const rows: Record<string, Row> = {
      works: { version: 3, data: { saved_at: 100, keys: { "works.save.v2": "mine" } } },
    };
    world = standin(saves(rows));
    world.store.setItem("town.cloud.v1", JSON.stringify({ player: TESTER.player.id, slots: {} }));
    await start();
    const told: Slot[] = [];
    await pull(["works"], { onReplaced: (s) => told.push(s) });
    // The phone saved the yard a minute from now; this page changes its older yard meanwhile.
    const phone = { version: 4, data: { saved_at: world.clock.now + 60_000, keys: { "works.save.v2": "phone" } } };
    rows.works = phone;
    world.store.setItem("works.save.v2", "changed here");
    tick();
    await Bun.sleep(5);
    expect(putsOf(world).length).toBe(1);
    expect(told).toEqual(["works"]);
    expect(world.store.getItem("works.save.v2")).toBe("phone");
    // From here the page's own savers write nothing: the copy just taken is what loads next.
    expect(stopped()).toBe(true);
    keepText("works.save.v2", "what this page still held");
    expect(world.store.getItem("works.save.v2")).toBe("phone");

    // The page still holds its older yard and writes it down again, while it is still open.
    world.store.setItem("works.save.v2", "changed here, again");
    world.clock.now += PUSH_EVERY;
    tick();
    flush();
    expect(await push("works")).toBe(false);
    await Bun.sleep(5);
    expect(putsOf(world).length).toBe(1);
    expect(told).toEqual(["works"]);
    expect(rows.works).toEqual(phone);
  });

  test("Coins are no slot's: nothing of them is pulled into the browser or sent from it", async () => {
    world = standin(saves({}, { "POST /v1/game/coins": () => ({ status: 200, body: { coins: 350 } }) }));
    await start();
    expect(Object.keys(SLOTS)).toEqual(["town", "works"]);
    expect(Object.values(SLOTS).flat()).not.toContain(PURSE_KEY);
    await pull(["town", "works"], page);
    earn(50, "works_order");
    world.clock.now += PUSH_EVERY;
    tick();
    await Bun.sleep(5);
    expect(world.store.getItem(PURSE_KEY)).toBeNull();
    expect(world.sent.some((s) => s.path.endsWith("/purse"))).toBe(false);
    expect(world.sent.filter((s) => s.method === "POST").map((s) => s.path)).toEqual(["/v1/game/coins"]);
  });

  test("a change here not yet sent survives another pull of the same version", async () => {
    const rows: Record<string, Row> = {
      works: { version: 1, data: { saved_at: 100, keys: { "works.save.v2": "a yard" } } },
    };
    world = standin(saves(rows));
    world.store.setItem("town.cloud.v1", JSON.stringify({ player: TESTER.player.id, slots: {} }));
    await start();
    await pull(["works"], page);
    // The yard changed, and at once the page pulls it again: no tick has seen the change.
    world.store.setItem("works.save.v2", "a bigger yard");
    expect(await pull(["works"], page)).toBe(true);
    expect(world.store.getItem("works.save.v2")).toBe("a bigger yard");
    // And the change still goes up.
    tick();
    await Bun.sleep(5);
    expect(rows.works).toMatchObject({ version: 2, data: { keys: { "works.save.v2": "a bigger yard" } } });
  });

  test("a pull of a newer copy takes it when nothing here is unsent, and keeps a change here, made now, when something is", async () => {
    const rows: Record<string, Row> = {
      town: { version: 1, data: { saved_at: 100, keys: { "town.guild.v1": "a guild" } } },
      works: { version: 1, data: { saved_at: 100, keys: { "works.save.v2": "a yard" } } },
    };
    world = standin(saves(rows));
    world.store.setItem("town.cloud.v1", JSON.stringify({ player: TESTER.player.id, slots: {} }));
    await start();
    await pull(["town", "works"], page);
    // The phone saved both since; only the yard has changed here meanwhile.
    rows.town = { version: 2, data: { saved_at: world.clock.now - 1000, keys: { "town.guild.v1": "phone guild" } } };
    rows.works = { version: 2, data: { saved_at: world.clock.now - 1000, keys: { "works.save.v2": "phone yard" } } };
    world.store.setItem("works.save.v2", "a bigger yard");
    world.clock.now += 1000;
    expect(await pull(["town", "works"], page)).toBe(true);
    expect(world.store.getItem("town.guild.v1")).toBe("phone guild");
    expect(world.store.getItem("works.save.v2")).toBe("a bigger yard");
    expect(await push("works")).toBe(true);
    expect(putsOf(world).map((s) => s.body)).toEqual([
      {
        player: TESTER.player.id,
        version: 2,
        data: { saved_at: world.clock.now, keys: { "works.save.v2": "a bigger yard" } },
      },
    ]);
  });

  test("a page whose browser now holds another member's game pushes nothing more, and loads again", async () => {
    const rows: Record<string, Row> = {
      works: { version: 1, data: { saved_at: 100, keys: { "works.save.v2": "a yard" } } },
    };
    world = standin(saves(rows));
    world.store.setItem("town.cloud.v1", JSON.stringify({ player: TESTER.player.id, slots: {} }));
    await start();
    await pull(["works"], page);
    // Somebody signs in as another member in another tab, and their page pulls their game.
    const theirs = JSON.stringify({ player: "somebody-else", slots: { works: { version: 4, saved: 1, sum: "x" } } });
    world.store.setItem("town.cloud.v1", theirs);
    world.store.setItem("works.save.v2", "their yard");
    // This page, still open, writes down what it holds.
    world.store.setItem("works.save.v2", "this page's yard");
    world.clock.now += PUSH_EVERY;
    tick();
    flush();
    expect(await push("works")).toBe(false);
    await Bun.sleep(5);
    expect(putsOf(world)).toEqual([]);
    expect(world.reloaded.count).toBe(1);
    expect(world.store.getItem("town.cloud.v1")).toBe(theirs);
  });

  test("the page stops as soon as storage shows another member's game", async () => {
    const shown = aPage();
    try {
      world = standin(saves({}));
      world.store.setItem("town.cloud.v1", JSON.stringify({ player: TESTER.player.id, slots: {} }));
      await start();
      await pull(["works"], page);
      world.store.setItem("town.cloud.v1", JSON.stringify({ player: "somebody-else", slots: {} }));
      window.dispatchEvent(new Event("storage"));
      expect(world.reloaded.count).toBe(1);
      // Even if the meta were written back, the page syncs nothing more.
      world.store.setItem("town.cloud.v1", JSON.stringify({ player: TESTER.player.id, slots: {} }));
      world.store.setItem("works.save.v2", "a yard");
      tick();
      shown.hide();
      await Bun.sleep(5);
      expect(putsOf(world)).toEqual([]);
      expect(world.reloaded.count).toBe(1);
    } finally {
      shown.done();
    }
  });

  test("a save the server refuses as somebody else's stops the page too", async () => {
    const rows: Record<string, Row> = {};
    world = standin(saves(rows, { "PUT /v1/game/saves/works": () => ({ status: 409, body: { code: "not_you" } }) }));
    await start();
    await pull(["works", "town"], page);
    world.store.setItem("works.save.v2", "a yard");
    world.store.setItem("town.guild.v1", "a guild");
    expect(await push("works")).toBe(false);
    expect(world.reloaded.count).toBe(1);
    expect(await push("town")).toBe(false);
    expect(putsOf(world).map((s) => s.path)).toEqual(["/v1/game/saves/works"]);
    expect(world.sent.filter((s) => s.method === "GET" && s.path.endsWith("/works")).length).toBe(1);
  });

  test("a page that finds another member's game stops before it loads again, and its savers write none of it", async () => {
    const shown = aPage();
    try {
      const rows: Record<string, Row> = {
        works: { version: 1, data: { saved_at: 100, keys: { "works.save.v2": "a yard" } } },
      };
      world = standin(saves(rows));
      world.store.setItem("town.cloud.v1", JSON.stringify({ player: TESTER.player.id, slots: {} }));
      // Whether the page had stopped by the time it asked to load again.
      const stoppedFirst: boolean[] = [];
      pretend({ reload: () => void stoppedFirst.push(stopped()) });
      await start();
      await pull(["works", "town"], page);
      // The page's savers run before a flush and as the page goes away, as the games' do.
      before(saveAsAGame);
      window.addEventListener("pagehide", saveAsAGame);
      saveAsAGame();
      expect(world.store.getItem("works.save.v2")).toBe("this page's yard");
      expect(world.store.getItem("town.postcard.works.v1")).not.toBeNull();

      // Another member signs in in another tab, and their page pulls their game.
      const theirs = JSON.stringify({ player: "somebody-else", slots: {} });
      world.store.setItem("town.cloud.v1", theirs);
      world.store.setItem("works.save.v2", "their yard");
      world.store.removeItem("town.postcard.works.v1");
      window.dispatchEvent(new Event("storage"));
      expect(stoppedFirst).toEqual([true]);
      expect(stopped()).toBe(true);

      // Loading again puts the page away: everything it does on the way out writes nothing.
      window.dispatchEvent(new Event("pagehide"));
      shown.hide();
      flush();
      saveAsAGame();
      await Bun.sleep(5);
      expect(world.store.getItem("works.save.v2")).toBe("their yard");
      expect(world.store.getItem("town.postcard.works.v1")).toBeNull();
      expect(world.store.getItem("town.cloud.v1")).toBe(theirs);
      expect(putsOf(world)).toEqual([]);
    } finally {
      shown.done();
    }
  });

  test("a write before the page hears of another member's game is refused, and stops the page", async () => {
    world = standin(saves({}));
    world.store.setItem("town.cloud.v1", JSON.stringify({ player: TESTER.player.id, slots: {} }));
    await start();
    await pull(["works"], page);
    expect(stopped()).toBe(false);
    // Their page has written down whose game it is, and this page has not yet heard.
    const theirs = JSON.stringify({ player: "somebody-else", slots: {} });
    world.store.setItem("town.cloud.v1", theirs);
    world.store.setItem("works.save.v2", "their yard");
    expect(keepText("works.save.v2", "a timer firing")).toBe(false);
    expect(world.store.getItem("works.save.v2")).toBe("their yard");
    expect(stopped()).toBe(true);
    expect(world.reloaded.count).toBe(1);
    expect(world.store.getItem("town.cloud.v1")).toBe(theirs);
  });

  test("the time last seen alone is not sent; it goes with a real change", async () => {
    const rows: Record<string, Row> = {
      town: { version: 2, data: { saved_at: 100, keys: { "town.save.v1": record(100) } } },
    };
    world = standin(saves(rows));
    world.store.setItem("town.cloud.v1", JSON.stringify({ player: TESTER.player.id, slots: {} }));
    await start();
    await pull(["town"], page);
    // Standing in town: the record is written again and again, with only the time last seen moved.
    for (let i = 0; i < 4; i++) {
      world.clock.now += PUSH_EVERY;
      world.store.setItem("town.save.v1", record(world.clock.now));
      tick();
    }
    await Bun.sleep(5);
    expect(putsOf(world)).toEqual([]);

    world.clock.now += PUSH_EVERY;
    world.store.setItem("town.save.v1", record(world.clock.now, ["lantern"]));
    tick();
    await Bun.sleep(5);
    expect(putsOf(world).length).toBe(1);
    expect(rows.town?.data).toEqual({
      saved_at: world.clock.now,
      keys: { "town.save.v1": record(world.clock.now, ["lantern"]) },
    });
  });

  test("the time last seen alone is sent when the page is hidden", async () => {
    const shown = aPage();
    try {
      const rows: Record<string, Row> = {
        town: { version: 2, data: { saved_at: 100, keys: { "town.save.v1": record(100) } } },
      };
      world = standin(saves(rows));
      world.store.setItem("town.cloud.v1", JSON.stringify({ player: TESTER.player.id, slots: {} }));
      await start();
      await pull(["town"], page);
      world.clock.now += 3 * PUSH_EVERY;
      world.store.setItem("town.save.v1", record(world.clock.now));
      tick();
      await Bun.sleep(5);
      expect(putsOf(world)).toEqual([]);

      shown.hide();
      await Bun.sleep(5);
      expect(putsOf(world)).toMatchObject([{ keepalive: true, body: { version: 2 } }]);
      // Nothing else changed, so the slot was last really changed when it was last saved.
      expect(rows.town?.data).toEqual({ saved_at: 100, keys: { "town.save.v1": record(world.clock.now) } });
    } finally {
      shown.done();
    }
  });

  test("a browser that last held somebody else's game is cleared before pulling", async () => {
    world = standin(saves({}));
    world.store.setItem("town.cloud.v1", JSON.stringify({ player: "somebody-else", slots: {} }));
    for (const names of Object.values(SLOTS)) for (const name of names) world.store.setItem(name, "theirs");
    world.store.setItem("raid.prefs.v1", "a view setting");
    world.store.setItem("town.muted", "1");
    await start();
    await pull(["works"], page);
    for (const names of Object.values(SLOTS)) for (const name of names) expect(world.store.getItem(name)).toBeNull();
    expect(world.store.getItem("raid.prefs.v1")).toBe("a view setting");
    expect(world.store.getItem("town.muted")).toBe("1");
    // Nothing of theirs was sent.
    tick();
    await Bun.sleep(1);
    expect(world.sent.filter((s) => s.method === "PUT")).toEqual([]);
  });

  test("a browser that holds nobody's is cleared too", async () => {
    world = standin(saves({}));
    world.store.setItem("works.save.v2", "from before");
    await start();
    await pull(["works"], page);
    expect(world.store.getItem("works.save.v2")).toBeNull();
  });

  test("a pull the server cannot answer says so", async () => {
    world = standin(saves({}, { "GET /v1/game/saves/town": () => ({ status: 503 }) }));
    await start();
    expect(await pull(["town"], page)).toBe(false);
  });

  test("with the made-up guild nothing is fetched", async () => {
    world = standin({ "GET /v1/game/hello": "offline" });
    await start();
    world.store.setItem("works.save.v2", "a yard");
    expect(await pull(["works"], page)).toBe(true);
    tick();
    expect(await push("works")).toBe(false);
    expect(world.sent.map((s) => s.path)).toEqual(["/v1/game/hello"]);
    expect(world.store.getItem("works.save.v2")).toBe("a yard");
  });

  test("the sum of a slot's texts does not depend on their order", () => {
    expect(sumOf({ a: "1", b: "2" })).toBe(sumOf({ b: "2", a: "1" }));
    expect(sumOf({ a: "1" })).not.toBe(sumOf({ a: "2" }));
  });
});

/** What Leaf's game routes really answer, from the contract its own tests write. */
const GAME: unknown = await Bun.file(new URL("../../../contracts/leaf-game-v1.json", import.meta.url)).json();
const said = (route: string): { status: number; body: unknown } => {
  const r = isRecord(GAME) ? GAME[route] : null;
  if (!isRecord(r) || typeof r.status !== "number") throw new Error(`no ${route} in the contract`);
  return { status: r.status, body: r.body };
};

describe("saves against what Leaf really answers", () => {
  test("a saved slot is pulled into the browser, and a change goes back over its version", async () => {
    world = standin({
      "GET /v1/game/hello": said("GET /v1/game/hello"),
      "GET /v1/game/me": said("GET /v1/game/me"),
      "GET /v1/game/saves/town": said("GET /v1/game/saves/{slot}"),
      "PUT /v1/game/saves/town": said("PUT /v1/game/saves/{slot}"),
    });
    await start();
    expect(await pull(["town"], page)).toBe(true);
    expect(world.store.getItem("town.save.v1")).toBe('{"v":1,"lanterns":3}');
    world.store.setItem("town.save.v1", '{"v":1,"lanterns":4}');
    world.clock.now += PUSH_EVERY;
    expect(await push("town")).toBe(true);
    expect(world.sent.at(-1)?.body).toMatchObject({ version: 1 });
  });

  test("a slot never saved starts at version 0", async () => {
    world = standin({
      "GET /v1/game/hello": said("GET /v1/game/hello"),
      "GET /v1/game/me": said("GET /v1/game/me"),
      "GET /v1/game/saves/town": said("GET /v1/game/saves/{slot}, never saved"),
      "PUT /v1/game/saves/town": said("PUT /v1/game/saves/{slot}"),
    });
    await start();
    expect(await pull(["town"], page)).toBe(true);
    world.store.setItem("town.save.v1", "x");
    expect(await push("town")).toBe(true);
    expect(world.sent.at(-1)?.body).toMatchObject({ version: 0 });
  });
});
