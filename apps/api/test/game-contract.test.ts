import { describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { playerId } from "@sequoia-leaf/core";

import { runAchievementSync } from "../src/achievements/run.ts";
import { runCreditSync } from "../src/earning/run.ts";
import { fakeBackend, fakeMojang, MINUTE, sessionOf, steadyDice, testLeaf } from "./support.ts";

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
    "visitor-token": () => Response.json(sessionOf(playerId("10000000-0000-0000-0000-000000000003"), "Visitor", null)),
    // One of the guild's staff, a website admin.
    "staff-token": () =>
      Response.json({
        ...sessionOf(playerId("10000000-0000-0000-0000-000000000004"), "Steward", null),
        website_admin: true,
      }),
  });
  const mojang = fakeMojang();
  mojang.profiles.set(bob, { name: "Bob", skin: undefined });
  // Leaf's dice fall the same way every time, so the raid's draws in the file are always the same.
  const leaf = testLeaf(clock, fetcher, {}, { mojang: mojang.service, dice: steadyDice(1) });
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
  const saved = { saved_at: T0 + 10 * MINUTE, keys: { "town.save.v1": '{"v":1,"lanterns":3}' } };
  await call("GET /v1/game/hello", "GET", "/v1/game/hello");
  await call("GET /v1/game/me", "GET", "/v1/game/me");
  await call("GET /v1/game/me, signed out", "GET", "/v1/game/me", undefined, "stale-token");
  await call("GET /v1/game/me, a guest", "GET", "/v1/game/me", undefined, "visitor-token");
  await call("GET /v1/game/saves/{slot}, never saved", "GET", "/v1/game/saves/town");
  await call("PUT /v1/game/saves/{slot}", "PUT", "/v1/game/saves/town", { player: alice, version: 0, data: saved });
  await call("PUT /v1/game/saves/{slot}, a stale version", "PUT", "/v1/game/saves/town", {
    player: alice,
    version: 0,
    data: saved,
  });
  // A page left open as Bob, after Alice signed in in another tab.
  await call("PUT /v1/game/saves/{slot}, not you", "PUT", "/v1/game/saves/town", {
    player: bob,
    version: 1,
    data: saved,
  });
  // The same slot again, at once.
  await call("PUT /v1/game/saves/{slot}, too soon", "PUT", "/v1/game/saves/town", {
    player: alice,
    version: 1,
    data: saved,
  });
  // The battler's game is played on Leaf now, and its old slot takes no more writes.
  await call("PUT /v1/game/saves/{slot}, a game that moved", "PUT", "/v1/game/saves/raid", {
    player: alice,
    version: 0,
    data: { saved_at: T0 + 10 * MINUTE, keys: { "raid.run.v1": "{}" } },
  });
  // The purse's Coins are the ledger's now, and its old slot takes no more writes either.
  await call("PUT /v1/game/saves/{slot}, the purse", "PUT", "/v1/game/saves/purse", {
    player: alice,
    version: 0,
    data: { saved_at: T0 + 10 * MINUTE, keys: { "town.purse.v1": '{"coins":5000}' } },
  });
  await call("GET /v1/game/saves/{slot}", "GET", "/v1/game/saves/town");
  await call("GET /v1/game/saves", "GET", "/v1/game/saves");
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
  // Coins the town and the Works work out on their pages, kept in the ledger: the daily chest, a
  // thing for the camp, the same call again, a spend too dear, and a reason that is not one.
  const chest = { player: alice, id: "chest-2026-11-25", amount: 3, reason: "daily_chest" };
  await call("POST /v1/game/coins", "POST", "/v1/game/coins", chest);
  await call("POST /v1/game/coins, a spend", "POST", "/v1/game/coins", {
    player: alice,
    id: "t-1",
    amount: -120,
    reason: "camp_thing",
  });
  await call("POST /v1/game/coins, sent again", "POST", "/v1/game/coins", chest);
  await call("POST /v1/game/coins, not enough", "POST", "/v1/game/coins", {
    player: alice,
    id: "w-1",
    amount: -5000,
    reason: "camp_thing",
  });
  await call("POST /v1/game/coins, not a reason", "POST", "/v1/game/coins", {
    player: alice,
    id: "w-2",
    amount: 5,
    reason: "luck",
  });
  // A page left open after someone else signed in.
  await call("POST /v1/game/coins, not you", "POST", "/v1/game/coins", { ...chest, player: bob });
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
