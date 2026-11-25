import { describe, expect, it } from "bun:test";

import { applyAbout, readToClient, type Who } from "@sequoia-leaf/core";

import { AboutTold } from "../src/live/about.ts";

const row = (id: string, place = "town") => ({
  id,
  username: id,
  place,
  guest: false,
  seen_at: "2026-11-24T12:00:00.000Z",
});
const who = (at: string, present: ReturnType<typeof row>[]): Who => ({ at, present, resting: [], gone: [] });

describe("who is about, as Live tells it", () => {
  it("tells all of it the first time, then what changed, each numbered one more, and gives all of it as last told", () => {
    const told = new AboutTold();
    expect(told.whole()).toBeNull();
    const first = told.next(who("t1", [row("a"), row("b"), row("c")]));
    expect(readToClient(first.changed)).toEqual({ t: "about", v: 1, who: who("t1", [row("a"), row("b"), row("c")]) });
    expect(first.whole).toBe(first.changed);

    const next = who("t2", [row("a"), row("b", "works"), row("c")]);
    const second = told.next(next);
    const changed = readToClient(second.changed);
    expect(changed).toMatchObject({ t: "aboutChanged", v: 2 });
    expect(
      changed?.t === "aboutChanged" ? applyAbout(who("t1", [row("a"), row("b"), row("c")]), changed) : null,
    ).toEqual(next);
    expect(readToClient(second.whole)).toEqual({ t: "about", v: 2, who: next });
    expect(told.whole()).toBe(second.whole);
  });

  it("tells all of it, numbered, whenever saying what changed would be longer", () => {
    const told = new AboutTold();
    told.next(who("t1", [row("a"), row("b")]));
    // Everybody different: what changed is longer than all of it.
    const all = told.next(who("t2", [row("x"), row("y")]));
    expect(all.changed).toBe(all.whole);
    expect(readToClient(all.changed)).toMatchObject({ t: "about", v: 2 });
  });
});
