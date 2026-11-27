/**
 * Groot Night outside the fight: nothing of it reaches a stall, a first pick, a regular, a carousel,
 * a pull, the exchange or the almanac before 8 December, 00:00 UTC, and all of it does at that
 * moment; and what the bot and the regulars learn of it.
 */
import { describe, expect, test } from "bun:test";

import { planRoom, SENSIBLE } from "./bot.ts";
import { BANNERS, GROVE } from "./content/banners.ts";
import { available, type Catalog, catalogAt, type Purpose, type Roster } from "./content/catalog.ts";
import { type FigureId, specOf, type TIERS } from "./content/figures.ts";
import { eraAt, eraOf } from "./content/releases.ts";
import { arrange } from "./formation.ts";
import { besideOf } from "./hex.ts";
import { choose, newPiece, startRun } from "./run.ts";
import { sparParty } from "./spar.ts";

const OPENS = Date.UTC(2026, 11, 8);
const NIGHT = eraOf("groot-night");
const GN: Catalog = catalogAt(NIGHT);
/** Everyone's figures Groot Night brings, and its headliner. */
const EVERYONES: readonly FigureId[] = ["peep", "crab31", "munch", "clutch", "crab8"];
const ALL: Roster = Object.fromEntries([...EVERYONES, "commodore"].map((id) => [id, 0]));

describe("Groot Night opens on Leaf's clock", () => {
  /** The costs it brings a figure at: all but two acorns. */
  const BROUGHT = [1, 3, 4, 5] as const;
  const PURPOSES: readonly (readonly [string, Purpose, readonly FigureId[]])[] = [
    ...BROUGHT.map(
      (tier) => [`the stall at ${tier}`, { for: "stall", figures: { pool: "fair" }, tier }, EVERYONES] as const,
    ),
    ...BROUGHT.map(
      (tier) =>
        [
          `the own stall at ${tier}`,
          { for: "stall", figures: { pool: "own", roster: ALL }, tier },
          [...EVERYONES, "commodore"],
        ] as const,
    ),
    ["the first pick", { for: "starter" }, ["peep"]],
    ["a regular", { for: "regular" }, EVERYONES],
    ...BROUGHT.map((tier) => [`the carousel at ${tier}`, { for: "carousel", tier }, EVERYONES] as const),
    ...(["Leafkin", "Sprite", "Druid", "Treant"] as const).map(
      (rarity) => [`the grove's ${rarity}`, { for: "pull", pool: GROVE, rarity }, EVERYONES] as const,
    ),
    ...(["Leafkin", "Sprite", "Druid", "Treant", "Yggdrasil"] as const).map(
      (rarity) =>
        [`Groot Night's ${rarity}`, { for: "pull", pool: "groot-night", rarity }, [...EVERYONES, "commodore"]] as const,
    ),
    ["the exchange", { for: "exchange" }, EVERYONES],
    ["the almanac", { for: "almanac", roster: {} }, EVERYONES],
    ["the almanac, the Commodore pulled", { for: "almanac", roster: ALL }, [...EVERYONES, "commodore"]],
  ];
  test.each(PURPOSES.map(([name, purpose, among]) => [name, purpose, among] as const))(
    "%s: none of it a millisecond before, and what suits it at the moment",
    (_name, purpose, among) => {
      const [before, at] = [catalogAt(eraAt(OPENS - 1)), catalogAt(eraAt(OPENS))];
      expect(available(before, purpose).filter((id) => among.includes(id))).toEqual([]);
      expect(available(at, purpose).filter((id) => among.includes(id)).length).toBeGreaterThan(0);
    },
  );
  test("each figure where it belongs at the moment: its cost, its rarity, the exchange for a Druid", () => {
    const at = catalogAt(eraAt(OPENS));
    const sold = (tier: (typeof TIERS)[number]) => available(at, { for: "stall", figures: { pool: "fair" }, tier });
    expect([sold(1), sold(3), sold(4), sold(5)].map((list) => list.filter((id) => EVERYONES.includes(id)))).toEqual([
      ["peep"],
      ["crab31", "munch"],
      ["clutch"],
      ["crab8"],
    ]);
    expect(available(at, { for: "exchange" }).filter((id) => EVERYONES.includes(id))).toEqual(["clutch"]);
    expect(available(at, { for: "pull", pool: "groot-night", rarity: "Yggdrasil" })).toEqual(["commodore"]);
    // While the banner is open the Commodore is on everyone's stall in gaz's place, and a regular.
    expect(sold(5).filter((id) => id === "commodore" || id === "banner-1")).toEqual(["commodore"]);
    expect(available(at, { for: "regular" })).toContain("commodore");
    expect(BANNERS.find((b) => b.id === "groot-night")).toMatchObject({ from: OPENS, until: Date.UTC(2026, 11, 22) });
  });
});

describe("the bot", () => {
  test("seats Crab #31 touching the two figures with the dearest mana bars", () => {
    const party: FigureId[] = ["crab31", "apothecary", "cindernewt", "kettle", "badger", "crab40"];
    const seats = arrange(
      GN,
      party.map((kind) => ({ kind, health: specOf(GN, kind).hp })),
      false,
    );
    const at = (kind: FigureId) => seats[party.indexOf(kind)] ?? -1;
    // The two dearest: Dose and Crab #40 (90 each) over Toast (80) and Brew (70).
    const touching = besideOf(at("crab31"));
    expect([touching.includes(at("apothecary")), touching.includes(at("crab40"))]).toEqual([true, true]);
    expect(new Set(seats).size).toBe(party.length);
  });
  test("seats the Commodore in the back row with two free seats beside him", () => {
    const party: FigureId[] = ["commodore", "peep", "finch", "heron", "moth", "lanterngnome", "chickaree", "crab12"];
    const seats = arrange(
      GN,
      party.map((kind) => ({ kind, health: specOf(GN, kind).hp })),
      false,
    );
    const seat = seats[0] ?? -1;
    expect(Math.floor(seat / 7)).toBe(3);
    expect(besideOf(seat).filter((s) => !seats.includes(s)).length).toBeGreaterThanOrEqual(2);
  });
  test("fields Crab #8 on top of its chairs, gives a Tin Whistle to the dearest mana bar, and a False Moustache never to one rooted", () => {
    // Seqwawa's bar (115) is dearer than Dose's (90): the whistle is Seqwawa's, and the moustache, which would be by worth, is not.
    const run = startRun(11, { era: NIGHT });
    expect(choose(run, 0).ok).toBe(true);
    run.board = run.board.map(() => null);
    run.bench = run.bench.map(() => null);
    Object.assign(run, { level: 3, acorns: 0, rustles: 0 });
    run.board[3] = newPiece(run, "moth");
    run.board[4] = newPiece(run, "apothecary");
    run.board[17] = newPiece(run, "seqwawa");
    run.bench[0] = newPiece(run, "crab8");
    run.rack = { choruscharm: 1, sneakcharm: 1 };
    planRoom(run, SENSIBLE);
    const on = run.board.flatMap((p) => (p ? [p] : []));
    expect(on.map((p) => p.kind).toSorted()).toEqual(["apothecary", "crab8", "moth", "seqwawa"]);
    const holder = (item: string) => on.find((p) => p.items.some((i) => i === item))?.kind;
    expect(holder("choruscharm")).toBe("seqwawa");
    expect(holder("sneakcharm")).not.toBe("seqwawa");
  });
});

test("a regular fond of Chorus brings Chorus figures, so its title says: never Choruss", () => {
  const titles = Array.from({ length: 400 }, (_, seed) => sparParty(GN, seed + 1, 6, 0).title);
  const chorus = titles.filter((title) => title.includes("Chorus"));
  expect(chorus.length).toBeGreaterThan(0);
  for (const title of chorus) expect(title).toMatch(/^brought \S+ Chorus figures$/);
  expect(titles.filter((title) => title.includes("Choruss"))).toEqual([]);
  // Before Groot Night no regular is fond of it.
  const before = Array.from({ length: 200 }, (_, seed) => sparParty(catalogAt(eraAt(OPENS - 1)), seed + 1, 6, 0).title);
  expect(before.filter((title) => /Chorus|Grooter/.test(title))).toEqual([]);
});
