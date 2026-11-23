import { describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { leaf as leafOf, playerId } from "@sequoia-leaf/core";

import { runAchievementSync } from "../src/achievements/run.ts";
import { runCreditSync } from "../src/earning/run.ts";
import { fakeBackend, fakeMojang, MINUTE, rewardQueue, sessionOf, steadyDice, testLeaf } from "./support.ts";

/**
 * The game's routes as the game sees them, from the real routes:
 * `contracts/leaf-game-v1.json` holds what each answers for one member after a
 * day of play with a guild-mate. The game's own tests read it instead of
 * answers written by hand. Unlike `leaf-api-v1.json`, no other repository
 * keeps a copy, so changing it needs no change elsewhere first.
 *
 * Changing what a route sends fails this test until the file is written again
 * with `WRITE_CONTRACTS=1 bun test test/game-contract.test.ts`.
 */
const CONTRACT = join(import.meta.dir, "..", "..", "..", "contracts", "leaf-game-v1.json");

const alice = playerId("10000000-0000-0000-0000-000000000001");
const bob = playerId("10000000-0000-0000-0000-000000000002");
const visitor = playerId("10000000-0000-0000-0000-000000000003");
/** Wednesday 25 November 2026, 12:30 UTC. */
const T0 = Date.UTC(2026, 10, 25, 12, 30);
const ORIGIN = "https://leaf.seqwawa.com";

/** Alice's day: nine raids, the first two with Bob, enough for a level; a defence; and a milestone. */
function creditFeed() {
  const raid = (completion: number, player: string) => ({
    completion_id: completion,
    completed_at: new Date(T0 + (completion - 99) * 40_000).toISOString(),
    raid_name: "Nest of the Grootslangs",
    season_rating: 110,
    player_uuid: player,
  });
  return {
    raids: [
      raid(100, alice),
      raid(100, bob),
      raid(101, alice),
      raid(101, bob),
      ...[102, 103, 104, 105, 106, 107, 108].map((completion) => raid(completion, alice)),
    ],
    wars: [
      {
        war_submission_id: 900,
        completed_at: new Date(T0 + 7 * MINUTE).toISOString(),
        territory: "Detlas",
        in_claim: true,
        war_points: 73,
        season_rating: 60,
        player_uuid: alice,
      },
    ],
  };
}

const award = {
  award_id: `${alice}:raid:NOG:bronze`,
  player_uuid: alice,
  achievement_key: "raid:NOG",
  milestone_id: "bronze",
  tier: "bronze",
  threshold: 25,
  label: "Bronze",
  earned_at: new Date(T0 + 4 * MINUTE).toISOString(),
};

/** One call: what the game sent, and what Leaf answered. */
interface Exchange {
  readonly request: { readonly method: string; readonly path: string; readonly body?: unknown };
  readonly status: number;
  readonly body: unknown;
}

async function exchanges(): Promise<Record<string, Exchange>> {
  const clock = { now: T0 };
  const { backend, fetcher } = fakeBackend({
    "alice-token": () => Response.json(sessionOf(alice, "Alice", "CAPTAIN")),
    "bob-token": () => Response.json(sessionOf(bob, "Bob", "RECRUIT")),
    "visitor-token": () => Response.json(sessionOf(visitor, "Visitor", null)),
    // One of the guild's staff, a website admin.
    "staff-token": () =>
      Response.json({
        ...sessionOf(playerId("10000000-0000-0000-0000-000000000004"), "Steward", null),
        website_admin: true,
      }),
  });
  const mojang = fakeMojang();
  mojang.profiles.set(bob, { name: "Bob", skin: undefined });
  mojang.profiles.set(visitor, { name: "Visitor", skin: undefined });
  // Leaf's dice fall the same way every time, so the raid's draws in the file are always the same.
  // Leaf's spending is on, so that a look is bought.
  const leaf = testLeaf(clock, fetcher, { gameLeafSpending: true }, { mojang: mojang.service, dice: steadyDice(1) });
  const app = leaf.app();
  await leaf.run(runCreditSync("recent"));
  await leaf.run(runAchievementSync("recent"));
  backend.credits = creditFeed;
  backend.awards = () => ({ awards: [award] });
  clock.now = T0 + 10 * MINUTE;
  await leaf.run(runCreditSync("recent"));
  await leaf.run(runAchievementSync("recent"));

  const recorded: Record<string, Exchange> = {};
  async function call(name: string, method: string, path: string, body?: unknown, session = "alice-token") {
    // As the game sends it: the website's cookie, from Leaf's own page.
    const response = await app.request(path, {
      method,
      headers: { Cookie: `seq_session=${session}`, Origin: ORIGIN, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    recorded[name] = {
      request: body === undefined ? { method, path } : { method, path, body },
      status: response.status,
      body: await response.json(),
    };
  }
  await call("GET /v1/game/hello", "GET", "/v1/game/hello");
  // A look costs more than the day's raids paid her: the guild's staff grant her the rest.
  await leaf.post(
    { kind: "earn", playerId: alice, amount: leafOf(30_000), source: "staff", idempotencyKey: "staff:look" },
    clock.now,
  );
  await call("GET /v1/game/me", "GET", "/v1/game/me");
  await call("GET /v1/game/me, signed out", "GET", "/v1/game/me", undefined, "stale-token");
  await call("GET /v1/game/me, a guest", "GET", "/v1/game/me", undefined, "visitor-token");
  await call("GET /v1/game/guild/events", "GET", "/v1/game/guild/events");
  await call("GET /v1/game/guild/events?after=", "GET", "/v1/game/guild/events?after=6");
  await call("GET /v1/game/guild/events, a guest", "GET", "/v1/game/guild/events", undefined, "visitor-token");
  // Bob had the game open a while ago, and his character stays in town, dozing.
  await app.request("/v1/game/presence", {
    method: "PUT",
    headers: { Authorization: "Bearer bob-token", "Content-Type": "application/json" },
    body: JSON.stringify({ place: "works" }),
  });
  clock.now = T0 + 25 * MINUTE;
  // A guest is in town too.
  await app.request("/v1/game/presence", {
    method: "PUT",
    headers: { Authorization: "Bearer visitor-token", "Content-Type": "application/json" },
    body: JSON.stringify({ place: "town" }),
  });
  // Alice has had the town open half a minute, on a desktop.
  clock.now = T0 + 24 * MINUTE + 30_000;
  await app.request("/v1/game/presence", {
    method: "PUT",
    headers: { Authorization: "Bearer alice-token", "Content-Type": "application/json" },
    body: JSON.stringify({ place: "town", device: "desktop" }),
  });
  clock.now = T0 + 25 * MINUTE;
  await call("PUT /v1/game/presence", "PUT", "/v1/game/presence", { place: "town", stay: true, device: "desktop" });
  await call("GET /v1/game/presence", "GET", "/v1/game/presence");
  // A page that is not the town's says nothing of staying, and Leaf keeps what the town said.
  await call("PUT /v1/game/presence, without stay", "PUT", "/v1/game/presence", { place: "table" });
  // The Little Raid on the play service: a new table, setting out and the first pick, a refusal, the
  // same batch sent again, and what is not a command or not a game.
  await call("GET /v1/game/play/{game}", "GET", "/v1/game/play/raid");
  const firstRoom = {
    player: alice,
    commands: [
      { id: "c-1", do: "start", trail: 0 },
      { id: "c-2", do: "choose", option: 0 },
    ],
  };
  await call("POST /v1/game/play/{game}", "POST", "/v1/game/play/raid", firstRoom);
  await call("POST /v1/game/play/{game}, a refusal", "POST", "/v1/game/play/raid", {
    player: alice,
    commands: [{ id: "c-3", do: "take" }],
  });
  await call("POST /v1/game/play/{game}, sent again", "POST", "/v1/game/play/raid", firstRoom);
  await call("POST /v1/game/play/{game}, not a command", "POST", "/v1/game/play/raid", {
    player: alice,
    commands: [{ id: "c-4", do: "win" }],
  });
  await call("GET /v1/game/play/{game}, not a game", "GET", "/v1/game/play/chess");
  // A look for the table bought with Leaf, the same command sent again, and a guest with too little Leaf for it.
  const buyLook = { player: alice, commands: [{ id: "c-5", do: "buyLook", kind: "cloth", look: "plum" }] };
  await call("POST /v1/game/play/{game}, a look bought with Leaf", "POST", "/v1/game/play/raid", buyLook);
  await call("POST /v1/game/play/{game}, a look bought, sent again", "POST", "/v1/game/play/raid", buyLook);
  await call(
    "POST /v1/game/play/{game}, a guest with too little Leaf",
    "POST",
    "/v1/game/play/raid",
    { player: visitor, commands: [{ id: "v-1", do: "buyLook", kind: "cloth", look: "plum" }] },
    "visitor-token",
  );
  await call("GET /v1/game/me, after a look bought", "GET", "/v1/game/me");
  // A page left open since before the town moved onto Leaf is told to load itself again.
  await call("PUT /v1/game/saves/{slot}, a page from before the town moved", "PUT", "/v1/game/saves/town", {
    player: alice,
    version: 1,
    data: {},
  });
  await call("POST /v1/game/coins, a page from before the town moved", "POST", "/v1/game/coins", {
    player: alice,
    id: "old-1",
    amount: 3,
    reason: "chest",
  });
  // The town on the play service: a new member's camp and the letter at the gate; the letter put
  // away, a thing bought at a stall, which is in the tray and new, the tray looked in, and the thing set out.
  await call("GET /v1/game/play/{game}, the town", "GET", "/v1/game/play/town");
  await call("POST /v1/game/play/{game}, the town", "POST", "/v1/game/play/town", {
    player: alice,
    commands: [
      { id: "t-1", do: "welcome", cursor: null },
      { id: "t-2", do: "buy", stall: "lamps", thing: "rock" },
      { id: "t-3", do: "looked", through: 1 },
      { id: "t-4", do: "setOut", thing: "rock", x: 30, y: 20, t: 0 },
    ],
  });
  // The Works' board: Bob's yard, Alice's and the guest's, as the play service writes where each stands.
  for (const [player, score, story, guest] of [
    [bob, 5120, 7, 0],
    [alice, 1840, 3, 0],
    [visitor, 960, 2, 1],
  ] as const) {
    // oxlint-disable-next-line no-await-in-loop -- one after another
    await leaf.query(
      (sql) => sql`
        INSERT INTO standings (player_id, game, score, also, guest, updated_at)
        VALUES (${player}, 'works', ${score}, ${JSON.stringify({ story })}, ${guest}, ${clock.now})
      `,
    );
  }
  await call("GET /v1/game/play/{game}/standings", "GET", "/v1/game/play/works/standings");
  // Bob's yard, as a visitor is given it; the raid, which cannot be visited; and Alice's numbers on her card.
  await app.request("/v1/game/play/works", { headers: { Authorization: "Bearer bob-token" } });
  await call("GET /v1/game/play/{game}/of/{player}", "GET", `/v1/game/play/works/of/${bob}`);
  await call("GET /v1/game/play/{game}/of/{player}, nothing to visit", "GET", `/v1/game/play/raid/of/${bob}`);
  // Alice is still in town three minutes on, and has the pulls open a minute, which has no board.
  for (const [after, game] of [
    [3 * MINUTE, "town"],
    [0, "pulls"],
    [MINUTE, "pulls"],
  ] as const) {
    clock.now += after;
    // oxlint-disable-next-line no-await-in-loop -- one after another
    await app.request(`/v1/game/play/${game}`, { headers: { Authorization: "Bearer alice-token" } });
  }
  await call("GET /v1/game/people/{player}", "GET", `/v1/game/people/${alice}`, undefined, "bob-token");
  clock.now = T0 + 25 * MINUTE;
  await call("GET /v1/game/people/{player}, unknown", "GET", "/v1/game/people/20000000-0000-0000-0000-000000000009");
  // The pull banners: before Leaf has a headliner for the first, and once it has Bob.
  await call("GET /v1/game/banners, no headliner yet", "GET", "/v1/game/banners");
  await leaf.query((sql) => sql`INSERT INTO banner_people (banner, player_id) VALUES ('banner-1', ${bob})`);
  await call("GET /v1/game/banners", "GET", "/v1/game/banners");
  // A page left open after someone else signed in.
  await call("POST /v1/game/play/{game}, not you", "POST", "/v1/game/play/raid", { ...firstRoom, player: bob });
  // A raid run of Alice's, as the play service logs it.
  for (const [minute, kind, data] of [
    [5, "raid_started", { trail: 0 }],
    [8, "raid_room", { room: 1, kind: "trouble", won: true, resolve: 3, seconds: 41 }],
    [12, "raid_room", { room: 2, kind: "trouble", won: false, resolve: 0, seconds: 63 }],
    [12, "raid_ended", { trail: 0, rooms_won: 1, ended: "lost", coins: 20 }],
  ] as const) {
    // oxlint-disable-next-line no-await-in-loop -- in order
    await leaf.query(
      (sql) => sql`
        INSERT INTO activity (player_id, at, game, kind, data)
        VALUES (${alice}, ${T0 + minute * MINUTE}, 'raid', ${kind}, ${JSON.stringify(data)})
      `,
    );
  }
  await call("GET /v1/game/admin/activity, a member", "GET", "/v1/game/admin/activity");
  await call("GET /v1/game/admin/activity", "GET", "/v1/game/admin/activity?days=2", undefined, "staff-token");
  // The Treasury: a tome request bought (the backend charges it through Leaf), the same again, and a guest.
  backend.api = rewardQueue("alice-token", alice, (path, init) => app.request(path, init)).api;
  await call("GET /v1/game/requests", "GET", "/v1/game/requests");
  const tome = { type: "tome", reason: "For the war tower" };
  await call("POST /v1/game/requests", "POST", "/v1/game/requests", tome);
  await call("POST /v1/game/requests, refused", "POST", "/v1/game/requests", tome);
  await call("GET /v1/game/requests, a guest", "GET", "/v1/game/requests", undefined, "visitor-token");
  // A batch in the Works, answered short: Bob sets a gatherer down at the tick his page was given.
  const works = await app.request("/v1/game/play/works", { headers: { Authorization: "Bearer bob-token" } });
  const tick = field(field(await works.json(), "state"), "clock");
  const gatherer = { id: "w-1", do: "build", kind: "gatherer", x: 20, y: 15, dir: 0, tick };
  await call(
    "POST /v1/game/play/{game}, the Works",
    "POST",
    "/v1/game/play/works",
    {
      player: bob,
      commands: [gatherer],
    },
    "bob-token",
  );
  await app.dispose();
  return recorded;
}

/** A field of a JSON object, or undefined when the value is not an object or lacks it. */
function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
}

describe("The game's contract", () => {
  it("answers as contracts/leaf-game-v1.json says", async () => {
    const actual = await exchanges();
    if (process.env["WRITE_CONTRACTS"] === "1") {
      writeFileSync(CONTRACT, `${JSON.stringify(actual, null, 2)}\n`);
    }

    const contract: unknown = JSON.parse(readFileSync(CONTRACT, "utf8"));

    expect(contract).toEqual(actual);
  });

  it("shows every kind of guild event, so the game sees each one", () => {
    const contract: unknown = JSON.parse(readFileSync(CONTRACT, "utf8"));
    const events = field(field(field(contract, "GET /v1/game/guild/events"), "body"), "events");
    const types = Array.isArray(events) ? events.map((event: unknown) => field(event, "type")) : [];

    expect(new Set(types)).toEqual(new Set(["achievement_paid", "leaf_earned", "level_up"]));
  });
});
