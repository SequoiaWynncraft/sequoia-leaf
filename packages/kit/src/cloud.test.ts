import { afterEach, describe, expect, test } from "bun:test";

import { forget, pull, push, PUSH_EVERY, SLOTS, sumOf, tick } from "./cloud.ts";
import { restart, start } from "./live.ts";
import { isRecord } from "./net.ts";
import { balance, forgetLedger } from "./purse.ts";
import { HELLO, type MemoryStore, type Sent, type Standin, standin, TESTER } from "./standin.ts";

interface Row {
  version: number;
  data: { saved_at: number; keys: Record<string, string> };
}

const slot = (s: Sent): string => s.path.split("/").pop() ?? "";

/** The server's saves, as the spec has them: one row a slot, written only over the version last read. */
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

describe("saves on the member's account", () => {
  test("pull writes the server's texts into the browser before the page reads them", async () => {
    const rows: Record<string, Row> = {
      purse: { version: 4, data: { saved_at: 100, keys: { "town.purse.v1": '{"coins":812}' } } },
      town: { version: 2, data: { saved_at: 100, keys: { "town.save.v1": '{"v":1,"town":"yes"}' } } },
    };
    world = standin(saves(rows));
    // A browser this member played in before, holding an old copy and a postcard the server does not have.
    world.store.setItem("town.cloud.v1", JSON.stringify({ player: TESTER.player.id, slots: {} }));
    world.store.setItem("town.save.v1", "old");
    world.store.setItem("town.postcard.raid.v1", "old card");
    await start();
    expect(await pull(["purse", "town"])).toBe(true);
    expect(world.store.getItem("town.save.v1")).toBe('{"v":1,"town":"yes"}');
    expect(world.store.getItem("town.postcard.raid.v1")).toBeNull();
    expect(balance()).toEqual({ leaf: TESTER.leaf, coins: 812 });
    expect(meta(world.store)).toMatchObject({ player: TESTER.player.id, slots: { purse: { version: 4 } } });
  });

  test("a slot the server has never had starts at version 0", async () => {
    const rows: Record<string, Row> = {};
    world = standin(saves(rows));
    await start();
    await pull(["works"]);
    world.store.setItem("works.save.v2", "a yard");
    tick();
    await Bun.sleep(1);
    expect(world.sent.at(-1)).toMatchObject({ method: "PUT", path: "/v1/game/saves/works", body: { version: 0 } });
    expect(rows.works?.data.keys).toEqual({ "works.save.v2": "a yard" });
  });

  test("a change is pushed with the version last read, and no oftener than every five seconds", async () => {
    const rows: Record<string, Row> = {
      raid: { version: 7, data: { saved_at: 100, keys: { "raid.almanac.v1": "a" } } },
    };
    world = standin(saves(rows));
    world.store.setItem("town.cloud.v1", JSON.stringify({ player: TESTER.player.id, slots: {} }));
    await start();
    await pull(["raid"]);
    tick();
    expect(world.sent.filter((s) => s.method === "PUT")).toEqual([]);

    world.store.setItem("raid.almanac.v1", "b");
    world.clock.now += 1000;
    tick();
    await Bun.sleep(1);
    const first = world.sent.filter((s) => s.method === "PUT");
    expect(first.length).toBe(1);
    expect(first[0]?.body).toEqual({
      version: 7,
      data: { saved_at: world.clock.now, keys: { "raid.almanac.v1": "b" } },
    });
    expect(rows.raid?.version).toBe(8);

    world.store.setItem("raid.almanac.v1", "c");
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
    await pull(["works"]);
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
    await pull(["works"]);
    rows.works = { version: 4, data: { saved_at: 200, keys: { "works.save.v2": "older, elsewhere" } } };
    world.store.setItem("works.save.v2", "later, here");
    world.clock.now = 9000;
    tick();
    await Bun.sleep(5);
    expect(rows.works).toEqual({ version: 5, data: { saved_at: 9000, keys: { "works.save.v2": "later, here" } } });
    expect(world.store.getItem("works.save.v2")).toBe("later, here");
  });

  test("a browser that last held somebody else's game is cleared before pulling", async () => {
    world = standin(saves({}));
    world.store.setItem("town.cloud.v1", JSON.stringify({ player: "somebody-else", slots: {} }));
    for (const names of Object.values(SLOTS)) for (const name of names) world.store.setItem(name, "theirs");
    world.store.setItem("raid.prefs.v1", "a view setting");
    world.store.setItem("town.muted", "1");
    await start();
    await pull(["purse"]);
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
    await pull(["works"]);
    expect(world.store.getItem("works.save.v2")).toBeNull();
  });

  test("a pull the server cannot answer says so", async () => {
    world = standin(saves({}, { "GET /v1/game/saves/town": () => ({ status: 503 }) }));
    await start();
    expect(await pull(["purse", "town"])).toBe(false);
  });

  test("with the made-up guild nothing is fetched", async () => {
    world = standin({ "GET /v1/game/hello": "offline" });
    await start();
    world.store.setItem("works.save.v2", "a yard");
    expect(await pull(["purse", "works"])).toBe(true);
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
    expect(await pull(["town"])).toBe(true);
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
    expect(await pull(["town"])).toBe(true);
    world.store.setItem("town.save.v1", "x");
    expect(await push("town")).toBe(true);
    expect(world.sent.at(-1)?.body).toMatchObject({ version: 0 });
  });
});
