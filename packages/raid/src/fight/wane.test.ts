/**
 * From Groot Night on, late in a fight (`FightRules.wanes`, Groot Night's patch): from 20 seconds,
 * healing and shields of every source are 20% weaker, and damage of every kind, to both sides,
 * rises 5% each second, up to 50% more. The base era is fought as it always was. Every heal (an
 * ability's, regrowth, a bite that heals, an item's, a burrow's, a card's), every shield (a
 * figure's, a group's one shield) and every hit comes through the fight's one door for it, so each
 * is changed there.
 */
import { describe, expect, test } from "bun:test";

import { catalogAt, type Era } from "../content/catalog.ts";
import { eraOf, LEGACY_ERA } from "../content/releases.ts";
import { cellAt, type Side } from "../hex.ts";
import { onCell, partyOfFigures, stillSide, unitOf } from "../testkit.ts";
import { secs } from "./clock.ts";
import { heal, hurt, poolUp, shieldUp } from "./core.ts";
import { openFight, stepFight } from "./engine.ts";
import { fly } from "./mind.ts";
import type { DamageKind, DamageSource, Fight, FightEvent, HealSource } from "./types.ts";

const NIGHT = eraOf("groot-night");
const AT = 20;
/** Two plain figures against one, nobody hurting anybody, nothing between a hit and its target: a fight that runs on. */
function quiet(era: Era): Fight {
  const f = openFight({
    seed: 3,
    era,
    sides: [
      partyOfFigures([onCell("worm", 0, cellAt(2, 4)), onCell("moth", 0, cellAt(3, 4))]),
      partyOfFigures([onCell("worm", 1, cellAt(2, 0))]),
    ],
  });
  stillSide(f, 0);
  stillSide(f, 1);
  for (const u of f.units) {
    u.hp = 1000;
    u.armour = 0;
    u.ward = 0;
  }
  return f;
}
const SOURCES: readonly HealSource[] = ["ability", "regrow", "leech", "item", "burrow", "card"];
const KINDS: readonly DamageKind[] = ["physical", "magic", "true"];
const HITS: readonly DamageSource[] = ["attack", "ability", "burn", "thorns", "item"];

describe("late in a fight, from Groot Night: healing and shields wane, damage rises", () => {
  test("the eras: plain before Groot Night; from it on, from 20 seconds", () => {
    const plain = catalogAt(eraOf("gaz-stall")).fight;
    expect([plain.wanes, plain.wane, plain.rises, catalogAt(LEGACY_ERA).fight.rises]).toEqual([
      Number.POSITIVE_INFINITY,
      0,
      0,
      0,
    ]);
    for (const release of ["groot-night", "penguin-month", "up-the-tree", "up-the-tree-ends"] as const) {
      const { wanes, wane, rises, risesMost } = catalogAt(eraOf(release)).fight;
      expect([release, wanes, wane, rises, risesMost]).toEqual([release, AT, 20, 5, 50]);
    }
    // Bound with its room's rules: a fight opened in the era has it.
    expect([quiet(NIGHT).wilds.wanes, quiet(LEGACY_ERA).wilds.wanes]).toEqual([AT, Number.POSITIVE_INFINITY]);
  });

  test("every heal, of every source, a tick before 20 seconds as it comes and at 20 a fifth less", () => {
    const f = quiet(NIGHT);
    const u = unitOf(f, "worm");
    const healed = (tick: number, source: HealSource): number => {
      f.tick = tick;
      u.hp = 500;
      return heal(f, u, 100, source, null);
    };
    expect(SOURCES.map((s) => [s, healed(secs(AT) - 1, s), healed(secs(AT), s)])).toEqual(
      SOURCES.map((s) => [s, 100, 80]),
    );
  });

  test("every shield, a figure's and a group's, a tick before 20 seconds as it comes and at 20 a fifth less", () => {
    const f = quiet(NIGHT);
    const u = unitOf(f, "worm");
    f.tick = secs(AT) - 1;
    expect(shieldUp(f, u, 100, 0, null)).toBe(100);
    f.tick = secs(AT);
    expect(shieldUp(f, u, 100, 0, null)).toBe(80);
    poolUp(f, [u, unitOf(f, "moth")], 300, 0, 6);
    expect(f.pools.at(-1)?.left).toBe(240);
  });

  test("damage of every kind and source, to both sides: 5% more each second begun from 20, up to 50% more", () => {
    const f = quiet(NIGHT);
    /** What a hit of 100 does at a moment, to a side's worm, by the other side's. */
    const lands = (tick: number, side: Side, kind: DamageKind, source: DamageSource): number => {
      f.tick = tick;
      const [target, by] = [unitOf(f, "worm", side), unitOf(f, "worm", side === 0 ? 1 : 0)];
      target.hp = 100_000;
      target.shield = 0;
      target.shields = [];
      return hurt(f, target, 100, kind, source, by);
    };
    const moments = [secs(AT) - 1, secs(AT), secs(AT + 1), secs(AT + 3) + 5, secs(AT + 9), secs(AT + 60)];
    for (const side of [0, 1] as const)
      for (const kind of KINDS)
        for (const source of HITS) {
          expect([side, kind, source, moments.map((t) => lands(t, side, kind, source))]).toEqual([
            side,
            kind,
            source,
            [100, 105, 110, 120, 150, 150],
          ]);
        }
    // Dusk's own hurt grows by its own count, and is left as it is.
    expect(lands(secs(AT + 15), 0, "true", "dusk")).toBe(100);
  });

  test("Mender's overflow: the heal is cut once, and what is past full health turns into a shield as it is", () => {
    const f = quiet(NIGHT);
    const [target, by] = [unitOf(f, "worm"), unitOf(f, "moth")];
    Object.assign(by, { mending: 25, overheal: 100, overhealFor: 4 });
    const overflowed = (tick: number): number => {
      f.tick = tick;
      Object.assign(target, { maxHp: 1000, hp: 1000, shield: 0, shields: [] });
      heal(f, target, 100, "ability", by);
      return target.shield;
    };
    // 100, 25% more for Mender: 125 past full; at 20 seconds a fifth less, 100, and no fifth off that again.
    expect([overflowed(secs(AT) - 1), overflowed(secs(AT))]).toEqual([125, 100]);
  });

  test("a figure picking a target counts damage on its way as it will land: risen by then", () => {
    const f = quiet(NIGHT);
    const target = unitOf(f, "worm", 1);
    const counted = (tick: number, ticks: number): number => {
      f.tick = tick;
      target.incoming = 0;
      fly(f, target, 100, "true", ticks, () => {});
      return target.incoming;
    };
    // Thrown a tick before 20 seconds, landing at 20: 5% more. Thrown at 23, landing a tick later: 20% more.
    expect([counted(secs(AT) - 2, 1), counted(secs(AT) - 1, 1), counted(secs(AT + 3), 1)]).toEqual([100, 105, 120]);
  });

  test("the fight sheet counts what armour stopped against the risen damage", () => {
    const f = quiet(NIGHT);
    const [target, by] = [unitOf(f, "worm", 1), unitOf(f, "worm", 0)];
    Object.assign(target, { armour: 100, hp: 100_000, shield: 0, shields: [] });
    f.tick = secs(AT + 1);
    const hits: FightEvent[] = [];
    const was = f.out;
    f.out = hits;
    hurt(f, target, 100, "physical", "attack", by);
    f.out = was;
    // 110 thrown, risen; armour 100 halves it to 55: 55 stopped, of 110.
    expect(hits.find((ev) => ev.t === "hit")).toMatchObject({ amount: 55, before: 110 });
  });

  test("in the base era nothing changes, however late", () => {
    const f = quiet(LEGACY_ERA);
    const u = unitOf(f, "worm");
    f.tick = secs(AT * 2);
    u.hp = 500;
    expect([heal(f, u, 100, "regrow", null), shieldUp(f, u, 100, 0, null)]).toEqual([100, 100]);
    u.hp = 100_000;
    u.shield = 0;
    u.shields = [];
    expect(hurt(f, u, 100, "physical", "attack", unitOf(f, "worm", 1))).toBe(100);
  });

  test("the fight says so once, at its moment, with its numbers, and never in the base era", () => {
    const said = (era: Era): { at: number; ev: FightEvent }[] => {
      const f = quiet(era);
      const out: { at: number; ev: FightEvent }[] = [];
      while (!f.over && f.tick < secs(AT + 3))
        for (const ev of stepFight(f)) if (ev.t === "wane") out.push({ at: f.tick, ev });
      return out;
    };
    expect(said(NIGHT)).toEqual([{ at: secs(AT), ev: { t: "wane", by: 20, rises: 5, most: 50 } }]);
    expect(said(LEGACY_ERA)).toEqual([]);
  });
});
