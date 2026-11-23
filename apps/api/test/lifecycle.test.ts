import { describe, expect, it } from "bun:test";

import { graceOver, type Link, linked, NO_LINK, type Stop, stopped, unlinked } from "../src/live/lifecycle.ts";

describe("a player's connection", () => {
  it("is theirs once it opens, and the one it takes over from is to close", () => {
    expect(linked(NO_LINK, "a")).toEqual({ link: { state: "open", pipe: "a" }, replaced: null });
    expect(linked<string>({ state: "open", pipe: "a" }, "b")).toEqual({
      link: { state: "open", pipe: "b" },
      replaced: "a",
    });
    expect(linked<string>({ state: "grace", since: 5 }, "b")).toEqual({
      link: { state: "open", pipe: "b" },
      replaced: null,
    });
  });

  it("closing, begins their grace, or ends it all at once when they signed out; another's closing changes nothing", () => {
    const open: Link<string> = { state: "open", pipe: "a" };

    expect(unlinked(open, "a", false, 100)).toEqual({ link: { state: "grace", since: 100 }, leaves: false });
    expect(unlinked(open, "a", true, 100)).toEqual({ link: NO_LINK, leaves: true });
    expect(unlinked(open, "b", false, 100)).toBeNull();
    expect(unlinked<string>({ state: "grace", since: 50 }, "a", false, 100)).toBeNull();
    expect(unlinked(NO_LINK, "a", false, 100)).toBeNull();
  });

  it("has its grace run out once it has lasted as long as the grace, and only then", () => {
    const grace: Link<string> = { state: "grace", since: 1000 };

    expect([graceOver(grace, 10_999, 10_000), graceOver(grace, 11_000, 10_000)]).toEqual([false, true]);
    expect(graceOver<string>({ state: "open", pipe: "a" }, 99_999, 10_000)).toBe(false);
    expect(graceOver(NO_LINK, 99_999, 10_000)).toBe(false);
  });
});

/** Live's stop after these, in order, from `from`. */
const after = (from: Stop, ...events: ("farewell" | "visits closed")[]) => events.reduce(stopped, from);

describe("Live's stop", () => {
  it("goes from running to closing every open visit to visits closed, and never back", () => {
    expect(after("running", "farewell")).toBe("closing visits");
    expect(after("running", "farewell", "visits closed")).toBe("visits closed");
    // Out of order, or again: nothing changes.
    expect(after("running", "visits closed")).toBe("running");
    expect(after("running", "farewell", "farewell")).toBe("closing visits");
    expect(after("running", "farewell", "visits closed", "farewell")).toBe("visits closed");
  });
});
