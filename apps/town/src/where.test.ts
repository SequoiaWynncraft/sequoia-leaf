import { describe, expect, test } from "bun:test";

import type { Place } from "@sequoia-leaf/kit/presence.ts";

import { atCamps, type InRoom, type Listed, resters, standing, type Where, whereabouts } from "./where.ts";

const NOW = Date.UTC(2026, 10, 25, 12);
const MIN = 60_000;
const ME = "me";
const room = (...names: string[]): InRoom[] => [
  { id: ME, name: "Tester", rank: "Strategist" },
  ...names.map((n) => ({ id: n, name: n, rank: null })),
];
const listed = (id: string, at: Place, seen: number | null = NOW, rank: string | null = null): Listed => ({
  id,
  name: id,
  rank,
  at,
  camp: null,
  seen,
});
/** Somebody on Leaf's list at `owner`'s camp. */
const camping = (id: string, owner: string | null, seen: number | null = NOW): Listed => ({
  ...listed(id, "camp", seen),
  camp: owner === null ? null : { id: owner, name: owner },
});
const all = (o: Partial<Parameters<typeof whereabouts>[0]>): ReadonlyMap<string, Where> =>
  whereabouts({ me: ME, room: null, present: [], resting: [], gone: [], now: NOW, ...o });
/** Each record as "id: where", with "live", "gone" and when for those gone. */
const said = (m: ReadonlyMap<string, Where>): string[] =>
  [...m.values()].map(
    (w) =>
      `${w.id}: ${w.at}${w.state === "live" ? " live" : ""}${w.state !== "gone" ? "" : ` gone ${w.seen === null ? "just now" : `${(NOW - w.seen) / MIN} min`}${w.stays ? "" : " not staying"}`}`,
  );

describe("where everybody is", () => {
  test("one record each, by id, never the member: the room first, then Leaf's list of who is here, then those gone", () => {
    const m = all({
      room: room("Birch"),
      present: [listed(ME, "town"), listed("Birch", "works"), listed("Quill", "works")],
      resting: [listed("Quill", "town", NOW - 5 * MIN), listed("Fern", "table", NOW - 40 * MIN)],
      gone: [listed("Fern", "town", NOW - 50 * MIN), listed("Oak", "camp", NOW - MIN)],
    });
    expect(said(m)).toEqual([
      // In the room: in town, whatever Leaf's list said a moment ago.
      "Birch: town live",
      "Quill: works",
      "Oak: camp gone 1 min not staying",
      "Fern: table gone 40 min",
    ]);
  });

  test("somebody Leaf last saw 90 seconds ago or more is gone from then, as Leaf's visits have it", () => {
    const m = all({
      room: room(),
      present: [listed("Quill", "works", NOW - 90_000), listed("Moss", "table", NOW - 89_999)],
    });
    expect(said(m)).toEqual(["Moss: table", "Quill: works gone 1.5 min"]);
  });

  test("Leaf saying the town of somebody not in the room with the page: they have only just left it", () => {
    const m = all({ room: room(), present: [listed("Glac", "town")] });
    expect(said(m)).toEqual(["Glac: town gone just now"]);
  });

  test("out of the room, whoever Leaf has in town is in town, though not drawn live", () => {
    expect(said(all({ room: null, present: [listed("Glac", "town"), listed("Grim", "grove")] }))).toEqual([
      "Glac: town",
      "Grim: grove",
    ]);
  });

  test("a rank the lists do not say is taken from what the page has learnt", () => {
    const m = all({ present: [listed("Quill", "works")], ranks: new Map([["Quill", "Chief"]]) });
    expect(m.get("Quill")?.rank).toBe("Chief");
  });
});

describe("how many are at each camp", () => {
  test("everybody in the game at it, the owner and visitors alike; nobody gone, and nobody at a camp Leaf does not name", () => {
    const m = all({
      room: room("Birch"),
      // Quill, whom Leaf last saw there two minutes ago, has gone.
      present: [
        camping("Oak", "Oak"),
        camping("Vale", "Oak"),
        camping("Ash", null),
        camping("Wren", ME),
        camping("Quill", "Oak", NOW - 2 * MIN),
      ],
      resting: [camping("Fern", "Oak", NOW - 5 * MIN)],
      gone: [camping("Rowan", "Oak", NOW - MIN)],
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
  test("standing at the Works, the stump or the Grove: in the game there, not live, at most so many", () => {
    const m = all({
      room: room("Birch"),
      present: [
        listed("Birch", "works"),
        listed("Camp", "camp"),
        listed("Grim", "grove"),
        ...Array.from({ length: 14 }, (_, i) => listed(`n${String(i).padStart(2, "0")}`, "table")),
      ],
    });
    const s = standing(m, 12);
    expect(s.map((w) => `${w.id}@${w.at}`).slice(0, 3)).toEqual(["Grim@grove", "n00@table", "n01@table"]);
    expect(s.length).toBe(12);
  });

  test("dozing or leaving: gone, when Leaf says, not from their camp, newest first, staying as Leaf last said", () => {
    const m = all({
      room: room(),
      present: [listed("Glac", "town"), listed("Quill", "works", NOW - 2 * MIN)],
      resting: [listed("Fern", "town", NOW - 180 * MIN), listed("Moss", "table", NOW - 3 * MIN)],
      gone: [listed("Oak", "camp", NOW - MIN), listed("Wren", "grove", NOW - 4 * MIN)],
    });
    expect(resters(m, 12).map((w) => `${w.id}@${w.at}${w.stays ? "" : " (goes)"}`)).toEqual([
      // Glac has only just left: not until Leaf says when.
      "Quill@works",
      "Moss@table",
      "Wren@grove (goes)",
      "Fern@town",
    ]);
    expect(resters(m, 2).length).toBe(2);
  });
});
