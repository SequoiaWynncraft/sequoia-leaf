import { describe, expect, test } from "bun:test";

import { agoLine, ALONE, type InRoom, whoIsAbout } from "./about.ts";
import type { Mate } from "./guild.ts";
import { GUEST, toAbout } from "./live.ts";
import { makeGuild } from "./madeup.ts";

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const ME: InRoom = { id: "me", name: "Tester", rank: "Strategist" };
const mate = (
  id: string,
  name: string,
  at: Mate["at"],
  rank: string | null = null,
  seen: number | null = null,
): Mate => ({
  id,
  name,
  rank,
  at,
  seen,
});
/** Each part's title, and each of its rows as "name: line" (with "(you)" for the member). */
const shown = (a: ReturnType<typeof whoIsAbout>): [string, string[]][] =>
  a.parts.map((p) => [p.title, p.rows.map((r) => `${r.name}: ${r.line}${r.you ? " (you)" : ""}`)]);

describe("who is about", () => {
  test("in town: everybody in the room, the member first and marked; then the rest by name", () => {
    const about = whoIsAbout({
      me: ME,
      room: [
        { id: "w", name: "wrenly", rank: "Captain" },
        ME,
        { id: "p", name: "Pebblefoot", rank: GUEST },
        { id: "b", name: "Birchwood", rank: null },
      ],
      present: [],
      resting: [],
      now: NOW,
    });
    expect(shown(about)).toEqual([
      ["In town", ["Tester: Strategist (you)", "Birchwood: ", "Pebblefoot: Guest", "wrenly: Captain"]],
    ]);
    expect(about.count).toBe(4);
  });

  test("elsewhere: in the game but not in town, by name, with where they are", () => {
    const about = whoIsAbout({
      me: ME,
      room: [ME],
      present: [
        mate("q", "Quillon", "works"),
        mate("m", "Mossling", "table", "Recruiter"),
        mate("g", "Glimmer", "camp", GUEST),
      ],
      resting: [],
      now: NOW,
    });
    expect(shown(about)).toEqual([
      ["In town", ["Tester: Strategist (you)"]],
      [
        "Elsewhere",
        ["Glimmer: Guest · in their camp", "Mossling: Recruiter · at the raid table", "Quillon: at the Works"],
      ],
    ]);
    expect(about.count).toBe(4);
  });

  test("seen lately: newest first, each with how long ago, as the dozers' cards say it", () => {
    const about = whoIsAbout({
      me: ME,
      room: [ME],
      present: [],
      resting: [
        mate("f", "Fernhollow", "town", "Recruit", NOW - 180 * MIN),
        mate("q", "Quillon", "works", null, NOW - 40 * MIN),
        mate("o", "Oakhart", "camp", GUEST, NOW - 61 * MIN),
      ],
      now: NOW,
    });
    expect(shown(about)).toEqual([
      ["In town", ["Tester: Strategist (you)"]],
      ["Seen lately", ["Quillon: 40 minutes ago", "Oakhart: Guest · an hour ago", "Fernhollow: Recruit · 3 hours ago"]],
    ]);
    // Seen lately are not in the game now.
    expect(about.count).toBe(1);
    expect(about.alone).toBe(false);
  });

  test("the wording of how long ago", () => {
    expect([0.5, 1, 2, 59, 60, 119, 180, 47 * 60, 49 * 60].map((m) => agoLine(NOW - m * MIN, NOW))).toEqual([
      "a moment ago",
      "1 minute ago",
      "2 minutes ago",
      "59 minutes ago",
      "an hour ago",
      "an hour ago",
      "3 hours ago",
      "47 hours ago",
      "2 days ago",
    ]);
  });

  test("leaves out a part with nobody in it, and with nobody but the member says only that", () => {
    const alone = whoIsAbout({ me: ME, room: [ME], present: [], resting: [], now: NOW });
    expect([alone.alone, alone.count]).toEqual([true, 1]);
    expect(ALONE).toBe("Only you, for now.");

    const someoneAway = whoIsAbout({
      me: ME,
      room: [ME],
      present: [mate("q", "Quillon", "works")],
      resting: [],
      now: NOW,
    });
    expect(someoneAway.parts.map((p) => p.title)).toEqual(["In town", "Elsewhere"]);
    expect(someoneAway.alone).toBe(false);
  });

  test("believes the room over the guild's lists, and puts nobody in two parts", () => {
    const about = whoIsAbout({
      me: ME,
      room: [ME, { id: "b", name: "Birchwood", rank: "Captain" }],
      present: [
        // Still at the Works as far as the guild's half-minute-old list knows, but in the room now.
        mate("b", "Birchwood", "works"),
        // The guild still has them in town, but the room does not: just gone, or in another copy.
        mate("q", "Quillon", "town"),
        mate("me", "Tester", "town"),
      ],
      resting: [mate("q", "Quillon", "town", null, NOW - 5 * MIN), mate("f", "Fernhollow", "town", null, NOW - MIN)],
      now: NOW,
    });
    expect(shown(about)).toEqual([
      ["In town", ["Tester: Strategist (you)", "Birchwood: Captain"]],
      ["Seen lately", ["Fernhollow: 1 minute ago"]],
    ]);
  });

  test("out of the room, in town is whoever the guild says is in town", () => {
    const about = whoIsAbout({
      me: ME,
      room: null,
      present: [mate("q", "Quillfeather", "town", "Elder"), mate("f", "Fernwhistle", "table", "Seedling")],
      resting: [],
      now: NOW,
    });
    expect(shown(about)).toEqual([
      ["In town", ["Tester: Strategist (you)", "Quillfeather: Elder"]],
      ["Elsewhere", ["Fernwhistle: Seedling · at the raid table"]],
    ]);
  });

  test("a rank the lists do not say is taken from what the page has learnt", () => {
    const about = whoIsAbout({
      me: ME,
      room: [ME],
      present: [mate("q", "Quillon", "works")],
      resting: [mate("f", "Fernhollow", "town", null, NOW - 3 * 60 * MIN)],
      ranks: new Map([
        ["q", "Chief"],
        ["f", "Recruit"],
      ]),
      now: NOW,
    });
    expect(shown(about).slice(1)).toEqual([
      ["Elsewhere", ["Quillon: Chief · at the Works"]],
      ["Seen lately", ["Fernhollow: Recruit · 3 hours ago"]],
    ]);
  });
});

describe("who is about, from the guild", () => {
  test("on the guild's server: everybody but the member, wherever they are, guests marked, newest gone first", () => {
    const about = toAbout(
      [
        { id: "me", name: "Tester", place: "town", rank: null, guest: false },
        { id: "c", name: "Campfellow", place: "camp", rank: null, guest: false },
        { id: "g", name: "Pebblefoot", place: "town", rank: null, guest: true },
      ],
      [
        { id: "f", name: "Fernhollow", place: "town", seen: NOW - 180 * MIN, guest: false },
        { id: "q", name: "Quillon", place: "works", seen: NOW - 40 * MIN, guest: false },
        { id: "c", name: "Campfellow", place: "camp", seen: NOW - MIN, guest: false },
      ],
      "me",
    );
    expect(about.present.map((m) => [m.name, m.at, m.rank])).toEqual([
      ["Campfellow", "camp", null],
      ["Pebblefoot", "town", GUEST],
    ]);
    expect(about.resting.map((m) => m.name)).toEqual(["Quillon", "Fernhollow"]);
  });

  test("with the made-up guild, its stand-ins the same way", () => {
    const madeUp = makeGuild({ now: () => NOW });
    const { present, resting } = madeUp.about();
    const about = whoIsAbout({ me: ME, room: null, present, resting, now: NOW });
    expect(shown(about)).toEqual([
      ["In town", ["Tester: Strategist (you)", "Quillfeather: Elder"]],
      ["Elsewhere", ["Fernwhistle: Seedling · at the raid table"]],
      ["Seen lately", ["Kestrelle: Warden · 40 minutes ago", "Wrenly: Ranger · 3 hours ago"]],
    ]);
    expect(about.count).toBe(3);
  });
});
