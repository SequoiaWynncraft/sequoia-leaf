import { describe, expect, it } from "bun:test";

import {
  graceRunsOut,
  handedOver,
  handsOver,
  type Link,
  linked,
  NO_LINK,
  type Stop,
  stopped,
  unlinked,
} from "../src/live/lifecycle.ts";

describe("a player's connection", () => {
  it("is theirs once it opens, and the one it takes over from is to close", () => {
    expect(linked(NO_LINK, "a")).toEqual({ link: { state: "open", pipe: "a" }, replaced: null });
    expect(linked<string>({ state: "open", pipe: "a" }, "b")).toEqual({
      link: { state: "open", pipe: "b" },
      replaced: "a",
    });
    expect(linked<string>({ state: "grace", grace: { since: 5 }, handoff: false }, "b")).toEqual({
      link: { state: "open", pipe: "b" },
      replaced: null,
    });
  });

  it("closing, begins their grace, or ends it all at once when they signed out; another's closing changes nothing", () => {
    const open: Link<string> = { state: "open", pipe: "a" };

    expect(unlinked(open, "a", false, 100, false)).toEqual({ state: "grace", grace: { since: 100 }, handoff: false });
    expect(unlinked(open, "a", true, 100, true)).toEqual(NO_LINK);
    expect(unlinked(open, "b", false, 100, true)).toBeNull();
    expect(
      unlinked<string>({ state: "grace", grace: { since: 50 }, handoff: false }, "a", false, 100, true),
    ).toBeNull();
    expect(unlinked(NO_LINK, "a", false, 100, true)).toBeNull();
    // Closed by its page itself: the player may be going to another of their pages.
    expect(unlinked(open, "a", false, 100, true)).toEqual({ state: "grace", grace: { since: 100 }, handoff: true });
  });

  it("has a grace period run out only while it is that very period, whatever the clock says", () => {
    const open: Link<string> = { state: "open", pipe: "a" };
    const first = unlinked(open, "a", false, 100, true);
    if (first?.state !== "grace") throw new Error("no grace");
    expect(graceRunsOut(first, first.grace)).toBe(true);
    // An opening that hands the player over and never opens keeps them in the same period.
    expect(graceRunsOut(handedOver(first), first.grace)).toBe(true);
    // Back, and dropped again at the same moment: a period of its own, which the first does not end.
    const again = unlinked(linked(first, "b").link, "b", false, 100, false);
    if (again?.state !== "grace") throw new Error("no grace");
    expect([graceRunsOut(again, first.grace), graceRunsOut(again, again.grace)]).toEqual([false, true]);
    expect([graceRunsOut(open, first.grace), graceRunsOut(NO_LINK, first.grace)]).toEqual([false, false]);
  });
});

describe("going from one of a player's pages to another", () => {
  const cleanly: Link<string> = { state: "grace", grace: { since: 1000 }, handoff: true };

  it("is an opening that takes over a connection of theirs that is open", () => {
    expect(handsOver<string>({ state: "open", pipe: "a" }, 1000, 5000)).toBe(true);
  });

  it("is an opening within a few seconds of their page closing its connection itself, and only the first", () => {
    expect([handsOver(cleanly, 6000, 5000), handsOver(cleanly, 6001, 5000)]).toEqual([true, false]);
    const taken = handedOver(cleanly);
    expect(taken).toEqual({ state: "grace", grace: { since: 1000 }, handoff: false });
    expect(handsOver(taken, 1500, 5000)).toBe(false);
  });

  it("is never an opening after a drop, or with no connection before it", () => {
    expect(handsOver<string>({ state: "grace", grace: { since: 1000 }, handoff: false }, 1100, 5000)).toBe(false);
    expect(handsOver(NO_LINK, 1100, 5000)).toBe(false);
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
