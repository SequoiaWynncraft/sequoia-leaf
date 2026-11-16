import { describe, expect, it } from "bun:test";

import { playerId } from "@sequoia-leaf/core";

import { runScheduledSync } from "../src/earning/run.ts";
import { getAccount } from "../src/ledger/store.ts";
import { testServices } from "./support.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
const T0 = Date.parse("2026-11-02T00:00:00Z");
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

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
    const services = testServices(clock, fetcher, "secret-token");

    await runScheduledSync(services);
    clock.now = T0 + 5 * MINUTE;
    await runScheduledSync(services);

    expect(requests).toHaveLength(1);
    const url = new URL(requests[0]?.url ?? "");
    expect(url.origin + url.pathname).toBe("https://backend.test/internal/player-credits");
    expect(url.searchParams.get("to")).toBe("2026-11-02T00:04:30.000Z");
    expect(requests[0]?.headers.get("Authorization")).toBe("Bearer secret-token");
    expect(getAccount(services.db, alice)).toEqual({ playerId: alice, balance: 110, xp: 110 });
  });

  it("re-reads the last week at minute 17 of the hour", async () => {
    const clock = { now: T0 };
    const { requests, fetcher } = backend();
    const services = testServices(clock, fetcher);
    await runScheduledSync(services);

    clock.now = T0 + 10 * DAY + 17 * MINUTE;
    await runScheduledSync(services);

    const asked = new URL(requests[0]?.url ?? "").searchParams;
    expect(asked.get("from")).toBe("2026-11-05T00:16:30.000Z");
    expect(asked.get("to")).toBe("2026-11-12T00:16:30.000Z");
  });

  it("skips the feed when the backend token is not configured", async () => {
    const clock = { now: T0 };
    const { requests, fetcher } = backend();
    const services = testServices(clock, fetcher);
    const withoutToken = { ...services, backend: { ...services.backend, token: undefined } };

    await runScheduledSync(withoutToken);
    clock.now = T0 + 5 * MINUTE;
    await runScheduledSync(withoutToken);

    expect(requests).toEqual([]);
  });

  it("carries on after a run that fails", async () => {
    const clock = { now: T0 };
    let down = false;
    const { fetcher } = backend();
    const services = testServices(clock, (url, init) =>
      down ? Promise.resolve(new Response("down", { status: 502 })) : fetcher(url, init),
    );
    await runScheduledSync(services);

    down = true;
    clock.now = T0 + 5 * MINUTE;
    await runScheduledSync(services);
    down = false;
    clock.now = T0 + 6 * MINUTE;
    await runScheduledSync(services);

    expect(getAccount(services.db, alice).balance).toBe(110);
  });
});
