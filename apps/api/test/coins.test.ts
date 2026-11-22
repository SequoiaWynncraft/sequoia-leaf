import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { PAGE_COINS, playerId } from "@sequoia-leaf/core";
import { Schema } from "effect";

import { fakeBackend, HOUR, MINUTE, sessionOf, testLeaf } from "./support.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
const carol = playerId("10000000-0000-0000-0000-000000000003");
const dave = playerId("10000000-0000-0000-0000-000000000004");
/** Wednesday 25 November 2026, 12:00 UTC. */
const T0 = Date.UTC(2026, 10, 25, 12);
const ORIGIN = "https://leaf.seqwawa.com";

const clock = { now: T0 };
let services: ReturnType<typeof testLeaf>;
let app: ReturnType<(typeof services)["app"]>;

beforeEach(() => {
  clock.now = T0;
  const fake = fakeBackend({
    "alice-token": () => Response.json(sessionOf(alice, "Alice", "CAPTAIN")),
    // Not in the guild: a guest, who has Coins as a member has.
    "carol-token": () => Response.json(sessionOf(carol, "Carol", null)),
    "dave-token": () => Response.json({ ...sessionOf(dave, "Dave", null), website_admin: true }),
  });
  services = testLeaf(clock, fake.fetcher);
  app = services.app();
});

afterEach(async () => {
  await app.dispose();
  await services.dispose();
});

/** A page's call, as the town or the Works sends it: the website's cookie, from Leaf's own page. */
function call(body: unknown, token = "alice-token"): Promise<Response> {
  return Promise.resolve(
    app.request("/v1/game/coins", {
      method: "POST",
      headers: { Cookie: `seq_session=${token}`, Origin: ORIGIN, "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const Coins = Schema.Struct({ coins: Schema.Number });
const Failed = Schema.Struct({ code: Schema.String });

async function done(body: unknown, token?: string): Promise<number> {
  const response = await call(body, token);
  expect(response.status).toBe(200);
  return Schema.decodeUnknownSync(Coins)(await response.json()).coins;
}

async function refused(body: unknown, token?: string): Promise<[number, string]> {
  const response = await call(body, token);
  return [response.status, Schema.decodeUnknownSync(Failed)(await response.json()).code];
}

const entries = (player: string) =>
  services.query(
    (sql) => sql`SELECT amount, reason, game, key, at FROM coin_entries WHERE player_id = ${player} ORDER BY id`,
  );
const balance = async (player: string) =>
  Schema.decodeUnknownSync(Coins)(
    await (
      await app.request("/v1/game/me", {
        headers: { Cookie: `seq_session=${player === carol ? "carol-token" : "alice-token"}` },
      })
    ).json(),
  ).coins;

describe("POST /v1/game/coins", () => {
  it("pays or takes the amount as one entry in the ledger, for the reason's game, and answers the balance", async () => {
    // A new player's account opens with the welcome first.
    expect(await done({ id: "chest-2026-11-25", amount: 3, reason: "daily_chest" })).toBe(303);
    clock.now += MINUTE;
    expect(await done({ id: "p-1", amount: -120, reason: "camp_thing" })).toBe(183);
    expect(await done({ id: "p-2", amount: 40, reason: "works_order" })).toBe(223);
    expect(await balance(alice)).toBe(223);
    expect(await entries(alice)).toEqual([
      { amount: 300, reason: "Welcome to Guild Town", game: null, key: `welcome:${alice}`, at: T0 },
      { amount: 3, reason: "daily_chest", game: "town", key: `page:${alice}:chest-2026-11-25`, at: T0 },
      { amount: -120, reason: "camp_thing", game: "town", key: `page:${alice}:p-1`, at: T0 + MINUTE },
      { amount: 40, reason: "works_order", game: "works", key: `page:${alice}:p-2`, at: T0 + MINUTE },
    ]);
  });

  it("does a call sent twice once, answering the balance as it stands", async () => {
    expect(await done({ id: "p-1", amount: 50, reason: "works_depot" })).toBe(350);
    expect(await done({ id: "p-2", amount: -10, reason: "works_build" })).toBe(340);
    // Sent again, even with something else in it: nothing more is done.
    expect(await done({ id: "p-1", amount: 50, reason: "works_depot" })).toBe(340);
    expect(await done({ id: "p-1", amount: -5000, reason: "works_plot" })).toBe(340);
    expect((await entries(alice)).map((e) => e.key)).toEqual([
      `welcome:${alice}`,
      `page:${alice}:p-1`,
      `page:${alice}:p-2`,
    ]);
  });

  it("refuses a spend the balance does not cover with 409 not_enough_coins, changing nothing", async () => {
    expect(await done({ id: "p-1", amount: -300, reason: "works_plan" })).toBe(0);
    expect(await refused({ id: "p-2", amount: -1, reason: "works_build" })).toEqual([409, "not_enough_coins"]);
    expect(await done({ id: "p-3", amount: 10, reason: "works_refund" })).toBe(10);
    expect(await refused({ id: "p-4", amount: -11, reason: "camp_thing" })).toEqual([409, "not_enough_coins"]);
    expect(await balance(alice)).toBe(10);
    expect(await entries(alice)).toHaveLength(3);
    // The id of a refused call was not used: the same call is weighed again, and done once it may be.
    expect(await done({ id: "p-5", amount: 5, reason: "works_refund" })).toBe(15);
    expect(await done({ id: "p-4", amount: -11, reason: "camp_thing" })).toBe(4);
  });

  it("refuses earnings past 10,000 in any hour with 429 too_much, changing nothing; spending does not count", async () => {
    expect(await done({ id: "e-1", amount: 5000, reason: "while_away" })).toBe(5300);
    clock.now += 20 * MINUTE;
    expect(await done({ id: "s-1", amount: -2000, reason: "works_plot" })).toBe(3300);
    expect(await done({ id: "e-2", amount: 4999, reason: "works_order" })).toBe(8299);
    clock.now += 20 * MINUTE;
    expect(await done({ id: "e-3", amount: 1, reason: "works_depot" })).toBe(8300);
    expect(await refused({ id: "e-4", amount: 1, reason: "works_depot" })).toEqual([429, "too_much"]);
    expect(await balance(alice)).toBe(8300);
    // An hour after the first, it no longer counts: 5,000 may be earned again.
    clock.now = T0 + HOUR + 1;
    expect(await refused({ id: "e-5", amount: 5001, reason: "works_order" })).toEqual([400, "invalid_amount"]);
    expect(await done({ id: "e-5", amount: PAGE_COINS.most, reason: "works_order" })).toBe(13_300);
    expect(await refused({ id: "e-6", amount: 1, reason: "quest" })).toEqual([429, "too_much"]);
  });

  it("refuses an amount or a reason that is not one with 400, and a body that is not a call with invalid_command", async () => {
    const cases: [unknown, string][] = [
      [{ id: "x-1", amount: 0, reason: "quest" }, "invalid_amount"],
      [{ id: "x-1", amount: 2.5, reason: "quest" }, "invalid_amount"],
      [{ id: "x-1", amount: 5001, reason: "quest" }, "invalid_amount"],
      [{ id: "x-1", amount: -100_001, reason: "camp_thing" }, "invalid_amount"],
      // An earning sent as a spend, and a spend as an earning.
      [{ id: "x-1", amount: -3, reason: "daily_chest" }, "invalid_amount"],
      [{ id: "x-1", amount: 3, reason: "camp_thing" }, "invalid_amount"],
      [{ id: "x-1", amount: 3, reason: "the raid" }, "invalid_reason"],
      [{ id: "x-1", amount: 3, reason: "" }, "invalid_reason"],
      [{ id: "not an id", amount: 3, reason: "quest" }, "invalid_command"],
      [{ id: "x-1", amount: "3", reason: "quest" }, "invalid_command"],
      [{ amount: 3, reason: "quest" }, "invalid_command"],
      ["[1, 2, 3]", "invalid_command"],
    ];
    for (const [body, code] of cases) {
      // oxlint-disable-next-line no-await-in-loop -- one at a time, each refused
      expect([body, await refused(body)]).toEqual([body, [400, code]]);
    }
    expect(await services.query((sql) => sql`SELECT count(*) AS n FROM coin_entries`)).toEqual([{ n: 0 }]);
  });

  it("is a guest's too, and needs a session and Leaf's own pages", async () => {
    expect(await done({ id: "g-1", amount: 3, reason: "daily_chest" }, "carol-token")).toBe(303);
    expect(await balance(carol)).toBe(303);
    const signedOut = await call({ id: "g-2", amount: 3, reason: "quest" }, "nobody");
    expect(signedOut.status).toBe(401);
    const elsewhere = await app.request("/v1/game/coins", {
      method: "POST",
      headers: { Cookie: "seq_session=carol-token", Origin: "https://example.com", "Content-Type": "application/json" },
      body: JSON.stringify({ id: "g-3", amount: 3, reason: "quest" }),
    });
    expect([elsewhere.status, await elsewhere.json()]).toMatchObject([403, { code: "bad_origin" }]);
    expect(await balance(carol)).toBe(303);
  });

  it("is counted, done and refused, for the staff's report, which reads the ledger's Coins risen in an hour", async () => {
    await done({ id: "e-1", amount: 5000, reason: "works_order" });
    clock.now += 10 * MINUTE;
    await done({ id: "e-2", amount: 1000, reason: "works_depot" });
    await refused({ id: "s-1", amount: -100_000, reason: "works_plot" });
    await refused({ id: "s-2", amount: -100_000, reason: "works_plot" });
    // Answered from before: not counted again.
    await done({ id: "e-2", amount: 1000, reason: "works_depot" });
    expect(await services.query((sql) => sql`SELECT player_id, done, refused FROM command_days`)).toEqual([
      { player_id: alice, done: 2, refused: 2 },
    ]);
    const report = await app.request("/v1/game/admin/activity", { headers: { Authorization: "Bearer dave-token" } });
    expect(report.status).toBe(200);
    const { odd } = Schema.decodeUnknownSync(
      Schema.Struct({
        odd: Schema.Array(Schema.Struct({ id: Schema.String, rule: Schema.String, value: Schema.Number })),
      }),
    )(await report.json());
    // The welcome and the two earnings, within the hour from the welcome.
    expect(odd).toEqual([{ id: alice, rule: "coins_in_an_hour", value: 6300 }]);
  });
});

describe("the pace of POST /v1/game/coins", () => {
  it("is four calls a second for a player, in bursts of twenty: past it 429 slow_down, nothing done or counted", async () => {
    for (let i = 0; i < 20; i++) {
      // oxlint-disable-next-line no-await-in-loop -- one at a time
      await done({ id: `b-${i}`, amount: -1, reason: "works_build" });
    }
    expect(await refused({ id: "b-20", amount: -1, reason: "works_build" })).toEqual([429, "slow_down"]);
    expect(await balance(alice)).toBe(280);
    expect(await entries(alice)).toHaveLength(21);
    expect(await services.query((sql) => sql`SELECT done, refused FROM command_days`)).toEqual([
      { done: 20, refused: 0 },
    ]);
    // A quarter of a second later there is room for one more; another player has their own.
    clock.now += 250;
    expect(await done({ id: "b-20", amount: -1, reason: "works_build" })).toBe(279);
    expect(await refused({ id: "b-21", amount: -1, reason: "works_build" })).toEqual([429, "slow_down"]);
    expect(await done({ id: "g-1", amount: -1, reason: "works_build" }, "carol-token")).toBe(299);
  });

  it("weighs the cap on a player's entries of the last day alone, by an index on the time", async () => {
    const plan = await services.query(
      (sql) => sql`
        EXPLAIN QUERY PLAN SELECT coalesce(sum(amount), 0) FROM coin_entries
        WHERE player_id = ${alice} AND amount > 0 AND at > ${T0 - HOUR} AND substr(key, 1, 5) = 'page:'
      `,
    );
    expect(plan.map((row) => String(Object(row).detail))).toEqual([
      "SEARCH coin_entries USING INDEX coin_entries_by_player_at (player_id=? AND at>?)",
    ]);
  });
});

describe("PUT /v1/game/saves/purse", () => {
  it("answers 410 moved and stores nothing: Coins are the ledger's now; what was there can still be read", async () => {
    await services.query(
      (sql) => sql`
        INSERT INTO saves (player_id, slot, version, data, updated_at, guest)
        VALUES (${alice}, 'purse', 2, '{"saved_at":1,"keys":{"town.purse.v1":"{\\"coins\\":812}"}}', ${T0 - HOUR}, 0)
      `,
    );
    const response = await app.request("/v1/game/saves/purse", {
      method: "PUT",
      headers: { Cookie: "seq_session=alice-token", Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({
        player: alice,
        version: 2,
        data: { saved_at: 2, keys: { "town.purse.v1": '{"coins":99999}' } },
      }),
    });
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({
      code: "moved",
      message: "Coins are kept in Leaf's ledger now, and the old purse takes no more writes",
    });
    const kept = await app.request("/v1/game/saves/purse", { headers: { Cookie: "seq_session=alice-token" } });
    expect(await kept.json()).toMatchObject({ version: 2, data: { keys: { "town.purse.v1": '{"coins":812}' } } });
    expect(await services.query((sql) => sql`SELECT count(*) AS n FROM save_history`)).toEqual([{ n: 0 }]);
  });
});
