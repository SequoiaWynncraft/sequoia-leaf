import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { leaf, type PlayerId, playerId } from "@sequoia-leaf/core";
import { Schema } from "effect";

import * as Body from "../src/api/schemas.ts";
import { testLeaf } from "./support.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
const bob = playerId("10000000-0000-0000-0000-000000000002");
const carol = playerId("10000000-0000-0000-0000-000000000003");
const dave = playerId("10000000-0000-0000-0000-000000000004");
const erin = playerId("10000000-0000-0000-0000-000000000005");
const staff = playerId("10000000-0000-0000-0000-00000000000f");
/** Wednesday 25 November 2026, 12:00 UTC. */
const T0 = Date.UTC(2026, 10, 25, 12);
const DECEMBER = Date.UTC(2026, 11, 1);
const JANUARY = Date.UTC(2027, 0, 1);

const members: Readonly<Record<string, { id: PlayerId; name: string; admin: boolean }>> = {
  "alice-token": { id: alice, name: "Alice", admin: false },
  "bob-token": { id: bob, name: "Bob", admin: false },
  "carol-token": { id: carol, name: "Carol", admin: false },
  "dave-token": { id: dave, name: "Dave", admin: false },
  "erin-token": { id: erin, name: "Erin", admin: false },
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

async function send(
  method: string,
  path: string,
  body?: unknown,
  token: string | null = "alice-token",
): Promise<{ status: number; body: unknown }> {
  const answered = await app.request(path, {
    method,
    headers: { ...(token === null ? {} : { Authorization: `Bearer ${token}` }), "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: answered.status, body: await answered.json() };
}

const decode = {
  answer: Schema.decodeUnknownSync(Body.ConversionAnswer),
  mine: Schema.decodeUnknownSync(Body.MyConversions),
  staff: Schema.decodeUnknownSync(Body.StaffConversionAnswer),
  queue: Schema.decodeUnknownSync(Body.ConversionQueue),
  rates: Schema.decodeUnknownSync(Body.ConversionRates),
  events: Schema.decodeUnknownSync(Body.Events),
};

function claim(body: Record<string, unknown>, token = "alice-token") {
  return send("POST", "/v1/conversions", { kind: "le", count: 32, request_id: "claim-1", ...body }, token);
}

/** Makes a claim that Leaf takes, and answers it. */
async function claimed(body: Record<string, unknown>, token = "alice-token") {
  const answer = await claim(body, token);
  expect(answer.status).toBe(200);
  return decode.answer(answer.body).conversion;
}

const pay = (id: number, token = "staff-token") => send("POST", `/v1/staff/conversions/${id}/pay`, {}, token);
const decline = (id: number, token = "staff-token") =>
  send("POST", `/v1/staff/conversions/${id}/decline`, { reason: "Not this month" }, token);

function give(player: PlayerId, amount: number) {
  return services.post(
    { kind: "earn", playerId: player, amount: leaf(amount), source: "staff", idempotencyKey: `grant:${player}` },
    T0,
  );
}

const balance = async (player: PlayerId) => (await services.account(player)).balance;

async function eventTypes(token: string): Promise<string[]> {
  const { body } = await send("GET", "/v1/me/events", undefined, token);
  return decode.events(body).events.map((event) => event.type);
}

/** Runs each step after the one before has finished. */
function inTurn<A>(items: readonly A[], step: (item: A) => Promise<unknown>): Promise<unknown> {
  return items.reduce<Promise<unknown>>((done, item) => done.then(() => step(item)), Promise.resolve());
}

beforeEach(async () => {
  clock.now = T0;
  services = testLeaf(clock, backend);
  app = services.app();
  await inTurn([alice, bob, carol, dave, erin, staff], (member) => give(member, 50_000));
});

afterEach(async () => {
  await app.dispose();
  await services.dispose();
});

describe("GET /v1/conversions/rates", () => {
  it("publishes the provisional rates, limits and caps, and when a claim made now is paid, to anyone", async () => {
    const answer = await send("GET", "/v1/conversions/rates", undefined, null);

    expect(decode.rates(answer.body)).toEqual({
      provisional: true,
      kinds: [
        {
          kind: "le",
          name: "Liquid Emerald",
          leaf_per_unit: 200,
          min_count: 32,
          max_count: 64,
          monthly_cap: 100,
          member_monthly_limit: 64,
          next_due_from: "2026-11-01T00:00:00.000Z",
        },
        expect.objectContaining({ kind: "tome", leaf_per_unit: 4000, min_count: 1, max_count: 1, monthly_cap: 4 }),
        expect.objectContaining({ kind: "aspect", leaf_per_unit: 4000, member_monthly_limit: 1 }),
      ],
    });
  });

  it("says a claim made now waits for next month once this month's cap is claimed", async () => {
    await claimed({ count: 64 });
    await claimed({ count: 64 }, "bob-token");

    const answer = decode.rates((await send("GET", "/v1/conversions/rates", undefined, null)).body);

    expect(answer.kinds[0]?.next_due_from).toBe("2026-12-01T00:00:00.000Z");
  });
});

describe("POST /v1/conversions", () => {
  it("spends the Leaf through the ledger, keyed by the claim, and puts the claim in the queue", async () => {
    const answer = await claim({ count: 40, note: " To my alt " });

    expect(decode.answer(answer.body)).toEqual({
      conversion: {
        id: 1,
        kind: "le",
        count: 40,
        leaf: 8_000,
        note: "To my alt",
        status: "pending",
        requested_at: "2026-11-25T12:00:00.000Z",
        due_from: "2026-11-01T00:00:00.000Z",
        due: true,
        position: 1,
        closed_at: null,
        decline_reason: null,
      },
      leaf: 42_000,
    });
    expect(
      await services.query(
        (sql) =>
          sql`SELECT kind, origin, balance_delta AS delta, idempotency_key AS key FROM ledger_entries WHERE origin = 'conversion'`,
      ),
    ).toEqual([{ kind: "spend", origin: "conversion", delta: -8_000, key: "conversion:1" }]);
    expect(await eventTypes("alice-token")).toEqual(["conversion.requested"]);
  });

  it("makes one claim when the same request is sent again", async () => {
    const first = await claim({});

    expect(await claim({})).toEqual(first);
    expect(await balance(alice)).toBe(50_000 - 6_400);
  });

  it("refuses a request id already used for a different claim", async () => {
    await claim({});

    expect(await claim({ count: 33 })).toMatchObject({ status: 409, body: { code: "request_conflict" } });
  });

  it("refuses a claim the balance doesn't cover, and writes nothing", async () => {
    await services.post(
      { kind: "spend", playerId: dave, amount: leaf(45_000), sink: "shop", idempotencyKey: "spent" },
      T0,
    );

    expect(await claim({}, "dave-token")).toMatchObject({ status: 409, body: { code: "insufficient_leaf" } });
    expect(await services.query((sql) => sql`SELECT id FROM conversions`)).toEqual([]);
    expect(await balance(dave)).toBe(5_000);
  });

  it("takes 32 to 64 LE at once, and one tome or aspect", async () => {
    const answers = [
      await claim({ count: 31, request_id: "a" }),
      await claim({ count: 65, request_id: "b" }),
      await claim({ kind: "tome", count: 2, request_id: "c" }),
    ];

    expect(answers).toEqual([
      { status: 400, body: { code: "invalid_count", message: "A claim of Liquid Emerald is for 32 to 64" } },
      { status: 400, body: { code: "invalid_count", message: "A claim of Liquid Emerald is for 32 to 64" } },
      { status: 400, body: { code: "invalid_count", message: "A claim of Tome is for 1" } },
    ]);
    // A count left out is 1.
    expect((await claim({ kind: "aspect", count: undefined, note: "Warrior aspect", request_id: "d" })).status).toBe(
      200,
    );
  });

  it("refuses more in a month than one member may claim, and takes it again next month", async () => {
    await claimed({ count: 64, request_id: "a" });

    expect(await claim({ count: 32, request_id: "b" })).toMatchObject({
      status: 409,
      body: { code: "member_limit" },
    });
    clock.now = DECEMBER;
    expect((await claim({ count: 32, request_id: "b" })).status).toBe(200);
  });

  it("needs a session", async () => {
    expect((await claim({}, "nobody")).status).toBe(401);
  });
});

describe("the monthly cap", () => {
  it("queues claims past this month's cap for the next, in the order they were made, and drops none", async () => {
    const first = await claimed({ count: 64 }, "alice-token");
    const second = await claimed({ count: 64 }, "bob-token");
    const third = await claimed({ count: 32 }, "carol-token");
    const fourth = await claimed({ count: 32 }, "dave-token");

    // November has room for the first; the second waits for December, and so do the ones behind it.
    expect([first, second, third, fourth].map((each) => [each.due_from, each.position, each.due])).toEqual([
      ["2026-11-01T00:00:00.000Z", 1, true],
      ["2026-12-01T00:00:00.000Z", 2, false],
      ["2026-12-01T00:00:00.000Z", 3, false],
      ["2027-01-01T00:00:00.000Z", 4, false],
    ]);
    expect(await pay(first.id)).toMatchObject({ status: 200, body: { conversion: { status: "paid" } } });
    expect(await pay(second.id)).toMatchObject({ status: 409, body: { code: "not_due" } });

    clock.now = DECEMBER;
    expect((await pay(second.id)).status).toBe(200);
    expect((await pay(third.id)).status).toBe(200);
    expect(await pay(fourth.id)).toMatchObject({ status: 409, body: { code: "not_due" } });

    clock.now = JANUARY;
    expect(await pay(fourth.id)).toMatchObject({
      status: 200,
      body: { conversion: { status: "paid", due_from: "2027-01-01T00:00:00.000Z" } },
    });
    const paid = await services.query(
      (sql) => sql`SELECT id, paid_month AS month FROM conversions WHERE status = 'paid' ORDER BY id`,
    );
    expect(paid).toEqual([
      { id: 1, month: 682 },
      { id: 2, month: 683 },
      { id: 3, month: 683 },
      { id: 4, month: 684 },
    ]);
  });

  it("moves the claims behind one that leaves the queue up into its place", async () => {
    await claimed({ count: 64 }, "alice-token");
    const second = await claimed({ count: 64 }, "bob-token");
    const third = await claimed({ count: 64 }, "carol-token");

    await send("POST", `/v1/conversions/${second.id}/cancel`, undefined, "bob-token");

    const queue = decode.queue((await send("GET", "/v1/staff/conversions", undefined, "staff-token")).body).queue;
    expect(queue.map((each) => [each.id, each.player.name, each.position, each.due_from])).toEqual([
      [1, "Alice", 1, "2026-11-01T00:00:00.000Z"],
      [third.id, "Carol", 2, "2026-12-01T00:00:00.000Z"],
    ]);
  });

  it("counts tomes against a cap of their own, by number", async () => {
    const tokens = ["alice-token", "bob-token", "carol-token", "dave-token", "erin-token"];
    const tomes: { readonly due_from: string | null }[] = [];
    await inTurn(tokens, async (token) =>
      tomes.push(await claimed({ kind: "tome", count: 1, note: "Mythic tome" }, token)),
    );
    const le = await claimed({ count: 64, request_id: "le" });

    expect(tomes.map((tome) => tome.due_from)).toEqual([
      ...Array.from({ length: 4 }, () => "2026-11-01T00:00:00.000Z"),
      "2026-12-01T00:00:00.000Z",
    ]);
    expect(le).toMatchObject({ due_from: "2026-11-01T00:00:00.000Z", position: 1 });
  });
});

describe("paying and declining", () => {
  it("marks a claim paid by the staff member who paid it, tells the member, and pays it once", async () => {
    const waiting = await claimed({});

    const answer = await pay(waiting.id);
    const again = await pay(waiting.id);

    expect(decode.staff(answer.body).conversion).toMatchObject({
      status: "paid",
      player: { player_id: alice, name: "Alice" },
      closed_at: "2026-11-25T12:00:00.000Z",
      position: null,
    });
    expect(again.status).toBe(200);
    expect(await services.query((sql) => sql`SELECT closed_by AS by FROM conversions`)).toEqual([{ by: staff }]);
    expect(await eventTypes("alice-token")).toEqual(["conversion.requested", "conversion.paid"]);
    expect(await balance(alice)).toBe(50_000 - 6_400);
  });

  it("declines a claim with a reason the member sees, refunding it by reversing the spend, once", async () => {
    const waiting = await claimed({});

    const answer = await decline(waiting.id);
    await decline(waiting.id);

    expect(decode.staff(answer.body).conversion).toMatchObject({
      status: "declined",
      decline_reason: "Not this month",
    });
    expect(await balance(alice)).toBe(50_000);
    expect(
      await services.query(
        (sql) => sql`SELECT idempotency_key AS key, actor FROM ledger_entries WHERE kind = 'reversal'`,
      ),
    ).toEqual([{ key: "undo:conversion:1", actor: staff }]);
    expect(await eventTypes("alice-token")).toEqual(["conversion.requested", "conversion.declined"]);
  });

  it("refuses to pay a declined claim, or decline a paid one", async () => {
    const declined = await claimed({ request_id: "a" });
    const paid = await claimed({ request_id: "b" });
    await decline(declined.id);
    await pay(paid.id);

    expect(await pay(declined.id)).toMatchObject({ status: 409, body: { code: "not_pending" } });
    expect(await decline(paid.id)).toMatchObject({ status: 409, body: { code: "not_pending" } });
  });

  it("refuses staff paying their own claim", async () => {
    const own = await claimed({}, "staff-token");

    expect(await pay(own.id)).toMatchObject({ status: 403, body: { code: "own_claim" } });
  });

  it("says there is no such claim", async () => {
    expect(await pay(9)).toMatchObject({ status: 404, body: { code: "conversion_not_found" } });
  });
});

describe("a member's own claims", () => {
  it("are listed newest first, with where each waiting one stands", async () => {
    await claimed({ count: 64 }, "bob-token");
    await claimed({ kind: "aspect", count: 1, request_id: "a" });
    await claimed({ count: 64, request_id: "b" });

    const mine = decode.mine((await send("GET", "/v1/conversions")).body).conversions;

    expect(mine.map((each) => [each.kind, each.position, each.due_from])).toEqual([
      ["le", 2, "2026-12-01T00:00:00.000Z"],
      ["aspect", 1, "2026-11-01T00:00:00.000Z"],
    ]);
  });

  it("can be cancelled while waiting, which refunds them, once", async () => {
    const waiting = await claimed({});

    const answer = await send("POST", `/v1/conversions/${waiting.id}/cancel`);
    const again = await send("POST", `/v1/conversions/${waiting.id}/cancel`);

    expect(decode.answer(answer.body)).toMatchObject({ conversion: { status: "cancelled" }, leaf: 50_000 });
    expect(again).toEqual(answer);
    expect(await balance(alice)).toBe(50_000);
  });

  it("can't be cancelled once paid, nor by anyone else", async () => {
    const waiting = await claimed({});

    expect(await send("POST", `/v1/conversions/${waiting.id}/cancel`, undefined, "bob-token")).toMatchObject({
      status: 404,
      body: { code: "conversion_not_found" },
    });
    await pay(waiting.id);
    expect(await send("POST", `/v1/conversions/${waiting.id}/cancel`)).toMatchObject({
      status: 409,
      body: { code: "not_pending" },
    });
  });
});
