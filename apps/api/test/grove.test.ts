import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import {
  type Activity,
  type ConePull,
  DEFAULT_RULES,
  leaf,
  openCone,
  type PlayerId,
  playerId,
  ROLL_RANGE,
  treeVariant,
} from "@sequoia-leaf/core";
import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql";

import * as Body from "../src/api/schemas.ts";
import { syncCredits } from "../src/earning/sync.ts";
import { Grove } from "../src/grove/store.ts";
import { feed, HOUR, MINUTE, raid, rolling, testLeaf } from "./support.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
const bob = playerId("10000000-0000-0000-0000-000000000002");
const carol = playerId("10000000-0000-0000-0000-000000000003");
const dave = playerId("10000000-0000-0000-0000-000000000004");
/** Wednesday 25 November 2026, 12:00 UTC, with the first banner on. */
const T0 = Date.UTC(2026, 10, 25, 12);

const rules = DEFAULT_RULES.grove;

/** The members the stand-in backend knows, by token. */
const members: Readonly<Record<string, { id: PlayerId; name: string }>> = {
  "alice-token": { id: alice, name: "Alice" },
  "bob-token": { id: bob, name: "Bob" },
  "carol-token": { id: carol, name: "Carol" },
  "dave-token": { id: dave, name: "Dave" },
  // Bob, signed in after changing his Minecraft name.
  "bobby-token": { id: bob, name: "Bobby" },
};

const clock = { now: T0 };
let services: ReturnType<typeof testLeaf>;
let app: ReturnType<(typeof services)["app"]>;

function backend(url: string, init: RequestInit): Promise<Response> {
  const request = new Request(url, init);
  if (new URL(request.url).pathname === "/auth/web/me") {
    const token = request.headers.get("Authorization")?.slice("Bearer ".length) ?? "";
    const known = members[token];
    return Promise.resolve(
      known === undefined
        ? Response.json({ error: "unauthorized" }, { status: 401 })
        : Response.json({ minecraft_uuid: known.id, minecraft_username: known.name, guild_rank: "MEMBER" }),
    );
  }
  return Promise.resolve(new Response("not found", { status: 404 }));
}

/** Opens the app with the server's rolls loaded, when a test needs to know what its cones hold. */
function openApp(rolls?: readonly number[]) {
  app = services.app(rolls === undefined ? Layer.empty : rolling(rolls));
}

function send(method: string, path: string, body?: unknown, token = "alice-token") {
  return app.request(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function json(response: Response | Promise<Response>): Promise<{ status: number; body: unknown }> {
  const answered = await response;
  return { status: answered.status, body: await answered.json() };
}

const grove = (token = "alice-token") => json(send("GET", "/v1/grove", undefined, token));
const care = (tool: string, requestId: string) => json(send("POST", "/v1/grove/care", { tool, request_id: requestId }));
const buy = (count: number, requestId: string) =>
  json(send("POST", "/v1/grove/cones/buy", { count, request_id: requestId }));
const open = (count: number, requestId: string) =>
  json(send("POST", "/v1/grove/cones/open", { count, request_id: requestId }));

function give(player: PlayerId, amount: number, key: string) {
  return services.post(
    { kind: "earn", playerId: player, amount: leaf(amount), source: "staff", idempotencyKey: key },
    T0,
  );
}

/** The first roll from 0 up whose cone, as a member's first, matches. */
function rollWhere(matches: (pull: ConePull) => boolean): number {
  const banner = rules.banners[0];
  if (banner === undefined) {
    throw new Error("The rules have no banner");
  }
  for (let roll = 0; roll < ROLL_RANGE; roll += 1) {
    if (matches(openCone(0, roll, () => 0, banner, rules))) {
      return roll;
    }
  }
  throw new Error("No roll opens such a cone");
}

/** Runs each step after the one before has finished, as a member's requests come one after another. */
function inTurn<A>(items: readonly A[], step: (item: A) => Promise<unknown>): Promise<unknown> {
  return items.reduce<Promise<unknown>>((done, item) => done.then(() => step(item)), Promise.resolve());
}

/** A response's body, read as the API declares it. */
const decode = {
  grove: Schema.decodeUnknownSync(Body.GroveMe),
  forest: Schema.decodeUnknownSync(Body.Forest),
  opened: Schema.decodeUnknownSync(Body.ConesOpened),
  rates: Schema.decodeUnknownSync(Body.Rates),
  events: Schema.decodeUnknownSync(Body.Events),
};

const commonRoll = rollWhere((pull) => pull.rank === "leafkin" && !pull.verdant);
const treantRoll = rollWhere((pull) => pull.rank === "treant");

async function eventTypes(token = "alice-token"): Promise<string[]> {
  const { body } = await json(send("GET", "/v1/me/events", undefined, token));
  return decode.events(body).events.map((event) => event.type);
}

function openings() {
  return services.query(
    (sql) => sql`
      SELECT player_id AS playerId, request_id AS requestId, position, banner, roll, pity_before AS pityBefore,
             pity_after AS pityAfter, rank, spirit
      FROM grove_openings ORDER BY id
    `,
  );
}

beforeEach(() => {
  clock.now = T0;
  services = testLeaf(clock, backend);
  openApp();
});

afterEach(async () => {
  await app.dispose();
  await services.dispose();
});

describe("GET /v1/grove", () => {
  it("shows a new member a seedling with a full bank of care, no cones and no spirits", async () => {
    const { status, body } = await grove();

    expect(status).toBe(200);
    expect(body).toEqual({
      player: { id: alice, username: "Alice" },
      leaf: 0,
      tree: { level: 1, variant: treeVariant(alice, rules), spot: 0 },
      bloom: { value: 0, max: 10 },
      charges: { count: 6, max: 6, next_at: null },
      cones: 0,
      pity: { count: 0, cones: 40, rank: "treant" },
      banner: { id: "tcc", title: "The Canyon Colossus", featured: "rock" },
      collection: [],
      companion: null,
    });
  });

  it("grows the tree with the member's SEQ level", async () => {
    await give(alice, 2250, "xp");

    expect((await grove()).body).toMatchObject({ leaf: 2250, tree: { level: 3 } });
  });

  it("needs a session", async () => {
    expect((await grove("stale-token")).status).toBe(401);
  });
});

describe("the Forest", () => {
  it("gives each member the spot nearest the heart that is free when they first come", async () => {
    await grove("alice-token");
    await grove("bob-token");
    await grove("carol-token");

    const { status, body } = await json(app.request("/v1/grove/forest"));

    expect(status).toBe(200);
    expect(body).toEqual({
      trees: [
        { player_id: alice, name: "Alice", level: 1, variant: treeVariant(alice, rules), spot: 0, companion: null },
        { player_id: bob, name: "Bob", level: 1, variant: treeVariant(bob, rules), spot: 1, companion: null },
        { player_id: carol, name: "Carol", level: 1, variant: treeVariant(carol, rules), spot: 2, companion: null },
      ],
    });
  });

  it("never moves a member's spot when others join or they come back under a new name", async () => {
    await grove("bob-token");
    await grove("alice-token");
    await grove("dave-token");
    await grove("bobby-token");
    await grove("carol-token");

    const { body } = await json(app.request("/v1/grove/forest"));

    expect(decode.forest(body).trees.map(({ name, spot }) => [name, spot])).toEqual([
      ["Bobby", 0],
      ["Alice", 1],
      ["Dave", 2],
      ["Carol", 3],
    ]);
  });

  it("is open to anyone, signed in or not", async () => {
    expect((await app.request("/v1/grove/forest")).status).toBe(200);
  });
});

describe("POST /v1/grove/care", () => {
  it("spends a charge and adds Bloom", async () => {
    const { status, body } = await care("water", "care-1");

    expect(status).toBe(200);
    expect(body).toEqual({
      charges: { count: 5, max: 6, next_at: new Date(T0 + 4 * HOUR).toISOString() },
      bloom: { value: 1, max: 10 },
      cones: 0,
      bloomed: 0,
    });
  });

  it("does nothing more when the same request is sent again", async () => {
    const first = await care("mist", "care-1");

    const again = await care("mist", "care-1");

    expect(again).toEqual(first);
    expect((await grove()).body).toMatchObject({ charges: { count: 5 }, bloom: { value: 1 } });
  });

  it("refuses a request id already used with another tool", async () => {
    await care("water", "care-1");

    expect(await care("shears", "care-1")).toEqual({
      status: 409,
      body: { code: "request_conflict", message: expect.any(String) },
    });
  });

  it("refuses care once the charges are spent, and takes it again when one comes back", async () => {
    const statuses: number[] = [];
    await inTurn([1, 2, 3, 4, 5, 6], async (index) => statuses.push((await care("water", `care-${index}`)).status));

    expect(statuses).toEqual([200, 200, 200, 200, 200, 200]);
    expect(await care("water", "care-7")).toMatchObject({ status: 409, body: { code: "no_charges" } });
    clock.now = T0 + 4 * HOUR;
    expect(await care("water", "care-7")).toMatchObject({ status: 200, body: { charges: { count: 0 } } });
  });

  it("never wilts: after days away the bank is full, and no fuller", async () => {
    await care("water", "care-1");
    clock.now = T0 + 9 * 24 * HOUR;

    expect((await grove()).body).toMatchObject({ charges: { count: 6, next_at: null }, bloom: { value: 1 } });
  });

  it("gives a cone when its Bloom fills", async () => {
    await inTurn([1, 2, 3, 4, 5, 6], (index) => care("water", `care-${index}`));
    clock.now = T0 + 16 * HOUR;
    await inTurn([7, 8, 9], (index) => care("mist", `care-${index}`));

    expect(await care("shears", "care-10")).toMatchObject({
      status: 200,
      body: { bloom: { value: 0 }, cones: 1, bloomed: 1 },
    });
    expect(await eventTypes()).toEqual(["grove.bloomed"]);
  });

  it("answers a tool it does not know with invalid_request", async () => {
    expect(await care("hose", "care-1")).toMatchObject({ status: 400, body: { code: "invalid_request" } });
  });
});

/** Syncs the credit feed once to start it, then once more to read what the source reports. */
async function syncRaids(activities: readonly Activity[]) {
  await services.run(syncCredits(feed(activities), DEFAULT_RULES, T0, "recent"));
  await services.run(syncCredits(feed(activities), DEFAULT_RULES, T0 + HOUR, "recent"));
}

/** A member's raids, a minute apart from just after T0. */
function raids(count: number): Activity[] {
  return Array.from({ length: count }, (_, index) => raid(index + 1, alice, T0 + (index + 1) * MINUTE));
}

describe("Bloom from raids", () => {
  it("adds a Bloom for each raid credited, and a cone for each Bloom filled", async () => {
    await syncRaids(raids(23));

    expect((await grove()).body).toMatchObject({ bloom: { value: 3 }, cones: 2 });
  });

  it("gives exactly one cone per Bloom when the same raids are reported again", async () => {
    const reported = raids(10);
    await syncRaids(reported);

    await services.run(syncCredits(feed(reported), DEFAULT_RULES, T0 + 2 * HOUR, "deep"));
    await services.run(syncCredits(feed(reported), DEFAULT_RULES, T0 + 3 * HOUR, "deep"));

    expect((await grove()).body).toMatchObject({ bloom: { value: 0 }, cones: 1 });
    expect((await eventTypes()).filter((type) => type === "grove.bloomed")).toHaveLength(1);
  });

  it("adds a raid's Bloom once however often its ledger entry is replayed", async () => {
    const replay = Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const store = yield* Grove;
      return yield* sql.withTransaction(
        Effect.forEach(raids(10), (each) => store.addBloom(alice, each.sourceKey, "raid", 1, T0, rules)),
      );
    });

    expect((await services.run(replay)).flat()).toEqual([1]);
    expect((await services.run(replay)).flat()).toEqual([]);
    expect((await grove()).body).toMatchObject({ bloom: { value: 0 }, cones: 1 });
  });

  it("adds nothing for a raid that paid no Leaf", async () => {
    await syncRaids([raid(1, alice, T0 + MINUTE, 0)]);

    expect((await grove()).body).toMatchObject({ bloom: { value: 0 } });
  });

  it("hangs a raid's lantern for its whole party, telling each member once", async () => {
    const party = [alice, bob, carol, dave].map((member) => raid(77, member, T0 + MINUTE));
    await syncRaids(party.slice(0, 3));
    // The backend matched the fourth member's name later.
    await services.run(syncCredits(feed(party), DEFAULT_RULES, T0 + 2 * HOUR, "deep"));

    const lanterns = await services.query(
      (sql) => sql`SELECT player_id AS playerId, data FROM events WHERE type = 'grove.raid_lantern' ORDER BY id`,
    );

    expect(lanterns).toEqual([
      ...[alice, bob, carol].map((member) => ({
        playerId: member,
        data: JSON.stringify({
          raid: "raid:77",
          raid_name: "The Nameless Anomaly",
          party: [alice, bob, carol],
          occurred_at: new Date(T0 + MINUTE).toISOString(),
        }),
      })),
      {
        playerId: dave,
        data: JSON.stringify({
          raid: "raid:77",
          raid_name: "The Nameless Anomaly",
          party: [alice, bob, carol, dave],
          occurred_at: new Date(T0 + MINUTE).toISOString(),
        }),
      },
    ]);
  });
});

describe("war wins", () => {
  it("tell everyone the war credited that the guild won it, with who fought", async () => {
    const war = (member: PlayerId): Activity => ({
      kind: "war",
      sourceKey: `war:913:${member}`,
      eventKey: "war:913",
      playerId: member,
      occurredAt: T0 + MINUTE,
      seasonRating: 60,
      territory: "Detlas",
      warPoints: 30,
      inClaim: true,
    });
    await services.run(syncCredits(feed([]), DEFAULT_RULES, T0, "recent"));
    await services.run(syncCredits(feed([war(bob), war(alice)]), DEFAULT_RULES, T0 + HOUR, "recent"));

    const wins = await services.query(
      (sql) => sql`SELECT player_id AS playerId, data FROM events WHERE type = 'guild.war_win' ORDER BY player_id`,
    );

    expect(wins).toEqual(
      [alice, bob].map((member) => ({
        playerId: member,
        data: JSON.stringify({
          war: "war:913",
          territory: "Detlas",
          players: [alice, bob],
          occurred_at: new Date(T0 + MINUTE).toISOString(),
          in_claim: true,
        }),
      })),
    );
  });
});

describe("POST /v1/grove/cones/buy", () => {
  it("spends Leaf on cones through the ledger", async () => {
    await give(alice, 5000, "grant");

    expect(await buy(10, "buy-1")).toEqual({ status: 200, body: { leaf: 1000, spent: 4000, cones: 10 } });
    const entries = await services.query(
      (sql) => sql`SELECT kind, origin, balance_delta AS delta FROM ledger_entries WHERE origin = 'cone'`,
    );
    expect(entries).toEqual([{ kind: "spend", origin: "cone", delta: -4000 }]);
  });

  it("spends and grants nothing more when the same request is sent again", async () => {
    await give(alice, 1000, "grant");
    await buy(1, "buy-1");

    expect(await buy(1, "buy-1")).toEqual({ status: 200, body: { leaf: 600, spent: 400, cones: 1 } });
    expect(await services.account(alice)).toMatchObject({ balance: 600 });
  });

  it("refuses a request id already used for a different number of cones", async () => {
    await give(alice, 5000, "grant");
    await buy(1, "buy-1");

    expect(await buy(10, "buy-1")).toMatchObject({ status: 409, body: { code: "request_conflict" } });
    expect((await grove()).body).toMatchObject({ leaf: 4600, cones: 1 });
  });

  it("refuses a purchase the balance doesn't cover, and changes nothing", async () => {
    await give(alice, 3999, "grant");

    expect(await buy(10, "buy-1")).toEqual({
      status: 409,
      body: { code: "insufficient_leaf", message: expect.any(String) },
    });
    expect((await grove()).body).toMatchObject({ leaf: 3999, cones: 0 });
  });

  it("only sells cones one or ten at a time", async () => {
    await give(alice, 5000, "grant");

    expect(await buy(3, "buy-1")).toMatchObject({ status: 400, body: { code: "invalid_request" } });
    expect(await buy(1, "not a request id!")).toMatchObject({ status: 400, body: { code: "invalid_request" } });
  });
});

describe("POST /v1/grove/cones/open", () => {
  beforeEach(async () => {
    await give(alice, 50_000, "grant");
  });

  it("opens a cone with the server's roll and keeps it in the audit", async () => {
    await app.dispose();
    openApp([treantRoll]);
    await buy(1, "buy-1");

    const { status, body } = await open(1, "open-1");

    expect(status).toBe(200);
    expect(body).toMatchObject({
      banner: "tcc",
      opened: [{ rank: "treant", guaranteed: false, copy: 1, bond: 1 }],
      pity: { count: 0, cones: 40, rank: "treant" },
      cones: 0,
    });
    expect(await openings()).toEqual([
      expect.objectContaining({
        playerId: alice,
        requestId: "open-1",
        position: 0,
        banner: "tcc",
        roll: treantRoll,
        pityBefore: 0,
        pityAfter: 0,
        rank: "treant",
      }),
    ]);
  });

  it("answers a retried request with the same cones, and opens no more", async () => {
    await buy(10, "buy-1");
    const first = await open(10, "open-1");

    const again = await open(10, "open-1");

    expect(again).toEqual(first);
    expect(await openings()).toHaveLength(10);
    expect((await grove()).body).toMatchObject({ cones: 0 });
  });

  it("refuses a request id already used for a different number of cones", async () => {
    await buy(10, "buy-1");
    await open(1, "open-1");

    expect(await open(10, "open-1")).toMatchObject({ status: 409, body: { code: "request_conflict" } });
  });

  it("refuses to open more cones than the member holds", async () => {
    await buy(1, "buy-1");

    expect(await open(10, "open-1")).toMatchObject({ status: 409, body: { code: "not_enough_cones" } });
    expect(await openings()).toEqual([]);
  });

  it("carries pity over from one opening to the next and lifts the fortieth cone to a Treant", async () => {
    await app.dispose();
    openApp([commonRoll]);
    await inTurn([1, 2, 3, 4], (batch) => buy(10, `buy-${batch}`));
    await inTurn([1, 2, 3], (batch) => open(10, `open-${batch}`));
    expect((await grove()).body).toMatchObject({ pity: { count: 30 } });

    const { body } = await open(10, "open-4");

    const { opened } = decode.opened(body);
    expect(opened.map((cone) => cone.guaranteed)).toEqual([...Array.from({ length: 9 }, () => false), true]);
    expect(opened.at(-1)?.rank).toBe("treant");
    expect(body).toMatchObject({ pity: { count: 0 } });
    expect((await openings()).at(-1)).toMatchObject({ pityBefore: 39, pityAfter: 0 });
  });

  it("deepens the bond with each copy, and lists the collection in the order found", async () => {
    await app.dispose();
    openApp([commonRoll, treantRoll]);
    await buy(10, "buy-1");

    await open(10, "open-1");

    const { body } = await grove();
    expect(decode.grove(body).collection.map(({ copies, bond }) => [copies, bond])).toEqual([
      [5, 5],
      [5, 5],
    ]);
  });

  it("tells the Forest of a Dryad or better, and not of a commoner cone", async () => {
    await app.dispose();
    openApp([commonRoll, treantRoll]);
    await buy(1, "buy-1");
    await buy(1, "buy-2");

    await open(1, "open-common");
    await open(1, "open-treant");

    expect(await eventTypes()).toEqual(["grove.cone_opened"]);
  });
});

describe("PUT /v1/grove/companion", () => {
  beforeEach(async () => {
    await app.dispose();
    openApp([treantRoll]);
    await give(alice, 400, "grant");
    await buy(1, "buy-1");
    await open(1, "open-1");
  });

  it("chooses a spirit the member has opened", async () => {
    const found = decode.grove((await grove()).body).collection[0]?.spirit;

    expect(await json(send("PUT", "/v1/grove/companion", { spirit: found }))).toEqual({
      status: 200,
      body: { companion: found },
    });
    expect((await grove()).body).toMatchObject({ companion: found });
    const forest = await json(app.request("/v1/grove/forest"));
    expect(forest.body).toMatchObject({ trees: [{ companion: found }] });
  });

  it("refuses a spirit the member has not opened, or one no cone gives", async () => {
    const answers: unknown[] = [];
    await inTurn(["white-fox", "gnome"], async (spirit) =>
      answers.push(await json(send("PUT", "/v1/grove/companion", { spirit }))),
    );

    expect(answers).toMatchObject([
      { status: 409, body: { code: "not_owned" } },
      { status: 409, body: { code: "not_owned" } },
    ]);
  });

  it("lets the member go without one", async () => {
    expect(await json(send("PUT", "/v1/grove/companion", { spirit: null }))).toEqual({
      status: 200,
      body: { companion: null },
    });
  });
});

describe("GET /v1/grove/rates", () => {
  it("publishes the odds a cone is opened with, to anyone", async () => {
    const { status, body } = await json(app.request("/v1/grove/rates"));

    expect(status).toBe(200);
    expect(body).toMatchObject({
      banner: { id: "tcc", featured: "rock", featured_share: 0.5, starts_at: "2026-11-20T00:00:00.000Z" },
      cone_price: 400,
      batches: [1, 10],
      pity: { cones: 40, rank: "treant" },
      verdant: { chance: 0.04, copy: 4 },
      bloom: { max: 10, per_raid: 1, per_care: 1 },
      care: { charge_seconds: 14_400, charge_max: 6, tools: ["water", "mist", "shears"] },
    });
    const { ranks } = decode.rates(body);
    expect(ranks.map((rank) => rank.chance)).toEqual([0.4, 0.27, 0.16, 0.09, 0.05, 0.025, 0.005]);
    expect(ranks.flatMap((rank) => rank.spirits).reduce((sum, spirit) => sum + spirit.chance, 0)).toBeCloseTo(1, 12);
  });
});
