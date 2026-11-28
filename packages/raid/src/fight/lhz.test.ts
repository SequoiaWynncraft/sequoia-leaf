/**
 * LHZ, the strike team, against its sentences in a fight of Penguin Month's era: more mana at the
 * start at each step, and at the second step a cast that feeds every other LHZ through the gift's
 * cap; the Honorary Badge counting as one more; nothing for a figure without it. Vi, from Up The
 * Tree, is one too.
 */
import { describe, expect, test } from "bun:test";

import { catalogAt } from "../content/catalog.ts";
import { specOf, type UnitKind } from "../content/figures.ts";
import { eraOf } from "../content/releases.ts";
import { FIGHT } from "../content/rooms.ts";
import { traitNumber } from "../content/traits.ts";
import { cellAt } from "../hex.ts";
import type { Placed } from "../party.ts";
import { onCell, partyOfFigures, ready, steps, stepUntil, still, unitOf, unitsOf } from "../testkit.ts";
import { openFight } from "./engine.ts";
import type { Fight, FightEvent, Unit } from "./types.ts";

const PENGUINS = eraOf("penguin-month");
const PM = catalogAt(PENGUINS);
const mana = (step: number): number => traitNumber(PM, "lhz", "mana", step);
const gift = (step: number): number => traitNumber(PM, "lhz", "gift", step);
const start = (kind: UnitKind): number => specOf(PM, kind).mana[0];

const HOME = cellAt(3, 4);
const RIGHT = cellAt(4, 4);
const LEFT = cellAt(2, 4);
const FAR = cellAt(0, 0);

const fight = (ours: Placed[], era = PENGUINS): Fight =>
  openFight({ seed: 7, era, sides: [partyOfFigures(ours), partyOfFigures([onCell("mud", 1, FAR)])] });
const castBy = (u: Unit) => (e: FightEvent) => e.t === "cast" && e.id === u.id;
/** Keeps a figure where it is, with no attack and an empty mana bar, so only a gift fills it. */
function waiting(u: Unit): Unit {
  u.attack = 0;
  u.rooted = true;
  u.mana = 0;
  return u;
}
/** A fight whose foe stands still far away, Dibs about to cast, and everyone else waiting. */
function dibsCasts(ours: Placed[], era = PENGUINS): { f: Fight; dibs: Unit } {
  const f = fight(ours, era);
  for (const o of f.units) if (o.side === 1) still(o);
  for (const o of f.units) if (o.side === 0) waiting(o);
  const dibs = ready(unitOf(f, "dibs"));
  stepUntil(f, castBy(dibs));
  return { f, dibs };
}

describe("LHZ", () => {
  test("1: one LHZ figure starts the fight with more mana; a figure without it, with its own", () => {
    const f = fight([onCell("yule", 0, HOME), onCell("dibs", 0, RIGHT)]);
    expect(f.traits[0].lhz).toBe(1);
    expect([unitOf(f, "yule").mana, unitOf(f, "dibs").mana]).toEqual([start("yule") + mana(1), start("dibs")]);
  });

  test("2: the Honorary Badge makes its holder an LHZ and counts as one more, and both start with more", () => {
    const f = fight([onCell("yule", 0, HOME), onCell("dibs", 0, RIGHT, 1, ["lhzcharm"])]);
    expect(f.traits[0].lhz).toBe(2);
    expect([unitOf(f, "yule").mana, unitOf(f, "dibs").mana]).toEqual([
      start("yule") + mana(2),
      start("dibs") + mana(2),
    ]);
  });

  test("two copies of one figure are one: still the first step", () => {
    const f = fight([onCell("yule", 0, HOME), onCell("yule", 0, LEFT)]);
    expect(f.traits[0].lhz).toBe(1);
  });

  test("2: an LHZ's cast gives every other LHZ the gift, and nobody else", () => {
    const { f, dibs } = dibsCasts([
      onCell("dibs", 0, HOME, 1, ["lhzcharm"]),
      onCell("yule", 0, RIGHT),
      onCell("jet", 0, LEFT),
    ]);
    expect(f.traits[0].lhz).toBe(2);
    expect([dibs.mana, unitOf(f, "yule").mana, unitOf(f, "jet").mana]).toEqual([0, gift(2), 0]);
  });

  test("1: no gift, even to a second copy", () => {
    const { f } = dibsCasts([onCell("dibs", 0, HOME, 1, ["lhzcharm"]), onCell("dibs", 0, RIGHT, 1, ["lhzcharm"])]);
    expect(f.traits[0].lhz).toBe(1);
    expect(gift(1)).toBe(0);
    expect(unitsOf(f, "dibs", 0).map((u) => u.mana)).toEqual([0, 0]);
  });

  test("2: the gift goes through the cap on what friends' abilities give one figure", () => {
    const f = fight([onCell("dibs", 0, HOME, 1, ["lhzcharm"]), onCell("yule", 0, RIGHT)]);
    for (const o of f.units) if (o.side === 1) still(o);
    for (const o of f.units) if (o.side === 0) waiting(o);
    const [dibs, yule] = [ready(unitOf(f, "dibs")), unitOf(f, "yule")];
    // Given nearly all a figure may receive just before Dibs casts: only what is left of it.
    const left = 5;
    for (let i = 0; i < 1200 && dibs.casts === 0; i++) {
      yule.gifts = [{ at: f.tick, n: FIGHT.giftMost - left }];
      steps(f, 1);
    }
    expect([dibs.casts, yule.mana]).toEqual([1, left]);
  });

  test("Up The Tree: Vi is an LHZ, and with Yule turns on the second step", () => {
    const tree = eraOf("up-the-tree");
    const f = fight([onCell("vi", 0, HOME), onCell("yule", 0, RIGHT)], tree);
    expect(f.traits[0].lhz).toBe(2);
    expect(unitOf(f, "vi").mana).toBe(specOf(catalogAt(tree), "vi").mana[0] + mana(2));
  });
});
