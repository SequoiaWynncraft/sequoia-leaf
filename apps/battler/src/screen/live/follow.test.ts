import { afterEach, expect, jest, test } from "bun:test";

import { scope } from "@sequoia-leaf/kit/scope.ts";

import { follower, GATHER_MS, type Went } from "./follow.ts";

afterEach(() => jest.useRealTimers());

/** Lets what was asked land: a few turns of the microtasks. */
async function landed(): Promise<void> {
  // oxlint-disable-next-line no-await-in-loop -- one turn of the microtasks at a time
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

test("asks close together make one read; one read at a time; what was asked during it is read after it", async () => {
  jest.useFakeTimers();
  const pending: ((went: Went) => void)[] = [];
  const f = follower(scope(), () => new Promise<Went>((went) => pending.push(went)));
  f.want();
  f.want();
  jest.advanceTimersByTime(GATHER_MS);
  expect(pending).toHaveLength(1);
  f.want();
  f.want();
  jest.advanceTimersByTime(GATHER_MS * 10);
  expect(pending).toHaveLength(1);
  pending[0]?.("landed");
  await landed();
  jest.advanceTimersByTime(GATHER_MS);
  expect(pending).toHaveLength(2);
  pending[1]?.("landed");
  await landed();
  jest.advanceTimersByTime(GATHER_MS * 10);
  expect([pending.length, f.owed()]).toEqual([2, false]);
});

test("a read put off waits for its owner to say it may go, even when it said so while the read was on its way", async () => {
  jest.useFakeTimers();
  const pending: ((went: Went) => void)[] = [];
  const f = follower(scope(), () => new Promise<Went>((went) => pending.push(went)));
  f.want();
  jest.advanceTimersByTime(GATHER_MS);
  pending[0]?.("later");
  await landed();
  jest.advanceTimersByTime(GATHER_MS * 10);
  expect([pending.length, f.owed()]).toEqual([1, true]);
  // Told it may go: it goes, and is put off again; told so while that one was on its way: it goes again.
  f.kick();
  jest.advanceTimersByTime(GATHER_MS);
  expect(pending).toHaveLength(2);
  f.kick();
  pending[1]?.("later");
  await landed();
  jest.advanceTimersByTime(GATHER_MS);
  expect(pending).toHaveLength(3);
  pending[2]?.("landed");
  await landed();
  expect(f.owed()).toBe(false);
  // Stopped: nothing more is read, whatever is asked.
  f.stop();
  f.want();
  jest.advanceTimersByTime(GATHER_MS * 10);
  expect(pending).toHaveLength(3);
});
