/** Traits and boons, each checked against its own sentence as it plays out in a fight. */
import { describe, expect, test } from "bun:test";

import { boonNumber } from "../content/boons.ts";
import { FIGURES, specOf } from "../content/figures.ts";
import { FIGHT } from "../content/rooms.ts";
import { traitNumber } from "../content/traits.ts";
import { backRow, cellAt, distance, rowOf } from "../hex.ts";
import { countTraits, traitStates, traitSteps } from "../party.ts";
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
import { heal, hurt, HZ, shieldUp } from "./core.ts";
import { speedNow } from "./engine.ts";

const t = traitNumber;
/** Greg's health at the start of a fight, having eaten a number of times. */
const gregsHealth = (fed: number): number => {
  const f = fightOf([{ kind: "greg", stars: 1, seat: 3, items: [], fed }], [at("mud", 3, 3)]);
  return unitOf(f, "greg").maxHp;
};

describe("counting traits", () => {
  test("a trait counts each different figure once, however many copies are fielded", () => {
    const counts = countTraits(["crab7", "crab7", "crab7", "emberkit"]);
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
    expect(countTraits(["crab", "uncounted", "glorplet", "gnat"])).toEqual({});
  });
  test("a charm counts as one more", () => {
    expect(traitSteps(partyOfFigures([at("crab7", 0, 0)], { charms: ["crab"] })).crab).toBe(1);
    const three = partyOfFigures([at("crab7", 0, 0), at("crab12", 1, 0), at("crab23", 2, 0)], { charms: ["crab"] });
    expect(traitSteps(three).crab).toBe(2);
  });
  test("a figure with a third trait counts toward all three", () => {
    const counts = countTraits(["whitefox", "hearthcat", "greg"]);
    expect(counts).toEqual({ mist: 1, fang: 2, sage: 1, ember: 1, sneak: 1, moss: 1, bulwark: 1, greg: 1 });
  });
  test("the states list what is on first", () => {
    const states = traitStates(countTraits(["crab7", "crab12", "emberkit"]));
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

    const hot = fightOf(
      [at("emberkit", 3, 0), at("kettle", 3, 2), at("cindernewt", 2, 1), at("crab12", 2, 2)],
      [at("mud", 3, 0)],
      { ours: { charms: ["ember"] } },
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
  test("Burrow: Burrow figures dig in for armour, and go to ground the first time they drop under half", () => {
    const f = fightOf([at("worm", 3, 0), at("chickaree", 3, 2), at("crab7", 2, 0)], [at("mud", 3, 3)]);
    stillSide(f, 1);
    const worm = unitOf(f, "worm");
    const foe = unitOf(f, "mud", 1);
    expect(worm.armour).toBe(FIGURES.worm.armour + t("burrow", "armour", 1));
    expect(unitOf(f, "crab7").armour).toBe(FIGURES.crab7.armour);
    worm.manaFull = 0;
    f.out = [];
    hurt(f, worm, worm.maxHp * 0.6, "true", "attack", foe);
    const under = only(f.out, "status").find((e) => e.status === "hidden" && e.on);
    expect(under?.ticks).toBe(t("burrow", "under", 1) * HZ);
    const hp = worm.hp;
    // Nothing reaches it down there.
    expect(hurt(f, worm, 500, "true", "attack", foe)).toBe(0);
    expect(worm.hp).toBe(hp);
    const events = steps(f, t("burrow", "under", 1) * HZ);
    expect(only(events, "swing").some((e) => e.id === worm.id)).toBe(false);
    const up = only(events, "heal").find((e) => e.source === "burrow");
    expect(up?.amount).toBe(Math.round((worm.maxHp * t("burrow", "heal", 1)) / 100));
    // Only the once.
    f.out = [];
    hurt(f, worm, 1, "true", "attack", foe);
    expect(only(f.out, "status").some((e) => e.status === "hidden")).toBe(false);
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
  test("Greg: every time he has eaten he is a little bigger, up to a point", () => {
    const hp = gregsHealth;
    const grows = t("greg", "grows", 1);
    const most = t("greg", "most", 1);
    expect(hp(0)).toBe(FIGURES.greg.hp);
    expect(hp(4)).toBe(Math.round(FIGURES.greg.hp * (1 + (4 * grows) / 100)));
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
    const f = fightOf([at("mud", 3, 3)], [at("crab7", 3, 0), at("crab12", 3, 2)], {
      theirs: { boons: ["headstart"], charms: ["crab"] },
    });
    expect(unitOf(f, "crab7", 1).mana).toBe(FIGURES.crab7.mana[0] + boonNumber("headstart", "mana"));
    expect(unitsOf(f, "uncounted", 1).length).toBe(1);
    expect(f.traits[1].crab).toBe(1);
    // Three crabs' worth with the charm is still the first step: the second wants four.
    expect(onCell("mud", 0, cellAt(0, 7)).seat).toBe(21);
  });
});
