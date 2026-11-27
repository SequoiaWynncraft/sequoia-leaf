/** Traits and boons, each checked against its own sentence as it plays out in a fight. */
import { describe, expect, test } from "bun:test";

import { boonNumber } from "../content/boons.ts";
import { abilityNumber, FIGURES, specOf, type UnitKind } from "../content/figures.ts";
import { FIGHT } from "../content/rooms.ts";
import { traitNumber } from "../content/traits.ts";
import { backRow, cellAt, distance, rowOf } from "../hex.ts";
import { type Carrier, countTraits, traitStates, traitSteps } from "../party.ts";
import {
  abc,
  at,
  fightOf,
  inOrder,
  onCell,
  only,
  partyOfFigures,
  steps,
  stepUntil,
  still,
  stillSide,
  unitOf,
  unitsOf,
} from "../testkit.ts";
import { brace, heal, hurt, HZ, shieldUp } from "./core.ts";
import { speedNow } from "./engine.ts";

const t = traitNumber;
/** Figures holding nothing, as far as their traits go. */
const kinds = (...list: UnitKind[]): Carrier[] => list.map((kind) => ({ kind, items: [] }));
/** What Gnome multiplies a gnome's health by at a step. */
const gnomeHealth = (step: number) => 1 + t("gnome", "health", step) / 100;
/** One of It Is A Rock's numbers at one star. */
const rockSays = (name: string) => abilityNumber("rock", name, 1);
/** Greg's health at the start of a fight, having eaten a number of times. */
const gregsHealth = (fed: number): number => {
  const f = fightOf([{ kind: "greg", stars: 1, seat: 3, items: [], fed }], [at("mud", 3, 3)]);
  return unitOf(f, "greg").maxHp;
};

describe("counting traits", () => {
  test("a trait counts each different figure once, however many copies are fielded", () => {
    const counts = countTraits(kinds("crab7", "crab7", "crab7", "emberkit"));
    expect(counts.crab).toBe(1);
    expect(counts.fang).toBe(2);
    expect(counts.ember).toBe(1);
    const on = traitSteps(partyOfFigures([at("crab7", 0, 0), at("crab7", 1, 0), at("crab7", 2, 0)]));
    expect(on.crab).toBeUndefined();
    expect(on.fang).toBeUndefined();
  });
  test("two different figures of a kin switch it on; the forest's trouble and summons count for nothing", () => {
    const on = traitSteps(
      partyOfFigures([at("crab7", 0, 0), at("crab12", 1, 0), at("crab", 2, 0), at("uncounted", 3, 0)]),
    );
    expect(on.crab).toBe(1);
    expect(countTraits(kinds("crab", "uncounted", "glorplet", "gnat"))).toEqual({});
  });
  test("a figure holding an emblem carries its kin as well, and counts as one more of it", () => {
    expect(traitSteps(partyOfFigures([at("crab7", 0, 0), at("worm", 1, 0, 1, ["crabcharm"])])).crab).toBe(1);
    const four = partyOfFigures([
      at("crab7", 0, 0),
      at("crab12", 1, 0),
      at("crab23", 2, 0),
      at("worm", 3, 0, 1, ["crabcharm"]),
    ]);
    expect(countTraits(four.figures)).toMatchObject({ crab: 4, burrow: 1, sneak: 1, groot: 1 });
    expect(traitSteps(four).crab).toBe(2);
    // On the bench, where nobody else is, it is one of its kin alone.
    expect(countTraits([{ kind: "worm", items: ["crabcharm"] }])).toEqual({ burrow: 1, sneak: 1, groot: 1, crab: 1 });
  });
  test("two copies of one figure count once, however many emblems they hold", () => {
    const twins = [
      { kind: "worm", items: ["crabcharm"] },
      { kind: "worm", items: ["crabcharm", "mistcharm"] },
      { kind: "crab7", items: [] },
    ] satisfies Carrier[];
    expect(countTraits(twins)).toEqual({ burrow: 1, sneak: 1, groot: 1, crab: 2, mist: 1, fang: 1 });
    // A copy holding nothing still counts the emblem the other copy holds, once.
    expect(
      countTraits([
        { kind: "worm", items: [] },
        { kind: "worm", items: ["crabcharm"] },
      ]).crab,
    ).toBe(1);
  });
  test("a figure with a third trait counts toward all three", () => {
    const counts = countTraits(kinds("whitefox", "hearthcat", "greg"));
    expect(counts).toEqual({ mist: 1, sage: 1, groot: 2, ember: 1, sneak: 1, fang: 1, bulwark: 1, greg: 1 });
  });
  test("the states list what is on first", () => {
    const states = traitStates(kinds("crab7", "crab12", "emberkit"));
    expect(states[0]?.step).toBe(1);
    expect(abc(states.filter((s) => s.step > 0).map((s) => s.trait))).toEqual(["crab", "fang"]);
    expect(states.find((s) => s.trait === "ember")).toEqual({ trait: "ember", count: 1, step: 0 });
  });
  test("a switched-on trait says so as the fight opens, with who it touches", () => {
    const f = fightOf([at("crab7", 3, 0), at("emberkit", 2, 0), at("finch", 3, 2)], [at("mud", 3, 0)]);
    const said = only(f.opening, "trait");
    expect(said.length).toBe(1);
    expect(said[0]?.trait).toBe("fang");
    expect(said[0]?.step).toBe(1);
    expect(inOrder(said[0]?.ids ?? [])).toEqual(inOrder([unitOf(f, "crab7").id, unitOf(f, "emberkit").id]));
    expect(f.traits[0]).toEqual({ fang: 1 });
  });
});

describe("kins", () => {
  test("Ember: Ember figures' hits leave a burn; at the second step the whole party's do, and hotter", () => {
    const f = fightOf([at("emberkit", 3, 0), at("kettle", 3, 2), at("crab12", 2, 2)], [at("mud", 3, 0)]);
    const mud = still(unitOf(f, "mud", 1));
    expect(unitOf(f, "emberkit").ember).toBe(t("ember", "burn", 1));
    expect(unitOf(f, "crab12").ember).toBe(0);
    f.out = [];
    hurt(f, mud, 10, "physical", "attack", unitOf(f, "crab12"));
    expect(mud.burnUntil).toBe(0);
    hurt(f, mud, 10, "physical", "attack", unitOf(f, "emberkit"));
    expect(mud.burnBy).toBe(t("ember", "burn", 1));
    expect(mud.burnUntil).toBe(f.tick + t("ember", "lasts", 1) * HZ);
    const events = steps(f, HZ);
    const burnt = only(events, "hit").find((e) => e.source === "burn");
    expect(burnt?.amount).toBe(Math.round((mud.maxHp * t("ember", "burn", 1)) / 100));

    // The fourth Ember is a Finch holding an Ember emblem.
    const hot = fightOf(
      [
        at("emberkit", 3, 0),
        at("kettle", 3, 2),
        at("cindernewt", 2, 1),
        at("crab12", 2, 2),
        at("finch", 4, 2, 1, ["embercharm"]),
      ],
      [at("mud", 3, 0)],
    );
    expect(hot.traits[0].ember).toBe(2);
    expect(unitOf(hot, "crab12").ember).toBe(t("ember", "burn", 2));
    expect(t("ember", "burn", 2)).toBeGreaterThan(t("ember", "burn", 1));
  });
  test("Moss: the whole party regrows a share of its health every second", () => {
    const f = fightOf([at("mossmote", 3, 2), at("slug", 3, 0), at("crab7", 2, 0)], [at("mud", 3, 3)]);
    stillSide(f, 1);
    const crab = unitOf(f, "crab7");
    crab.hp = 100;
    const events = steps(f, HZ);
    const grown = only(events, "heal").filter((e) => e.id === crab.id && e.source === "regrow");
    expect(grown.map((e) => e.amount)).toEqual([Math.round((crab.maxHp * t("moss", "regrow", 1)) / 100)]);
  });
  test("Mist: the whole party gains ward, and some attacks slip past it", () => {
    const f = fightOf([at("crab7", 3, 0)], [at("moth", 3, 0), at("glorp", 2, 0), at("mud", 4, 0)]);
    const mud = unitOf(f, "mud", 1);
    expect(mud.ward).toBe(specOf("mud").ward + t("mist", "ward", 1));
    expect(mud.slip).toBe(t("mist", "slip", 1));
    // Count them: a still target with Mist's slip, attacked every step until dusk.
    stillSide(f, 1);
    mud.slip = t("mist", "slip", 1);
    const crab = unitOf(f, "crab7");
    crab.manaFull = 0;
    crab.speed = HZ;
    crab.target = mud.id;
    const events = steps(f, FIGHT.dusk * HZ - 1);
    const slips = only(events, "slip").length;
    const swings = only(events, "swing").length;
    expect(swings).toBeGreaterThan(500);
    expect(slips / swings).toBeGreaterThan(t("mist", "slip", 1) / 100 - 0.05);
    expect(slips / swings).toBeLessThan(t("mist", "slip", 1) / 100 + 0.05);
    expect(only(events, "hit").length).toBe(swings - slips);
  });
  test("Burrow: Burrow figures dig in for armour, and the first time they drop under half get health back and take less, still fighting", () => {
    const f = fightOf([at("worm", 3, 0), at("chickaree", 3, 2), at("crab7", 2, 0)], [at("mud", 3, 3)]);
    stillSide(f, 1);
    const worm = unitOf(f, "worm");
    const foe = unitOf(f, "mud", 1);
    expect(worm.armour).toBe(FIGURES.worm.armour + t("burrow", "armour", 1));
    expect(unitOf(f, "crab7").armour).toBe(FIGURES.crab7.armour);
    worm.manaFull = 0;
    f.out = [];
    hurt(f, worm, worm.maxHp * 0.6, "true", "attack", foe);
    const back = only(f.out, "heal").find((e) => e.source === "burrow");
    expect(back?.amount).toBe(Math.round((worm.maxHp * t("burrow", "heal", 1)) / 100));
    const braced = only(f.out, "status").find((e) => e.status === "braced" && e.on);
    expect(braced?.ticks).toBe(t("burrow", "lasts", 1) * HZ);
    expect(braced?.amount).toBe(t("burrow", "less", 1));
    // It is still there to be hit, for less, and it keeps fighting.
    expect(only(f.out, "status").some((e) => e.status === "hidden")).toBe(false);
    expect(hurt(f, worm, 100, "true", "attack", foe)).toBe(Math.round(100 * (1 - t("burrow", "less", 1) / 100)));
    const events = steps(f, t("burrow", "lasts", 1) * HZ);
    expect(only(events, "swing").some((e) => e.id === worm.id)).toBe(true);
    // Only the once.
    f.out = [];
    hurt(f, worm, 1, "true", "attack", foe);
    expect(only(f.out, "heal").some((e) => e.source === "burrow")).toBe(false);
  });
  test("Feather: a Feather emblem on a figure of another kin quickens it too", () => {
    const f = fightOf([at("jay", 3, 0), at("crab7", 2, 0, 1, ["feathercharm"])], [at("mud", 3, 1)]);
    expect(f.traits[0].feather).toBe(1);
    stillSide(f, 1);
    const crab = unitOf(f, "crab7");
    crab.manaFull = 0;
    expect(crab.quicken).toBe(t("feather", "quicken", 1));
    const base = speedNow(f, crab);
    stepUntil(f, (e) => e.t === "swing" && e.id === crab.id);
    expect(speedNow(f, crab)).toBeCloseTo(base * (1 + t("feather", "quicken", 1) / 100));
    // Without the emblem there is one Feather, and nobody quickens.
    const plain = fightOf([at("jay", 3, 0), at("crab7", 2, 0)], [at("mud", 3, 1)]);
    expect(plain.traits[0].feather).toBeUndefined();
    expect(unitOf(plain, "crab7").quicken).toBe(0);
  });
  test("Burrow: a Burrow emblem's holder digs in like the rest", () => {
    const f = fightOf([at("worm", 3, 0), at("crab7", 2, 0, 1, ["burrowcharm"])], [at("mud", 3, 3)]);
    const crab = unitOf(f, "crab7");
    expect(crab.armour).toBe(FIGURES.crab7.armour + t("burrow", "armour", 1));
    expect(crab.digs).toBe(true);
  });
  test("Burrow: a Rock that digs in during It Is A Rock keeps the stronger brace, its sting and its end", () => {
    const f = fightOf([at("rock", 3, 0), at("worm", 3, 2)], [at("mud", 3, 3)]);
    stillSide(f, 1);
    const rock = unitOf(f, "rock");
    const foe = unitOf(f, "mud", 1);
    // Its own ability is up, stronger and longer than Burrow's dig.
    brace(f, rock, rockSays("less"), rockSays("stub"), rockSays("lasts"));
    const until = rock.bracedUntil;
    f.out = [];
    // Enough, through its brace, to take it under half.
    hurt(f, rock, rock.maxHp * 0.9, "true", "attack", foe);
    expect(only(f.out, "heal").some((e) => e.source === "burrow")).toBe(true);
    expect(rockSays("less")).toBeGreaterThan(t("burrow", "less", 1));
    expect([rock.bracedBy, rock.stub, rock.bracedUntil]).toEqual([rockSays("less"), rockSays("stub"), until]);
  });
  test("Feather: every attack makes the next come quicker, up to a point", () => {
    const f = fightOf([at("jay", 3, 0), at("finch", 3, 2)], [at("mud", 3, 0)]);
    stillSide(f, 1);
    const jay = unitOf(f, "jay");
    jay.manaFull = 0;
    const base = speedNow(f, jay);
    stepUntil(f, (e) => e.t === "swing" && e.id === jay.id);
    expect(speedNow(f, jay)).toBeCloseTo(base * (1 + t("feather", "quicken", 1) / 100));
    steps(f, 40 * HZ);
    expect(jay.quick).toBe(t("feather", "stacks", 1));
    expect(speedNow(f, jay)).toBeCloseTo(base * (1 + (t("feather", "quicken", 1) * t("feather", "stacks", 1)) / 100));
  });
  test("Crab: roll call. An uncounted crab turns up beside them, as starry as the best of them", () => {
    const f = fightOf([at("crab7", 3, 0, 2), at("crab12", 3, 2)], [at("mud", 3, 3)]);
    const extra = unitOf(f, "uncounted");
    expect(only(f.opening, "summon").map((e) => e.kind)).toEqual(["uncounted"]);
    expect(extra.summoned).toBe(true);
    expect(extra.stars).toBe(2);
    expect(distance(extra.cell, unitOf(f, "crab7").cell)).toBe(1);
    expect(f.standing[0]).toBe(3);
  });
  test("Crab: at the second step it is a big one; with one kind of crab, nobody comes", () => {
    const big = fightOf(
      [at("crab7", 3, 0), at("crab12", 3, 2), at("crab23", 2, 2), at("crab40", 2, 0)],
      [at("mud", 3, 3)],
    );
    expect(unitsOf(big, "biguncounted", 0).length).toBe(1);
    expect(unitsOf(big, "uncounted", 0).length).toBe(0);
    const none = fightOf([at("crab7", 3, 0), at("crab7", 2, 0)], [at("mud", 3, 3)]);
    expect(none.units.filter((u) => u.summoned).length).toBe(0);
  });
  test("Crab: at five, which takes a Crab emblem on a fifth figure, a big one and a small one both come", () => {
    const crabs = [at("crab7", 3, 0), at("crab12", 3, 2), at("crab23", 2, 2), at("crab40", 2, 0)];
    const five = fightOf([...crabs, at("worm", 4, 0, 1, ["crabcharm"])], [at("mud", 3, 3)]);
    expect(five.traits[0].crab).toBe(3);
    expect(only(five.opening, "summon").map((e) => e.kind)).toEqual(["biguncounted", "uncounted"]);
  });
  test("Crab: a Crab emblem's holder answers roll call as a crab, and its stars count", () => {
    const f = fightOf([at("crab7", 3, 0), at("worm", 1, 3, 2, ["crabcharm"])], [at("mud", 3, 3)]);
    const extra = unitOf(f, "uncounted");
    expect(extra.stars).toBe(2);
    const first = f.units.find((u) => u.side === 0 && (u.kind === "crab7" || u.kind === "worm"));
    expect(distance(extra.cell, first?.cell ?? -1)).toBe(1);
  });
  test("Gnome: Gnome figures have more health, more at the second step; nobody else does", () => {
    const two = fightOf([at("barrowgnome", 3, 0), at("lanterngnome", 3, 2), at("finch", 2, 2)], [at("mud", 3, 3)]);
    expect(unitOf(two, "barrowgnome").maxHp).toBe(Math.round(FIGURES.barrowgnome.hp * gnomeHealth(1)));
    expect(unitOf(two, "barrowgnome").hp).toBe(unitOf(two, "barrowgnome").maxHp);
    expect(unitOf(two, "finch").maxHp).toBe(FIGURES.finch.hp);
    const four = fightOf(
      [at("barrowgnome", 3, 0), at("lanterngnome", 3, 2), at("bushgnome", 2, 0), at("apothecary", 2, 2)],
      [at("mud", 3, 3)],
    );
    expect(unitOf(four, "apothecary").maxHp).toBe(Math.round(FIGURES.apothecary.hp * gnomeHealth(2)));
  });
});

describe("callings", () => {
  test("Bulwark: armour for Bulwarks, and at the second step some for everyone else", () => {
    const two = fightOf([at("barrowgnome", 3, 0), at("slug", 2, 0), at("finch", 3, 2)], [at("mud", 3, 3)]);
    expect(unitOf(two, "slug").armour).toBe(FIGURES.slug.armour + t("bulwark", "armour", 1));
    expect(unitOf(two, "finch").armour).toBe(FIGURES.finch.armour);
    const four = fightOf(
      [at("barrowgnome", 3, 0), at("slug", 2, 0), at("glorp", 4, 0), at("crab40", 1, 0), at("finch", 3, 2)],
      [at("mud", 3, 3)],
    );
    expect(unitOf(four, "slug").armour).toBe(FIGURES.slug.armour + t("bulwark", "armour", 2));
    expect(unitOf(four, "finch").armour).toBe(FIGURES.finch.armour + t("bulwark", "party", 2));
  });
  test("Fang: more attack, and some attacks land hard for half as much again", () => {
    const f = fightOf([at("crab7", 3, 0), at("emberkit", 2, 0)], [at("mud", 3, 0)]);
    stillSide(f, 1);
    const crab = unitOf(f, "crab7");
    expect(crab.attack).toBe(Math.round(FIGURES.crab7.attack * (1 + t("fang", "attack", 1) / 100)));
    expect(crab.crit).toBe(t("fang", "crit", 1));
    for (const u of f.units) u.manaFull = 0;
    unitOf(f, "emberkit").attack = 0;
    crab.speed = HZ;
    const hits = only(steps(f, FIGHT.dusk * HZ - 1), "hit").filter((e) => e.by === crab.id);
    const hard = hits.filter((e) => e.hard);
    expect(hits.length).toBeGreaterThan(500);
    expect(hard.length / hits.length).toBeGreaterThan(t("fang", "crit", 1) / 100 - 0.05);
    expect(hard.length / hits.length).toBeLessThan(t("fang", "crit", 1) / 100 + 0.05);
    for (const h of hard) expect(h.amount).toBe(Math.round(crab.attack * (1 + FIGHT.hard / 100)));
    for (const h of hits) if (!h.hard) expect(h.amount).toBe(crab.attack);
  });
  test("Slinger: a hex more reach, and each attack on the same target does more than the last", () => {
    const f = fightOf([at("finch", 3, 2), at("chickaree", 2, 2)], [at("mud", 3, 0)]);
    stillSide(f, 1);
    const finch = unitOf(f, "finch");
    expect(finch.range).toBe(FIGURES.finch.range + t("slinger", "reach", 1));
    for (const u of f.units) u.manaFull = 0;
    unitOf(f, "chickaree").attack = 0;
    const hits = only(steps(f, 12 * HZ), "hit").filter((e) => e.by === finch.id);
    const most = t("slinger", "most", 1);
    expect(hits.length).toBeGreaterThan(most + 1);
    hits.forEach((h, i) => {
      const built = Math.min(i, most);
      expect(h.amount).toBe(Math.round(finch.attack * (1 + (built * t("slinger", "focus", 1)) / 100)));
    });
  });
  test("Sage: stronger abilities and more mana from every attack", () => {
    const f = fightOf([at("moth", 3, 2), at("lanterngnome", 2, 2)], [at("mud", 3, 0)]);
    stillSide(f, 1);
    const moth = unitOf(f, "moth");
    expect(moth.power).toBe(100 + t("sage", "power", 1));
    const start = moth.mana;
    unitOf(f, "lanterngnome").manaFull = 0;
    stepUntil(f, (e) => e.t === "shot" && e.id === moth.id);
    expect(moth.mana).toBe(start + FIGHT.manaAttack + t("sage", "mana", 1));
    // And the ability lands for that much more.
    moth.mana = moth.manaFull;
    const cast = stepUntil(f, (e) => e.t === "hit" && e.source === "ability");
    const dust = only(cast, "hit").find((e) => e.source === "ability");
    const plain = specOf("moth").ability?.n.damage?.[0] ?? 0;
    expect(dust?.amount).toBe(Math.round((plain * (100 + t("sage", "power", 1))) / 100));
  });
  test("Mender: their healing and shields count for more", () => {
    const f = fightOf([at("mossmote", 3, 2), at("kettle", 2, 2), at("crab7", 3, 0)], [at("mud", 3, 3)]);
    const crab = unitOf(f, "crab7");
    const kettle = unitOf(f, "kettle");
    crab.maxHp = 5000;
    crab.hp = 1000;
    const more = 1 + t("mender", "mending", 1) / 100;
    expect(heal(f, crab, 100, "ability", kettle)).toBe(100 * more);
    expect(heal(f, crab, 100, "ability", crab)).toBe(100);
    expect(shieldUp(f, crab, 100, 2, kettle)).toBe(100 * more);
  });
  test("Sneak: they leap to the enemy's back row as the fight starts, and their first hits land hard", () => {
    const f = fightOf([at("worm", 1, 3), at("bushgnome", 5, 3)], [at("mud", 3, 0), at("mud", 3, 3)]);
    const leaps = only(f.opening, "leap");
    expect(leaps.length).toBe(2);
    for (const l of leaps) {
      expect(l.why).toBe("sneak");
      expect(rowOf(l.to)).toBe(backRow(1));
      expect(rowOf(l.from)).toBe(backRow(0));
    }
    stillSide(f, 1);
    const worm = unitOf(f, "worm");
    for (const u of f.units) u.manaFull = 0;
    unitOf(f, "bushgnome").attack = 0;
    const hits = only(steps(f, 8 * HZ), "hit").filter((e) => e.by === worm.id);
    const first = t("sneak", "hits", 1);
    expect(hits.length).toBeGreaterThan(first);
    hits.forEach((h, i) => {
      expect(h.hard).toBe(i < first);
      expect(h.amount).toBe(Math.round(worm.attack * (i < first ? 1 + t("sneak", "extra", 1) / 100 : 1)));
    });
  });
  test("one Sneak alone has no trait, and walks", () => {
    const f = fightOf([at("worm", 1, 3)], [at("mud", 3, 3)]);
    expect(only(f.opening, "leap").length).toBe(0);
    expect(rowOf(unitOf(f, "worm").cell)).toBe(backRow(0));
  });
  test("Greg: what he has eaten is a share of his health, for good, up to a point", () => {
    const hp = gregsHealth;
    const most = t("greg", "most", 1);
    expect(most).toBe(40);
    expect(hp(0)).toBe(FIGURES.greg.hp);
    expect(hp(12)).toBe(Math.round(FIGURES.greg.hp * 1.12));
    expect(hp(most + 50)).toBe(hp(most));
  });
});

describe("boons that travel into a fight", () => {
  test("Head Start: everyone starts with more mana", () => {
    const f = fightOf([at("crab7", 3, 0)], [at("mud", 3, 3)], { ours: { boons: ["headstart"] } });
    expect(unitOf(f, "crab7").mana).toBe(FIGURES.crab7.mana[0] + boonNumber("headstart", "mana"));
  });
  test("Tidy Formation: armour in the front row, quicker attacks in the back row", () => {
    const f = fightOf([at("crab7", 3, 0), at("emberkit", 3, 1), at("finch", 3, 3)], [at("mud", 3, 3)], {
      ours: { boons: ["formation"] },
    });
    // Crab #7 and Emberkit are both Fangs, which changes neither armour nor speed.
    expect(unitOf(f, "crab7").armour).toBe(FIGURES.crab7.armour + boonNumber("formation", "armour"));
    expect(unitOf(f, "emberkit").armour).toBe(FIGURES.emberkit.armour);
    expect(unitOf(f, "finch").speed).toBeCloseTo(FIGURES.finch.speed * (1 + boonNumber("formation", "speed") / 100));
    expect(unitOf(f, "crab7").speed).toBe(FIGURES.crab7.speed);
  });
  test("Small Fry: one- and two-acorn figures are sturdier and hit harder; dearer ones are as they were", () => {
    const f = fightOf([at("crab7", 3, 0), at("badger", 2, 0)], [at("mud", 3, 3)], { ours: { boons: ["smallfry"] } });
    const more = 1 + boonNumber("smallfry", "boost") / 100;
    expect(unitOf(f, "crab7").maxHp).toBe(Math.round(FIGURES.crab7.hp * more));
    expect(unitOf(f, "badger").maxHp).toBe(FIGURES.badger.hp);
  });
  test("the same things on the other side of the table work the same way", () => {
    const f = fightOf([at("mud", 3, 3)], [at("crab7", 3, 0), at("crab12", 3, 2), at("worm", 2, 2, 1, ["crabcharm"])], {
      theirs: { boons: ["headstart"] },
    });
    expect(unitOf(f, "crab7", 1).mana).toBe(FIGURES.crab7.mana[0] + boonNumber("headstart", "mana"));
    expect(unitsOf(f, "uncounted", 1).length).toBe(1);
    expect(f.traits[1].crab).toBe(1);
    // Three crabs' worth with the emblem is still the first step: the second wants four.
    expect(onCell("mud", 0, cellAt(0, 7)).seat).toBe(21);
  });
});
