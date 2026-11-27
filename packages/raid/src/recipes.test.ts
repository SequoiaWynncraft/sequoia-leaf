/**
 * Items and chairs. `combine` is the only maker, so every recipe gives the same thing on the rack,
 * on a holder and through a merge, and a recipe may make a boon (An Extra Chair). An emblem grants
 * any trait, an origin or a class, and the trait it grants counts and fights. A figure that takes
 * no chair (a Stowaway) is fielded on a full board, as the member's own party and as a board met,
 * and a second copy of it takes one.
 *
 * Nothing open today grants a class, takes no chair or makes a boon, so the made-up release here (on
 * Penguin Month's day, which has no patch yet) is the test's own: the Jar Of Fog grants Sneak, Crab
 * #12 takes no chair, and Bark and Bark make An Extra Chair (the base without the Stump Shield, whose
 * recipe that was).
 */
import { describe, expect, test } from "bun:test";

import { chairsOn, overfills } from "./chairs.ts";
import { boonNumber } from "./content/boons.ts";
import { type Catalog, catalogsOf } from "./content/catalog.ts";
import { type FigureId, traitsOf } from "./content/figures.ts";
import { carriedTraits, type ItemId, type ItemSpec } from "./content/items.ts";
import type { Patch } from "./content/patch.ts";
import { combine, holdItem } from "./content/recipes.ts";
import { eraOf, LEGACY_ERA } from "./content/releases.ts";
import { BASE } from "./content/releases/base.ts";
import { GROOT } from "./content/releases/groot.ts";
import { MAX_LEVEL } from "./content/rooms.ts";
import { drawOf } from "./fight/core.ts";
import { openFight } from "./fight/engine.ts";
import { boardMet } from "./foe.ts";
import { takeMade } from "./made.ts";
import { chairsUsed, countTraits, type Party, type Placed } from "./party.ts";
import { forgeItems } from "./rack.ts";
import { rackOf } from "./racks.ts";
import { beginFight, buy, choose, fieldCap, fielded, giveItem, move, type Piece, type Run, startRun } from "./run.ts";
import { at, CAT, partyOfFigures } from "./testkit.ts";

/** The base's items without the Stump Shield, so that Bark and Bark are free for a boon. */
const NO_STUMP: Partial<Record<ItemId, ItemSpec>> = Object.fromEntries(
  Object.entries(BASE.items?.add ?? {}).filter(([id]) => id !== "stump"),
);
const MADE_UP: Patch = {
  release: "penguin-month",
  figures: { change: { crab12: { chairs: 0 } } },
  items: { change: { mistcharm: { grants: "sneak", name: "False Moustache" } } },
  boons: { change: { extrachair: { made: ["bark", "bark"] } } },
};
const ERAS = catalogsOf([{ ...BASE, items: { add: NO_STUMP } }, GROOT, MADE_UP]);
const PATCHED: Catalog = ERAS[eraOf("penguin-month") - 1] ?? CAT;

/** A run with its first figure picked, which stands in the middle of the front row. */
function started(seed = 1): Run {
  const run = startRun(seed, { era: LEGACY_ERA });
  expect(choose(run, 0).ok).toBe(true);
  return run;
}
const MIDDLE = 3;
const piece = (run: Run, kind: FigureId, items: ItemId[] = []): Piece => ({
  id: run.nextId++,
  kind,
  stars: 1,
  items,
  fed: 0,
  fights: 0,
});

describe("every recipe gives the same thing, however the two meet", () => {
  test("on the rack, on a holder and through a merge, for every pair of components", () => {
    for (const a of CAT.ids.components) {
      for (const b of CAT.ids.components) {
        const made = combine(CAT, a, b);
        if (made?.gives !== "item") throw new Error(`${a} and ${b} make no item`);
        expect(combine(CAT, b, a)).toEqual(made);

        const rack = started();
        rack.rack = rackOf([a, b]);
        expect(forgeItems(rack, a, b)).toEqual({ ok: true, notes: [{ t: "made", item: made.id }] });

        const holder = started();
        holder.rack = rackOf([a, b]);
        giveItem(holder, a, { on: "board", at: MIDDLE });
        const gave = giveItem(holder, b, { on: "board", at: MIDDLE });
        expect(gave.ok && gave.notes[0]).toMatchObject({ t: "gave", item: b, forged: made.id });

        // Three Worms: the one on the board holds one half, a copy on the bench the other, and the third is bought.
        const merged = started();
        const keeper = piece(merged, "worm", [a]);
        merged.board[MIDDLE] = keeper;
        merged.bench[0] = piece(merged, "worm", [b]);
        merged.stall[0] = "worm";
        merged.acorns = 5;
        expect(buy(merged, 0).ok).toBe(true);

        expect([rack.rack, holder.board[MIDDLE]?.items, keeper.items]).toEqual([
          { [made.id]: 1 },
          [made.id],
          [made.id],
        ]);
        const forged: ItemId[][] = [rack.seen.forged, holder.seen.forged, merged.seen.forged];
        expect(forged).toEqual([[made.id], [made.id], [made.id]]);
      }
    }
  });

  test("two that make nothing are refused on the rack, and stay where they were", () => {
    const run = started();
    run.rack = rackOf(["crabcharm", "thorn", "hoard"]);
    expect(forgeItems(run, "crabcharm", "thorn")).toMatchObject({ ok: false, code: "two_components" });
    expect(forgeItems(run, "thorn", "hoard")).toMatchObject({ ok: false, code: "two_components" });
    expect(forgeItems(run, "thorn", "thorn")).toMatchObject({ ok: false, code: "no_such_item" });
    expect(run.rack).toEqual(rackOf(["crabcharm", "thorn", "hoard"]));
  });
});

describe("a recipe that makes a boon", () => {
  test("is what combine gives, either way round, and leaves both places on a holder", () => {
    expect(combine(PATCHED, "bark", "bark")).toEqual({ gives: "boon", id: "extrachair" });
    expect(holdItem(PATCHED, { kind: "worm", items: ["hoard", "bark"] }, "bark")).toEqual({
      held: ["hoard"],
      made: { gives: "boon", id: "extrachair" },
      forged: null,
      with: "bark",
    });
    // A Bark meets the first item held that it makes anything with: here the Thorn.
    expect(holdItem(PATCHED, { kind: "worm", items: ["thorn", "bark"] }, "bark")).toMatchObject({
      held: ["hedgehog", "bark"],
    });
  });

  test("on the rack, gives the run the boon and closes both places; a second time it is refused, and nothing is used up", () => {
    const run = started();
    const chairs = fieldCap(run);
    run.rack = rackOf(["bark", "thorn", "bark"]);
    expect(forgeItems(run, "bark", "bark", PATCHED)).toEqual({ ok: true, notes: [{ t: "boon", boon: "extrachair" }] });
    expect([run.rack, run.boons, fieldCap(run)]).toEqual([{ thorn: 1 }, ["extrachair"], chairs + 1]);
    run.rack = rackOf(["bark", "bark"]);
    expect(forgeItems(run, "bark", "bark", PATCHED)).toMatchObject({ ok: false, code: "boon_held" });
    expect([run.rack, run.boons]).toEqual([{ bark: 2 }, ["extrachair"]]);
  });

  test("is given to a run once by what made it, and an item made goes in the almanac's notes", () => {
    const run = started();
    expect(takeMade(run, { gives: "boon", id: "extrachair" })).toEqual([{ t: "boon", boon: "extrachair" }]);
    expect(takeMade(run, { gives: "boon", id: "extrachair" })).toBeNull();
    expect(takeMade(run, { gives: "item", id: "hoard" })).toEqual([]);
    expect([run.boons, run.seen.forged]).toEqual([["extrachair"], ["hoard"]]);
  });
});

/** Flint, an Ember Fang: no Sneak and no Mist of its own. */
const holder: FigureId = "emberkit";
/** A Worm and Flint holding some items, against a mud. */
const sides = (items: ItemId[]): [Party, Party] => [
  partyOfFigures([at("worm", 2, 0), at(holder, 4, 0, 1, items)]),
  partyOfFigures([at("mud", 3, 0)]),
];
/** So many of Crab #12. */
const crabs = (n: number): { kind: FigureId }[] => Array.from({ length: n }, () => ({ kind: "crab12" }));
/** Another member's board of these figures, one a seat, as Leaf hands it over. */
const met = (kinds: readonly FigureId[]) => ({
  player: "10000000-0000-0000-0000-00000000ca7c",
  name: "Someone",
  of: 1,
  data: partyOfFigures(
    kinds.map((kind, seat): Placed => ({ ...at(kind, 0, 0), seat })),
    { who: "Someone", title: "their board" },
  ),
});

/** For each of the party, whether it is a Sneak in the fight (its first hits do more) and leapt as it began. */
const sneaks = (items: ItemId[]): [boolean, boolean][] => {
  const f = openFight({ seed: 7, era: PATCHED.era, sides: sides(items) }, PATCHED);
  const leapt = new Set(f.opening.flatMap((e) => (e.t === "leap" && e.why === "sneak" ? [e.id] : [])));
  return f.units.filter((u) => u.side === 0).map((u) => [u.sneakBy > 0 && u.sneakHits > 0, leapt.has(u.id)]);
};

describe("an emblem that grants a class", () => {
  test("makes its holder carry it, count for it and draw as it does, and is refused by one that is that class", () => {
    expect(traitsOf(PATCHED, holder)).not.toContain("sneak");
    expect(carriedTraits(PATCHED, holder, ["mistcharm"])).toEqual([...traitsOf(PATCHED, holder), "sneak"]);
    expect(
      countTraits(PATCHED, [
        { kind: "worm", items: [] },
        { kind: holder, items: ["mistcharm"] },
      ]).sneak,
    ).toBe(2);
    expect(drawOf(PATCHED, holder, ["mistcharm"])).toBe(drawOf(PATCHED, holder, []) - 1);
    // The Worm is a Sneak already.
    expect(holdItem(PATCHED, { kind: "worm", items: [] }, "mistcharm")).toEqual({ refused: "already_kin" });
    // In today's catalogue the same emblem makes a Mist, and nothing else.
    expect(carriedTraits(CAT, holder, ["mistcharm"])).toEqual([...traitsOf(CAT, holder), "mist"]);
  });

  test("fights: with a Worm beside it, both are Sneaks, and both leap when the fight starts", () => {
    expect(sneaks(["mistcharm"])).toEqual([
      [true, true],
      [true, true],
    ]);
    // Without the emblem one Worm is no step of Sneak, and nobody leaps.
    expect(sneaks([])).toEqual([
      [false, false],
      [false, false],
    ]);
  });
});

describe("a figure that takes no chair", () => {
  test("takes none, a second copy of it takes one, and every other figure one", () => {
    expect([0, 1, 2, 3].map((n) => chairsUsed(PATCHED, crabs(n)))).toEqual([0, 0, 1, 2]);
    expect(chairsUsed(PATCHED, [...crabs(1), { kind: "worm" }, { kind: "moth" }])).toBe(2);
    // Today every figure takes a chair.
    expect(chairsUsed(CAT, crabs(2))).toBe(2);
  });

  test("as the member's party: it is fielded on a full board, which still locks, and a second copy is not", () => {
    const run = started();
    expect([fielded(run), fieldCap(run)]).toEqual([1, 1]);
    const stowaway = piece(run, "crab12");
    const worm = piece(run, "worm");
    // A full board: nobody else sits down, but the Stowaway does.
    expect(overfills(run, worm, null, PATCHED)).toBe(true);
    expect(overfills(run, stowaway, null, PATCHED)).toBe(false);
    run.board[0] = stowaway;
    expect([fielded(run), chairsOn(run, PATCHED), chairsOn(run)]).toEqual([2, 1, 2]);
    expect(overfills(run, piece(run, "crab12"), null, PATCHED)).toBe(true);
    // Changing places with one who takes a chair takes no more; with the Stowaway, one more.
    const starter = run.board[MIDDLE] ?? worm;
    expect(overfills(run, worm, starter, PATCHED)).toBe(false);
    expect(overfills(run, worm, stowaway, PATCHED)).toBe(true);
    // Today, with the catalogue every figure takes a chair in: the move is refused, and so is the fight.
    run.board[0] = null;
    run.bench[0] = stowaway;
    expect(move(run, { on: "bench", at: 0 }, { on: "board", at: 0 })).toMatchObject({ ok: false, code: "field_full" });
    run.board[0] = stowaway;
    run.bench[0] = null;
    expect(beginFight(run)).toMatchObject({ ok: false, code: "too_many_fielded" });
    run.board[0] = null;
    expect(beginFight(run).ok).toBe(true);
  });

  test("as a board met: a board holding it may have one body more than the most chairs anyone has", () => {
    const most = MAX_LEVEL + boonNumber(CAT, "extrachair", "more");
    const full: FigureId[] = Array.from({ length: most }, () => "worm");
    expect(boardMet(PATCHED, met(full))).not.toBeNull();
    expect(boardMet(PATCHED, met([...full, "crab12"]))).not.toBeNull();
    expect(boardMet(PATCHED, met([...full, "moth"]))).toBeNull();
    expect(boardMet(PATCHED, met([...full, "crab12", "crab12"]))).toBeNull();
    // Today the crab takes a chair like anyone.
    expect(boardMet(CAT, met([...full, "crab12"]))).toBeNull();
  });
});
