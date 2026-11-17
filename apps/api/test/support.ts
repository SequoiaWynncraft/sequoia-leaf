import type { Database } from "bun:sqlite";

import { openDatabase } from "../src/db.ts";
import type { Fetcher, Services } from "../src/services.ts";

/** An empty, fully migrated database that lives in memory. */
export function testDatabase(): Database {
  return openDatabase(":memory:");
}

/** A clock that tests set by hand. */
export interface TestClock {
  now: number;
}

/** Services around a fresh database, a hand-set clock and a stand-in backend. */
export function testServices(clock: TestClock, fetcher: Fetcher, token = "internal-token"): Services {
  return {
    db: testDatabase(),
    backend: { url: "https://backend.test", token },
    sierra: { url: "https://sierra.test", token },
    fetcher,
    now: () => clock.now,
  };
}

/** What a promise rejects with. Fails the test when the promise resolves instead. */
export async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the promise to reject, but it resolved");
}
