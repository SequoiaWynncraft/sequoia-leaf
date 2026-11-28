import { describe, expect, test } from "bun:test";

import { CALL_WORDS, within } from "./call.ts";

describe("waiting on Discord", () => {
  test("gives what comes in time, and null for what fails or never comes", async () => {
    expect(await within(1000, Promise.resolve(3))).toBe(3);
    expect(await within(1000, Promise.reject(new Error("no")))).toBeNull();
    expect(await within(20, new Promise<number>(() => undefined))).toBeNull();
  });
});

describe("what a page in a call says", () => {
  test("never names Discord's machinery to players", () => {
    for (const words of Object.values(CALL_WORDS)) expect(words).not.toMatch(/activity|sdk|frame|instance/i);
  });
});
