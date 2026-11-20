import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { DAY_MS, DEFAULT_RULES, leaf, type PlayerId, playerId } from "@sequoia-leaf/core";
import { Schema } from "effect";

import * as Body from "../src/api/schemas.ts";
import { autoConfirmOrders } from "../src/market/actions.ts";
import { HOUR, testLeaf } from "./support.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
const bob = playerId("10000000-0000-0000-0000-000000000002");
const carol = playerId("10000000-0000-0000-0000-000000000003");
const staff = playerId("10000000-0000-0000-0000-00000000000f");
/** Wednesday 25 November 2026, 12:00 UTC. */
const T0 = Date.UTC(2026, 10, 25, 12);

const rules = DEFAULT_RULES.market;

/** The members the stand-in backend knows, by token. Staff are website administrators. */
const members: Readonly<Record<string, { id: PlayerId; name: string; admin: boolean }>> = {
  "alice-token": { id: alice, name: "Alice", admin: false },
  "bob-token": { id: bob, name: "Bob", admin: false },
  "carol-token": { id: carol, name: "Carol", admin: false },
  "staff-token": { id: staff, name: "Steward", admin: true },
};

const clock = { now: T0 };
let services: ReturnType<typeof testLeaf>;
let app: ReturnType<(typeof services)["app"]>;

function backend(url: string, init: RequestInit): Promise<Response> {
  const token = new Request(url, init).headers.get("Authorization")?.slice("Bearer ".length) ?? "";
  const known = members[token];
  return Promise.resolve(
    known === undefined
      ? Response.json({ error: "unauthorized" }, { status: 401 })
      : Response.json({
          minecraft_uuid: known.id,
          minecraft_username: known.name,
          guild_rank: "MEMBER",
          website_admin: known.admin,
        }),
  );
}

async function json(response: Response | Promise<Response>): Promise<{ status: number; body: unknown }> {
  const answered = await response;
  return { status: answered.status, body: await answered.json() };
}

function send(method: string, path: string, body?: unknown, token: string | null = "alice-token") {
  return json(
    app.request(path, {
      method,
      headers: {
        ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

const decode = {
  listing: Schema.decodeUnknownSync(Body.ListingAnswer),
  listings: Schema.decodeUnknownSync(Body.Listings),
  mine: Schema.decodeUnknownSync(Body.MyListings),
  acted: Schema.decodeUnknownSync(Body.OrderActed),
  order: Schema.decodeUnknownSync(Body.OrderAnswer),
  orders: Schema.decodeUnknownSync(Body.Orders),
  disputes: Schema.decodeUnknownSync(Body.Disputes),
  events: Schema.decodeUnknownSync(Body.Events),
};

const potions = { kind: "item", title: "Stack of healing potions", description: "Crafted, 64.", price: 500 };

/** Lists something as a seller, and answers the listing. */
async function list(overrides: Record<string, unknown> = {}, token = "alice-token") {
  const answer = await send("POST", "/v1/market/listings", { ...potions, request_id: "list-1", ...overrides }, token);
  expect(answer.status).toBe(200);
  return decode.listing(answer.body).listing;
}

function buy(listingId: number, requestId: string, overrides: Record<string, unknown> = {}, token = "bob-token") {
  return send(
    "POST",
    `/v1/market/listings/${listingId}/buy`,
    { price: 500, request_id: requestId, ...overrides },
    token,
  );
}

/** Buys a unit as Bob, and answers the order. */
async function order(listingId: number, requestId = "buy-1") {
  const answer = await buy(listingId, requestId);
  expect(answer.status).toBe(200);
  return decode.acted(answer.body).order;
}

function act(orderId: number, action: string, token: string, body?: unknown) {
  return send("POST", `/v1/market/orders/${orderId}/${action}`, body, token);
}

function resolve(orderId: number, outcome: "release" | "refund", token = "staff-token") {
  return send("POST", `/v1/staff/market/orders/${orderId}/resolve`, { outcome, note: "Checked the trade log" }, token);
}

function give(player: PlayerId, amount: number) {
  return services.post(
    { kind: "earn", playerId: player, amount: leaf(amount), source: "staff", idempotencyKey: `grant:${player}` },
    T0,
  );
}

const balance = async (player: PlayerId) => (await services.account(player)).balance;

/** The ledger's entries for orders, oldest first. */
function marketEntries() {
  return services.query(
    (sql) => sql`
      SELECT player_id AS playerId, kind, origin, balance_delta AS delta, xp_delta AS xp, idempotency_key AS key, actor
      FROM ledger_entries WHERE origin IN ('market_hold', 'market_sale') ORDER BY id
    `,
  );
}

async function eventTypes(token: string): Promise<string[]> {
  const { body } = await send("GET", "/v1/me/events", undefined, token);
  return decode.events(body).events.map((event) => event.type);
}

/** The titles of the listings the public list shows for a query. */
async function titles(query: string) {
  const { body } = await send("GET", `/v1/market/listings?${query}`, undefined, null);
  return decode.listings(body).listings.map((listing) => listing.title);
}

/** Runs each step after the one before has finished. */
function inTurn<A>(items: readonly A[], step: (item: A) => Promise<unknown>): Promise<unknown> {
  return items.reduce<Promise<unknown>>((done, item) => done.then(() => step(item)), Promise.resolve());
}

beforeEach(async () => {
  clock.now = T0;
  services = testLeaf(clock, backend);
  app = services.app();
  await give(bob, 10_000);
  await give(staff, 10_000);
});

afterEach(async () => {
  await app.dispose();
  await services.dispose();
});

describe("POST /v1/market/listings", () => {
  it("lists an item for anyone to see, taking orders for 14 days", async () => {
    const listing = await list({ title: "  Stack of healing potions  " });

    expect(listing).toEqual({
      id: 1,
      kind: "item",
      title: "Stack of healing potions",
      description: "Crafted, 64.",
      price: 500,
      quantity: 1,
      remaining: 1,
      status: "open",
      seller: { player_id: alice, name: "Alice" },
      created_at: "2026-11-25T12:00:00.000Z",
      updated_at: "2026-11-25T12:00:00.000Z",
      expires_at: "2026-12-09T12:00:00.000Z",
    });
    const browsed = await send("GET", "/v1/market/listings", undefined, null);
    expect(decode.listings(browsed.body)).toEqual({ listings: [listing], next_before: null });
  });

  it("makes one listing when the same request is sent again", async () => {
    const first = await list();

    expect(await list()).toEqual(first);
    expect(await services.query((sql) => sql`SELECT id FROM market_listings`)).toEqual([{ id: 1 }]);
  });

  it("refuses a request id already used for a different listing", async () => {
    await list();

    expect(
      await send("POST", "/v1/market/listings", { ...potions, title: "Other", request_id: "list-1" }),
    ).toMatchObject({ status: 409, body: { code: "request_conflict" } });
  });

  it("refuses a listing the rules don't take, saying which part", async () => {
    const answers = [
      await send("POST", "/v1/market/listings", { ...potions, title: "ab", request_id: "a" }),
      await send("POST", "/v1/market/listings", { ...potions, price: 0, request_id: "b" }),
      await send("POST", "/v1/market/listings", { ...potions, quantity: 65, request_id: "c" }),
    ];

    expect(answers).toMatchObject([
      { status: 400, body: { code: "invalid_listing", message: "A title is 3 to 80 characters" } },
      { status: 400, body: { code: "invalid_listing", message: "A price is a whole 1 to 1000000 Leaf" } },
      { status: 400, body: { code: "invalid_listing", message: "A listing offers 1 to 64" } },
    ]);
  });

  it("answers a body it can't read with invalid_request", async () => {
    expect(await send("POST", "/v1/market/listings", { ...potions, kind: "pet", request_id: "a" })).toMatchObject({
      status: 400,
      body: { code: "invalid_request" },
    });
  });

  it("needs a session", async () => {
    expect(await send("POST", "/v1/market/listings", { ...potions, request_id: "a" }, null)).toMatchObject({
      status: 401,
    });
  });

  it("lets a seller have 20 listings taking orders, and no more until one closes", async () => {
    await inTurn(
      Array.from({ length: 20 }, (_, index) => index),
      (index) => list({ request_id: `list-${index}` }),
    );

    expect(await send("POST", "/v1/market/listings", { ...potions, request_id: "list-21" })).toMatchObject({
      status: 409,
      body: { code: "too_many_listings" },
    });
    await send("POST", "/v1/market/listings/1/withdraw");
    expect((await send("POST", "/v1/market/listings", { ...potions, request_id: "list-21" })).status).toBe(200);
  });
});

describe("GET /v1/market/listings", () => {
  it("shows listings taking orders newest first, a page at a time", async () => {
    await inTurn([1, 2, 3, 4, 5], async (index) => {
      clock.now = T0 + index * HOUR;
      await list({ title: `Listing ${index}`, request_id: `list-${index}` });
    });

    const first = decode.listings((await send("GET", "/v1/market/listings?limit=2", undefined, null)).body);
    const second = decode.listings(
      (await send("GET", `/v1/market/listings?limit=2&before=${first.next_before}`, undefined, null)).body,
    );
    const last = decode.listings(
      (await send("GET", `/v1/market/listings?limit=2&before=${second.next_before}`, undefined, null)).body,
    );

    expect(first.listings.map((listing) => listing.title)).toEqual(["Listing 5", "Listing 4"]);
    expect(second.listings.map((listing) => listing.title)).toEqual(["Listing 3", "Listing 2"]);
    expect(last).toMatchObject({ listings: [{ title: "Listing 1" }], next_before: null });
  });

  it("narrows to a kind and to words in the title or description, taken as written", async () => {
    await list({ title: "Raid carry", kind: "service", description: "Any raid", request_id: "a" });
    await list({ title: "Potions", description: "100% healing", request_id: "b" });
    await list({ title: "Arrows", description: "1000 healing arrows", request_id: "c" });

    expect(await titles("kind=service")).toEqual(["Raid carry"]);
    expect(await titles("q=HEALING")).toEqual(["Arrows", "Potions"]);
    expect(await titles(`q=${encodeURIComponent("100%")}`)).toEqual(["Potions"]);
  });

  it("leaves out listings withdrawn, expired or sold out", async () => {
    await list({ title: "Expired", request_id: "a" });
    clock.now = T0 + DAY_MS;
    await list({ title: "Withdrawn", request_id: "b" });
    await send("POST", "/v1/market/listings/2/withdraw");
    await list({ title: "Sold out", request_id: "c" });
    await order(3);
    await list({ title: "Open", request_id: "d" });
    clock.now = T0 + 14 * DAY_MS;

    const browsed = decode.listings((await send("GET", "/v1/market/listings", undefined, null)).body);

    expect(browsed.listings.map((listing) => listing.title)).toEqual(["Open"]);
  });

  it("shows any one listing by id however it stands, and says when there is none", async () => {
    await list();
    await send("POST", "/v1/market/listings/1/withdraw");

    expect(await send("GET", "/v1/market/listings/1", undefined, null)).toMatchObject({
      status: 200,
      body: { listing: { id: 1, status: "withdrawn" } },
    });
    expect(await send("GET", "/v1/market/listings/9", undefined, null)).toMatchObject({
      status: 404,
      body: { code: "listing_not_found" },
    });
    expect(await send("GET", "/v1/market/listings/abc", undefined, null)).toMatchObject({
      status: 400,
      body: { code: "invalid_request" },
    });
  });
});

describe("changing a listing", () => {
  it("lets the seller change its price and description while no order is open, and keeps each change", async () => {
    await list();

    const answer = await send("PATCH", "/v1/market/listings/1", { price: 450, description: " Fresh. " });

    expect(decode.listing(answer.body).listing).toMatchObject({ price: 450, description: "Fresh." });
    expect(
      await services.query(
        (sql) => sql`SELECT change, actor, price, description FROM market_listing_changes ORDER BY id`,
      ),
    ).toEqual([
      { change: "created", actor: alice, price: 500, description: "Crafted, 64." },
      { change: "edited", actor: alice, price: 450, description: "Fresh." },
    ]);
  });

  it("changes nothing when asked for the terms it has", async () => {
    await list();

    expect((await send("PATCH", "/v1/market/listings/1", { price: 500 })).status).toBe(200);
    expect(await services.query((sql) => sql`SELECT change FROM market_listing_changes`)).toEqual([
      { change: "created" },
    ]);
  });

  it("refuses to change its terms while an order on it is open", async () => {
    await list({ quantity: 2 });
    const placed = await order(1);

    expect(await send("PATCH", "/v1/market/listings/1", { price: 5 })).toMatchObject({
      status: 409,
      body: { code: "has_open_orders" },
    });
    await act(placed.id, "cancel", "bob-token");
    expect((await send("PATCH", "/v1/market/listings/1", { price: 5 })).status).toBe(200);
  });

  it("refuses a change or a withdrawal by anyone but the seller", async () => {
    await list();

    expect(await send("PATCH", "/v1/market/listings/1", { price: 5 }, "bob-token")).toMatchObject({
      status: 403,
      body: { code: "not_seller" },
    });
    expect(await send("POST", "/v1/market/listings/1/withdraw", undefined, "bob-token")).toMatchObject({
      status: 403,
      body: { code: "not_seller" },
    });
  });

  it("stops a withdrawn listing taking orders, and withdraws it once however often asked", async () => {
    await list();

    await send("POST", "/v1/market/listings/1/withdraw");
    const again = await send("POST", "/v1/market/listings/1/withdraw");

    expect(decode.listing(again.body).listing.status).toBe("withdrawn");
    expect(await buy(1, "buy-1")).toMatchObject({ status: 409, body: { code: "listing_closed" } });
    expect(await services.query((sql) => sql`SELECT change FROM market_listing_changes ORDER BY id`)).toEqual([
      { change: "created" },
      { change: "withdrawn" },
    ]);
  });

  it("shows the seller their own listings however they stand, with their open orders", async () => {
    await list({ title: "First", quantity: 3, request_id: "a" });
    await list({ title: "Second", request_id: "b" });
    await send("POST", "/v1/market/listings/2/withdraw");
    await order(1);

    const mine = decode.mine((await send("GET", "/v1/market/my-listings")).body);

    expect(
      mine.listings.map((listing) => [listing.title, listing.status, listing.remaining, listing.open_orders]),
    ).toEqual([
      ["Second", "withdrawn", 1, 0],
      ["First", "open", 2, 1],
    ]);
  });
});

describe("POST /v1/market/listings/{id}/buy", () => {
  beforeEach(async () => {
    await list({ quantity: 3 });
  });

  it("holds the buyer's Leaf through the ledger, keyed by the order, and tells both sides", async () => {
    const answer = await buy(1, "buy-1", { quantity: 2 });

    expect(answer.status).toBe(200);
    const { order: placed, leaf: left } = decode.acted(answer.body);
    expect(left).toBe(9_000);
    expect(placed).toMatchObject({
      id: 1,
      listing: { id: 1, kind: "item", title: "Stack of healing potions" },
      seller: { player_id: alice, name: "Alice" },
      buyer: { player_id: bob, name: "Bob" },
      quantity: 2,
      price: 500,
      leaf: 1000,
      fee: 0,
      state: "placed",
      delivered_at: null,
      auto_confirms_at: null,
    });
    expect(await marketEntries()).toEqual([
      { playerId: bob, kind: "spend", origin: "market_hold", delta: -1000, xp: 0, key: "market_hold:1", actor: null },
    ]);
    expect(await eventTypes("bob-token")).toContain("market.order_placed");
    expect(await eventTypes("alice-token")).toEqual(["market.order_placed"]);
  });

  it("places one order when the same request is sent again", async () => {
    const first = await buy(1, "buy-1");

    expect(await buy(1, "buy-1")).toEqual(first);
    expect(await balance(bob)).toBe(9_500);
    expect(await marketEntries()).toHaveLength(1);
  });

  it("refuses a request id already used for a different order", async () => {
    await buy(1, "buy-1");

    expect(await buy(1, "buy-1", { quantity: 2 })).toMatchObject({ status: 409, body: { code: "request_conflict" } });
  });

  it("refuses an order the balance doesn't cover, and changes nothing", async () => {
    await send("PATCH", "/v1/market/listings/1", { price: 6_000 });

    expect(await buy(1, "buy-1", { price: 6_000, quantity: 2 })).toMatchObject({
      status: 409,
      body: { code: "insufficient_leaf" },
    });
    expect(await balance(bob)).toBe(10_000);
    expect(await services.query((sql) => sql`SELECT id FROM market_orders`)).toEqual([]);
    expect(await eventTypes("alice-token")).toEqual([]);
  });

  it("refuses buying one's own listing", async () => {
    await give(alice, 1000);

    expect(await buy(1, "buy-1", {}, "alice-token")).toMatchObject({ status: 409, body: { code: "own_listing" } });
  });

  it("refuses a listing that has expired", async () => {
    clock.now = T0 + 14 * DAY_MS;

    expect(await buy(1, "buy-1")).toMatchObject({ status: 409, body: { code: "listing_closed" } });
  });

  it("refuses a price other than the one the listing asks now", async () => {
    await send("PATCH", "/v1/market/listings/1", { price: 900 });

    expect(await buy(1, "buy-1")).toMatchObject({ status: 409, body: { code: "price_changed" } });
    expect(await balance(bob)).toBe(10_000);
  });

  it("refuses more than are left, and takes them again once an order is cancelled", async () => {
    const placed = await order(1, "buy-1");
    await buy(1, "buy-2", { quantity: 2 });

    expect(await buy(1, "buy-3")).toMatchObject({ status: 409, body: { code: "sold_out" } });
    await act(placed.id, "cancel", "bob-token");
    expect((await buy(1, "buy-3")).status).toBe(200);
  });

  it("takes only whole orders of 1 to 64", async () => {
    expect(await buy(1, "buy-1", { quantity: 0 })).toMatchObject({ status: 400, body: { code: "invalid_count" } });
    expect(await buy(1, "buy-2", { quantity: 65 })).toMatchObject({ status: 400, body: { code: "invalid_count" } });
  });

  it("says there is no such listing", async () => {
    expect(await buy(9, "buy-1")).toMatchObject({ status: 404, body: { code: "listing_not_found" } });
  });
});

describe("delivering and confirming", () => {
  beforeEach(async () => {
    await list();
  });

  it("pays the seller once the buyer confirms, keyed by the order, without XP, and tells both sides", async () => {
    const placed = await order(1);
    clock.now = T0 + HOUR;

    const delivered = decode.acted((await act(placed.id, "deliver", "alice-token")).body);
    const confirmed = decode.acted((await act(placed.id, "confirm", "bob-token")).body);

    expect(delivered.order).toMatchObject({
      state: "delivered",
      delivered_at: "2026-11-25T13:00:00.000Z",
      auto_confirms_at: "2026-12-02T13:00:00.000Z",
    });
    expect(confirmed.order).toMatchObject({ state: "completed", closed_at: "2026-11-25T13:00:00.000Z" });
    expect(await services.account(alice)).toMatchObject({ balance: 500, xp: 0 });
    expect(await marketEntries()).toEqual([
      expect.objectContaining({ key: "market_hold:1" }),
      { playerId: alice, kind: "earn", origin: "market_sale", delta: 500, xp: 0, key: "market_sale:1", actor: bob },
    ]);
    const told = ["market.order_placed", "market.delivered", "market.completed"];
    expect(await eventTypes("alice-token")).toEqual(told);
    expect((await eventTypes("bob-token")).filter((type) => type.startsWith("market."))).toEqual(told);
  });

  it("never pays the seller twice, however the order is confirmed again", async () => {
    const placed = await order(1);
    await act(placed.id, "deliver", "alice-token");
    await act(placed.id, "confirm", "bob-token");

    const again = await act(placed.id, "confirm", "bob-token");
    clock.now = T0 + 8 * DAY_MS;
    await services.run(autoConfirmOrders(clock.now, rules));
    const staffRelease = await resolve(placed.id, "release");

    expect(again).toMatchObject({ status: 200, body: { order: { state: "completed" } } });
    expect(staffRelease).toMatchObject({ status: 409, body: { code: "order_closed" } });
    expect((await marketEntries()).filter((entry) => entry.origin === "market_sale")).toHaveLength(1);
    expect(await balance(alice)).toBe(500);
  });

  it("answers a delivery sent again with the order as it is", async () => {
    const placed = await order(1);
    await act(placed.id, "deliver", "alice-token");

    expect(await act(placed.id, "deliver", "alice-token")).toMatchObject({
      status: 200,
      body: { order: { state: "delivered", delivered_at: "2026-11-25T12:00:00.000Z" } },
    });
    expect(await eventTypes("alice-token")).toEqual(["market.order_placed", "market.delivered"]);
  });

  it("lets the buyer confirm before the seller marks it delivered", async () => {
    const placed = await order(1);

    expect(await act(placed.id, "confirm", "bob-token")).toMatchObject({ body: { order: { state: "completed" } } });
    expect(await balance(alice)).toBe(500);
  });

  it("takes each step only from the side whose step it is", async () => {
    const placed = await order(1);

    expect(await act(placed.id, "deliver", "bob-token")).toMatchObject({ status: 403, body: { code: "not_seller" } });
    expect(await act(placed.id, "confirm", "alice-token")).toMatchObject({ status: 403, body: { code: "not_buyer" } });
  });

  it("is not there for a member who is neither side", async () => {
    const placed = await order(1);

    expect(await send("GET", `/v1/market/orders/${placed.id}`, undefined, "carol-token")).toMatchObject({
      status: 404,
      body: { code: "order_not_found" },
    });
    expect(await act(placed.id, "cancel", "carol-token")).toMatchObject({
      status: 404,
      body: { code: "order_not_found" },
    });
  });

  it("lists each side's orders newest first, a page at a time", async () => {
    await list({ title: "Arrows", request_id: "list-2" });
    await order(1, "buy-1");
    await order(2, "buy-2");

    const bobs = decode.orders((await send("GET", "/v1/market/orders?limit=1", undefined, "bob-token")).body);
    const next = decode.orders(
      (await send("GET", `/v1/market/orders?limit=1&before=${bobs.next_before}`, undefined, "bob-token")).body,
    );
    const alices = decode.orders((await send("GET", "/v1/market/orders")).body);

    expect(bobs.orders.map((each) => each.listing.title)).toEqual(["Arrows"]);
    expect(next).toMatchObject({ orders: [{ listing: { title: "Stack of healing potions" } }], next_before: null });
    expect(alices.orders.map((each) => each.id)).toEqual([2, 1]);
  });
});

describe("cancelling", () => {
  beforeEach(async () => {
    await list();
  });

  it("refunds the buyer by reversing the hold, when either side cancels before delivery", async () => {
    const first = await order(1, "buy-1");
    const cancelled = decode.acted((await act(first.id, "cancel", "alice-token")).body);
    const second = await order(1, "buy-2");
    await act(second.id, "cancel", "bob-token");

    expect(cancelled.order).toMatchObject({ state: "cancelled", cancelled_by: "seller" });
    expect(await balance(bob)).toBe(10_000);
    const reversals = await services.query(
      (sql) => sql`SELECT idempotency_key AS key, balance_delta AS delta FROM ledger_entries WHERE kind = 'reversal'`,
    );
    expect(reversals).toEqual([
      { key: "undo:market_hold:1", delta: 500 },
      { key: "undo:market_hold:2", delta: 500 },
    ]);
    expect(await eventTypes("alice-token")).toEqual([
      "market.order_placed",
      "market.cancelled",
      "market.order_placed",
      "market.cancelled",
    ]);
  });

  it("refunds once however often it is cancelled", async () => {
    const placed = await order(1);
    await act(placed.id, "cancel", "bob-token");

    expect(await act(placed.id, "cancel", "alice-token")).toMatchObject({
      status: 200,
      body: { order: { state: "cancelled", cancelled_by: "buyer" } },
    });
    expect(await balance(bob)).toBe(10_000);
  });

  it("can't be done once it was delivered", async () => {
    const placed = await order(1);
    await act(placed.id, "deliver", "alice-token");

    expect(await act(placed.id, "cancel", "bob-token")).toMatchObject({
      status: 409,
      body: { code: "already_delivered" },
    });
  });

  it("settles a cancellation and a delivery sent together one way only: delivered, or refunded", async () => {
    await list({ quantity: 20, request_id: "list-2" });
    const placed = await Promise.all(Array.from({ length: 10 }, (_, index) => order(2, `race-${index}`)));

    // Half the races send the delivery first and half the cancellation.
    const raced = await Promise.all(
      placed.map(async (each, index) => {
        const deliver = () => act(each.id, "deliver", "alice-token");
        const cancel = () => act(each.id, "cancel", "bob-token");
        if (index % 2 === 0) {
          const [delivered, cancelled] = await Promise.all([deliver(), cancel()]);
          return { delivered, cancelled };
        }
        const [cancelled, delivered] = await Promise.all([cancel(), deliver()]);
        return { delivered, cancelled };
      }),
    );

    for (const { delivered, cancelled } of raced) {
      expect([delivered.status, cancelled.status].toSorted((a, b) => a - b)).toEqual([200, 409]);
      const won = delivered.status === 200 ? "delivered" : "cancelled";
      const lost = won === "delivered" ? cancelled : delivered;
      expect(lost.body).toMatchObject({ code: won === "delivered" ? "already_delivered" : "order_closed" });
    }
    const states = await services.query(
      (sql) => sql`
        SELECT ord.state, EXISTS (
          SELECT 1 FROM ledger_entries WHERE idempotency_key = 'undo:market_hold:' || ord.id
        ) AS refunded
        FROM market_orders AS ord ORDER BY ord.id
      `,
    );
    expect(states).toEqual(
      raced.map(({ delivered }) =>
        delivered.status === 200 ? { state: "delivered", refunded: 0 } : { state: "cancelled", refunded: 1 },
      ),
    );
    const refunds = raced.filter(({ cancelled }) => cancelled.status === 200).length;
    expect(await balance(bob)).toBe(10_000 - (10 - refunds) * 500);
  });
});

describe("confirming on its own", () => {
  beforeEach(async () => {
    await list();
  });

  it("pays the seller 7 days after delivery when the buyer neither confirms nor disputes", async () => {
    const placed = await order(1);
    await act(placed.id, "deliver", "alice-token");

    clock.now = T0 + 7 * DAY_MS - 1;
    const early = await services.run(autoConfirmOrders(clock.now, rules));
    clock.now = T0 + 7 * DAY_MS;
    const due = await services.run(autoConfirmOrders(clock.now, rules));

    expect([early, due]).toEqual([0, 1]);
    expect(await send("GET", `/v1/market/orders/${placed.id}`, undefined, "bob-token")).toMatchObject({
      body: { order: { state: "completed", auto_confirms_at: null } },
    });
    expect(await marketEntries()).toContainEqual(
      expect.objectContaining({ key: "market_sale:1", delta: 500, actor: null }),
    );
    expect(
      await services.query(
        (sql) => sql`SELECT step, role, actor FROM market_order_steps WHERE step = 'auto_confirmed'`,
      ),
    ).toEqual([{ step: "auto_confirmed", role: "system", actor: null }]);
    expect(await eventTypes("alice-token")).toContain("market.completed");
  });

  it("leaves a disputed order, and one not delivered, alone", async () => {
    const disputed = await order(1, "buy-1");
    await act(disputed.id, "deliver", "alice-token");
    await act(disputed.id, "dispute", "bob-token", { reason: "Got 32, not 64" });
    await list({ title: "Arrows", request_id: "list-2" });
    const waiting = await order(2, "buy-2");

    clock.now = T0 + 30 * DAY_MS;
    await services.run(autoConfirmOrders(clock.now, rules));

    const states = await services.query((sql) => sql`SELECT id, state FROM market_orders ORDER BY id`);
    expect(states).toEqual([
      { id: disputed.id, state: "disputed" },
      { id: waiting.id, state: "placed" },
    ]);
  });
});

describe("disputes", () => {
  let disputed: { readonly id: number };

  beforeEach(async () => {
    await list();
    disputed = await order(1);
    await act(disputed.id, "deliver", "alice-token");
    clock.now = T0 + HOUR;
    await act(disputed.id, "dispute", "bob-token", { reason: "Got 32, not 64" });
  });

  it("go to staff with the buyer's reason, and tell both sides", async () => {
    const queue = decode.disputes((await send("GET", "/v1/staff/market/disputes", undefined, "staff-token")).body);

    expect(queue.orders).toEqual([
      expect.objectContaining({
        id: disputed.id,
        state: "disputed",
        disputed_at: "2026-11-25T13:00:00.000Z",
        dispute_reason: "Got 32, not 64",
        auto_confirms_at: null,
      }),
    ]);
    expect(await eventTypes("alice-token")).toContain("market.disputed");
  });

  it("need a reason that isn't blank", async () => {
    await list({ title: "Arrows", request_id: "list-2" });
    const placed = await order(2, "buy-2");
    await act(placed.id, "deliver", "alice-token");

    expect(await act(placed.id, "dispute", "bob-token", { reason: "   " })).toMatchObject({
      status: 400,
      body: { code: "invalid_request" },
    });
    expect(await act(placed.id, "dispute", "bob-token", { reason: "  Short  " })).toMatchObject({
      body: { order: { dispute_reason: "Short" } },
    });
  });

  it("can't be raised before delivery", async () => {
    await list({ title: "Arrows", request_id: "list-2" });
    const placed = await order(2, "buy-2");

    expect(await act(placed.id, "dispute", "bob-token", { reason: "Nothing yet" })).toMatchObject({
      status: 409,
      body: { code: "not_delivered" },
    });
  });

  it("are released to the seller by staff, who are recorded", async () => {
    const answer = await resolve(disputed.id, "release");

    expect(decode.order(answer.body).order).toMatchObject({
      state: "completed",
      resolution: { outcome: "release", note: "Checked the trade log" },
    });
    expect(await balance(alice)).toBe(500);
    expect(await marketEntries()).toContainEqual(expect.objectContaining({ key: "market_sale:1", actor: staff }));
    expect(
      await services.query((sql) => sql`SELECT role, actor, note FROM market_order_steps WHERE step = 'released'`),
    ).toEqual([{ role: "staff", actor: staff, note: "Checked the trade log" }]);
    expect(await eventTypes("bob-token")).toContain("market.resolved");
  });

  it("are refunded to the buyer by staff, reversing the hold", async () => {
    const answer = await resolve(disputed.id, "refund");

    expect(decode.order(answer.body).order).toMatchObject({ state: "refunded", resolution: { outcome: "refund" } });
    expect(await balance(bob)).toBe(10_000);
    expect(await balance(alice)).toBe(0);
    expect(
      await services.query((sql) => sql`SELECT actor FROM ledger_entries WHERE idempotency_key = 'undo:market_hold:1'`),
    ).toEqual([{ actor: staff }]);
  });

  it("are settled once: the same outcome again is a repeat, the other is refused", async () => {
    await resolve(disputed.id, "refund");

    expect((await resolve(disputed.id, "refund")).status).toBe(200);
    expect(await resolve(disputed.id, "release")).toMatchObject({ status: 409, body: { code: "order_closed" } });
    expect(await balance(bob)).toBe(10_000);
    expect(await balance(alice)).toBe(0);
  });

  it("can be withdrawn by the buyer confirming after all", async () => {
    expect(await act(disputed.id, "confirm", "bob-token")).toMatchObject({ body: { order: { state: "completed" } } });
    expect(await balance(alice)).toBe(500);
  });

  it("can't be settled by staff who are a side of the order", async () => {
    await list({ title: "Arrows", request_id: "list-2" });
    const own = decode.acted((await buy(2, "staff-buy", {}, "staff-token")).body).order;
    await act(own.id, "deliver", "alice-token");
    await act(own.id, "dispute", "staff-token", { reason: "Short" });

    expect(await resolve(own.id, "refund")).toMatchObject({ status: 403, body: { code: "own_order" } });
    expect(await balance(staff)).toBe(9_500);
  });
});

describe("staff routes", () => {
  it("refuse members who aren't staff, and anyone without a session", async () => {
    const routes = [
      ["GET", "/v1/staff/market/disputes", undefined],
      ["POST", "/v1/staff/market/orders/1/resolve", { outcome: "refund" }],
      ["GET", "/v1/staff/conversions", undefined],
      ["POST", "/v1/staff/conversions/1/pay", {}],
      ["POST", "/v1/staff/conversions/1/decline", { reason: "No" }],
    ] as const;

    const asMember = await Promise.all(routes.map(([method, path, body]) => send(method, path, body, "bob-token")));
    const strangers = await Promise.all(routes.map(([method, path, body]) => send(method, path, body, null)));

    expect(asMember).toEqual(
      routes.map(() => ({ status: 403, body: { code: "not_staff", message: "Only staff can do that" } })),
    );
    expect(strangers.map((answer) => answer.status)).toEqual(routes.map(() => 401));
  });
});
