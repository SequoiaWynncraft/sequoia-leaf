import { describe, expect, test } from "bun:test";

import type { Place } from "@sequoia-leaf/kit/presence.ts";

import { agoLine, ALONE, campWords, cardLine, held, partsOf, whoIsAbout } from "./about.ts";
import { GUEST } from "./live.ts";
import { type Gone, type Here, type InRoom, whereabouts } from "./where.ts";

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const ME: InRoom = { id: "me", name: "Tester", rank: "Strategist" };
/**
 * Somebody on Leaf's list as in the game: there since `NOW` and doing something then (or when `acted`
 * says), in a live room if in town, unless `o` says otherwise.
 */
const mate = (
  id: string,
  name: string,
  at: Place,
  rank: string | null = null,
  acted: number | null = NOW,
  o: Partial<Here> = {},
): Here => ({ id, name, rank, at, camp: null, live: at === "town" || at === "camp", since: NOW, acted, ...o });
/** Somebody on Leaf's list as gone, who left at `seen`. */
const past = (id: string, name: string, at: Place, rank: string | null, seen: number): Gone => ({
  id,
  name,
  rank,
  at,
  camp: null,
  seen,
});
/** Whose camp, by its owner's id, named as Leaf names them. */
const campOf = (owner: string): { id: string; name: string } => ({
  id: owner,
  name: owner === ME.id ? ME.name : owner.toUpperCase(),
});
/** Somebody on Leaf's list at `owner`'s camp (by id); or at a camp Leaf does not say whose. */
const camper = (id: string, name: string, owner: string | null): Here => ({
  ...mate(id, name, "camp"),
  camp: owner === null ? null : campOf(owner),
});
/**
 * Who is about with the member, from the room (or none) and Leaf's lists, by way of where each is;
 * everybody in the room seen doing something just now, but those `idle`.
 */
function whoIs(o: {
  room: readonly InRoom[] | null;
  present?: readonly Here[];
  resting?: readonly Gone[];
  ranks?: ReadonlyMap<string, string>;
  idle?: readonly string[];
}): ReturnType<typeof whoIsAbout> {
  const all = whereabouts({
    me: ME.id,
    room: o.room,
    present: o.present ?? [],
    resting: o.resting ?? [],
    gone: [],
    ...(o.ranks ? { ranks: o.ranks } : {}),
    stirred: new Map((o.room ?? []).filter((m) => !o.idle?.includes(m.id)).map((m) => [m.id, NOW])),
  });
  return whoIsAbout({ me: ME, all, now: NOW });
}
/** Each part's title, and each of its rows as "name: line" (with "(you)" for the member). */
const shown = (a: ReturnType<typeof whoIsAbout>): [string, string[]][] =>
  partsOf(a).map((p) => [p.title, p.rows.map((r) => `${r.name}: ${r.line}${r.you ? " (you)" : ""}`)]);

describe("who is about", () => {
  test("in town: everybody in the room, the member first and marked; then the rest by name", () => {
    const about = whoIs({
      room: [
        { id: "w", name: "wrenly", rank: "Captain" },
        ME,
        { id: "p", name: "Pebblefoot", rank: GUEST },
        { id: "b", name: "Birchwood", rank: null },
      ],
      present: [],
      resting: [],
    });
    expect(shown(about)).toEqual([
      ["In town", ["Tester: Strategist (you)", "Birchwood: ", "Pebblefoot: Guest", "wrenly: Captain"]],
    ]);
    expect(about.count).toBe(4);
  });

  test("elsewhere: in the game but not in town, by name, with where they are", () => {
    const about = whoIs({
      room: [ME],
      present: [
        mate("q", "Quillon", "works"),
        mate("m", "Mossling", "table", "Recruiter"),
        { ...mate("g", "Glimmer", "camp", GUEST), camp: { id: "g", name: "Glimmer" } },
      ],
      resting: [],
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

  test("seen lately: newest first, each with how long ago, as the dozers' cards say it, and whose camp at one", () => {
    const about = whoIs({
      room: [ME],
      present: [],
      resting: [
        past("f", "Fernhollow", "town", "Recruit", NOW - 180 * MIN),
        past("q", "Quillon", "works", null, NOW - 40 * MIN),
        { ...past("o", "Oakhart", "camp", GUEST, NOW - 61 * MIN), camp: { id: "o", name: "Oakhart" } },
      ],
    });
    expect(shown(about)).toEqual([
      ["In town", ["Tester: Strategist (you)"]],
      [
        "Seen lately",
        [
          "Quillon: 40 minutes ago",
          "Oakhart: Guest · in their camp · an hour ago",
          "Fernhollow: Recruit · 3 hours ago",
        ],
      ],
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
    const alone = whoIs({ room: [ME] });
    expect([alone.alone, alone.count]).toEqual([true, 1]);
    expect(ALONE).toBe("Only you, for now.");

    const someoneAway = whoIs({
      room: [ME],
      present: [mate("q", "Quillon", "works")],
      resting: [],
    });
    expect(partsOf(someoneAway).map((p) => p.title)).toEqual(["In town", "Elsewhere"]);
    expect(someoneAway.alone).toBe(false);
  });

  test("the list says where somebody is, for a page in the room with them as for any other, and nobody is in two parts", () => {
    const lists = {
      present: [
        // At the Works by Leaf's list, though a page of theirs is in the town's room.
        mate("b", "Birchwood", "works", "Captain"),
        // In town by Leaf's list, and not in the room with the member: in town.
        mate("q", "Quillon", "town"),
        mate("me", "Tester", "town"),
      ],
      // Lists that had somebody twice would still show them once, where they are now.
      resting: [past("q", "Quillon", "town", null, NOW - 5 * MIN), past("f", "Fernhollow", "town", null, NOW - MIN)],
    };
    const same: [string, string[]][] = [
      ["In town", ["Tester: Strategist (you)", "Quillon: "]],
      ["Elsewhere", ["Birchwood: Captain · at the Works"]],
      ["Seen lately", ["Fernhollow: 1 minute ago"]],
    ];
    expect(shown(whoIs({ room: [ME, { id: "b", name: "Birchwood", rank: "Captain" }], ...lists }))).toEqual(same);
    expect(shown(whoIs({ room: [ME], ...lists }))).toEqual(same);
    expect(shown(whoIs({ room: null, ...lists }))).toEqual(same);
  });

  test("a player whose page says the town with no live room is never listed as having just left", () => {
    for (const ago of [61_000, 10 * MIN, 3 * HOUR]) {
      const kira = mate("k", "Kira", "town", "Recruit", null, { live: false, since: NOW - ago });
      // In the town's room with others, alone in it, or out of it.
      for (const room of [[ME, { id: "b", name: "Birchwood", rank: null }], [ME], null]) {
        const about = whoIs({ room, present: [kira] });
        expect(about.rows.get("k")?.part).toBe("In town");
        expect(partsOf(about).some((p) => p.title === "Seen lately")).toBe(false);
        expect(about.rows.get("k")?.line).toBe(
          `Recruit · ${ago === 61_000 ? "away for 1 minute" : ago === 10 * MIN ? "away for 10 minutes" : "away for 3 hours"}`,
        );
      }
    }
  });

  test("the town's list: somebody connected, one whose page only says so, one who has just left, and one away for hours", () => {
    const about = whoIs({
      room: [ME, { id: "c", name: "Connie", rank: "Captain" }],
      present: [
        mate("c", "Connie", "town", null, NOW - 20_000, { since: NOW - 30 * MIN }),
        mate("k", "Kira", "town", "Recruit", null, { live: false, since: NOW - 49 * MIN }),
        mate("h", "Hollis", "town", "Chief", NOW - 3 * HOUR, { since: NOW - 4 * HOUR }),
      ],
      resting: [past("j", "Juno", "town", "Recruit", NOW - 20_000)],
    });
    expect(shown(about)).toEqual([
      [
        "In town",
        [
          "Tester: Strategist (you)",
          "Connie: Captain",
          "Hollis: Chief · away for 3 hours",
          "Kira: Recruit · away for 49 minutes",
        ],
      ],
      ["Seen lately", ["Juno: Recruit · a moment ago"]],
    ]);
  });

  test("out of the room, in town is whoever Leaf says is in town", () => {
    const about = whoIs({
      room: null,
      present: [mate("q", "Quillfeather", "town", "Elder"), mate("f", "Fernwhistle", "table", "Seedling")],
      resting: [],
    });
    expect(shown(about)).toEqual([
      ["In town", ["Tester: Strategist (you)", "Quillfeather: Elder"]],
      ["Elsewhere", ["Fernwhistle: Seedling · at the raid table"]],
    ]);
  });

  test("a rank the lists do not say is taken from what the page has learnt", () => {
    const about = whoIs({
      room: [ME],
      present: [mate("q", "Quillon", "works")],
      resting: [past("f", "Fernhollow", "town", null, NOW - 3 * 60 * MIN)],
      ranks: new Map([
        ["q", "Chief"],
        ["f", "Recruit"],
      ]),
    });
    expect(shown(about).slice(1)).toEqual([
      ["Elsewhere", ["Quillon: Chief · at the Works"]],
      ["Seen lately", ["Fernhollow: Recruit · 3 hours ago"]],
    ]);
  });
});

describe("who is away", () => {
  test("whoever has done nothing for five minutes is away, by Leaf's rule, with for how long, in town or elsewhere", () => {
    const about = whoIs({
      room: [ME, { id: "b", name: "Birchwood", rank: "Captain" }, { id: "w", name: "Wrenly", rank: null }],
      present: [
        mate("b", "Birchwood", "town", null, NOW - 20 * MIN),
        mate("q", "Quillon", "works", null, NOW - 5 * MIN),
        mate("m", "Mossling", "table", "Recruiter", NOW - 5 * MIN + 1),
        // Nothing heard since they came: counted from then.
        mate("g", "Glimmer", "grove", null, null, { since: NOW - 12 * MIN }),
        mate("n", "Nettle", "works", null, null, { since: NOW - MIN }),
      ],
      idle: ["b", "w"],
    });
    expect(shown(about)).toEqual([
      // Wrenly, in the room and not on Leaf's list yet: nothing says since when, so nothing is said.
      ["In town", ["Tester: Strategist (you)", "Birchwood: Captain · away for 20 minutes", "Wrenly: "]],
      [
        "Elsewhere",
        [
          "Glimmer: in the Grove · away for 12 minutes",
          "Mossling: Recruiter · at the raid table",
          "Nettle: at the Works",
          "Quillon: at the Works · away for 5 minutes",
        ],
      ],
    ]);
    // Nobody is away without a time.
    expect([...about.rows.values()].filter((r) => /away(?! for )/.test(r.line))).toEqual([]);
  });

  test("whoever the page sees do something in the room is back at once, whatever Leaf's list said", () => {
    const all = whereabouts({
      me: ME.id,
      room: [ME, { id: "b", name: "Birchwood", rank: null }],
      present: [mate("b", "Birchwood", "town", null, NOW - 20 * MIN)],
      resting: [],
      gone: [],
      stirred: new Map([["b", NOW - 1000]]),
    });
    expect(all.get("b")).toMatchObject({ state: "live", acted: NOW - 1000 });
    expect(shown(whoIsAbout({ me: ME, all, now: NOW }))[0]?.[1]).toEqual(["Tester: Strategist (you)", "Birchwood: "]);
  });

  test("a person's card says where they are and for how long they have been away, and nothing for somebody about the town", () => {
    const all = whereabouts({
      me: ME.id,
      room: [ME, { id: "b", name: "Birchwood", rank: null }],
      present: [
        mate("b", "Birchwood", "town", null, NOW - 61 * MIN),
        mate("q", "Quillon", "works"),
        mate("m", "Mossling", "table", null, NOW - 7 * MIN),
      ],
      resting: [past("f", "Fernhollow", "town", null, NOW - 3 * MIN)],
      gone: [],
      stirred: new Map([["b", NOW - 61 * MIN]]),
    });
    expect(["b", "q", "m", "f", "nobody"].map((id) => cardLine(all.get(id), NOW, ME.id))).toEqual([
      "Away for an hour",
      "At the Works",
      "At the raid table, away for 7 minutes",
      null,
      null,
    ]);
  });
});

describe("who is about, at the camps", () => {
  test("says whose camp somebody is in: their own, the member's, or somebody else's; and where Leaf does not say, a camp", () => {
    const about = whoIs({
      room: [ME],
      present: [
        camper("o", "Oakley", "o"),
        camper("v", "Vale", ME.id),
        camper("w", "Wren", "o"),
        camper("x", "Ash", null),
      ],
      resting: [
        { ...past("r", "Rowan", "camp", null, NOW - 3 * 60 * MIN), camp: campOf("o") },
        past("q", "Quillon", "works", null, NOW - 2 * 60 * MIN),
      ],
    });
    expect(shown(about)).toEqual([
      ["In town", ["Tester: Strategist (you)"]],
      ["Elsewhere", ["Ash: in a camp", "Oakley: in their camp", "Vale: visiting you", "Wren: visiting O"]],
      ["Seen lately", ["Quillon: 2 hours ago", "Rowan: visiting O · 3 hours ago"]],
    ]);
  });

  test("a person's card says the same", () => {
    const all = whereabouts({
      me: ME.id,
      room: [ME],
      present: [camper("o", "Oakley", "o"), camper("v", "Vale", ME.id), camper("w", "Wren", "o")],
      resting: [],
      gone: [],
    });
    expect(["o", "v", "w"].map((id) => cardLine(all.get(id), NOW, ME.id))).toEqual([
      "In their camp",
      "Visiting you",
      "Visiting O",
    ]);
    expect(campWords("w", { id: "o", name: "Oakley" }, "o")).toBe("visiting you");
  });
});

describe("who is about, from Leaf's list", () => {
  test("in the Grove is somewhere else in the game", () => {
    const about = whoIs({ room: [ME], present: [mate("g", "Glimmer", "grove", GUEST)] });
    expect(shown(about)).toEqual([
      ["In town", ["Tester: Strategist (you)"]],
      ["Elsewhere", ["Glimmer: Guest · in the Grove"]],
    ]);
  });

  test("somebody at a game stays where Leaf's list has them until Leaf says they have gone", () => {
    const quillon = mate("q", "Quillon", "works", null, NOW - 2 * MIN, { since: NOW - HOUR });
    expect(shown(whoIs({ room: [ME], present: [quillon] }))).toEqual([
      ["In town", ["Tester: Strategist (you)"]],
      ["Elsewhere", ["Quillon: at the Works"]],
    ]);
    expect(shown(whoIs({ room: [ME], resting: [past("q", "Quillon", "works", null, NOW - 2 * MIN)] }))).toEqual([
      ["In town", ["Tester: Strategist (you)"]],
      ["Seen lately", ["Quillon: 2 minutes ago"]],
    ]);
  });
});

/** The room with the member and these others in it, and who is about with them there. */
const inRoom = (...others: string[]): InRoom[] => [ME, ...others.map((n) => ({ id: n, name: n, rank: null }))];
const about = (room: InRoom[], present: Here[] = []): ReturnType<typeof whoIsAbout> => whoIs({ room, present });
/** Each part's title and its rows' names, with "(gone)" for those no longer in it. */
const names = (a: ReturnType<typeof whoIsAbout>): [string, string[]][] =>
  partsOf(a).map((p) => [p.title, p.rows.map((r) => `${r.name}${r.gone ? " (gone)" : ""}`)]);

describe("the panel while it stays open", () => {
  test("its order holds: somebody arriving goes to the end of their part, not where their name sorts", () => {
    const opened = about(inRoom("Birchwood", "Nettlebrook"));
    const arrived = about(inRoom("Birchwood", "Mossling", "Nettlebrook"));
    expect(names(held(opened, arrived))).toEqual([["In town", ["Tester", "Birchwood", "Nettlebrook", "Mossling"]]]);
    // Opened afresh, it is sorted by name as ever.
    expect(names(arrived)).toEqual([["In town", ["Tester", "Birchwood", "Mossling", "Nettlebrook"]]]);
  });

  test("somebody leaving stays listed where they were, marked as gone, until it is opened again", () => {
    const opened = about(inRoom("Birchwood", "Mossling", "Nettlebrook"));
    const left = held(opened, about(inRoom("Birchwood", "Nettlebrook")));
    expect(names(left)).toEqual([["In town", ["Tester", "Birchwood", "Mossling (gone)", "Nettlebrook"]]]);
    // Still gone a moment later; and back in the room, they are where they were, and not gone.
    expect(names(held(left, about(inRoom("Nettlebrook"))))).toEqual([
      ["In town", ["Tester", "Birchwood (gone)", "Mossling (gone)", "Nettlebrook"]],
    ]);
    expect(names(held(left, opened))).toEqual(names(opened));
  });

  test("somebody who goes from town into the Works stays where they were, dimmed, saying where they are now, and is listed once", () => {
    const works = [mate("Wrenly", "Wrenly", "works")];
    const opened = about(inRoom("Birchwood", "Nettlebrook"), works);
    const went = about(inRoom("Nettlebrook"), [...works, mate("Birchwood", "Birchwood", "works")]);
    expect(shown(held(opened, went))).toEqual([
      ["In town", ["Tester: Strategist (you)", "Birchwood: at the Works", "Nettlebrook: "]],
      ["Elsewhere", ["Wrenly: at the Works"]],
    ]);
    expect(names(held(opened, went))[0]?.[1]).toContain("Birchwood (gone)");
  });

  test("somebody who leaves town stays where they were listed, dimmed, saying how long ago, and is not listed again as seen lately", () => {
    const opened = about(inRoom("Glacade"));
    // Leaf says they have gone: out of the room, and on its list as gone.
    const left = whoIs({ room: inRoom(), resting: [past("Glacade", "Glacade", "town", GUEST, NOW - 20_000)] });
    expect(names(left)).toEqual([
      ["In town", ["Tester"]],
      ["Seen lately", ["Glacade"]],
    ]);
    expect(shown(held(opened, left))).toEqual([
      ["In town", ["Tester: Strategist (you)", `Glacade: ${GUEST} · a moment ago`]],
    ]);
    // And somebody seen lately who comes back into town stays where they were, saying so.
    const back = held(left, opened);
    expect(shown(back)).toEqual([
      ["In town", ["Tester: Strategist (you)"]],
      ["Seen lately", ["Glacade: in town"]],
    ]);
  });

  test("nobody is listed twice, however the panel's lists change while it is open", () => {
    const steps = [
      about(inRoom("A", "B"), [mate("C", "C", "works")]),
      about(inRoom("B"), [mate("A", "A", "town"), mate("C", "C", "works")]),
      about(inRoom("C"), [mate("A", "A", "table"), mate("B", "B", "camp")]),
      about(inRoom("A", "B", "C")),
      about(inRoom()),
    ];
    let shownNow = steps[0] ?? about(inRoom());
    for (const step of steps) {
      shownNow = held(shownNow, step);
      const ids = partsOf(shownNow).flatMap((p) => p.rows.map((r) => r.id));
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test("the count is of who is about now; and it says nobody is about only if nobody was when it opened", () => {
    const alone = about(inRoom());
    const two = about(inRoom("Birchwood"));
    expect(held(two, alone)).toMatchObject({ count: 1, alone: false });
    expect(held(alone, alone).alone).toBe(true);
    expect(held(alone, two)).toMatchObject({ count: 2, alone: false });
  });
});
