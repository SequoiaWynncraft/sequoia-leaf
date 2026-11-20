import { describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_RULES, openCone, playerId, RAIDS, ROLL_RANGE } from "@sequoia-leaf/core";

import { runAchievementSync } from "../src/achievements/run.ts";
import { runCreditSync } from "../src/earning/run.ts";
import { MINUTE, rolling, testLeaf } from "./support.ts";

/**
 * Leaf's API as clients see it, from the real routes: `contracts/leaf-api-v1.json`
 * holds what each answers for one member after a day of play. Clients test against
 * a copy of that file instead of answers written by hand, so what they assume about
 * Leaf (shapes, nulls, the order of a list) is checked against what Leaf sends.
 *
 * Changing what a route sends fails this test until the file is written again with
 * `WRITE_CONTRACTS=1 bun test test/contract.test.ts`; then copy it to the clients
 * (see "The contract clients test against" in the README).
 */
const CONTRACT = join(import.meta.dir, "..", "..", "..", "contracts", "leaf-api-v1.json");

const alice = playerId("10000000-0000-0000-0000-000000000001");
/** Wednesday 25 November 2026, 12:30 UTC: inside the 12:00 timed window. */
const T0 = Date.UTC(2026, 10, 25, 12, 30);

const member = {
  discord_id: "1",
  discord_username: "alice",
  minecraft_uuid: alice,
  minecraft_username: "Alice",
  expires_at: "2026-12-01T00:00:00Z",
  guild_rank: "CAPTAIN",
  website_admin: false,
};

/** A war as the credit feed lists it. */
function warCredit(index: number, territory: string, inClaim: boolean, warPoints: number) {
  return {
    war_submission_id: 900 + index,
    completed_at: new Date(T0 + 7 * MINUTE + index * 20_000).toISOString(),
    territory,
    in_claim: inClaim,
    war_points: warPoints,
    season_rating: 60,
    player_uuid: alice,
  };
}

/** Three of every guild raid, a defence and an FFA war, a minute or so apart, as the backend's credit feed lists them. */
function creditFeed() {
  const raids = Object.values(RAIDS).flatMap((raidName, kind) =>
    [0, 1, 2].map((run) => ({
      completion_id: 100 + kind * 3 + run,
      completed_at: new Date(T0 + MINUTE + (kind * 3 + run) * 20_000).toISOString(),
      raid_name: raidName,
      season_rating: 110,
      player_uuid: alice,
    })),
  );
  const wars = [warCredit(0, "Detlas", true, 73), warCredit(1, "Ragni", false, 25)];
  return { raids, wars };
}

const award = {
  award_id: `${alice}:raid:TNA:gold`,
  player_uuid: alice,
  achievement_key: "raid:TNA",
  milestone_id: "gold",
  tier: "gold",
  threshold: 100,
  label: "Gold",
  earned_at: new Date(T0 + 4 * MINUTE).toISOString(),
};

/** The first roll that opens a Treant from a member's first cone. */
function treantRoll(): number {
  const banner = DEFAULT_RULES.grove.banners[0];
  if (banner === undefined) {
    throw new Error("The rules have no banner");
  }
  for (let roll = 0; roll < ROLL_RANGE; roll += 1) {
    if (openCone(0, roll, () => 0, banner, DEFAULT_RULES.grove).rank === "treant") {
      return roll;
    }
  }
  throw new Error("No roll opens a Treant");
}

/**
 * Plays a day: the backend and Sierra report it, Leaf pays it, the member opens
 * the cone their Bloom gave them in the Grove, and rerolls their weekly.
 */
/** One call: what the client sent, and what Leaf answered. */
interface Exchange {
  readonly request: { readonly method: string; readonly path: string; readonly body?: unknown };
  readonly status: number;
  readonly body: unknown;
}

async function exchanges(): Promise<Record<string, Exchange>> {
  const clock = { now: T0 };
  let reporting = false;
  const leaf = testLeaf(clock, (url, init) => {
    const path = new URL(url).pathname;
    if (path === "/auth/web/me") {
      const token = new Request(url, init).headers.get("Authorization");
      return Promise.resolve(
        token === "Bearer alice-token"
          ? Response.json(member)
          : Response.json({ error: "unauthorized" }, { status: 401 }),
      );
    }
    if (path === "/internal/player-credits") {
      return Promise.resolve(Response.json(reporting ? creditFeed() : { raids: [], wars: [] }));
    }
    if (path === "/internal/v1/achievements/awards") {
      return Promise.resolve(Response.json({ awards: reporting ? [award] : [] }));
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  });
  const app = leaf.app(rolling([treantRoll()]));
  await leaf.run(runCreditSync("recent"));
  await leaf.run(runAchievementSync("recent"));
  reporting = true;
  clock.now = T0 + 10 * MINUTE;
  await leaf.run(runCreditSync("recent"));
  await leaf.run(runAchievementSync("recent"));

  // The Grove is not a client of this contract, so its call is not recorded; its event is.
  await app.request("/v1/grove/cones/open", {
    method: "POST",
    headers: { Authorization: "Bearer alice-token", "Content-Type": "application/json" },
    body: JSON.stringify({ count: 1, request_id: "contract-cone" }),
  });

  const recorded: Record<string, Exchange> = {};
  async function call(name: string, method: string, path: string, body?: unknown) {
    const response = await app.request(path, {
      method,
      headers: { Authorization: "Bearer alice-token", "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    recorded[name] = {
      request: body === undefined ? { method, path } : { method, path, body },
      status: response.status,
      body: await response.json(),
    };
  }
  await call("POST /v1/me/quests/{id}/reroll", "POST", "/v1/me/quests/weekly:1/reroll", { leaf: 0 });
  await call("POST /v1/me/quests/{id}/reroll, the cost changed", "POST", "/v1/me/quests/weekly:2/reroll", { leaf: 0 });
  await call("POST /v1/me/quests/{id}/reroll, the same quest again", "POST", "/v1/me/quests/weekly:1/reroll", {
    leaf: 100,
  });
  await call("GET /v1/me", "GET", "/v1/me");
  await call("GET /v1/me/quests", "GET", "/v1/me/quests");
  await call("GET /v1/me/events", "GET", "/v1/me/events");
  await app.dispose();
  return recorded;
}

/** A field of a JSON object, or undefined when the value is not an object or lacks it. */
function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
}

/** The kinds of event in the contract's `GET /v1/me/events` answer. */
function eventTypes(contract: unknown): string[] {
  const events = field(field(field(contract, "GET /v1/me/events"), "body"), "events");
  const types = Array.isArray(events) ? events.map((event: unknown) => field(event, "type")) : [];
  return [...new Set(types.filter((type): type is string => typeof type === "string"))];
}

describe("Leaf's API contract", () => {
  it("answers as contracts/leaf-api-v1.json says", async () => {
    const actual = await exchanges();
    if (process.env["WRITE_CONTRACTS"] === "1") {
      writeFileSync(CONTRACT, `${JSON.stringify(actual, null, 2)}\n`);
    }

    const contract: unknown = JSON.parse(readFileSync(CONTRACT, "utf8"));

    expect(contract).toEqual(actual);
  });

  it("shows every kind of event, so a client sees each one", () => {
    const contract: unknown = JSON.parse(readFileSync(CONTRACT, "utf8"));

    expect(eventTypes(contract).toSorted()).toEqual([
      "achievement_paid",
      "grove.bloomed",
      "grove.cone_opened",
      "grove.raid_lantern",
      "guild.war_win",
      "leaf_earned",
      "level_up",
      "quest_completed",
      "quest_rerolled",
    ]);
  });
});
