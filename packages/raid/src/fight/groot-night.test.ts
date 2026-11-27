/**
 * Groot Night's rules, each against its own sentence, in a fight set up in its era: the crack and
 * the mana gift, Grooter and Chorus at each step, Crab at 2/4/7 and Sneak's softer first hits, the
 * six new abilities, Stowaway's chair, and the four emblems the banner brings.
 */
import { describe, expect, test } from "bun:test";

import { type Catalog, catalogAt, type Era } from "../content/catalog.ts";
import { abilityNumber, GROOTER_IDS, isGrooterId, type Stars, type UnitKind } from "../content/figures.ts";
import type { ItemId } from "../content/items.ts";
import { eraOf, LEGACY_ERA } from "../content/releases.ts";
import { FIGHT } from "../content/rooms.ts";
import { type TraitId, traitNumber } from "../content/traits.ts";
import { cellAt, distance } from "../hex.ts";
import { chairsUsed, type Placed, traitSteps } from "../party.ts";
import { beginFight, choose, move, newPiece, startRun } from "../run.ts";
import { CAT, onCell, only, partyOfFigures, ready, steps, stepUntil, still, unitOf, unitsOf } from "../testkit.ts";
import { crack, giveMana, hurt, HZ } from "./core.ts";
import { openFight } from "./engine.ts";
import type { Fight, FightEvent, Unit } from "./types.ts";

const NIGHT = eraOf("groot-night");
/** The catalogue of Groot Night's era. */
const GN: Catalog = catalogAt(NIGHT);
const n = (kind: UnitKind, name: string, stars: Stars = 1): number => abilityNumber(GN, kind, name, stars);
const t = (id: TraitId, name: string, step: number): number => traitNumber(GN, id, name, step);

const HOME = cellAt(3, 4);
const NEAR = cellAt(3, 3);
const TWO = cellAt(3, 2);
const THREE = cellAt(3, 1);
const FOUR = cellAt(3, 0);

/** A fight between two lists of figures in Groot Night's era, or another, opened and not yet stepped. */
const night = (ours: Placed[], theirs: Placed[], era: Era = NIGHT): Fight =>
  openFight({ seed: 7, era, sides: [partyOfFigures(ours), partyOfFigures(theirs)] });
/** Our figure at home, with full mana and no attack, facing plain targets on the given hexes. */
function scene(caster: UnitKind, foes: readonly number[], allies: Placed[] = []): { f: Fight; u: Unit } {
  const f = night(
    [onCell(caster, 0, HOME), ...allies],
    foes.map((cell) => onCell("mud", 1, cell)),
  );
  for (const o of f.units) if (o.side === 1) still(o);
  const u = unitOf(f, caster);
  u.attack = 0;
  ready(u);
  return { f, u };
}
function foeAt(f: Fight, cell: number): Unit {
  const u = f.units.find((o) => o.side === 1 && o.cell === cell);
  if (!u) throw new Error(`nobody of theirs on ${cell}`);
  return u;
}
const cracks = (events: readonly FightEvent[], who: Unit) =>
  only(events, "status").filter((e) => e.id === who.id && e.status === "cracked");
const castBy = (u: Unit) => (e: FightEvent) => e.t === "cast" && e.id === u.id;
/** How many big and small crabs nobody counted a side's roll call brought. */
const called = (f: Fight): number[] => [unitsOf(f, "biguncounted", 0).length, unitsOf(f, "uncounted", 0).length];
/** Some figures, as far as their chairs go. */
const kinds = (...list: UnitKind[]) => list.map((kind) => ({ kind }));
/** A Moth's health holding some items, in a fight of an era. */
const health = (era: Era, items: ItemId[]): number =>
  unitOf(night([onCell("moth", 0, HOME, 1, items)], [onCell("mud", 1, FOUR)], era), "moth").maxHp;

// ---------- the two verbs ----------

describe("the crack", () => {
  test("takes armour and ward off for the rest of the fight, never below 0, counts what was asked, and says so", () => {
    const f = night([onCell("peep", 0, HOME)], [onCell("mud", 1, NEAR)]);
    const mud = still(unitOf(f, "mud", 1));
    const peep = unitOf(f, "peep");
    mud.armour = 12;
    mud.ward = 30;
    crack(f, mud, 10, null);
    expect([mud.armour, mud.ward, mud.cracked]).toEqual([2, 20, 10]);
    crack(f, mud, 10, peep);
    expect([mud.armour, mud.ward, mud.cracked]).toEqual([0, 10, 20]);
    expect(cracks(f.out, mud).map((e) => [e.amount, e.by])).toEqual([
      [10, -1],
      [20, peep.id],
    ]);
    // Physical damage meets the armour left.
    mud.armour = 50;
    crack(f, mud, 25, null);
    const before = mud.hp;
    hurt(f, mud, 150, "physical", "attack", null);
    expect(before - mud.hp).toBe(Math.round((150 * 100) / 125));
  });
});

describe("a mana gift", () => {
  test("is never to its giver nor to one with no mana bar, and at most 50 to one figure in any 2 seconds", () => {
    const f = night([onCell("crab31", 0, HOME), onCell("moth", 0, cellAt(2, 5))], [onCell("mud", 1, NEAR)]);
    const [giver, moth, bare] = [unitOf(f, "crab31"), unitOf(f, "moth"), still(unitOf(f, "mud", 1))];
    moth.mana = 0;
    moth.manaFull = 1000;
    expect([giveMana(f, giver, 30, giver), giveMana(f, bare, 30, giver)]).toEqual([0, 0]);
    expect([giveMana(f, moth, 30, giver), giveMana(f, moth, 30, giver), giveMana(f, moth, 30, giver)]).toEqual([
      30, 20, 0,
    ]);
    expect(moth.mana).toBe(50);
    // From another giver it is the same cap: it is the figure's.
    expect(giveMana(f, moth, 30, bare)).toBe(0);
    // Two seconds after the first it no longer counts.
    f.tick += 2 * HZ - 1;
    expect(giveMana(f, moth, 30, giver)).toBe(0);
    f.tick += 1;
    expect(giveMana(f, moth, 30, giver)).toBe(30);
    expect([FIGHT.giftMost, FIGHT.giftOver]).toEqual([50, 2]);
  });
});

// ---------- traits ----------

describe("Grooter", () => {
  const GROOTERS: readonly Placed[] = [
    onCell("peep", 0, cellAt(2, 6)),
    onCell("munch", 0, HOME),
    onCell("clutch", 0, cellAt(4, 4)),
    onCell("moth", 0, cellAt(5, 6), 1, ["grootercharm"]),
  ];
  test.each([2, 3, 4])(
    "with %i, each attack or ability hit cracks its step's number, up to its most, and nothing else does",
    (count) => {
      const step = count - 1;
      const f = night(GROOTERS.slice(0, count), [onCell("mud", 1, NEAR)]);
      expect(f.traits[0].grooter).toBe(step);
      const mud = still(unitOf(f, "mud", 1));
      mud.armour = 100;
      mud.ward = 100;
      const [c, most] = [t("grooter", "crack", step), t("grooter", "most", step)];
      expect([c, most]).toEqual(
        [
          [4, 30],
          [6, 50],
          [8, 80],
        ][step - 1] ?? [],
      );
      // Every Grooter carrier cracks, the emblem's holder too.
      for (const u of f.units.filter((o) => o.side === 0))
        expect([u.kind, u.crack, u.crackMost]).toEqual([u.kind, c, most]);
      const by = unitOf(f, "munch");
      hurt(f, mud, 50, "physical", "attack", by);
      expect([mud.armour, mud.ward, mud.cracked]).toEqual([100 - c, 100 - c, c]);
      hurt(f, mud, 50, "magic", "ability", by);
      expect(mud.cracked).toBe(2 * c);
      for (const source of ["burn", "thorns", "item", "dusk"] as const) hurt(f, mud, 50, "true", source, by);
      expect(mud.cracked).toBe(2 * c);
      // Up to its most, and no further.
      mud.cracked = most - 1;
      hurt(f, mud, 50, "physical", "attack", by);
      expect(mud.cracked).toBe(most);
      hurt(f, mud, 50, "physical", "attack", by);
      expect(mud.cracked).toBe(most);
    },
  );
  test("is off with one, and the tests' own era has no Grooter", () => {
    const f = night([onCell("peep", 0, HOME), onCell("moth", 0, cellAt(2, 6))], [onCell("mud", 1, NEAR)]);
    expect([f.traits[0].grooter, unitOf(f, "peep").crack]).toEqual([undefined, 0]);
    expect(CAT.traits.grooter).toBeUndefined();
  });
});

describe("Chorus", () => {
  const CHORUS: readonly Placed[] = [
    onCell("finch", 0, cellAt(1, 6)),
    onCell("kettle", 0, cellAt(2, 6)),
    onCell("drizzlefrog", 0, cellAt(4, 6)),
    onCell("crab31", 0, cellAt(5, 5)),
  ];
  test.each([2, 3, 4])(
    "with %i, the party gains its step's mana a second and Chorus figures their own instead",
    (count) => {
      const step = count - 1;
      const f = night([...CHORUS.slice(0, count), onCell("moth", 0, HOME)], [onCell("mud", 1, FOUR)]);
      expect(f.traits[0].chorus).toBe(step);
      const [party, own] = [t("chorus", "party", step), t("chorus", "own", step)];
      expect([party, own]).toEqual(
        [
          [1, 2],
          [2, 4],
          [3, 6],
        ][step - 1] ?? [],
      );
      expect(unitOf(f, "moth").manaRate).toBe(party);
      for (const p of CHORUS.slice(0, count)) expect(unitOf(f, p.kind).manaRate).toBe(own);
      // The clock pays it once a second, to a figure doing nothing else.
      still(unitOf(f, "mud", 1));
      const moth = unitOf(f, "moth");
      moth.attack = 0;
      const was = moth.mana;
      steps(f, HZ);
      expect(moth.mana).toBe(was + party);
    },
  );
  test("Twig, Brew and Drizzle are Chorus from Groot Night, and not before", () => {
    const two = partyOfFigures([onCell("finch", 0, HOME), onCell("kettle", 0, cellAt(2, 5))]);
    expect([traitSteps(GN, two).chorus, traitSteps(CAT, two).chorus]).toEqual([1, undefined]);
  });
});

describe("Crab at 2, 4 and 7", () => {
  const CRABS: readonly Placed[] = [
    onCell("crab7", 0, cellAt(1, 4)),
    onCell("crab12", 0, cellAt(1, 6)),
    onCell("crab23", 0, cellAt(2, 5)),
    onCell("crab40", 0, cellAt(3, 4)),
    onCell("crab31", 0, cellAt(4, 5)),
    onCell("crab8", 0, cellAt(5, 4)),
    onCell("moth", 0, cellAt(5, 6), 1, ["crabcharm"]),
  ];
  test.each([
    [1, 0, [0, 0]],
    [2, 1, [0, 1]],
    [4, 2, [1, 0]],
    [5, 2, [1, 0]],
    [6, 2, [1, 0]],
    [7, 3, [1, 2]],
  ] as const)("with %i crabs, step %i: so many big and small crabs nobody counted join", (count, step, joined) => {
    const f = night(CRABS.slice(0, count), [onCell("mud", 1, FOUR)]);
    expect(f.traits[0].crab ?? 0).toBe(step);
    expect(called(f)).toEqual([...joined]);
  });
  test("a fight of the tests' own era still counts 2, 4, 5", () => {
    const f = night(CRABS.slice(0, 2), [onCell("mud", 1, FOUR)], LEGACY_ERA);
    expect([f.traits[0].crab, called(f)]).toEqual([1, [0, 1]]);
  });
});

test("Sneak's first hits do 35% and 60% more from Groot Night, 40% and 70% before", () => {
  expect([t("sneak", "extra", 1), t("sneak", "extra", 2)]).toEqual([35, 60]);
  expect([traitNumber(CAT, "sneak", "extra", 1), traitNumber(CAT, "sneak", "extra", 2)]).toEqual([40, 70]);
});

// ---------- the new abilities ----------

describe("Hat Off (Peep)", () => {
  test("hits the enemy in its reach with the most armour, ties to the nearest, and cracks it", () => {
    const { f, u } = scene("peep", [NEAR, TWO, THREE]);
    const [near, two, three] = [foeAt(f, NEAR), foeAt(f, TWO), foeAt(f, THREE)];
    near.armour = 20;
    two.armour = 40;
    three.armour = 40;
    const events = stepUntil(f, (e) => e.t === "hit" && e.by === u.id && e.source === "ability");
    expect(only(events, "cast").find((e) => e.id === u.id)?.targets).toEqual([two.id]);
    const hit = only(events, "hit").find((e) => e.by === u.id);
    expect(hit?.amount).toBe(Math.round((n("peep", "damage") * 100) / 140));
    expect([two.cracked, two.armour, two.ward]).toEqual([10, 30, 0]);
    expect([n("peep", "crack", 1), n("peep", "crack", 2), n("peep", "crack", 3)]).toEqual([10, 14, 20]);
  });
  test("cracks on top of Grooter's own cracking, past its most", () => {
    const { f, u } = scene("peep", [NEAR], [onCell("munch", 0, cellAt(1, 6))]);
    expect(f.traits[0].grooter).toBe(1);
    const mud = foeAt(f, NEAR);
    mud.cracked = t("grooter", "most", 1);
    stepUntil(f, (e) => e.t === "hit" && e.by === u.id);
    expect(mud.cracked).toBe(t("grooter", "most", 1) + n("peep", "crack"));
  });
  test("with nobody in its reach, keeps its mana", () => {
    const far = cellAt(0, 0);
    const { f, u } = scene("peep", [far]);
    expect(distance(HOME, far)).toBeGreaterThan(u.range);
    expect(only(steps(f, 2), "cast").filter((e) => e.id === u.id)).toEqual([]);
    expect(u.mana).toBe(u.manaFull);
  });
});

describe("Shell And All (Munch)", () => {
  test("bites three times in a second, each bite physical damage and a crack", () => {
    const { f, u } = scene("munch", [NEAR]);
    const mud = foeAt(f, NEAR);
    const events = steps(f, 2 * HZ);
    const bites = only(events, "hit").filter((e) => e.by === u.id && e.source === "ability");
    expect(bites.map((e) => e.amount)).toEqual([n("munch", "damage"), n("munch", "damage"), n("munch", "damage")]);
    expect(mud.cracked).toBe(3 * n("munch", "crack"));
    expect(cracks(events, mud).map((e) => e.amount)).toEqual([6, 12, 18]);
    const cast = only(events, "cast").find((e) => e.id === u.id);
    expect([cast?.pulses, cast?.every]).toEqual([3, HZ / 2]);
  });
});

describe("Mind The Eggs (Clutch)", () => {
  test("hatches a Hatchling beside it with the ability's health and attack, at most three; with three up it keeps its mana", () => {
    const { f, u } = scene("clutch", [FOUR]);
    for (let egg = 1; egg <= 3; egg++) {
      ready(u);
      stepUntil(f, (e) => e.t === "summon" && e.by === u.id);
      expect(unitsOf(f, "hatchling", 0)).toHaveLength(egg);
    }
    for (const h of unitsOf(f, "hatchling", 0)) {
      expect([h.maxHp, h.attack, h.owner, h.summoned]).toEqual([
        n("clutch", "health"),
        n("clutch", "attack"),
        u.id,
        true,
      ]);
    }
    // Each came out beside it, where it stood then.
    const summons = f.units.filter((o) => o.kind === "hatchling");
    expect(summons.length).toBe(3);
    ready(u);
    expect(only(steps(f, HZ), "cast").filter((e) => e.id === u.id)).toEqual([]);
    expect(u.mana).toBe(u.manaFull);
  });
  test("hatches beside it", () => {
    const { f, u } = scene("clutch", [FOUR]);
    const ev = only(
      stepUntil(f, (e) => e.t === "summon" && e.by === u.id),
      "summon",
    ).at(-1);
    expect(ev && distance(ev.cell, u.cell)).toBe(1);
  });
  test("its Hatchlings crack as it does when Grooter is on", () => {
    const { f, u } = scene("clutch", [FOUR], [onCell("peep", 0, cellAt(1, 6))]);
    stepUntil(f, (e) => e.t === "summon" && e.by === u.id);
    const h = unitOf(f, "hatchling");
    expect([h.crack, h.crackMost]).toEqual([t("grooter", "crack", 1), t("grooter", "most", 1)]);
  });
});

describe("Clack (Crab #31)", () => {
  test("gives the friends nearest it with a mana bar its mana, through the gift's cap, and shields itself", () => {
    const allies: Placed[] = [
      onCell("moth", 0, cellAt(2, 4)),
      onCell("rock", 0, cellAt(4, 4)),
      onCell("finch", 0, cellAt(3, 5)),
      onCell("kettle", 0, cellAt(0, 7)),
    ];
    const { f, u } = scene("crab31", [FOUR], allies);
    for (const o of f.units.filter((x) => x.side === 0 && x !== u)) {
      o.mana = 0;
      o.attack = 0;
    }
    // One beside it with no mana bar is passed over.
    unitOf(f, "rock").manaFull = 0;
    const events = stepUntil(f, castBy(u));
    const [moth, finch] = [unitOf(f, "moth"), unitOf(f, "finch")];
    expect(
      only(events, "cast")
        .find((e) => e.id === u.id)
        ?.targets.toSorted((a, b) => a - b),
    ).toEqual([moth.id, finch.id].toSorted((a, b) => a - b));
    expect([moth.mana, finch.mana, unitOf(f, "kettle").mana]).toEqual([n("crab31", "mana"), n("crab31", "mana"), 0]);
    expect(u.shield).toBe(n("crab31", "shield"));
    // Again at once: the cap lets only what is left of 50 in 2 seconds through.
    ready(u);
    stepUntil(f, castBy(u));
    expect(moth.mana).toBe(FIGHT.giftMost);
  });
});

describe("Was Never Here (Crab #8)", () => {
  test("hides a second, then comes up beside the enemy with the least health; if it falls, again at once", () => {
    const { f, u } = scene("crab8", [NEAR, TWO, THREE]);
    const [near, two, three] = [foeAt(f, NEAR), foeAt(f, TWO), foeAt(f, THREE)];
    near.hp = 5000;
    two.hp = 10;
    three.hp = 4000;
    const events = stepUntil(f, (e) => e.t === "hit" && e.by === u.id && e.id === three.id);
    const hide = only(events, "status").find((e) => e.id === u.id && e.status === "hidden");
    expect(hide?.ticks).toBe(n("crab8", "hides") * HZ);
    // It picks as it comes up: Two first, who falls; then at once the next with the least, Three.
    const hits = only(events, "hit").filter((e) => e.by === u.id && e.source === "ability");
    expect(hits.map((e) => e.id)).toEqual([two.id, three.id]);
    expect(hits[1]?.amount).toBe(n("crab8", "damage"));
    expect([two.alive, three.alive, distance(u.cell, three.cell)]).toEqual([false, true, 1]);
    // One hard cut, a leap, each time it comes up.
    expect(only(events, "leap").filter((e) => e.id === u.id && e.why === "ability")).toHaveLength(2);
    // At one star, once more at most; at three, twice.
    expect([n("crab8", "again", 1), n("crab8", "again", 3)]).toEqual([1, 2]);
  });
  test("comes up where it stands if it is beside the one it picks: a leap all the same", () => {
    const { f, u } = scene("crab8", [NEAR, THREE]);
    foeAt(f, NEAR).hp = 10_000;
    foeAt(f, THREE).hp = 20_000;
    const events = stepUntil(f, (e) => e.t === "hit" && e.by === u.id);
    const cuts = only(events, "leap").filter((e) => e.id === u.id && e.why === "ability");
    expect(cuts.map((e) => [e.from, e.to])).toEqual([[HOME, HOME]]);
    expect(only(events, "cast").find((e) => e.id === u.id)?.targets).toEqual([foeAt(f, NEAR).id]);
  });
  test("is a Crab and a Sneak and takes no place on the board: the first copy takes no chair, a second does", () => {
    const crab8 = GN.figures.crab8;
    expect([crab8?.kin, crab8?.calling, crab8?.extra, crab8?.chairs]).toEqual(["crab", "sneak", ["stowaway"], 0]);
    expect(chairsUsed(GN, kinds("crab8"))).toBe(0);
    expect(chairsUsed(GN, kinds("crab8", "peep"))).toBe(1);
    expect(chairsUsed(GN, kinds("crab8", "crab8", "peep"))).toBe(2);
    // On a run at level 1: one figure and Crab #8 are fielded; a second Crab #8 is one too many.
    const run = startRun(3, { era: NIGHT });
    expect(choose(run, 0).ok).toBe(true);
    run.board = run.board.map(() => null);
    run.bench = run.bench.map(() => null);
    run.board[3] = newPiece(run, "peep");
    run.bench[0] = newPiece(run, "crab8");
    run.bench[1] = newPiece(run, "crab8");
    expect(move(run, { on: "bench", at: 0 }, { on: "board", at: 4 }).ok).toBe(true);
    expect(move(run, { on: "bench", at: 1 }, { on: "board", at: 5 }).ok).toBe(false);
    expect(beginFight(run).ok).toBe(true);
  });
});

describe("Any grooters in chat? (the Commodore)", () => {
  const WAIT = 0.8 * HZ;
  test("rings at once, marking the places, and grooters 1 to 3 stand there the wait later, within 2 of him", () => {
    const { f, u } = scene("commodore", [FOUR]);
    const cast = only(stepUntil(f, castBy(u)), "cast").find((e) => e.id === u.id);
    expect([n("commodore", "wait") * HZ, cast?.ticks, cast?.targets]).toEqual([WAIT, WAIT, []]);
    const mine = () => f.units.filter((o) => o.alive && o.owner === u.id && isGrooterId(o.kind));
    // Nobody has come yet: not until the wait is over, and then all three on the places marked.
    expect(only(steps(f, WAIT - 1), "summon")).toEqual([]);
    const came = only(steps(f, 1), "summon");
    expect(came.map((e) => e.kind)).toEqual(["grooter1", "grooter2", "grooter3"]);
    expect(came.map((e) => e.cell)).toEqual(cast?.cells ?? []);
    for (const g of mine()) {
      expect([g.maxHp, g.attack, g.summoned]).toEqual([n("commodore", "health"), n("commodore", "attack"), true]);
      expect(distance(g.cell, u.cell)).toBeLessThanOrEqual(2);
    }
  });
  test("heals those still up to full and calls the missing next in turn, the wait after he rings", () => {
    const { f, u } = scene("commodore", [FOUR]);
    stepUntil(f, castBy(u));
    steps(f, WAIT);
    // One hurt, one down: the hurt one is healed to full and the fourth comes in the place of the one down.
    const [one, two] = [unitOf(f, "grooter1"), unitOf(f, "grooter2")];
    one.hp = 10;
    hurt(f, two, 1e6, "true", "dusk", null);
    expect(two.alive).toBe(false);
    ready(u);
    const rung = only(stepUntil(f, castBy(u)), "cast").find((e) => e.id === u.id);
    expect([rung?.targets, rung?.cells.length]).toEqual([[one.id], 1]);
    expect(one.hp).toBe(10);
    const later = steps(f, WAIT);
    expect(one.hp).toBe(one.maxHp);
    expect(only(later, "summon").map((e) => e.kind)).toEqual(["grooter4"]);
    // Counting on from the fourth, the first not up is the second.
    hurt(f, unitOf(f, "grooter3"), 1e6, "true", "dusk", null);
    ready(u);
    stepUntil(f, castBy(u));
    expect(only(steps(f, WAIT), "summon").map((e) => e.kind)).toEqual(["grooter2"]);
    expect(GROOTER_IDS).toHaveLength(4);
  });
  test("down before the wait is over, nobody comes", () => {
    const { f, u } = scene("commodore", [FOUR]);
    stepUntil(f, castBy(u));
    hurt(f, u, 1e6, "true", "dusk", null);
    expect(only(steps(f, WAIT + 2), "summon")).toEqual([]);
  });
  test("with three up and all at full health, keeps his mana; his grooters crack as he does", () => {
    const { f, u } = scene("commodore", [FOUR], [onCell("peep", 0, cellAt(1, 6))]);
    stepUntil(f, castBy(u));
    steps(f, WAIT);
    const grooters = f.units.filter((o) => o.owner === u.id);
    expect(grooters.map((g) => g.crack)).toEqual([3, 3, 3].map(() => t("grooter", "crack", 1)));
    ready(u);
    expect(only(steps(f, 3), "cast").filter((e) => e.id === u.id)).toEqual([]);
  });
});

// ---------- the emblems ----------

describe("the emblems Groot Night brings", () => {
  test("every emblem gives its holder 10% more health from Groot Night, and none before", () => {
    const plain = health(NIGHT, []);
    for (const id of ["crabcharm", "grootercharm", "choruscharm", "sneakcharm", "graidcharm"] as const)
      expect([id, health(NIGHT, [id])]).toEqual([id, Math.round(plain * 1.1)]);
    expect(health(LEGACY_ERA, ["crabcharm"])).toBe(health(LEGACY_ERA, []));
  });
  test("Party Finder: its holder carries Graid and gets back up as itself", () => {
    const f = night(
      [onCell("peep", 0, HOME, 1, ["graidcharm"]), onCell("crab7", 0, cellAt(1, 4))],
      [onCell("mud", 1, FOUR)],
    );
    // Its holder alone is one Graid figure; with Worm it is two, and Graid is on.
    expect(f.traits[0].graid).toBeUndefined();
    const g = night(
      [onCell("peep", 0, HOME, 1, ["graidcharm"]), onCell("worm", 0, cellAt(1, 4))],
      [onCell("mud", 1, FOUR)],
    );
    expect(g.traits[0].graid).toBe(1);
    const peep = unitOf(g, "peep");
    expect(peep.rises).toBe(true);
    hurt(g, peep, 1e6, "true", "dusk", null);
    const rose = only(
      stepUntil(g, (e) => e.t === "rise"),
      "rise",
    ).find((e) => e.id === peep.id);
    expect([rose?.why, rose?.form, peep.alive]).toEqual(["graid", "plain", true]);
  });
  test("False Moustache: its holder is a Sneak and leaps to the back; one rooted to its hex does not", () => {
    const f = night(
      [onCell("peep", 0, HOME, 1, ["sneakcharm"]), onCell("worm", 0, cellAt(1, 4))],
      [onCell("mud", 1, FOUR)],
    );
    const peep = unitOf(f, "peep");
    expect([f.traits[0].sneak, peep.sneakHits, peep.sneakBy]).toEqual([1, 2, 35]);
    expect(only(f.opening, "leap").some((e) => e.id === peep.id && e.why === "sneak")).toBe(true);
    const rooted = night(
      [onCell("seqwawa", 0, cellAt(3, 7), 1, ["sneakcharm"]), onCell("worm", 0, cellAt(1, 4))],
      [onCell("mud", 1, FOUR)],
    );
    expect(only(rooted.opening, "leap").some((e) => e.id === unitOf(rooted, "seqwawa").id)).toBe(false);
  });
  test("Tin Whistle: its holder is a Chorus, at Chorus's own rate; Grooter Ping: its holder cracks", () => {
    const f = night(
      [
        onCell("moth", 0, HOME, 1, ["choruscharm"]),
        onCell("crab31", 0, cellAt(1, 6)),
        onCell("worm", 0, cellAt(4, 4), 1, ["grootercharm"]),
        onCell("peep", 0, cellAt(5, 6)),
      ],
      [onCell("mud", 1, FOUR)],
    );
    expect([f.traits[0].chorus, unitOf(f, "moth").manaRate]).toEqual([1, t("chorus", "own", 1)]);
    expect([f.traits[0].grooter, unitOf(f, "worm").crack]).toEqual([1, t("grooter", "crack", 1)]);
  });
});
