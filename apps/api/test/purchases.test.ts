import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { leaf, playerId } from "@sequoia-leaf/core";

import { noNetwork, testLeaf } from "./support.ts";

/**
 * sequoia-backend's routes: a member's Leaf, and the tome and aspect requests it buys for them.
 * `contracts/leaf-internal-v1.json` holds what they answer, from the real routes; sequoia-backend's
 * tests read its copy of it (`src/test/resources/contracts/leaf-internal-v1.json`). Changing what a
 * route sends fails the last test here until the file is written again with
 * `WRITE_CONTRACTS=1 bun test test/purchases.test.ts`, and then copied to the backend.
 */
const CONTRACT = join(import.meta.dir, "..", "..", "..", "contracts", "leaf-internal-v1.json");

const alice = playerId("10000000-0000-0000-0000-000000000001");
const bob = playerId("10000000-0000-0000-0000-000000000002");
/** Wednesday 25 November 2026, 12:00 UTC. */
const T0 = Date.UTC(2026, 10, 25, 12);
/** The internal token the test Leaf is set up with (`testConfig`). */
const TOKEN = "internal-token";

const clock = { now: T0 };
let services: ReturnType<typeof testLeaf>;
let app: ReturnType<(typeof services)["app"]>;

beforeEach(async () => {
  clock.now = T0;
  services = testLeaf(clock, noNetwork);
  app = services.app();
  await services.post(
    { kind: "earn", playerId: alice, amount: leaf(5000), source: "raid", idempotencyKey: "raid:1:alice" },
    T0 - 1000,
  );
});

afterEach(async () => {
  await app.dispose();
  await services.dispose();
});

/** A call as sequoia-backend makes it, over the private network with the internal token. */
async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await app.request(path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

const buy = (key: string, body: unknown = { player_id: alice, kind: "tome", leaf: 3000 }) =>
  call("PUT", `/internal/v1/purchases/${key}`, body);
const cancel = (key: string) => call("DELETE", `/internal/v1/purchases/${key}`);
const balance = async (player = alice) => (await services.account(player)).balance;

const entries = () =>
  services.query(
    (sql) =>
      sql`SELECT player_id AS player, kind, balance_delta AS delta, origin, idempotency_key AS key, memo FROM ledger_entries WHERE origin = 'request' ORDER BY id`,
  );

describe("who may use the backend's routes", () => {
  it("refuses a call without the internal token, or with another", async () => {
    const answers = await Promise.all(
      [{ Authorization: "" }, { Authorization: "Bearer someone-else" }].map((headers) =>
        call("GET", `/internal/v1/players/${alice}/leaf`, undefined, headers),
      ),
    );
    const refused = { status: 401, body: { code: "unauthorized", message: "This is for Sequoia's own services" } };
    expect(answers).toEqual([refused, refused]);
  });

  it("refuses a call that came through the public proxy, even with the token", async () => {
    const proxied = await call(
      "PUT",
      "/internal/v1/purchases/k1",
      { player_id: alice, kind: "tome", leaf: 3000 },
      { "X-Forwarded-For": "203.0.113.9" },
    );
    expect(proxied.status).toBe(401);
    expect(await balance()).toBe(5000);
  });

  it("refuses every call when Leaf has no internal token", async () => {
    const tokenless = testLeaf(clock, noNetwork, { backendToken: undefined });
    const tokenlessApp = tokenless.app();
    const response = await tokenlessApp.request(`/internal/v1/players/${alice}/leaf`, {
      headers: { Authorization: "Bearer " },
    });
    expect(response.status).toBe(401);
    await tokenlessApp.dispose();
    await tokenless.dispose();
  });
});

describe("a member's Leaf", () => {
  it("answers their balance, and nothing for somebody with none", async () => {
    expect(await call("GET", `/internal/v1/players/${alice}/leaf`)).toEqual({
      status: 200,
      body: { player_id: alice, balance: 5000 },
    });
    expect((await call("GET", `/internal/v1/players/${bob}/leaf`)).body).toEqual({ player_id: bob, balance: 0 });
    expect((await call("GET", "/internal/v1/players/not-a-uuid/leaf")).status).toBe(400);
  });
});

describe("buying a request", () => {
  it("charges the price once, however often the same purchase is sent", async () => {
    expect(await buy("tome-1")).toEqual({ status: 200, body: { key: "tome-1", status: "paid", balance: 2000 } });
    expect(await buy("tome-1")).toEqual({ status: 200, body: { key: "tome-1", status: "paid", balance: 2000 } });

    expect(await balance()).toBe(2000);
    expect(await entries()).toEqual([
      {
        player: alice,
        kind: "spend",
        delta: -3000,
        origin: "request",
        key: "purchase:tome-1",
        memo: "Tome request",
      },
    ]);
  });

  it("refuses one the balance does not cover, charging nothing", async () => {
    await buy("tome-1");
    expect(await buy("aspect-1", { player_id: alice, kind: "aspect", leaf: 3000 })).toEqual({
      status: 409,
      body: { code: "insufficient_leaf", message: "The player does not have that much Leaf" },
    });
    expect(await balance()).toBe(2000);
  });

  it("refuses a key already used for another purchase", async () => {
    await buy("tome-1");
    const answers = await Promise.all(
      [
        { player_id: alice, kind: "tome", leaf: 2000 },
        { player_id: alice, kind: "aspect", leaf: 3000 },
      ].map((other) => buy("tome-1", other)),
    );
    const inUse = { code: "key_in_use", message: "That key was used for another purchase" };
    expect(answers.map((a) => a.body)).toEqual([inUse, inUse]);
    expect(await balance()).toBe(2000);
  });

  it("refuses a purchase or a key that is not one", async () => {
    const answers = await Promise.all(
      [
        { player_id: "alice", kind: "tome", leaf: 3000 },
        { player_id: alice, kind: "emerald", leaf: 3000 },
        { player_id: alice, kind: "tome", leaf: 0 },
        { player_id: alice, kind: "tome", leaf: 2.5 },
        { player_id: alice, kind: "tome" },
        "not json",
      ].map((body) => buy("k1", body)),
    );
    expect(answers.map((a) => a.status)).toEqual([400, 400, 400, 400, 400, 400]);
    for (const answer of answers) expect(answer.body).toMatchObject({ code: "invalid_purchase" });
    expect((await buy("a key with spaces")).body).toMatchObject({ code: "invalid_key" });
    expect(await balance()).toBe(5000);
  });
});

describe("cancelling a purchase", () => {
  it("gives a paid purchase's Leaf back, once", async () => {
    await buy("tome-1");
    expect(await cancel("tome-1")).toEqual({ status: 200, body: { key: "tome-1", status: "refunded" } });
    expect(await cancel("tome-1")).toEqual({ status: 200, body: { key: "tome-1", status: "refunded" } });

    expect(await balance()).toBe(5000);
    expect((await entries()).map((e) => [e.kind, e.delta, e.key])).toEqual([
      ["spend", -3000, "purchase:tome-1"],
      ["reversal", 3000, "purchase:tome-1:refund"],
    ]);
  });

  it("keeps a purchase cancelled before it arrived from ever being paid", async () => {
    expect(await cancel("tome-1")).toEqual({ status: 200, body: { key: "tome-1", status: "cancelled" } });
    expect(await buy("tome-1")).toEqual({
      status: 409,
      body: { code: "purchase_cancelled", message: "That purchase was cancelled" },
    });
    expect(await balance()).toBe(5000);
    expect(await entries()).toEqual([]);
  });

  it("does not charge a refunded purchase sent again", async () => {
    await buy("tome-1");
    await cancel("tome-1");
    expect((await buy("tome-1")).body).toMatchObject({ code: "purchase_cancelled" });
    expect(await balance()).toBe(5000);
  });
});

describe("the backend's contract", () => {
  it("answers as contracts/leaf-internal-v1.json says", async () => {
    const recorded: Record<string, unknown> = {};
    const record = async (name: string, method: string, path: string, body?: unknown) => {
      const answer = await call(method, path, body);
      recorded[name] = {
        request: body === undefined ? { method, path } : { method, path, body },
        status: answer.status,
        body: answer.body,
      };
    };
    const tome = { player_id: alice, kind: "tome", leaf: 3000 };
    await record("GET /internal/v1/players/{player}/leaf", "GET", `/internal/v1/players/${alice}/leaf`);
    await record("PUT /internal/v1/purchases/{key}", "PUT", "/internal/v1/purchases/request:1", tome);
    await record("PUT /internal/v1/purchases/{key}, the same again", "PUT", "/internal/v1/purchases/request:1", tome);
    await record("PUT /internal/v1/purchases/{key}, not enough Leaf", "PUT", "/internal/v1/purchases/request:2", {
      player_id: alice,
      kind: "aspect",
      leaf: 3000,
    });
    await record("DELETE /internal/v1/purchases/{key}, paid", "DELETE", "/internal/v1/purchases/request:1");
    await record("DELETE /internal/v1/purchases/{key}, never paid", "DELETE", "/internal/v1/purchases/request:3");
    await record("PUT /internal/v1/purchases/{key}, cancelled", "PUT", "/internal/v1/purchases/request:3", tome);
    await record("PUT /internal/v1/purchases/{key}, unread", "PUT", "/internal/v1/purchases/request:4", {
      player_id: alice,
      kind: "tome",
    });

    if (process.env["WRITE_CONTRACTS"] === "1") {
      writeFileSync(CONTRACT, `${JSON.stringify(recorded, null, 2)}\n`);
    }
    const contract: unknown = JSON.parse(readFileSync(CONTRACT, "utf8"));
    expect(contract).toEqual(recorded);
  });
});
