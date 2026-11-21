import { describe, expect, it } from "bun:test";

import { playerId } from "@sequoia-leaf/core";
import { Redacted } from "effect";

import { runCreditSync } from "../src/earning/run.ts";
import { scheduledSync } from "../src/jobs.ts";
import { DAY, MINUTE, testLeaf } from "./support.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
const T0 = Date.parse("2026-11-02T00:00:00Z");
const runScheduledSync = scheduledSync("credit", runCreditSync);

const feed = {
  raids: [
    {
      completion_id: 4812,
      completed_at: "2026-11-02T00:01:30Z",
      raid_name: "The Nameless Anomaly",
      season_rating: 110,
      player_uuid: alice,
    },
  ],
  wars: [],
};

/** A backend that answers every request with the feed and remembers what it was asked. */
function backend(): { requests: Request[]; fetcher: (url: string, init: RequestInit) => Promise<Response> } {
  const requests: Request[] = [];
  return {
    requests,
    fetcher: (url, init) => {
      requests.push(new Request(url, init));
      return Promise.resolve(Response.json(feed));
    },
  };
}

describe("the scheduled run", () => {
  it("reads the backend's credit feed and pays the Leaf it lists", async () => {
    const clock = { now: T0 };
    const { requests, fetcher } = backend();
    const leaf = testLeaf(clock, fetcher, { backendToken: Redacted.make("secret-token") });

    await leaf.run(runScheduledSync);
    clock.now = T0 + 5 * MINUTE;
    await leaf.run(runScheduledSync);

    expect(requests).toHaveLength(1);
    const url = new URL(requests[0]?.url ?? "");
    expect(url.origin + url.pathname).toBe("https://backend.test/internal/player-credits");
    expect(url.searchParams.get("to")).toBe("2026-11-02T00:04:30.000Z");
    expect(requests[0]?.headers.get("Authorization")).toBe("Bearer secret-token");
    expect(await leaf.account(alice)).toEqual({ playerId: alice, balance: 100, xp: 100 });
  });

  it("re-reads the last week at minute 17 of the hour", async () => {
    const clock = { now: T0 };
    const { requests, fetcher } = backend();
    const leaf = testLeaf(clock, fetcher);
    await leaf.run(runScheduledSync);

    clock.now = T0 + 10 * DAY + 17 * MINUTE;
    await leaf.run(runScheduledSync);

    const asked = new URL(requests[0]?.url ?? "").searchParams;
    expect(asked.get("from")).toBe("2026-11-05T00:16:30.000Z");
    expect(asked.get("to")).toBe("2026-11-12T00:16:30.000Z");
  });

  it("skips the feed when the backend token is not configured", async () => {
    const clock = { now: T0 };
    const { requests, fetcher } = backend();
    const withoutToken = testLeaf(clock, fetcher, { backendToken: undefined });

    await withoutToken.run(runScheduledSync);
    clock.now = T0 + 5 * MINUTE;
    await withoutToken.run(runScheduledSync);

    expect(requests).toEqual([]);
  });

  it("carries on after a run that fails", async () => {
    const clock = { now: T0 };
    let down = false;
    const { fetcher } = backend();
    const leaf = testLeaf(clock, (url, init) =>
      down ? Promise.resolve(new Response("down", { status: 502 })) : fetcher(url, init),
    );
    await leaf.run(runScheduledSync);

    down = true;
    clock.now = T0 + 5 * MINUTE;
    await leaf.run(runScheduledSync);
    down = false;
    clock.now = T0 + 6 * MINUTE;
    await leaf.run(runScheduledSync);

    expect((await leaf.account(alice)).balance).toBe(100);
  });
});
