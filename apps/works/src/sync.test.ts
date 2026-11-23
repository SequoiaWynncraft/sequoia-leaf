/**
 * The page's link to Leaf and its place in the yard's room, each moved by its one function: what each
 * event does in each state, and what it leaves alone.
 */
import { describe, expect, test } from "bun:test";

import { askDue, type Link, type LinkEvent, type Room, roomStep, type Sent, step } from "./sync.ts";

type L = Link<"leaf", string>;
const sent = (command: string): Sent<string> => ({ command, tick: 1, check: 2 });
const run = (l: L, ...events: LinkEvent<"leaf", string>[]): L => events.reduce(step, l);
const closed: L = { is: "closed" };
const inStep: L = { is: "inStep", leaf: "leaf", sent: [sent("a"), sent("b")] };

describe("the link to Leaf", () => {
  test("opens in step, sends, and has each command answered", () => {
    const l = run(
      closed,
      { do: "open", leaf: "leaf" },
      { do: "send", sent: sent("a") },
      { do: "send", sent: sent("b") },
    );
    expect(l).toEqual(inStep);
    expect(step(l, { do: "answered", commands: ["a"] })).toEqual({ ...inStep, sent: [sent("b")] });
  });

  test("gives way once, keeping what was sent to be answered, and the tick of a fault", () => {
    const giving = step(inStep, { do: "giveWay", now: 10, differs: 7 });
    expect(giving).toEqual({
      is: "givingWay",
      leaf: "leaf",
      sent: inStep.is === "inStep" ? inStep.sent : [],
      since: 10,
      asked: -Infinity,
      differs: 7,
    });
    // Asked again to give way, it keeps when it began; a later fault's tick is the one told.
    expect(step(giving, { do: "giveWay", now: 20 })).toEqual(giving);
    expect(step(giving, { do: "giveWay", now: 20, differs: 9 })).toMatchObject({ since: 10, differs: 9 });
    // Answers still come in while it gives way.
    expect(step(giving, { do: "answered", commands: ["a", "b"] })).toMatchObject({ is: "givingWay", sent: [] });
  });

  test("sends nothing while giving way, closed or ended", () => {
    const giving = step(inStep, { do: "giveWay", now: 10 });
    for (const l of [giving, closed, { is: "ended", why: "signedout" } satisfies L])
      expect(step(l, { do: "send", sent: sent("c") })).toBe(l);
  });

  test("asks for Leaf's yard once nothing is on its way, every couple of seconds, and is in step once it is read", () => {
    const giving = step(inStep, { do: "giveWay", now: 10 });
    expect([askDue(giving, 10, true), askDue(giving, 10, false), askDue(inStep, 10, false)]).toEqual([
      false,
      true,
      false,
    ]);
    const asked = step(giving, { do: "ask", now: 10 });
    expect([askDue(asked, 1500, false), askDue(asked, 2010, false)]).toEqual([false, true]);
    expect(step(asked, { do: "took" })).toEqual({
      is: "inStep",
      leaf: "leaf",
      sent: inStep.is === "inStep" ? inStep.sent : [],
    });
  });

  test("a read in step (the kit's own, after a minute without a call) keeps it in step; ended, nothing moves it but opening", () => {
    expect(step(inStep, { do: "took" })).toBe(inStep);
    const ended = step(inStep, { do: "end", why: "closed" });
    expect(ended).toEqual({ is: "ended", why: "closed" });
    for (const e of [{ do: "took" }, { do: "ask", now: 1 }, { do: "giveWay", now: 1 }] as const)
      expect(step(ended, e)).toBe(ended);
  });
});

describe("the yard's room", () => {
  type R = Room<"room">;
  test("is live from a welcome until the connection drops, and let go for good when signed in elsewhere", () => {
    let r: R = roomStep<"room">({ is: "out" }, { do: "join", room: "room" });
    expect(r).toEqual({ is: "waiting", room: "room" });
    r = roomStep(r, { do: "welcome" });
    expect(r).toEqual({ is: "live", room: "room" });
    expect(roomStep(r, { do: "status", status: "open" })).toBe(r);
    expect(roomStep(r, { do: "status", status: "connecting" })).toEqual({ is: "waiting", room: "room" });
    expect(roomStep(r, { do: "status", status: "replaced" })).toEqual({ is: "out" });
    // None to join (not a player), and a welcome with no room, change nothing.
    expect(roomStep<"room">({ is: "out" }, { do: "join", room: null })).toEqual({ is: "out" });
    expect(roomStep<"room">({ is: "out" }, { do: "welcome" })).toEqual({ is: "out" });
  });
});
