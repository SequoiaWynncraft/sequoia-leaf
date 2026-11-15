import { playerId } from "@sequoia-leaf/core";
import { createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import worker from "../src/index.ts";
import { getAccount } from "../src/ledger/store.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
const T0 = Date.parse("2026-11-02T00:00:00Z");
const MINUTE = 60_000;

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

function everyMinute(now: number): Promise<void> {
  vi.setSystemTime(now);
  return worker.scheduled(createScheduledController({ cron: "* * * * *", scheduledTime: now }), {
    ...env,
    BACKEND_INTERNAL_TOKEN: "secret-token",
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the every-minute run", () => {
  it("reads the backend's credit feed and pays the Leaf it lists", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const requests: Request[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      requests.push(new Request(url, init));
      return Response.json(feed);
    });

    await everyMinute(T0);
    await everyMinute(T0 + 5 * MINUTE);

    expect(requests).toHaveLength(1);
    const url = new URL(requests[0]?.url ?? "");
    expect(url.origin + url.pathname).toBe("https://api.seqwawa.com/internal/player-credits");
    expect(url.searchParams.get("to")).toBe("2026-11-02T00:04:30.000Z");
    expect(requests[0]?.headers.get("Authorization")).toBe("Bearer secret-token");
    expect(await getAccount(env.DB, alice)).toEqual({ playerId: alice, balance: 110, xp: 110 });
  });

  it("skips the feed when the backend token is not configured", async () => {
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);

    await worker.scheduled(createScheduledController({ cron: "* * * * *", scheduledTime: T0 }), env);

    expect(fetched).not.toHaveBeenCalled();
  });
});
