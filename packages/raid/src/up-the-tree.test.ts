/**
 * Up The Tree outside the fight: nothing of it reaches a stall, a first pick, a regular, a carousel,
 * a pull, the exchange or the almanac before 5 January, 00:00 UTC, and all of it does at that moment;
 * Leetanns is everyone's for its banner's two weeks and no longer; and Crafter's component every third
 * fight on the board.
 */
import { describe, expect, test } from "bun:test";

import { planRoom, SENSIBLE } from "./bot.ts";
import { BANNERS, GROVE } from "./content/banners.ts";
import { available, catalogAt, type Purpose, type Roster } from "./content/catalog.ts";
import { type FigureId, specOf, type Stars, type TIERS } from "./content/figures.ts";
import { eraAt, eraOf } from "./content/releases.ts";
import { resolveFight } from "./fight/engine.ts";
import { ROOM_HOOKS } from "./fight/hooks.ts";
import type { FightSetup } from "./fight/types.ts";
import { arrange } from "./formation.ts";
import { COLS, standRow } from "./hex.ts";
import type { Piece } from "./piece.ts";
import { rackSize } from "./racks.ts";
import { type Fought, newPiece, startRun } from "./run.ts";
import { at as seated, partyOfFigures } from "./testkit.ts";

const OPENS = Date.UTC(2027, 0, 5);
const CLOSES = Date.UTC(2027, 0, 19);
/** Everyone's figures Up The Tree brings, and its headliner. */
const EVERYONES: readonly FigureId[] = ["vi", "flop", "bhlue", "ace", "unc"];
const ALL: Roster = Object.fromEntries([...EVERYONES, "leetanns"].map((id) => [id, 0]));

describe("Up The Tree opens on Leaf's clock", () => {
  const TIER_LIST = [1, 2, 3, 4, 5] as const;
  const PURPOSES: readonly (readonly [string, Purpose, readonly FigureId[]])[] = [
    ...TIER_LIST.map(
      (tier) => [`the stall at ${tier}`, { for: "stall", figures: { pool: "fair" }, tier }, EVERYONES] as const,
    ),
    ...TIER_LIST.map(
      (tier) =>
        [
          `the own stall at ${tier}`,
          { for: "stall", figures: { pool: "own", roster: ALL }, tier },
          [...EVERYONES, "leetanns"],
        ] as const,
    ),
    ["the first pick", { for: "starter" }, ["vi"]],
    ["a regular", { for: "regular" }, EVERYONES],
    ...TIER_LIST.map((tier) => [`the carousel at ${tier}`, { for: "carousel", tier }, EVERYONES] as const),
    ...(["Leafkin", "Sapling", "Sprite", "Dryad", "Treant"] as const).map(
      (rarity) => [`the grove's ${rarity}`, { for: "pull", pool: GROVE, rarity }, EVERYONES] as const,
    ),
    ...(["Leafkin", "Sapling", "Sprite", "Dryad", "Treant", "Yggdrasil"] as const).map(
      (rarity) =>
        [`Up The Tree's ${rarity}`, { for: "pull", pool: "up-the-tree", rarity }, [...EVERYONES, "leetanns"]] as const,
    ),
    ["the almanac", { for: "almanac", roster: {} }, EVERYONES],
    ["the almanac, Leetanns pulled", { for: "almanac", roster: ALL }, [...EVERYONES, "leetanns"]],
  ];
  test.each(PURPOSES.map(([name, purpose, among]) => [name, purpose, among] as const))(
    "%s: none of it a millisecond before, and what suits it at the moment",
    (_name, purpose, among) => {
      const [before, at] = [catalogAt(eraAt(OPENS - 1)), catalogAt(eraAt(OPENS))];
      expect(available(before, purpose).filter((id) => among.includes(id))).toEqual([]);
      expect(available(at, purpose).filter((id) => among.includes(id)).length).toBeGreaterThan(0);
    },
  );
  test("each figure where it belongs at the moment: its cost, its rarity, and Leetanns on everyone's stall", () => {
    const at = catalogAt(eraAt(OPENS));
    const sold = (tier: (typeof TIERS)[number]) => available(at, { for: "stall", figures: { pool: "fair" }, tier });
    expect(TIER_LIST.map((tier) => sold(tier).filter((id) => EVERYONES.includes(id) || id === "leetanns"))).toEqual([
      ["vi"],
      ["flop"],
      ["bhlue"],
      ["ace"],
      ["unc", "leetanns"],
    ]);
    expect(available(at, { for: "pull", pool: "up-the-tree", rarity: "Yggdrasil" })).toEqual(["leetanns"]);
    expect(available(at, { for: "regular" })).toContain("leetanns");
    expect(BANNERS.find((b) => b.id === "up-the-tree")).toMatchObject({ from: OPENS, until: CLOSES, look: "set" });
  });
  test("the exchange has nothing of it a millisecond before, and what it has at the moment it has after", () => {
    const [before, at] = [catalogAt(eraAt(OPENS - 1)), catalogAt(eraAt(OPENS))];
    const of = (cat: typeof at) => available(cat, { for: "exchange" }).filter((id) => EVERYONES.includes(id));
    expect(of(before)).toEqual([]);
    expect(of(catalogAt(eraAt(CLOSES)))).toEqual(of(at));
  });
});

const five: Purpose = { for: "stall", figures: { pool: "fair" }, tier: 5 };
/** Whether Leetanns is on everyone's five-acorn stall at a moment of Leaf's clock. */
const has = (t: number): boolean => available(catalogAt(eraAt(t)), five).includes("leetanns");

describe("Leetanns is everyone's for its banner's two weeks", () => {
  test("not a millisecond before 5 January, from it, and not from 19 January; whoever pulled it keeps it", () => {
    expect([has(OPENS - 1), has(OPENS), has(CLOSES - 1), has(CLOSES)]).toEqual([false, true, true, false]);
    const own: Purpose = { for: "stall", figures: { pool: "own", roster: { leetanns: 1 } }, tier: 5 };
    expect(available(catalogAt(eraAt(CLOSES)), own)).toContain("leetanns");
  });
  test("the release that closes it brings nothing", () => {
    const [open, closed] = [catalogAt(eraOf("up-the-tree")), catalogAt(eraOf("up-the-tree-ends"))];
    expect(closed.order).toEqual(open.order);
    expect([closed.traits, closed.items, closed.boons]).toEqual([open.traits, open.items, open.boons]);
  });
});

/** A run in Up The Tree's era with Leetanns on the board, and a figure on the bench. */
function crafting(): ReturnType<typeof startRun> {
  const run = startRun(3, { era: eraOf("up-the-tree") });
  run.board = run.board.map(() => null);
  run.board[0] = newPiece(run, "leetanns");
  run.bench[0] = newPiece(run, "leetanns");
  return run;
}

describe("Crafter", () => {
  /** A fight the hook is handed; Crafter counts the board, whatever the fight was. */
  const setup: FightSetup = {
    seed: 1,
    era: eraOf("up-the-tree"),
    sides: [partyOfFigures([seated("leetanns", 3, 0)]), partyOfFigures([seated("mud", 3, 0)])],
  };
  const fought: Fought = { setup, outcome: resolveFight(setup) };
  test("every third fight on the board, a component to the rack; the bench counts none", () => {
    const run = crafting();
    const crafter = ROOM_HOOKS.crafter;
    if (!crafter) throw new Error("no Crafter");
    const had = rackSize(run.rack);
    const notes = [1, 2, 3, 4, 5, 6].map(() => crafter(run, fought, 1, catalogAt(eraOf("up-the-tree"))));
    expect(notes.map((n) => n.length)).toEqual([0, 0, 1, 0, 0, 1]);
    expect(rackSize(run.rack)).toBe(had + 2);
    expect(notes[2]?.[0]).toMatchObject({ t: "items", why: "crafter" });
    expect([run.board[0]?.fights, run.bench[0]?.fights]).toEqual([6, 0]);
  });
  test("a component from the run's own stream: the same run crafts the same", () => {
    const [a, b] = [crafting(), crafting()];
    for (const run of [a, b])
      for (let i = 0; i < 3; i++) ROOM_HOOKS.crafter?.(run, fought, 1, catalogAt(eraOf("up-the-tree")));
    expect(a.rack).toEqual(b.rack);
  });
});

/** What the bot fields at level 3 in Up The Tree's era with nothing to spend, holding these (the board's, then the bench's). */
function fields(board: readonly [FigureId, Stars][], bench: readonly [FigureId, Stars][]): FigureId[] {
  const run = startRun(3, { era: eraOf("up-the-tree") });
  run.level = 3;
  run.acorns = 0;
  run.stall = run.stall.map(() => null);
  const put = (on: (Piece | null)[], held: typeof board): void => {
    on.fill(null);
    held.forEach(([kind, stars], i) => {
      const p = newPiece(run, kind);
      p.stars = stars;
      on[i] = p;
    });
  };
  put(run.board, board);
  put(run.bench, bench);
  planRoom(run, SENSIBLE);
  return run.board.flatMap((p) => (p ? [p.kind] : []));
}

describe("the bot", () => {
  test("fields an owned Leetanns every fight, for Crafter, over figures worth more", () => {
    const fielded = fields(
      [
        ["crab40", 2],
        ["flurry", 2],
        ["heron", 2],
      ],
      [["leetanns", 1]],
    );
    expect(fielded).toContain("leetanns");
  });
  test("counts Canopy as worth having only with two that stay on the board in front", () => {
    const canopy: FigureId[] = ["vi", "flop", "bhlue"];
    const fielded = fields(
      canopy.map((kind) => [kind, 1]),
      [
        ["chickaree", 1],
        ["lanterngnome", 1],
      ],
    );
    expect(fielded.filter((kind) => canopy.includes(kind)).length).toBeLessThan(3);
  });

  test("seats Bhlue in the row with the most friends it still reaches from, and stays put with none better", () => {
    const cat = catalogAt(eraOf("up-the-tree"));
    const seat = (party: FigureId[]): number[] =>
      arrange(
        cat,
        party.map((kind) => ({ kind, health: specOf(cat, kind).hp })),
        false,
      );
    // Three up front, nobody in the second row: Bhlue (reach 2) joins the front.
    const front: FigureId[] = ["bhlue", "rock", "crab40", "flop"];
    expect(Math.floor((seat(front)[0] ?? -1) / COLS)).toBe(0);
    // However the rest sit, no row it reaches from has more friends than the one it is in.
    for (const party of [
      front,
      ["bhlue", "finch", "heron", "rock"],
      ["bhlue", "crab12", "crab23", "kettle", "rock"],
    ] as FigureId[][]) {
      const seats = seat(party);
      const rowOf = (n: number): number => Math.floor((seats[n] ?? -1) / COLS);
      const friends = (row: number): number => party.filter((_, n) => n > 0 && rowOf(n) === row).length;
      const reach = standRow(specOf(cat, "bhlue").range);
      for (let row = 0; row <= reach; row++) expect(friends(row)).toBeLessThanOrEqual(friends(rowOf(0)));
    }
  });
});
