/**
 * A banner's member as a figure of the raid: until `gaz-stall`, never on the main way, whatever a
 * member has pulled; from it, one of everyone's figures at five acorns, with no level. Sold,
 * levelled and merged with the member's own figures only to whoever pulled it; and its ability,
 * against its own sentence, at each era's numbers.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import type { Ctx, Met } from "@sequoia-leaf/core";

import { GOOD_WITH } from "./content/advice.ts";
import { BANNERS } from "./content/banners.ts";
import { catalogAt } from "./content/catalog.ts";
import { abilityNumber, abilityText, type FigureId, figureIn, type Stars, TIERS } from "./content/figures.ts";
import { isMemberId, MEMBERS } from "./content/members.ts";
import { eraOf, LEGACY_ERA } from "./content/releases.ts";
import { MAX_LEVEL, ROOMS, STALL_ODDS, TRAIL_COUNT } from "./content/rooms.ts";
import { HZ, summon } from "./fight/core.ts";
import type { FightEvent } from "./fight/types.ts";
import { boardMet, opposition } from "./foe.ts";
import { RAID, type Table } from "./game.ts";
import { cellAt, distance } from "./hex.ts";
import { newAlmanac } from "./outside.ts";
import { levelOf, rosterOf, stallOdds, stallPool } from "./own.ts";
import { isParty, traitStates } from "./party.ts";
import { buy, choose, giveItem, move, partyOf, picksOf, pieces, type Run, rustle, sell, startRun } from "./run.ts";
import { checkRun } from "./save.ts";
import { layCarousel } from "./sitting/carousel.ts";
import { command, openSitting } from "./sitting/commands.ts";
import { sparParty } from "./spar.ts";
import {
  CAT,
  EVERYONES,
  fightOf,
  onCell,
  only,
  partyOfFigures,
  ready,
  steps,
  stepUntil,
  still,
  unitOf,
} from "./testkit.ts";
import { onTrail } from "./way.ts";
import { readView } from "./wire.ts";

/** Every banner's headliner. */
const HEADLINERS = BANNERS.map((b) => b.headliner);

const UNIT = "banner-1";
/** What the pulls award a member who has pulled the first banner's member four times, and Greg once. */
const HAS = ["pull:headliner:banner-1", ...[2, 3, 4].map((n) => `copies:headliner:banner-1:${n}`), "pull:figure:greg"];

const ctx = (awards: readonly string[] = [], seed = 5): Ctx => ({
  now: 1_800_000_000_000,
  player: { id: "10000000-0000-0000-0000-000000000001", guest: false },
  seed,
  room: 1e9,
  awards: [...awards],
  postcards: {},
});
/** A table that has set out, by the main way or with the member's own figures, holding these awards. */
function setOut(awards: readonly string[], own: boolean): Run {
  const done = RAID.apply(RAID.create(ctx()), own ? { do: "start", trail: 0, own } : { do: "start", trail: 0 }, {
    ...ctx(awards),
  });
  const run = "refused" in done ? null : done.state.held.main;
  if (!run) throw new Error("did not set out");
  return run;
}
/** Everyone the stall offers over many rustles at the top level. */
function offered(run: Run): Map<FigureId, number> {
  expect(choose(run, 0).ok).toBe(true);
  run.level = MAX_LEVEL;
  const seen = new Map<FigureId, number>();
  for (let i = 0; i < 600; i++) {
    run.rustles = 1;
    expect(rustle(run).ok).toBe(true);
    for (const kind of run.stall) if (kind) seen.set(kind, (seen.get(kind) ?? 0) + 1);
  }
  return seen;
}
/** A board with a banner's member on it, as Leaf hands another member's over. */
const boardWith = (kind: FigureId): Met => ({
  player: "10000000-0000-0000-0000-000000000002",
  name: "Quillfeather",
  of: 1_000_000,
  data: partyOfFigures([
    { kind, stars: 2, seat: 3, items: ["stewpot"], fed: 0, level: 3 },
    { kind: "crab7", stars: 1, seat: 4, items: [], fed: 0 },
  ]),
});

describe("the twenty-eight", () => {
  test("stay twenty-nine: a banner's member is a figure, and not one of them", () => {
    expect(EVERYONES.length).toBe(29);
    expect(CAT.order).toEqual([...EVERYONES, ...HEADLINERS]);
    const stall: readonly string[] = TIERS.flatMap((tier) => stallPool({ way: onTrail(0), era: LEGACY_ERA }, tier));
    expect(stall).toEqual([...EVERYONES]);
    for (const id of HEADLINERS) {
      expect(stall).not.toContain(id);
      expect(isMemberId(id)).toBe(true);
      if (isMemberId(id)) expect(figureIn(CAT, id)).toMatchObject(MEMBERS[id]);
      expect([figureIn(CAT, id).tier, figureIn(CAT, id).extra, new Set(GOOD_WITH[id]).size]).toEqual([5, [], 3]);
    }
    expect(HEADLINERS.every(isMemberId) && !EVERYONES.some(isMemberId)).toBe(true);
  });
  test("a banner's member is nobody in particular: its name is what any guild member is", () => {
    for (const id of HEADLINERS) expect(figureIn(CAT, id).name).toBe("A guild member");
  });
});

describe("the main way before gaz-stall, whatever a member has pulled", () => {
  test("is told nothing of the roster, and its stall never offers a banner's member", () => {
    const run = setOut(HAS, false);
    expect(run.way).toEqual(onTrail(0));
    // A run kept at the era before, as Leaf has it until its next command.
    run.era = LEGACY_ERA;
    const seen = offered(run);
    expect([...seen.keys()].filter(isMemberId)).toEqual([]);
    expect(seen.size).toBe(EVERYONES.length);
    for (const tier of TIERS) expect(stallPool(run, tier).filter(isMemberId)).toEqual([]);
  });
  test("its opening pick is never a banner's member", () => {
    for (let seed = 1; seed < 200; seed++) {
      const pick = picksOf(startRun(seed, { era: LEGACY_ERA }))[0];
      expect(pick?.kind === "starter" && !pick.options.some(isMemberId)).toBe(true);
    }
  });
  test("no regular brings one to a sparring room, on any trail", () => {
    for (let trail = 0; trail < TRAIL_COUNT; trail++) {
      ROOMS.forEach((room, at) => {
        if (room.kind !== "spar") return;
        for (let seed = 1; seed <= 150; seed++) {
          expect(sparParty(CAT, seed, at, trail).figures.some((p) => isMemberId(p.kind))).toBe(false);
        }
      });
    }
  });
  test("a board holding one is not met at all: the regular waits there", () => {
    const met = boardWith(UNIT);
    expect(boardMet(CAT, met)).toBeNull();
    for (let seed = 1; seed <= 40; seed++) {
      expect(opposition(CAT, seed, 2, 0, met)).toEqual(opposition(CAT, seed, 2, 0));
    }
    // The same board without the member is met, so it is the member that keeps it out.
    expect(boardMet(CAT, boardWith("greg"))?.by).toBe(met.player);
  });
});

/** The catalogue from `gaz-stall` on, where the first banner's headliner is everyone's. */
const GAZ = catalogAt(eraOf("gaz-stall"));

describe("the main way from gaz-stall, whatever a member has pulled", () => {
  test("its stall offers a banner's member for five acorns, with no level, to members who pulled it and those who did not", () => {
    for (const awards of [HAS, []]) {
      const run = setOut(awards, false);
      run.era = GAZ.era;
      expect(run.way).toEqual(onTrail(0));
      const seen = offered(run);
      expect(seen.size).toBe(GAZ.order.length);
      expect(seen.get(UNIT)).toBeGreaterThan(0);
      run.acorns = 9;
      run.stall[0] = UNIT;
      expect(buy(run, 0).ok).toBe(true);
      expect([run.acorns, levelOf(run, UNIT)]).toEqual([4, 0]);
    }
  });
  test("a regular brings one to a sparring room, with no level", () => {
    const SEEDS = Array.from({ length: 150 }, (_, i) => i + 1);
    const brought = Array.from({ length: TRAIL_COUNT }, (_, trail) =>
      ROOMS.flatMap((room, at) =>
        room.kind !== "spar" ? [] : SEEDS.flatMap((seed) => sparParty(GAZ, seed, at, trail).figures),
      ).filter((p) => isMemberId(p.kind)),
    );
    for (const members of brought) expect(members.length).toBeGreaterThan(0);
    expect(brought.flat().some((p) => p.level !== undefined)).toBe(false);
  });
  test("a live table's carousel has one among its five-acorn figures", () => {
    const player = { id: "10000000-0000-0000-0000-000000000003", name: "A member" };
    const now = 1_800_000_000_000;
    const rings = Array.from({ length: 40 }, (_, seed) => {
      const started = command(openSitting({ now, seed, player }), { do: "start" }, { now, seed: seed + 1, player });
      if (!started.ok) throw new Error(started.why);
      layCarousel(started.sitting, now, [5, 5, 5, 5, 5, 5, 5, 5, 5], false);
      const stage = started.sitting.stage;
      return stage.at === "carousel" ? stage.ring.map((o) => o.kind) : [];
    });
    expect(rings.every((ring) => ring.length === 9)).toBe(true);
    expect(rings.filter((ring) => ring.includes(UNIT)).length).toBeGreaterThan(0);
  });
  test("a board holding one is met, without its level", () => {
    const met = boardWith(UNIT);
    const board = boardMet(GAZ, met);
    expect([board?.by, board?.figures.map((p) => [p.kind, p.level])]).toEqual([
      met.player,
      [
        [UNIT, undefined],
        ["crab7", undefined],
      ],
    ]);
  });
  test("its numbers are trimmed to sit among everyone's five-acorn figures; the era before keeps its own", () => {
    const numbers = (cat: typeof GAZ) =>
      ([1, 2, 3] as const).map((stars) => [
        abilityNumber(cat, UNIT, "stun", stars),
        abilityNumber(cat, UNIT, "damage", stars),
      ]);
    expect(numbers(CAT)).toEqual([
      [2, 550],
      [2.5, 950],
      [3.5, 2200],
    ]);
    expect(numbers(GAZ)).toEqual([
      [1.5, 370],
      [2, 640],
      [3, 1450],
    ]);
    expect([figureIn(CAT, UNIT).mana, figureIn(GAZ, UNIT).mana]).toEqual([
      [50, 80],
      [30, 90],
    ]);
    expect(abilityText(GAZ, UNIT, 1)).toBe(SENTENCE("1.5", 370));
  });
});

describe("a run with the member's own figures", () => {
  test("is offered to a member whose only pull is a banner's member", () => {
    expect(setOut(["pull:headliner:banner-1"], true).way).toEqual(onTrail(0, { [UNIT]: 0 }));
  });
  test("sells the banner's member a member has pulled, at its cost's odds with their other five-acorn figures", () => {
    const run = setOut(HAS, true);
    expect(run.way).toEqual(onTrail(0, { [UNIT]: 3, greg: 0 }));
    expect(stallPool(run, 5)).toEqual(["greg", UNIT]);
    const odds = STALL_ODDS[MAX_LEVEL - 1] ?? [0, 0, 0, 0, 0];
    const seen = offered(run);
    expect(stallOdds(run)).toEqual([odds[0], 0, 0, 0, odds[4]]);
    const total = [...seen.values()].reduce((a, b) => a + b, 0);
    const [unit, greg] = [seen.get(UNIT) ?? 0, seen.get("greg") ?? 0];
    expect((unit + greg) / total).toBeCloseTo(odds[4] / (odds[0] + odds[4]), 1);
    expect(unit / (unit + greg)).toBeCloseTo(0.5, 1);
  });
  test("does not sell it to a member who has not pulled it", () => {
    const run = setOut(["pull:figure:greg", "pull:figure:whitefox"], true);
    expect([...offered(run).keys()].filter(isMemberId)).toEqual([]);
  });
  test("its level is copies less one, 6 at most, and goes into the fight with it", () => {
    expect(rosterOf(HAS)).toEqual({ [UNIT]: 3, greg: 0 });
    const many = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) =>
      n === 1 ? "pull:headliner:banner-1" : `copies:headliner:banner-1:${n}`,
    );
    expect(rosterOf(many)).toEqual({ [UNIT]: 6 });
    // Only a banner's own prize is its member: nothing else names one.
    expect(rosterOf(["pull:figure:banner-1", "pull:headliner:greg", "copies:headliner:banner-9:2"])).toEqual({});
    const run = setOut(HAS, true);
    run.board[3] = { id: run.nextId++, kind: UNIT, stars: 1, items: [], fed: 0 };
    expect(levelOf(run, UNIT)).toBe(3);
    expect(partyOf(run).figures.find((p) => p.kind === UNIT)?.level).toBe(3);
    expect(isParty(JSON.parse(JSON.stringify(partyOf(run))))).toBe(true);
  });
  test("it is bought for five acorns, merges to two and three stars, holds items, and counts for its kin and calling", () => {
    const run = setOut(HAS, true);
    expect(choose(run, 0).ok).toBe(true);
    run.acorns = 99;
    run.level = MAX_LEVEL;
    for (let copy = 0; copy < 9; copy++) {
      run.stall[0] = UNIT;
      const before = run.acorns;
      expect(buy(run, 0).ok).toBe(true);
      expect(before - run.acorns).toBe(5);
    }
    const mine = pieces(run).filter((p) => p.kind === UNIT);
    expect(mine.map((p) => p.stars)).toEqual([3]);
    const [piece] = mine;
    if (!piece) throw new Error("no member");
    run.items.push("glowcap", "chestnut");
    expect(move(run, { on: "bench", at: run.bench.indexOf(piece) }, { on: "board", at: 8 }).ok).toBe(true);
    expect(giveItem(run, 0, { on: "board", at: 8 }).ok).toBe(true);
    expect(giveItem(run, 0, { on: "board", at: 8 }).ok).toBe(true);
    expect(piece.items).toEqual(["stewpot"]);
    const traits = traitStates(CAT, [piece]).map((t) => t.trait);
    expect(traits.toSorted()).toEqual(["feather", "sage"]);
    // With one more Sage on the board the calling switches on, the member counted.
    run.board[9] = { id: run.nextId++, kind: "moth", stars: 1, items: [], fed: 0 };
    expect(
      traitStates(
        CAT,
        run.board.flatMap((p) => (p ? [p] : [])),
      ).find((t) => t.trait === "sage")?.step,
    ).toBe(1);
    expect(sell(run, { on: "board", at: 8 }).ok).toBe(true);
    expect(run.acorns).toBe(99 - 45 + 43);
  });
  test("a board holding it is met, with its level", () => {
    const met = boardWith(UNIT);
    const board = boardMet(CAT, met, true);
    expect(board?.figures.map((p) => [p.kind, p.stars, p.level])).toEqual([
      [UNIT, 2, 3],
      ["crab7", 1, undefined],
    ]);
    expect([board?.who, board?.by]).toEqual(["Quillfeather", met.player]);
    expect(opposition(CAT, 1, 2, 0, met, true).by).toBe(met.player);
  });
});

describe("a table kept in a run with a banner's member", () => {
  const text = readFileSync(new URL("../stored/own-member.json", import.meta.url), "utf8");
  const read = (): Table => {
    const table = RAID.decode(text);
    if (!table?.held.main) throw new Error("does not read");
    return table;
  };
  test("reads with the member on its board, on its stall and in its roster, and is stored again the same", () => {
    const table = read();
    const run = table.held.main;
    expect(run && levelOf(run, UNIT)).toBe(2);
    expect(run?.board.some((p) => p?.kind === UNIT)).toBe(true);
    expect(run?.seen.fielded).toContain(UNIT);
    expect(RAID.decode(RAID.encode(table))).toEqual(table);
    const view = RAID.view(table, ctx(HAS));
    expect(readView(JSON.parse(JSON.stringify(view)))).toEqual(view);
  });
  test("a run that has fielded every figure a member can have still reads", () => {
    const raw = JSON.parse(text);
    raw.run.seen.fielded = [...CAT.order];
    raw.run.seen.threeStars = [...CAT.order];
    expect(checkRun(raw.run).ok).toBe(true);
  });
  test("the almanac is of the twenty-eight: a run with the member's own figures writes nothing in it", () => {
    const table = read();
    const left = RAID.apply(table, { do: "abandon" }, ctx(HAS));
    if ("refused" in left) throw new Error(left.refused);
    expect(left.state.almanac).toEqual(table.almanac);
    expect(newAlmanac().fielded).toEqual([]);
  });
});

// ---------- its ability ----------

const n = (name: string, stars: Stars): number => abilityNumber(CAT, UNIT, name, stars);
const HOME = cellAt(3, 4);
const FAR = cellAt(0, 7);

/** The member at home with its mana full, friends where they are put, and still enemies, each having taken and dealt so much. */
function scene(
  stars: Stars,
  foes: readonly (readonly [cell: number, taken: number, dealt?: number])[],
  friends: readonly (readonly [FigureId, number])[] = [],
) {
  const f = fightOf(
    [onCell(UNIT, 0, HOME, stars), ...friends.map(([kind, cell]) => onCell(kind, 0, cell))],
    foes.map(([cell]) => onCell("mud", 1, cell)),
  );
  for (const o of f.units) if (o.side === 1 || o.kind !== UNIT) still(o, 5000);
  // In the order they were given, whatever order the fight seats them in.
  const across = foes.flatMap(([cell, taken, dealt]) => {
    const o = f.units.find((x) => x.side === 1 && x.cell === cell);
    return o ? [Object.assign(o, { taken, dealt: dealt ?? 0 })] : [];
  });
  const u = unitOf(f, UNIT);
  u.attack = 0;
  return { f, u: ready(u), across };
}
/** What the member's ability did to each enemy, by id: the damage it was sent with. */
const blasted = (events: readonly FightEvent[], by: number): number[][] =>
  only(events, "hit")
    .filter((e) => e.by === by && e.source === "ability")
    .map((e) => [e.id, e.before, e.kind === "magic" ? 1 : 0]);
const SENTENCE = (stun: string, damage: number): string =>
  `Picks the enemy who has taken the least damage so far, wherever they are, and stuns them for ${stun} seconds. If several have taken the same, it picks the one who has dealt the least. One second later, ${damage} magic damage to them and to every enemy touching them.`;

describe("I heard you weren't graiding.", () => {
  test.each([1, 2, 3] as const)(
    "at %i stars: stuns the enemy who has taken the least, then a second later blasts them and those touching them",
    (stars) => {
      const { f, u, across } = scene(stars, [
        [cellAt(5, 0), 300, 0],
        [cellAt(1, 1), 40, 900],
        [cellAt(2, 1), 200, 100],
        [cellAt(3, 3), 2000, 0],
      ]);
      const [far, caught, beside, tank] = across;
      if (!far || !caught || !beside || !tank) throw new Error("four enemies");
      expect(distance(caught.cell, beside.cell)).toBe(1);
      expect([far, tank].map((o) => distance(caught.cell, o.cell) > 1)).toEqual([true, true]);
      // The one in front of it has dealt nothing, and has taken the most: it is left alone.
      expect(distance(u.cell, tank.cell)).toBe(1);
      const first = steps(f, 1);
      const cast = only(first, "cast")[0];
      expect([cast?.name, cast?.shape, cast?.targets, cast?.ticks]).toEqual([
        "I heard you weren't graiding.",
        "bolt",
        [caught.id],
        HZ,
      ]);
      const stunned = only(first, "status").filter((e) => e.status === "stun" && e.on);
      expect(stunned.map((e) => [e.id, e.ticks, e.by])).toEqual([[caught.id, Math.round(n("stun", stars) * HZ), u.id]]);
      // Nothing lands until the second is up.
      const waiting = steps(f, HZ - 1);
      expect(blasted([...first, ...waiting], u.id)).toEqual([]);
      const landed = steps(f, 1);
      expect(blasted(landed, u.id)).toEqual([
        [caught.id, n("damage", stars), 1],
        [beside.id, n("damage", stars), 1],
      ]);
      expect(u.mana).toBe(0);
    },
  );
  test("its sentence says so, with the numbers for its stars", () => {
    expect(abilityText(CAT, UNIT, 1)).toBe(SENTENCE("2", 550));
    expect(abilityText(CAT, UNIT, 2)).toBe(SENTENCE("2.5", 950));
    expect(abilityText(CAT, UNIT, 3)).toBe(SENTENCE("3.5", 2200));
    expect(MEMBERS[UNIT].mana).toEqual([50, 80]);
  });
  test("of enemies who have taken the same, it picks the one who has dealt the least", () => {
    const { f, across } = scene(1, [
      [cellAt(3, 3), 0, 50],
      [cellAt(0, 0), 0, 0],
    ]);
    expect(only(steps(f, 1), "cast")[0]?.targets).toEqual([across[1]?.id ?? -1]);
  });
  test("of enemies who have taken and dealt the same, it picks the nearest", () => {
    const { f, across } = scene(1, [
      [cellAt(0, 0), 0],
      [cellAt(3, 3), 0],
    ]);
    expect(only(steps(f, 1), "cast")[0]?.targets).toEqual([across[1]?.id ?? -1]);
  });
  test("it picks a summoned enemy only when nobody else is up", () => {
    const f = fightOf([onCell(UNIT, 0, HOME)], [onCell("mud", 1, cellAt(0, 0))]);
    const brought = unitOf(f, "mud", 1);
    still(brought, 5000).taken = 900;
    const made = summon(f, "uncounted", 1, 1, cellAt(3, 3), null);
    if (!made) throw new Error("nobody summoned");
    still(made, 5000);
    const u = ready(unitOf(f, UNIT));
    u.attack = 0;
    expect(only(steps(f, 1), "cast")[0]?.targets).toEqual([brought.id]);
    brought.alive = false;
    ready(u).busyUntil = 0;
    expect(
      only(
        stepUntil(f, (e) => e.t === "cast"),
        "cast",
      )[0]?.targets,
    ).toEqual([made.id]);
  });
  test("a Sage, so with another its ability is stronger", () => {
    const { f, u, across } = scene(1, [[cellAt(3, 0), 0]], [["moth", FAR]]);
    const [foe] = across;
    if (!foe) throw new Error("one enemy");
    expect(u.power).toBeGreaterThan(100);
    const events = steps(f, HZ + 1);
    expect(blasted(events, u.id)).toEqual([[foe.id, Math.round((n("damage", 1) * u.power) / 100), 1]]);
  });
});
