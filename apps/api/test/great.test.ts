import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { type Activity, DEFAULT_RULES, leaf, type PlayerId, playerId, WEEK_MS } from "@sequoia-leaf/core";
import { Schema } from "effect";

import * as Body from "../src/api/schemas.ts";
import { syncCredits } from "../src/earning/sync.ts";
import { feed, HOUR, MINUTE, raid, testLeaf } from "./support.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
const bob = playerId("10000000-0000-0000-0000-000000000002");
const carol = playerId("10000000-0000-0000-0000-000000000003");
const dave = playerId("10000000-0000-0000-0000-000000000004");
/** Wednesday 25 November 2026, 12:00 UTC: the week of Monday the 23rd. */
const T0 = Date.UTC(2026, 10, 25, 12);

const members: Readonly<Record<string, { id: PlayerId; name: string }>> = {
  "alice-token": { id: alice, name: "Alice" },
  "bob-token": { id: bob, name: "Bob" },
};

const clock = { now: T0 };
let services: ReturnType<typeof testLeaf>;
let app: ReturnType<(typeof services)["app"]>;

function backend(url: string, init: RequestInit): Promise<Response> {
  const request = new Request(url, init);
  const token = request.headers.get("Authorization")?.slice("Bearer ".length) ?? "";
  const known = members[token];
  return Promise.resolve(
    known === undefined
      ? Response.json({ error: "unauthorized" }, { status: 401 })
      : Response.json({ minecraft_uuid: known.id, minecraft_username: known.name, guild_rank: "MEMBER" }),
  );
}

const decodeGreat = Schema.decodeUnknownSync(Body.Great);

async function json(response: Promise<Response>): Promise<{ status: number; body: unknown }> {
  const answered = await response;
  return { status: answered.status, body: await answered.json() };
}

async function great(token = "alice-token") {
  const answered = await app.request("/v1/grove/great", { headers: { Authorization: `Bearer ${token}` } });
  expect(answered.status).toBe(200);
  return decodeGreat(await answered.json());
}

function offer(amount: number, requestId: string, token = "alice-token") {
  return json(
    app.request("/v1/grove/great/offer", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ leaf: amount, request_id: requestId }),
    }),
  );
}

function give(player: PlayerId, amount: number) {
  return services.post(
    { kind: "earn", playerId: player, amount: leaf(amount), source: "staff", idempotencyKey: `grant:${player}` },
    T0,
  );
}

/** Runs each step after the one before has finished. */
function inTurn<A>(items: readonly A[], step: (item: A) => Promise<unknown>): Promise<unknown> {
  return items.reduce<Promise<unknown>>((done, item) => done.then(() => step(item)), Promise.resolve());
}

function war(id: number, player: PlayerId, occurredAt: number): Activity {
  return {
    kind: "war",
    sourceKey: `war:${id}:${player}`,
    eventKey: `war:${id}`,
    playerId: player,
    occurredAt,
    seasonRating: 60,
    territory: "Detlas",
    warPoints: 30,
  };
}

/** Syncs the credit feed once to start it, at the start of the week, then reads what it reports. */
async function sync(activities: readonly Activity[]) {
  await services.run(syncCredits(feed(activities), DEFAULT_RULES, Date.UTC(2026, 10, 23), "recent"));
  await services.run(syncCredits(feed(activities), DEFAULT_RULES, T0 + HOUR, "recent"));
}

beforeEach(() => {
  clock.now = T0;
  services = testLeaf(clock, backend);
  app = services.app();
});

afterEach(async () => {
  await app.dispose();
  await services.dispose();
});

describe("GET /v1/grove/great", () => {
  it("shows a quiet week: three goals at nothing, no lanterns and no rewards", async () => {
    const answer = await great();

    expect(answer.week).toMatchObject({ starts_at: "2026-11-23T00:00:00.000Z", ends_at: "2026-11-30T00:00:00.000Z" });
    expect(answer.week.goals).toEqual([
      {
        id: "raids",
        kind: "raids",
        title: "Finish 1,000 guild raids",
        progress: 0,
        target: 1000,
        met: false,
        reward: { id: "great.aurora", title: "An aurora over the Great Sequoia" },
      },
      expect.objectContaining({ id: "offered_leaf", progress: 0, target: 50_000, met: false }),
      expect.objectContaining({ id: "wars", progress: 0, target: 3000, met: false }),
    ]);
    expect(answer).toMatchObject({
      last_week: { starts_at: "2026-11-16T00:00:00.000Z" },
      rewards: [],
      lanterns: [],
      me: { lantern: false, glow: 0, offered: 0, rings: 0 },
      offering: { min: 100, max: 10_000 },
    });
  });

  it("counts a raid party's run once and a war once, and hangs a lantern for each member in them", async () => {
    await sync([
      ...[alice, bob, carol, dave].map((member) => raid(1, member, T0 + MINUTE)),
      war(9, bob, T0 + 2 * MINUTE),
      war(9, carol, T0 + 2 * MINUTE),
    ]);

    const answer = await great();

    expect(answer.week.goals.map((goal) => [goal.id, goal.progress])).toEqual([
      ["raids", 1],
      ["offered_leaf", 0],
      ["wars", 1],
    ]);
    // In the order they first helped, then by id; a member who never opened the Grove has no name.
    expect(answer.lanterns).toEqual([
      { player_id: alice, name: "Alice", glow: 1 },
      { player_id: bob, name: null, glow: 1 },
      { player_id: carol, name: null, glow: 1 },
      { player_id: dave, name: null, glow: 1 },
    ]);
    expect(answer.me).toEqual({ lantern: true, glow: 1, offered: 0, rings: 1 });
  });

  it("lights a helper's lantern brighter in steps for more help, without ranking anyone", async () => {
    await sync(Array.from({ length: 10 }, (_, index) => raid(index + 1, alice, T0 + index * MINUTE)));

    const answer = await great();

    expect(answer.lanterns).toEqual([{ player_id: alice, name: "Alice", glow: 2 }]);
  });

  it("gives everyone a goal's reward when the guild meets it, through the next week", async () => {
    await give(alice, 30_000);
    await give(bob, 30_000);
    await inTurn([1, 2, 3], (index) => offer(10_000, `alice-${index}`));
    await inTurn([1, 2], (index) => offer(10_000, `bob-${index}`, "bob-token"));

    const met = await great("bob-token");
    clock.now = T0 + WEEK_MS;
    const nextWeek = await great("bob-token");
    clock.now = T0 + 2 * WEEK_MS;
    const later = await great("bob-token");

    const fairyLights = { id: "great.fairy-lights", title: "Fairy lights in the Great Sequoia's crown" };
    expect(met.week.goals[1]).toMatchObject({ progress: 50_000, met: true });
    expect(met.rewards).toEqual([fairyLights]);
    expect(nextWeek.last_week.goals[1]).toMatchObject({ met: true });
    expect(nextWeek.rewards).toEqual([fairyLights]);
    expect(nextWeek.me).toMatchObject({ lantern: false, rings: 1 });
    expect(later.rewards).toEqual([]);
  });

  it("counts what happened by Sunday's last moment in its week, and Monday's first in the next", async () => {
    const monday = Date.UTC(2026, 10, 30);
    await services.run(syncCredits(feed([]), DEFAULT_RULES, Date.UTC(2026, 10, 23), "recent"));
    clock.now = monday + HOUR;
    await services.run(
      syncCredits(feed([raid(1, alice, monday - 1), raid(2, alice, monday)]), DEFAULT_RULES, clock.now, "recent"),
    );

    const answer = await great();

    expect(answer.last_week.goals[0]).toMatchObject({ id: "raids", progress: 1 });
    expect(answer.week.goals[0]).toMatchObject({ id: "raids", progress: 1 });
  });

  it("counts Leaf offered net of any refunded", async () => {
    await give(alice, 1000);
    const offered = await services.post(
      { kind: "spend", playerId: alice, amount: leaf(500), sink: "offering", idempotencyKey: "offering:a" },
      T0,
    );
    if (offered.status !== "posted") {
      throw new Error("The offering was not posted");
    }

    await services.post({ kind: "reversal", playerId: alice, reverses: offered.entry, idempotencyKey: "refund:a" }, T0);

    const answer = await great();
    expect(answer.week.goals[1]).toMatchObject({ progress: 0 });
    expect(answer.me).toMatchObject({ lantern: false, offered: 0 });
  });

  it("marks a ring on the tree for each week the member helped", async () => {
    await give(alice, 1000);
    await offer(100, "first-week");
    clock.now = T0 + WEEK_MS;
    await offer(100, "second-week");
    clock.now = T0 + 3 * WEEK_MS;

    expect((await great()).me).toMatchObject({ lantern: false, rings: 2 });
  });
});

describe("POST /v1/grove/great/offer", () => {
  beforeEach(async () => {
    await give(alice, 1000);
  });

  it("spends the Leaf through the ledger toward the week's goal, and hangs the member's lantern", async () => {
    expect(await offer(300, "offer-1")).toEqual({ status: 200, body: { leaf: 700, offered: 300, glow: 1 } });

    const entries = await services.query(
      (sql) => sql`SELECT kind, balance_delta AS delta FROM ledger_entries WHERE origin = 'offering'`,
    );
    expect(entries).toEqual([{ kind: "spend", delta: -300 }]);
    const answer = await great();
    expect(answer.week.goals[1]).toMatchObject({ progress: 300 });
    expect(answer.me).toEqual({ lantern: true, glow: 1, offered: 300, rings: 1 });
  });

  it("offers nothing more when the same request is sent again", async () => {
    const first = await offer(300, "offer-1");

    expect(await offer(300, "offer-1")).toEqual(first);
    expect(await services.account(alice)).toMatchObject({ balance: 700 });
  });

  it("refuses a request id already used for a different amount", async () => {
    await offer(300, "offer-1");

    expect(await offer(500, "offer-1")).toMatchObject({ status: 409, body: { code: "request_conflict" } });
    expect(await services.account(alice)).toMatchObject({ balance: 700 });
  });

  it("refuses an offering the balance doesn't cover, and changes nothing", async () => {
    expect(await offer(1001, "offer-1")).toMatchObject({ status: 409, body: { code: "insufficient_leaf" } });
    expect((await great()).me).toMatchObject({ lantern: false, offered: 0 });
  });

  it("takes only whole offerings from 100 to 10,000 Leaf", async () => {
    const answers: unknown[] = [];
    await inTurn([99, 10_001], async (amount) => answers.push(await offer(amount, `offer-${amount}`)));

    expect(answers).toMatchObject([
      { status: 400, body: { code: "invalid_offering" } },
      { status: 400, body: { code: "invalid_offering" } },
    ]);
  });
});
