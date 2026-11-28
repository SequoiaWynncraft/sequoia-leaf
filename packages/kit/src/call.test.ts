import { afterEach, describe, expect, test } from "bun:test";

import { CALL_WORDS, within } from "./call.ts";
import { inTown } from "./shell.ts";

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

/** A window framed by `frame` (null: framed by another site's page, or by nothing). */
const framedBy = (frame: { closest: (selector: string) => object | null } | null): void => {
  Object.defineProperty(globalThis, "window", { value: { frameElement: frame }, configurable: true });
};

describe("a page in the town", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  test("is one in the town's door, and not one framed by any other page of Leaf's origin, nor by another site", () => {
    framedBy({ closest: (selector) => (selector === "#door" ? {} : null) });
    expect(inTown()).toBe(true);
    // Discord's stand-in on Leaf's own origin frames the town: the town is not in the town.
    framedBy({ closest: () => null });
    expect(inTown()).toBe(false);
    framedBy(null);
    expect(inTown()).toBe(false);
  });
});
