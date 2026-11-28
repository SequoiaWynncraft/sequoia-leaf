/**
 * The sets: a release can take grove figures out of normal mode (`retire`) and a later one bring
 * them back (`return`). Proved with made-up lists on the real patches, a millisecond before each
 * release and at it: everyone's ways lose the retired, the pulls, the exchange and a run with the
 * member's own figures keep them, and the almanac shows the member's own apart.
 */
import { describe, expect, test } from "bun:test";

import { boardMet, keptBoard } from "../foe.ts";
import { heldOf, type Holding } from "../own.ts";
import type { Placed } from "../party.ts";
import { at as placed, partyOfFigures } from "../testkit.ts";
import { GROVE } from "./banners.ts";
import { available, type Catalog, catalogAt, catalogsOf, PATCHES, type Purpose, type Roster } from "./catalog.ts";
import type { FigureId, Stars } from "./figures.ts";
import type { Patch } from "./patch.ts";
import { type Era, eraAt, eraOf, type ReleaseId, RELEASES } from "./releases.ts";

/**
 * The made-up lists, in place of the real ones of those two releases: Groot Night retires one of the
 * base's figures at each cost it brings one at (Worm, Bud, Rock, Reed, Vesta); Penguin Month
 * retires Mosey and brings Reed back.
 */
const NIGHT: readonly FigureId[] = ["worm", "leafling", "rock", "heron", "hearthcat"];
/** Which figures each release retires and brings back. */
type Lists = Partial<
  Record<ReleaseId, { readonly retire?: readonly FigureId[]; readonly return?: readonly FigureId[] }>
>;
const LISTS: Lists = {
  "groot-night": { retire: [...NIGHT] },
  "penguin-month": { retire: ["slug"], return: ["heron"] },
};
const listed = (patches: readonly Patch[], lists: Lists): Patch[] =>
  patches.map((p) => {
    const more = lists[p.release];
    return more ? { ...p, figures: { ...p.figures, ...more } } : p;
  });
const TEST: readonly Catalog[] = catalogsOf(listed(PATCHES, LISTS));
const cat = (era: Era): Catalog => {
  const c = TEST[era - 1];
  if (!c) throw new RangeError(`no era ${era}`);
  return c;
};
/** Every era, in order. */
const ERAS: readonly Era[] = RELEASES.map((r) => eraOf(r.id));
const at = (release: ReleaseId): number => RELEASES.find((r) => r.id === release)?.at ?? 0;
/** The catalogue a millisecond before a release, and at it. */
const around = (release: ReleaseId): readonly [Catalog, Catalog] => [
  cat(eraAt(at(release) - 1)),
  cat(eraAt(at(release))),
];

/** Of a draw, the figures among `ids`. */
const among = (c: Catalog, p: Purpose, ids: readonly FigureId[]): FigureId[] =>
  available(c, p).filter((id) => ids.includes(id));
/** The stall with everyone's figures at a cost. */
const fair = (c: Catalog, tier: 2 | 4) => available(c, { for: "stall", holds: [], figures: { pool: "fair" }, tier });
/** A catalogue but its way to the ones before it, to compare. */
const strip = (c: Catalog) => ({ ...c, earlier: null });
/** A Worm a run holds, at its stars. */
const worm = (stars: Stars): { kind: FigureId; stars: Stars } => ({ kind: "worm", stars });
/** Whether the stall with everyone's figures offers a run the Worm, by what it holds. */
const offered = (c: Catalog, run: Holding): boolean =>
  available(c, { for: "stall", holds: heldOf(run), figures: { pool: "fair" }, tier: 1 }).includes("worm");
const OWN: Roster = Object.fromEntries([...NIGHT, "slug"].map((id) => [id, 2]));
/** Whether a run with the member's own figures is offered the Worm, by its roster and what it holds. */
const ones = (c: Catalog, roster: Roster, holds: readonly FigureId[] = []): boolean =>
  available(c, { for: "stall", holds, figures: { pool: "own", roster }, tier: 1 }).includes("worm");
/** The figures out of normal mode as a release opens. */
const out = (release: ReleaseId): FigureId[] => {
  const c = catalogAt(eraOf(release));
  return c.order.filter((id) => c.figures[id]?.retired).toSorted();
};
/** A board kept from a fight in a catalogue's era. */
const keptIn = (c: Catalog, figures: Placed[]) =>
  keptBoard({ era: c.era, sides: [partyOfFigures(figures), partyOfFigures([])] });
/** A board as Leaf hands it over to a run that meets it. */
const met = (data: unknown) => ({ player: "p", name: "A member", of: 1, data });
/** A Vesta's board, kept in a catalogue's era. */
const board = (c: Catalog) => met(keptIn(c, [placed("hearthcat", 3, 0)]));
const tierOf = (c: Catalog, id: FigureId) => c.figures[id]?.tier ?? 1;

describe("a release that retires", () => {
  const [before, then] = around("groot-night");
  /** Everyone's ways: each one has the retired a millisecond before, and none of them at the release. */
  const EVERYONES: readonly (readonly [string, (id: FigureId) => Purpose])[] = [
    [
      "the stall with everyone's figures",
      (id) => ({ for: "stall", holds: [], figures: { pool: "fair" }, tier: tierOf(then, id) }),
    ],
    ["a regular, a live table's seats too", () => ({ for: "regular" })],
    ["the carousel", (id) => ({ for: "carousel", tier: tierOf(then, id) })],
    ["the almanac for everyone", () => ({ for: "almanac" })],
    ["the almanac, the member's own", () => ({ for: "almanac" })],
  ];
  test.each(EVERYONES)("%s: has them a millisecond before, and none at it", (_name, purpose) => {
    for (const id of NIGHT) {
      expect([id, available(before, purpose(id)).includes(id)]).toEqual([id, true]);
      expect([id, available(then, purpose(id)).includes(id)]).toEqual([id, false]);
    }
  });
  test("the first pick: the Worm a millisecond before, and not at it", () => {
    expect([among(before, { for: "starter" }, NIGHT), among(then, { for: "starter" }, NIGHT)]).toEqual([["worm"], []]);
  });

  test("a run with the member's own figures sells what they own, at its level; the set's one-acorn figures to anyone", () => {
    for (const c of [before, then]) {
      for (const id of NIGHT) {
        expect(
          available(c, { for: "stall", holds: [], figures: { pool: "own", roster: OWN }, tier: tierOf(c, id) }),
        ).toContain(id);
      }
      expect(among(c, { for: "stall", holds: [], figures: { pool: "own", roster: {} }, tier: 4 }, NIGHT)).toEqual([]);
    }
    // The Worm, out of the set, only to whoever pulled it, or while the run holds one to star.
    expect([ones(before, {}), ones(then, {}), ones(then, OWN), ones(then, {}, ["worm"])]).toEqual([
      true,
      false,
      true,
      true,
    ]);
    // A board of them stands for a run with the member's own figures, and for none with everyone's.
    expect([
      boardMet(before, board(before)) !== null,
      boardMet(then, board(then)) !== null,
      boardMet(then, board(then), true) !== null,
    ]).toEqual([true, false, true]);
  });

  test("the pulls and the exchange keep them: the grove's, the banner's it opens, and Seeds", () => {
    for (const c of [before, then]) {
      for (const id of NIGHT) {
        const rarity = c.figures[id]?.prize ?? "Leafkin";
        expect(available(c, { for: "pull", pool: GROVE, rarity })).toContain(id);
      }
      expect(available(c, { for: "exchange" })).toContain("heron");
    }
    for (const id of NIGHT) {
      expect(
        available(then, { for: "pull", pool: "groot-night", rarity: then.figures[id]?.prize ?? "Leafkin" }),
      ).toContain(id);
    }
  });

  test("the almanac splits: the set, and the member's own retired apart, in your collection", () => {
    expect([
      among(before, { for: "collection", roster: OWN }, NIGHT),
      among(then, { for: "collection", roster: OWN }, NIGHT),
    ]).toEqual([[], [...NIGHT]]);
    expect(available(then, { for: "collection", roster: {} })).toEqual([]);
    // Each figure is in one of the two or neither, never both.
    const [set, kept] = [available(then, { for: "almanac" }), available(then, { for: "collection", roster: OWN })];
    expect(set.filter((id) => kept.includes(id))).toEqual([]);
  });

  test("its figures stay open, numbers and all: a run moved into its era keeps what it holds", () => {
    for (const id of NIGHT) {
      expect([then.figures[id]?.retired, then.figures[id]?.everyones]).toEqual([true, false]);
      const [made, real] = [then.figures[id], catalogAt(then.era).figures[id]];
      expect(made && { ...made, retired: false, everyones: true }).toEqual(
        real && { ...real, retired: false, everyones: true },
      );
    }
  });

  test("a run holding a Worm keeps being offered Worms until it sells them or takes one to three stars; a run with none never is", () => {
    /** A run across Groot Night's moment, by what it holds: one Worm on the bench, a two-star on the board, only a three-star, none. */
    const runs: readonly (readonly [string, Holding])[] = [
      ["one Worm on the bench", { board: [null], bench: [worm(1), null] }],
      ["a two-star Worm on the board", { board: [worm(2)], bench: [] }],
      ["a three-star Worm only", { board: [worm(3)], bench: [null] }],
      ["sold every Worm", { board: [null], bench: [null] }],
    ];
    expect(runs.map(([said, run]) => [said, offered(before, run), offered(then, run)])).toEqual([
      ["one Worm on the bench", true, true],
      ["a two-star Worm on the board", true, true],
      ["a three-star Worm only", true, false],
      ["sold every Worm", true, false],
    ]);
    // Holding one brings back no other, and nothing of another cost: the set's stall at one acorn, with the Worm.
    const set = available(then, { for: "stall", holds: [], figures: { pool: "fair" }, tier: 1 });
    expect(available(then, { for: "stall", holds: ["worm", "rock"], figures: { pool: "fair" }, tier: 1 })).toEqual(
      then.order.filter((id) => set.includes(id) || id === "worm"),
    );
    // Nothing else follows what a run holds: the first pick, the regulars, the carousel and the almanac.
    for (const purpose of [
      { for: "starter" },
      { for: "regular" },
      { for: "carousel", tier: 1 },
      { for: "almanac" },
    ] as const) {
      expect(available(then, purpose)).not.toContain("worm");
    }
  });
});

describe("a kept board keeps the era it was fought in", () => {
  test("a run meets only boards kept in its own era; one kept before boards said so is gaz-stall's", () => {
    const [gaz, night] = [catalogAt(eraOf("gaz-stall")), catalogAt(eraOf("groot-night"))];
    const crab = [placed("crab7", 3, 0)];
    expect(keptIn(night, crab).era).toBe(night.era);
    expect([
      boardMet(night, met(keptIn(night, crab))) !== null,
      boardMet(night, met(keptIn(gaz, crab))) !== null,
      boardMet(gaz, met(keptIn(gaz, crab))) !== null,
      boardMet(gaz, met(keptIn(night, crab))) !== null,
    ]).toEqual([true, false, true, false]);
    const before = partyOfFigures(crab);
    expect([boardMet(gaz, met(before)) !== null, boardMet(night, met(before)) !== null]).toEqual([true, false]);
  });
});

describe("a release that brings one back", () => {
  const [before, then] = around("penguin-month");
  test("Reed is back in everyone's ways and out of the collection; Mosey leaves", () => {
    expect([fair(before, 4).includes("heron"), fair(then, 4).includes("heron")]).toEqual([false, true]);
    expect([fair(before, 2).includes("slug"), fair(then, 2).includes("slug")]).toEqual([true, false]);
    expect([
      available(before, { for: "regular" }).includes("heron"),
      available(then, { for: "regular" }).includes("heron"),
    ]).toEqual([false, true]);
    expect(available(then, { for: "collection", roster: OWN })).toEqual([
      "worm",
      "slug",
      "leafling",
      "rock",
      "hearthcat",
    ]);
    expect(available(then, { for: "almanac" })).toContain("heron");
    // Those Groot Night retired and nobody brought back stay out.
    expect(among(then, { for: "regular" }, NIGHT)).toEqual(["heron"]);
  });
});

describe("the lists", () => {
  test("change nothing before the first release that has one", () => {
    for (const n of ERAS.filter((e) => e < eraOf("groot-night"))) expect(strip(cat(n))).toEqual(strip(catalogAt(n)));
    // After it, only who is everyone's moves, and only for figures on a list, made-up or real.
    const LISTED = new Set<FigureId>([
      ...NIGHT,
      "slug",
      ...PATCHES.flatMap((p) => [...(p.figures?.retire ?? []), ...(p.figures?.return ?? [])]),
    ]);
    for (const n of ERAS.filter((e) => e >= eraOf("groot-night"))) {
      const [made, real] = [cat(n), catalogAt(n)];
      const moved = made.order.filter((id) => made.figures[id]?.everyones !== real.figures[id]?.everyones);
      expect(moved.every((id) => LISTED.has(id))).toBe(true);
      expect(made.order).toEqual(real.order);
    }
  });

  test("the content retires RAID-SETS.md's lists: nobody before Groot Night, then five a release", () => {
    const night: FigureId[] = ["emberkit", "cindernewt", "bushgnome", "heron", "hearthcat"];
    const penguins: FigureId[] = [...night, "barrowgnome", "glorp", "drizzlefrog", "fogowl", "apothecary"];
    const tree: FigureId[] = [...penguins, "peep", "kettle", "munch", "clutch", "whitefox"];
    expect(RELEASES.map((r) => [r.id, out(r.id)])).toEqual([
      ["base", []],
      ["groot", []],
      ["gaz-stall", []],
      ["groot-night", night.toSorted()],
      ["penguin-month", penguins.toSorted()],
      ["up-the-tree", tree.toSorted()],
      ["up-the-tree-ends", tree.toSorted()],
    ]);
  });

  const WRONG: readonly (readonly [string, Lists, string])[] = [
    ["retiring a figure the release brings", { "groot-night": { retire: ["peep"] } }, "not out before it"],
    ["retiring a headliner", { "groot-night": { retire: ["banner-1"] } }, "a headliner"],
    [
      "retiring one retired already",
      { "groot-night": { retire: ["worm"] }, "penguin-month": { retire: ["worm"] } },
      "retired already",
    ],
    ["retiring one twice in a release", { "groot-night": { retire: ["worm", "worm"] } }, "retired already"],
    ["one not retired, brought back", { "penguin-month": { return: ["worm"] } }, "not retired"],
    [
      "one brought back twice",
      { "groot-night": { retire: ["worm"] }, "penguin-month": { retire: ["slug"], return: ["worm", "worm"] } },
      "twice",
    ],
  ];
  test.each(WRONG)("%s stops the catalogue being made", (_name, lists, says) => {
    expect(() => catalogsOf(listed(PATCHES, lists))).toThrow(says);
  });
});
