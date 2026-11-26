/**
 * A banner's member as a figure of the raid: never on the main way, whatever a member has pulled;
 * sold, levelled, merged and met only in a run with the member's own figures; and its ability,
 * against its own sentence.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import type { Ctx, Met } from "@sequoia-leaf/core";

import { GOOD_WITH } from "./content/advice.ts";
import { abilityNumber, abilityText, FIGURE_IDS, type FigureId, FIGURES, type Stars } from "./content/figures.ts";
import { isMemberId, MEMBER_IDS, MEMBERS } from "./content/members.ts";
import { MAX_LEVEL, ROOMS, STALL_ODDS, TRAIL_COUNT } from "./content/rooms.ts";
import { HZ } from "./fight/core.ts";
import { boardMet, opposition } from "./foe.ts";
import { RAID, type Table } from "./game.ts";
import { cellAt, distance, neighbours } from "./hex.ts";
import { newAlmanac } from "./outside.ts";
import { levelOf, OWNABLE, rosterOf, stallOdds, stallPool } from "./own.ts";
import { isParty, traitStates } from "./party.ts";
import {
  buy,
  choose,
  giveItem,
  move,
  partyOf,
  picksOf,
  pieces,
  type Run,
  rustle,
  sell,
  STALL_POOL,
  startRun,
} from "./run.ts";
import { checkRun } from "./save.ts";
import { sparParty } from "./spar.ts";
import { fightOf, onCell, only, partyOfFigures, ready, steps, still, unitOf } from "./testkit.ts";
import { readView } from "./wire.ts";

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
  const run = "refused" in done ? null : done.state.run;
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
  test("stay twenty-eight: a banner's member is a figure, and not one of them", () => {
    expect(FIGURE_IDS.length).toBe(28);
    expect(OWNABLE).toEqual([...FIGURE_IDS, ...MEMBER_IDS]);
    const stall: readonly string[] = STALL_POOL;
    expect(stall).toEqual([...FIGURE_IDS]);
    for (const id of MEMBER_IDS) {
      expect(stall).not.toContain(id);
      expect(FIGURES[id]).toBe(MEMBERS[id]);
      expect([FIGURES[id].tier, FIGURES[id].extra, new Set(GOOD_WITH[id]).size]).toEqual([5, [], 3]);
    }
    expect(MEMBER_IDS.every(isMemberId) && !FIGURE_IDS.some(isMemberId)).toBe(true);
  });
  test("a banner's member is nobody in particular: its name is what any guild member is", () => {
    for (const id of MEMBER_IDS) expect(MEMBERS[id].name).toBe("A guild member");
  });
});

describe("the main way, whatever a member has pulled", () => {
  test("is told nothing of the roster, and its stall never offers a banner's member", () => {
    const run = setOut(HAS, false);
    expect(run.own).toBeNull();
    const seen = offered(run);
    expect([...seen.keys()].filter(isMemberId)).toEqual([]);
    expect(seen.size).toBe(FIGURE_IDS.length);
    for (const tier of [1, 2, 3, 4, 5]) expect(stallPool(run, tier).filter(isMemberId)).toEqual([]);
  });
  test("its opening pick is never a banner's member", () => {
    for (let seed = 1; seed < 200; seed++) {
      const pick = picksOf(startRun(seed))[0];
      expect(pick?.kind === "starter" && !pick.options.some(isMemberId)).toBe(true);
    }
  });
  test("no regular brings one to a sparring room, on any trail", () => {
    for (let trail = 0; trail < TRAIL_COUNT; trail++) {
      ROOMS.forEach((room, at) => {
        if (room.kind !== "spar") return;
        for (let seed = 1; seed <= 150; seed++) {
          expect(sparParty(seed, at, trail).figures.some((p) => isMemberId(p.kind))).toBe(false);
        }
      });
    }
  });
  test("a board holding one is not met at all: the regular waits there", () => {
    const met = boardWith(UNIT);
    expect(boardMet(met)).toBeNull();
    for (let seed = 1; seed <= 40; seed++) {
      expect(opposition(seed, 2, 0, met)).toEqual(opposition(seed, 2, 0));
    }
    // The same board without the member is met, so it is the member that keeps it out.
    expect(boardMet(boardWith("greg"))?.by).toBe(met.player);
  });
});

describe("a run with the member's own figures", () => {
  test("is offered to a member whose only pull is a banner's member", () => {
    expect(setOut(["pull:headliner:banner-1"], true).own).toEqual({ [UNIT]: 0 });
  });
  test("sells the banner's member a member has pulled, at its cost's odds with their other five-acorn figures", () => {
    const run = setOut(HAS, true);
    expect(run.own).toEqual({ [UNIT]: 3, greg: 0 });
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
    const traits = traitStates([piece]).map((t) => t.trait);
    expect(traits.toSorted()).toEqual(["feather", "mender"]);
    // With one more Mender on the board the calling switches on, the member counted.
    run.board[9] = { id: run.nextId++, kind: "kettle", stars: 1, items: [], fed: 0 };
    expect(traitStates(run.board.flatMap((p) => (p ? [p] : []))).find((t) => t.trait === "mender")?.step).toBe(1);
    expect(sell(run, { on: "board", at: 8 }).ok).toBe(true);
    expect(run.acorns).toBe(99 - 45 + 43);
  });
  test("a board holding it is met, with its level", () => {
    const met = boardWith(UNIT);
    const board = boardMet(met, true);
    expect(board?.figures.map((p) => [p.kind, p.stars, p.level])).toEqual([
      [UNIT, 2, 3],
      ["crab7", 1, undefined],
    ]);
    expect([board?.who, board?.by]).toEqual(["Quillfeather", met.player]);
    expect(opposition(1, 2, 0, met, true).by).toBe(met.player);
  });
});

describe("a table kept in a run with a banner's member", () => {
  const text = readFileSync(new URL("../stored/own-member.json", import.meta.url), "utf8");
  const read = (): Table => {
    const table = RAID.decode(text);
    if (!table?.run) throw new Error("does not read");
    return table;
  };
  test("reads with the member on its board, on its stall and in its roster, and is stored again the same", () => {
    const table = read();
    const run = table.run;
    expect(run?.own?.[UNIT]).toBe(2);
    expect(run?.board.some((p) => p?.kind === UNIT)).toBe(true);
    expect(run?.seen.fielded).toContain(UNIT);
    expect(RAID.decode(RAID.encode(table))).toEqual(table);
    const view = RAID.view(table, ctx(HAS));
    expect(readView(JSON.parse(JSON.stringify(view)))).toEqual(view);
  });
  test("a run that has fielded every figure a member can have still reads", () => {
    const raw = JSON.parse(text);
    raw.run.seen.fielded = [...OWNABLE];
    raw.run.seen.threeStars = [...OWNABLE];
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

const n = (name: string, stars: Stars): number => abilityNumber(UNIT, name, stars);
const HOME = cellAt(3, 4);
const FAR = cellAt(0, 7);

/** The member at home with its mana full, friends where they are put, and one plain enemy across the board. */
function scene(stars: Stars, friends: readonly (readonly [FigureId, number])[], foe = cellAt(3, 0)) {
  const f = fightOf(
    [onCell(UNIT, 0, HOME, stars), ...friends.map(([kind, cell]) => onCell(kind, 0, cell))],
    [onCell("mud", 1, foe)],
  );
  for (const o of f.units) if (o.side === 1 || o.kind !== UNIT) still(o, 5000);
  const u = unitOf(f, UNIT);
  u.attack = 0;
  return { f, u: ready(u) };
}

describe("On My Way", () => {
  test.each([1, 2, 3] as const)(
    "at %i stars: runs to the friend most hurt, gives them health back, and shields them both",
    (stars) => {
      const { f, u } = scene(stars, [
        ["crab7", FAR],
        ["emberkit", cellAt(6, 7)],
      ]);
      const crab = unitOf(f, "crab7");
      const kit = unitOf(f, "emberkit");
      crab.hp = 1000;
      kit.hp = 3000;
      u.hp = Math.round(u.maxHp / 10);
      const events = steps(f, 1);
      const cast = only(events, "cast")[0];
      expect([cast?.name, cast?.shape, cast?.targets]).toEqual(["On My Way", "ally", [crab.id]]);
      // It went: from home to a hex touching the friend, the one furthest from the enemy nearest them.
      const leapt = only(events, "leap").filter((e) => e.id === u.id);
      expect(leapt.map((e) => [e.from, e.why])).toEqual([[HOME, "ability"]]);
      expect(distance(u.cell, crab.cell)).toBe(1);
      const foe = unitOf(f, "mud", 1);
      const free = neighbours(crab.cell).filter((cell) => cell === u.cell || f.taken[cell] === -1);
      expect(distance(u.cell, foe.cell)).toBe(Math.max(...free.map((cell) => distance(cell, foe.cell))));
      // Health back for the friend alone, though the member is the more hurt.
      expect(only(events, "heal").map((e) => [e.id, e.amount, e.by])).toEqual([[crab.id, n("heal", stars), u.id]]);
      expect(crab.hp).toBe(1000 + n("heal", stars));
      // A shield on them both.
      const shields = only(events, "shield").map((e) => [e.id, e.amount, e.ticks]);
      expect(shields).toEqual([
        [crab.id, n("shield", stars), n("lasts", stars) * HZ],
        [u.id, n("shield", stars), n("lasts", stars) * HZ],
      ]);
      expect([crab.shield, u.shield, kit.shield, u.mana]).toEqual([n("shield", stars), n("shield", stars), 0, 0]);
    },
  );
  test("its sentence says so, with the numbers for its stars", () => {
    expect(abilityText(UNIT, 1)).toBe(
      "Runs over to the friend who is most hurt and stands by them: 260 health back for the friend, and a shield of 180 for 4 seconds on them both.",
    );
    expect(abilityText(UNIT, 3)).toContain("1000 health back");
  });
  test("beside the friend already, it stays where it is", () => {
    const { f, u } = scene(1, [["crab7", cellAt(4, 4)]]);
    unitOf(f, "crab7").hp = 1000;
    const events = steps(f, 1);
    expect(only(events, "leap")).toEqual([]);
    expect(u.cell).toBe(HOME);
    expect(only(events, "shield").length).toBe(2);
  });
  test("with nobody else left, it looks after itself: health back and one shield", () => {
    const { f, u } = scene(1, []);
    u.hp = 100;
    const events = steps(f, 1);
    expect(only(events, "leap")).toEqual([]);
    expect(only(events, "heal").map((e) => [e.id, e.amount])).toEqual([[u.id, n("heal", 1)]]);
    expect(only(events, "shield").map((e) => [e.id, e.amount])).toEqual([[u.id, n("shield", 1)]]);
  });
  test("a Mender, so with another its help counts for more", () => {
    const { f, u } = scene(1, [
      ["crab7", FAR],
      ["kettle", cellAt(6, 7)],
    ]);
    unitOf(f, "crab7").hp = 1000;
    expect(u.mending).toBe(20);
    const events = steps(f, 1);
    expect(only(events, "heal")[0]?.amount).toBe(Math.round(n("heal", 1) * 1.2));
  });
});
