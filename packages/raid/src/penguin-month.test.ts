/**
 * Penguin Month outside the fight: nothing of it reaches a stall, a first pick, a regular, a
 * carousel, a pull, the exchange or the almanac before 22 December, 00:00 UTC, and all of it does at
 * that moment; the Carving Knife turns up only in the second pick after a boss is beaten; and what
 * the bot learns of it: Huddle seated touching, the Knife used.
 */
import { describe, expect, test } from "bun:test";

import { planRoom, SENSIBLE } from "./bot.ts";
import { BANNERS, GROVE } from "./content/banners.ts";
import { available, type Catalog, catalogAt, type Purpose, type Roster } from "./content/catalog.ts";
import { type FigureId, specOf, type TIERS } from "./content/figures.ts";
import { drawnComponents } from "./content/items.ts";
import { eraAt, eraOf } from "./content/releases.ts";
import { ROOMS } from "./content/rooms.ts";
import { arrange } from "./formation.ts";
import { besideOf, groupsTouching, seatCell } from "./hex.ts";
import { rackOf } from "./racks.ts";
import { roomPicks } from "./rewards.ts";
import { roomOf } from "./room.ts";
import { choose, newPiece, startRun } from "./run.ts";
import { ringItems } from "./sitting/sitting.ts";

const OPENS = Date.UTC(2026, 11, 22);
const PENGUINS = eraOf("penguin-month");
const PM: Catalog = catalogAt(PENGUINS);
/** Everyone's figures Penguin Month brings, and its headliner. */
const EVERYONES: readonly FigureId[] = ["dibs", "jet", "larp", "flurry", "pomp"];
const ALL: Roster = Object.fromEntries([...EVERYONES, "yule"].map((id) => [id, 0]));

describe("Penguin Month opens on Leaf's clock", () => {
  const TIER = [1, 2, 3, 4] as const;
  const PURPOSES: readonly (readonly [string, Purpose, readonly FigureId[]])[] = [
    ...TIER.map(
      (tier) => [`the stall at ${tier}`, { for: "stall", figures: { pool: "fair" }, tier }, EVERYONES] as const,
    ),
    [`the stall at 5`, { for: "stall", figures: { pool: "fair" }, tier: 5 }, ["yule"]],
    ...TIER.map(
      (tier) =>
        [`the own stall at ${tier}`, { for: "stall", figures: { pool: "own", roster: ALL }, tier }, EVERYONES] as const,
    ),
    ["the first pick", { for: "starter" }, ["dibs"]],
    ["a regular", { for: "regular" }, [...EVERYONES, "yule"]],
    ...TIER.map((tier) => [`the carousel at ${tier}`, { for: "carousel", tier }, EVERYONES] as const),
    ...(["Leafkin", "Sapling", "Sprite", "Dryad", "Druid"] as const).map(
      (rarity) => [`the grove's ${rarity}`, { for: "pull", pool: GROVE, rarity }, EVERYONES] as const,
    ),
    ...(["Leafkin", "Sapling", "Sprite", "Dryad", "Druid", "Yggdrasil"] as const).map(
      (rarity) =>
        [`Penguin Month's ${rarity}`, { for: "pull", pool: "penguin-month", rarity }, [...EVERYONES, "yule"]] as const,
    ),
    ["the exchange", { for: "exchange" }, EVERYONES],
    ["the almanac", { for: "almanac", roster: {} }, [...EVERYONES, "yule"]],
  ];
  test.each(PURPOSES.map(([name, purpose, among]) => [name, purpose, among] as const))(
    "%s: none of it a millisecond before, and what suits it at the moment",
    (_name, purpose, among) => {
      const [before, at] = [catalogAt(eraAt(OPENS - 1)), catalogAt(eraAt(OPENS))];
      expect(available(before, purpose).filter((id) => among.includes(id))).toEqual([]);
      expect(available(at, purpose).filter((id) => among.includes(id)).length).toBeGreaterThan(0);
    },
  );
  test("each figure where it belongs at the moment: its cost, its rarity, and Yule on everyone's stall in the Commodore's place", () => {
    const at = catalogAt(eraAt(OPENS));
    const sold = (tier: (typeof TIERS)[number]) => available(at, { for: "stall", figures: { pool: "fair" }, tier });
    expect([sold(1), sold(2), sold(3), sold(4)].map((list) => list.filter((id) => EVERYONES.includes(id)))).toEqual([
      ["dibs"],
      ["jet"],
      ["larp"],
      ["flurry", "pomp"],
    ]);
    expect(sold(5).filter((id) => ["yule", "commodore", "banner-1"].includes(id))).toEqual(["yule"]);
    expect(available(at, { for: "pull", pool: "penguin-month", rarity: "Yggdrasil" })).toEqual(["yule"]);
    expect(BANNERS.find((b) => b.id === "penguin-month")).toMatchObject({ from: OPENS, until: Date.UTC(2027, 0, 5) });
  });
  test("the Knife and the Huddle charm a millisecond before nowhere, and at the moment in the catalogue", () => {
    const [before, at] = [catalogAt(eraAt(OPENS - 1)), catalogAt(eraAt(OPENS))];
    expect([before.ids.components.includes("knife"), at.ids.components.includes("knife")]).toEqual([false, true]);
    expect([before.ids.boons.includes("huddlecharm"), at.ids.boons.includes("huddlecharm")]).toEqual([false, true]);
    expect([before.ids.traits.includes("huddle"), at.ids.traits.includes("huddle")]).toEqual([false, true]);
  });
});

describe("the Carving Knife", () => {
  const BOSS = ROOMS.findIndex((r) => r.kind === "boss");
  const TROUBLE = ROOMS.findIndex((r) => r.kind === "trouble");
  test("is one of the three of the second pick after a boss is beaten, and of no other pick", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const run = startRun(seed, { era: PENGUINS });
      const won = roomPicks(run, roomOf(run, BOSS), true);
      expect(won.map((p) => p.options.filter((o) => o === "knife").length)).toEqual([0, 1]);
      expect(won[1]?.options.length).toBe(3);
      for (const picks of [roomPicks(run, roomOf(run, BOSS), false), roomPicks(run, roomOf(run, TROUBLE), true)])
        expect(picks.flatMap((p) => p.options).includes("knife")).toBe(false);
    }
    // Before its release a boss leaves no Knife.
    const before = startRun(1, { era: eraAt(OPENS - 1) });
    expect(roomPicks(before, roomOf(before, BOSS), true).flatMap((p) => p.options)).not.toContain("knife");
  });
  test("is in no basket, no carousel ring, and no ordinary draw", () => {
    expect(drawnComponents(PM)).not.toContain("knife");
    expect(ringItems(PM)).not.toContain("knife");
  });
});

describe("the bot", () => {
  test("seats Huddle figures touching, round the frontmost of them, Jet in the group rather than a corner", () => {
    const party: FigureId[] = ["dibs", "jet", "flurry", "yule", "finch", "badger"];
    const seats = arrange(
      PM,
      party.map((kind) => ({ kind, health: specOf(PM, kind).hp })),
      true,
    );
    const huddle = (["dibs", "jet", "flurry", "yule"] as const).map((k) => seats[party.indexOf(k)] ?? -1);
    expect(groupsTouching(huddle.map((s) => seatCell(0, s)))).toEqual([[0, 1, 2, 3]]);
    // Dibs, a Bulwark, in the middle of the front row.
    expect(seats[0]).toBe(3);
    expect(new Set(seats).size).toBe(party.length);
    // Larp counts too, by its Huddle.
    const withLarp = arrange(
      PM,
      (["dibs", "larp"] as const).map((kind) => ({ kind, health: specOf(PM, kind).hp })),
      false,
    );
    expect(besideOf(withLarp[0] ?? -1)).toContain(withLarp[1] ?? -2);
  });
  test("makes An Extra Chair of two Knives, and a class emblem where it puts a step on", () => {
    const run = startRun(11, { era: PENGUINS });
    expect(choose(run, 0).ok).toBe(true);
    run.board = run.board.map(() => null);
    run.bench = run.bench.map(() => null);
    Object.assign(run, { level: 3, acorns: 0, rustles: 0 });
    run.board[3] = newPiece(run, "crab40");
    run.board[4] = newPiece(run, "dibs");
    run.board[17] = newPiece(run, "moth");
    run.rack = rackOf(["knife", "knife"]);
    planRoom(run, SENSIBLE);
    expect(run.boons).toContain("extrachair");
    // One Knife and a Bark, with Bulwark one short of its step: a Wooden Buckler on the worthiest who is no Bulwark.
    const second = startRun(11, { era: PENGUINS });
    expect(choose(second, 0).ok).toBe(true);
    second.board = second.board.map(() => null);
    second.bench = second.bench.map(() => null);
    Object.assign(second, { level: 3, acorns: 0, rustles: 0 });
    second.board[3] = newPiece(second, "crab40");
    second.board[4] = newPiece(second, "worm");
    second.board[17] = newPiece(second, "moth");
    second.boons = ["extrachair"];
    second.rack = rackOf(["knife", "bark"]);
    planRoom(second, SENSIBLE);
    const holder = second.board.find((p) => p?.items.includes("woodenbuckler"));
    expect(holder?.kind).toBeDefined();
    expect(holder?.kind).not.toBe("crab40");
  });
});
