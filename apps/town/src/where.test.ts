import { describe, expect, test } from "bun:test";

import type { Place } from "@sequoia-leaf/kit/presence.ts";

import {
  atCamps,
  awayFor,
  type Gone,
  type Here,
  inGame,
  type InRoom,
  resters,
  standing,
  type Where,
  whereabouts,
} from "./where.ts";

const NOW = Date.UTC(2026, 10, 25, 12);
const MIN = 60_000;
const HOUR = 60 * MIN;
const ME = "me";
const room = (...names: string[]): InRoom[] => [
  { id: ME, name: "Tester", rank: "Strategist" },
  ...names.map((n) => ({ id: n, name: n, rank: null })),
];
/** Somebody on Leaf's list as in the game: there since `NOW`, doing something then, in a live room in town or at a camp, unless said. */
const here = (id: string, at: Place, o: Partial<Here> = {}): Here => ({
  id,
  name: id,
  rank: null,
  at,
  camp: null,
  live: at === "town" || at === "camp",
  since: NOW,
  acted: NOW,
  ...o,
});
/** Somebody on Leaf's list as gone, who left at `seen`. */
const left = (id: string, at: Place, seen: number): Gone => ({ id, name: id, rank: null, at, camp: null, seen });
/** Somebody on Leaf's list at `owner`'s camp. */
const camping = (id: string, owner: string | null): Here => ({
  ...here(id, "camp"),
  camp: owner === null ? null : { id: owner, name: owner },
});
const all = (o: Partial<Parameters<typeof whereabouts>[0]>): ReadonlyMap<string, Where> =>
  whereabouts({ me: ME, room: null, present: [], resting: [], gone: [], ...o });
/** Each record as "id: where", with "live", "gone" and when for those gone. */
const said = (m: ReadonlyMap<string, Where>): string[] =>
  [...m.values()].map(
    (w) =>
      `${w.id}: ${w.at}${w.state === "live" ? " live" : ""}${w.state !== "gone" ? "" : ` gone ${(NOW - w.seen) / MIN} min${w.stays ? "" : " not staying"}`}`,
  );

describe("where everybody is", () => {
  test("one record each, by id, never the member: the room's whom Leaf has in town, then Leaf's list of who is here, then those gone", () => {
    const m = all({
      room: room("Birch", "Ash"),
      present: [here(ME, "town"), here("Ash", "town"), here("Birch", "works"), here("Quill", "works")],
      resting: [left("Quill", "town", NOW - 5 * MIN), left("Fern", "table", NOW - 40 * MIN)],
      gone: [left("Fern", "town", NOW - 50 * MIN), left("Oak", "camp", NOW - MIN)],
    });
    expect(said(m)).toEqual([
      "Ash: town live",
      // In the room, and at the Works by Leaf's list: at the Works, as every other page reads them.
      "Birch: works",
      "Quill: works",
      "Oak: camp gone 1 min not staying",
      "Fern: table gone 40 min",
    ]);
  });

  test("somebody Leaf lists in town who is not in the room with the page is in town, and never gone", () => {
    // Another of the town's rooms has one; only their page says the other is there.
    const m = all({ room: room(), present: [here("Glac", "town"), here("Kira", "town", { live: false })] });
    expect(said(m)).toEqual(["Glac: town", "Kira: town"]);
    expect([...m.values()].map((w) => w.state)).toEqual(["listed", "listed"]);
  });

  test("a player whose page says the town with no live room, for over a minute or for hours, is never one who has just left", () => {
    for (const ago of [MIN + 1, 5 * MIN, 3 * HOUR]) {
      const kira = here("Kira", "town", { live: false, since: NOW - ago, acted: null });
      // Whether the page is in the town's room or not, and whoever else is.
      for (const inRoom of [room(), room("Birch"), null]) {
        const w = all({ room: inRoom, present: [kira] }).get("Kira");
        expect(w?.state).toBe("listed");
        expect(w && inGame(w) ? awayFor(w, NOW) : null).toBe(ago);
      }
    }
  });

  test("nobody is gone but on Leaf's word, at the time Leaf gives", () => {
    const m = all({
      room: room(),
      present: [here("Quill", "works", { since: NOW - 3 * HOUR, acted: NOW - 2 * HOUR })],
      resting: [left("Fern", "town", NOW - 30_000)],
    });
    // Quill, at the Works for hours and away, is at the Works: the list says so, and it is Leaf's to say otherwise.
    expect(said(m)).toEqual(["Quill: works", "Fern: town gone 0.5 min"]);
  });

  test("a rank the lists do not say is taken from what the page has learnt", () => {
    const m = all({ present: [here("Quill", "works")], ranks: new Map([["Quill", "Chief"]]) });
    expect(m.get("Quill")?.rank).toBe("Chief");
  });
});

/**
 * Every pairing of the two things Leaf says of somebody: in the room with the member or not, and on
 * Leaf's list as here in town with a live room, here in town by their page alone, here elsewhere,
 * gone, or not at all.
 */
describe("every pairing of the room and Leaf's list has one reading, each part of it something Leaf said", () => {
  const SINCE = NOW - 20 * MIN;
  const LEFT = NOW - 7 * MIN;
  const ROWS = ["town, live", "town, by their page", "the Works", "gone", "gone, not staying", "not listed"] as const;
  const rows: Readonly<Record<(typeof ROWS)[number], Partial<Parameters<typeof whereabouts>[0]>>> = {
    "town, live": { present: [here("X", "town", { since: SINCE })] },
    "town, by their page": { present: [here("X", "town", { live: false, since: SINCE })] },
    "the Works": { present: [here("X", "works", { since: SINCE })] },
    gone: { resting: [left("X", "town", LEFT)] },
    "gone, not staying": { gone: [left("X", "works", LEFT)] },
    "not listed": {},
  };
  const read = (inRoom: boolean, row: (typeof ROWS)[number]): Where | undefined =>
    all({ room: inRoom ? room("X") : room(), ...rows[row] }).get("X");

  test("in the room with the member: in town, drawn, when the list has them in town or not at all; in town since the list says so", () => {
    expect(read(true, "town, live")).toMatchObject({ state: "live", at: "town", since: SINCE });
    expect(read(true, "town, by their page")).toMatchObject({ state: "live", at: "town", since: SINCE });
    expect(read(true, "not listed")).toMatchObject({ state: "live", at: "town", since: null });
  });

  test("the room never says otherwise than the list: a page in the room with somebody reads them as a page out of it does", () => {
    for (const row of ["the Works", "gone", "gone, not staying"] as const) {
      expect([row, read(true, row)]).toEqual([row, read(false, row)]);
    }
    expect(read(true, "the Works")).toMatchObject({ state: "listed", at: "works" });
    expect(read(true, "gone")).toMatchObject({ state: "gone", seen: LEFT });
  });

  test("not in the room: exactly what the list says, and nobody at all when it says nothing", () => {
    expect(read(false, "town, live")).toMatchObject({ state: "listed", at: "town", live: true, since: SINCE });
    expect(read(false, "town, by their page")).toMatchObject({
      state: "listed",
      at: "town",
      live: false,
      since: SINCE,
    });
    expect(read(false, "the Works")).toMatchObject({ state: "listed", at: "works", since: SINCE });
    expect(read(false, "gone")).toMatchObject({ state: "gone", at: "town", seen: LEFT, stays: true });
    expect(read(false, "gone, not staying")).toMatchObject({ state: "gone", at: "works", seen: LEFT, stays: false });
    expect(read(false, "not listed")).toBeUndefined();
  });

  test("no reading has a time the page made: each is the list's own, or none", () => {
    const times = new Set<number | null>([SINCE, LEFT, NOW, null]);
    for (const inRoom of [true, false]) {
      for (const row of ROWS) {
        const w = read(inRoom, row);
        if (w === undefined) continue;
        const given = w.state === "gone" ? [w.seen] : [w.since, w.acted];
        for (const t of given) expect([row, times.has(t)]).toEqual([row, true]);
      }
    }
  });
});

/** X in town, as a Leaf from before it said since when or whether live lists them. */
const older = (o: Partial<Here>): Here => here("X", "town", { live: null, since: null, ...o });

/** X, who is in the game, from the room and Leaf's lists. */
const one = (o: Partial<Parameters<typeof whereabouts>[0]>): Extract<Where, { state: "live" | "listed" }> => {
  const w = all(o).get("X");
  if (w === undefined || !inGame(w)) throw new Error("X is not in the game");
  return w;
};

describe("for how long somebody has been away", () => {
  test("where Leaf hears what they do, after five minutes of nothing, counted from the last thing they did", () => {
    const at = (acted: number): number | null => awayFor(one({ present: [here("X", "town", { acted })] }), NOW);
    expect([at(NOW), at(NOW - 5 * MIN + 1), at(NOW - 5 * MIN), at(NOW - 3 * HOUR)]).toEqual([
      null,
      null,
      5 * MIN,
      3 * HOUR,
    ]);
    // At a game, whose page tells Leaf what they do, the same.
    expect(awayFor(one({ present: [here("X", "works", { acted: NOW - 20 * MIN })] }), NOW)).toBe(20 * MIN);
  });

  test("with nothing heard since they came, counted from when they came: never away without a time", () => {
    const at = (since: number): number | null =>
      awayFor(one({ present: [here("X", "works", { since, acted: null })] }), NOW);
    expect([at(NOW - MIN), at(NOW - 40 * MIN)]).toEqual([null, 40 * MIN]);
  });

  test("in town by their page alone, Leaf hears nothing they do: said from the first, with how long", () => {
    const at = (o: Partial<Here>): number | null =>
      awayFor(one({ present: [here("X", "town", { live: false, ...o })] }), NOW);
    expect([at({ acted: NOW - 30_000 }), at({ acted: null, since: NOW - 3 * HOUR })]).toEqual([30_000, 3 * HOUR]);
  });

  test("in the room, what the page saw them do counts, when it is later than Leaf's word", () => {
    const o = { room: room("X"), present: [here("X", "town", { acted: NOW - 10 * MIN })] };
    expect(awayFor(one(o), NOW)).toBe(10 * MIN);
    expect(awayFor(one({ ...o, stirred: new Map([["X", NOW - MIN]]) }), NOW)).toBeNull();
  });

  test("in the room and not yet on Leaf's list, nothing says since when: not away", () => {
    expect(awayFor(one({ room: room("X") }), NOW)).toBeNull();
  });

  test("at a camp by their page alone, as in town: said from the first; in the camp's room, by Leaf's rule", () => {
    const at = (live: boolean): number | null =>
      awayFor(one({ present: [here("X", "camp", { live, acted: NOW - MIN })] }), NOW);
    expect([at(false), at(true)]).toEqual([MIN, null]);
  });

  test("listed by a Leaf from before it said since when or whether live: there all the same, and away only with a time", () => {
    expect(all({ room: room(), present: [older({ acted: null })] }).get("X")).toMatchObject({
      state: "listed",
      at: "town",
    });
    expect(awayFor(one({ present: [older({ acted: null })] }), NOW)).toBeNull();
    expect(awayFor(one({ present: [older({ acted: NOW - MIN })] }), NOW)).toBeNull();
    expect(awayFor(one({ present: [older({ acted: NOW - 20 * MIN })] }), NOW)).toBe(20 * MIN);
  });
});

describe("how many are at each camp", () => {
  test("everybody in the game at it, the owner and visitors alike; nobody gone, and nobody at a camp Leaf does not name", () => {
    const m = all({
      room: room("Birch"),
      present: [camping("Oak", "Oak"), camping("Vale", "Oak"), camping("Ash", null), camping("Wren", ME)],
      resting: [{ ...left("Fern", "camp", NOW - 5 * MIN), camp: { id: "Oak", name: "Oak" } }],
      gone: [{ ...left("Rowan", "camp", NOW - MIN), camp: { id: "Oak", name: "Oak" } }],
    });
    expect(atCamps(m, null)).toEqual(
      new Map([
        ["Oak", 2],
        [ME, 1],
      ]),
    );
  });

  test("the member once, where the page has them, whatever Leaf's list said of them a moment ago", () => {
    const m = all({ present: [camping(ME, "Oak"), camping("Vale", "Oak"), camping("Wren", "Elm")] });
    expect(atCamps(m, "Oak")).toEqual(
      new Map([
        ["Oak", 2],
        ["Elm", 1],
      ]),
    );
    expect(atCamps(m, "Elm")).toEqual(
      new Map([
        ["Oak", 1],
        ["Elm", 2],
      ]),
    );
    expect(atCamps(m, null)).toEqual(
      new Map([
        ["Oak", 1],
        ["Elm", 1],
      ]),
    );
  });
});

describe("the town's figures, from where everybody is", () => {
  test("standing at the Works, the stump or the Grove: in the game there by Leaf's list, at most so many", () => {
    const m = all({
      room: room("Birch"),
      present: [
        here("Birch", "works"),
        here("Camp", "camp"),
        here("Grim", "grove"),
        ...Array.from({ length: 14 }, (_, i) => here(`n${String(i).padStart(2, "0")}`, "table")),
      ],
    });
    const s = standing(m, 12);
    // Birch, at the Works by Leaf's list, is at the Works, though the room has a figure of theirs.
    expect(s.map((w) => `${w.id}@${w.at}`).slice(0, 3)).toEqual(["Birch@works", "Grim@grove", "n00@table"]);
    expect(s.length).toBe(12);
  });

  test("dozing or leaving: gone by Leaf's word, not from a camp, newest first, staying as Leaf last said", () => {
    const m = all({
      room: room(),
      // In town by Leaf's list, in the room or not, Glac and Kira are nobody's to draw dozing.
      present: [here("Glac", "town"), here("Kira", "town", { live: false, since: NOW - 3 * HOUR, acted: null })],
      resting: [left("Fern", "town", NOW - 180 * MIN), left("Moss", "table", NOW - 3 * MIN)],
      gone: [left("Oak", "camp", NOW - MIN), left("Wren", "grove", NOW - 4 * MIN)],
    });
    expect(resters(m, 12).map((w) => `${w.id}@${w.at}${w.stays ? "" : " (goes)"}`)).toEqual([
      "Moss@table",
      "Wren@grove (goes)",
      "Fern@town",
    ]);
    expect(resters(m, 2).length).toBe(2);
  });
});
