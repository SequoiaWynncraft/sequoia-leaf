/**
 * How a figure thinks, rule by rule, on small boards: a heal or a shield waits for somebody who
 * needs it, an area ability waits a moment for a crowd, and nobody wastes a blow on the fallen.
 */
import { describe, expect, test } from "bun:test";

import { FIGHT } from "../content/rooms.ts";
import { cellAt } from "../hex.ts";
import { fightOf, onCell, only, ready, steps, still, stillSide, unitOf, unitsOf } from "../testkit.ts";
import { HZ, leap } from "./core.ts";
import { covered, drawnFoe, fly, wanted } from "./mind.ts";
import type { Fight, Unit } from "./types.ts";

const HOME = cellAt(3, 4);
const NEAR = cellAt(3, 3);

/** A Badger touching one enemy, with two more away across the board. */
function crowdScene(): Fight {
  const f = fightOf(
    [onCell("badger", 0, HOME)],
    [onCell("mud", 1, NEAR), onCell("mud", 1, cellAt(0, 0)), onCell("mud", 1, cellAt(6, 0))],
  );
  stillSide(f, 1);
  ready(unitOf(f, "badger")).attack = 0;
  return f;
}
/** A Twig Finch with two enemies in its reach, the nearer one at little health. */
function twoInReach(): { f: Fight; near: Unit; other: Unit } {
  const f = fightOf([onCell("finch", 0, cellAt(3, 6))], [onCell("mud", 1, NEAR), onCell("mud", 1, cellAt(2, 2))]);
  stillSide(f, 1);
  const near = unitsOf(f, "mud", 1).find((o) => o.cell === NEAR);
  const other = unitsOf(f, "mud", 1).find((o) => o.cell !== NEAR);
  if (!near || !other) throw new Error("no muds");
  near.hp = 50;
  return { f, near, other };
}

describe("a heal or a shield waits for somebody who needs it", () => {
  test("with every friend above 85% health, a healer keeps its mana and goes on attacking", () => {
    for (const kind of ["mossmote", "kettle", "crab23", "apothecary"] as const) {
      const f = fightOf([onCell(kind, 0, cellAt(3, 5)), onCell("crab7", 0, HOME)], [onCell("mud", 1, NEAR)]);
      stillSide(f, 1);
      const healer = ready(unitOf(f, kind));
      const crab = still(unitOf(f, "crab7"), 1000);
      crab.hp = 860;
      const events = steps(f, 10);
      expect(only(events, "cast").length, kind).toBe(0);
      expect(healer.mana, kind).toBe(healer.manaFull);
      expect(healer.attacks, kind).toBeGreaterThan(0);
      // At 85% somebody needs it.
      crab.hp = 850;
      expect(only(steps(f, 2), "cast").length, kind).toBe(1);
    }
  });
  test("the Apothecary Gnome counts only the friends its tonic reaches, itself among them", () => {
    const f = fightOf([onCell("apothecary", 0, HOME), onCell("crab7", 0, cellAt(0, 7))], [onCell("mud", 1, NEAR)]);
    stillSide(f, 1);
    const gnome = ready(unitOf(f, "apothecary"));
    still(unitOf(f, "crab7"), 1000).hp = 100;
    expect(only(steps(f, 5), "cast").length).toBe(0);
    expect(wanted(f, gnome)).toBe(false);
    gnome.hp = Math.round(gnome.maxHp * 0.8);
    expect(wanted(f, gnome)).toBe(true);
  });
  test("an ability that heals nobody is not held back", () => {
    const f = fightOf([onCell("badger", 0, HOME)], [onCell("mud", 1, NEAR)]);
    expect(wanted(f, unitOf(f, "badger"))).toBe(true);
  });
});

describe("an area ability waits a moment for a crowd", () => {
  test("one that would catch one enemy of three waits a second for a second, then goes anyway", () => {
    const f = crowdScene();
    const badger = unitOf(f, "badger");
    expect(only(steps(f, FIGHT.crowdWait), "cast").length).toBe(0);
    expect(badger.mana).toBe(badger.manaFull);
    const cast = only(steps(f, 1), "cast")[0];
    expect(cast?.targets.length).toBe(1);
    expect(f.tick).toBe(1 + FIGHT.crowdWait);
    expect(badger.waitFrom).toBe(-1);
  });
  test("a second enemy coming into it sets it off at once", () => {
    const f = crowdScene();
    expect(only(steps(f, 5), "cast").length).toBe(0);
    const far = unitsOf(f, "mud", 1).find((o) => o.cell === cellAt(0, 0));
    if (!far) throw new Error("no far mud");
    leap(f, far, cellAt(4, 4), "ability");
    expect(only(steps(f, 1), "cast")[0]?.targets.length).toBe(2);
  });
  test("with fewer than three enemies up, it goes at once", () => {
    const f = fightOf([onCell("badger", 0, HOME)], [onCell("mud", 1, NEAR), onCell("mud", 1, cellAt(0, 0))]);
    stillSide(f, 1);
    ready(unitOf(f, "badger")).attack = 0;
    expect(only(steps(f, 1), "cast").length).toBe(1);
  });
});

describe("nobody wastes a blow on the fallen", () => {
  test("a figure picking a target passes over one whose health the damage on its way already covers", () => {
    const { f, near, other } = twoInReach();
    const finch = unitOf(f, "finch");
    expect(drawnFoe(f, finch)?.id).toBe(near.id);
    fly(f, near, 50, "true", 10, () => {});
    expect(covered(f, near)).toBe(true);
    expect(drawnFoe(f, finch)?.id).toBe(other.id);
    // With nobody else in reach, it is picked all the same.
    leap(f, other, cellAt(6, 0), "ability");
    finch.range = 3;
    expect(drawnFoe(f, finch)?.id).toBe(near.id);
  });
  test("one already on a target whose health is covered turns to another in reach", () => {
    const { f, near, other } = twoInReach();
    const finch = unitOf(f, "finch");
    finch.manaFull = 0;
    finch.target = near.id;
    fly(f, near, 50, "physical", 30, () => {});
    // Physical damage meets armour: 50 against no armour covers 50 health.
    expect(covered(f, near)).toBe(true);
    const shot = only(steps(f, 1), "shot")[0];
    expect(shot?.target).toBe(other.id);
  });
  test("what is thrown counts as on its way until it lands, and no longer", () => {
    const { f, other } = twoInReach();
    const finch = unitOf(f, "finch");
    finch.manaFull = 0;
    finch.target = other.id;
    const shot = only(steps(f, 1), "shot")[0];
    expect(shot?.target).toBe(other.id);
    expect(other.incoming).toBeCloseTo(finch.attack);
    steps(f, (shot?.ticks ?? 0) + 1);
    expect(other.incoming).toBeCloseTo(0);
    expect(other.hp).toBeLessThan(other.maxHp);
  });
  test("an ability's throw counts too", () => {
    const { f, near } = twoInReach();
    const finch = ready(unitOf(f, "finch"));
    finch.target = near.id;
    finch.attack = 0;
    steps(f, 1);
    expect(near.incoming).toBeGreaterThan(0);
    steps(f, HZ);
    expect(near.incoming).toBeCloseTo(0);
  });
});
