import { describe, expect, test } from "bun:test";

import { heal, hurt, shieldUp } from "./fight/core.ts";
import { openFight, recordFight, stepFight } from "./fight/engine.ts";
import type { Fight, FightEvent, FightSetup } from "./fight/types.ts";
import { type Did, measureOf, partsOf, tally } from "./tally.ts";
import { at, fightOf, only, partyOfFigures, ready, steps, stepUntil, still, unitOf } from "./testkit.ts";

/** The opening of a fight and whatever was done to it by hand since. */
const sinceStart = (f: Fight): FightEvent[] => [...f.opening, ...f.out];
const rowOf = (rows: readonly Did[], id: number): Did => {
  const d = rows.find((r) => r.id === id);
  if (!d) throw new Error(`no row for ${id}`);
  return d;
};

describe("a hit says what it was before armour and ward", () => {
  test("armour and ward halve it at 100, and true damage meets nothing", () => {
    const f = fightOf([at("crab7", 3, 0)], [at("mud", 3, 0)]);
    const mud = still(unitOf(f, "mud", 1), 1000);
    mud.armour = 100;
    mud.ward = 100;
    f.out = [];
    hurt(f, mud, 100, "physical", "attack", null);
    hurt(f, mud, 60, "magic", "ability", null);
    hurt(f, mud, 30, "true", "burn", null);
    const hits = only(f.out, "hit");
    expect(hits.map((h) => [h.before, h.amount])).toEqual([
      [100, 50],
      [60, 30],
      [30, 30],
    ]);
  });
  test("a braced Rock's hits are less than they were", () => {
    const f = fightOf([at("crab7", 3, 0)], [at("rock", 3, 0)]);
    const rock = still(unitOf(f, "rock", 1), 1000);
    rock.bracedUntil = 999;
    rock.bracedBy = 40;
    f.out = [];
    hurt(f, rock, 100, "physical", "attack", null);
    expect(only(f.out, "hit")[0]).toMatchObject({ before: 100, amount: 60 });
  });
});

describe("the tally", () => {
  test("a hit that fells a figure counts only the health it had left as taken", () => {
    const f = fightOf([at("crab7", 3, 0)], [at("mud", 3, 0)]);
    const crab = unitOf(f, "crab7");
    const mud = still(unitOf(f, "mud", 1), 1000);
    mud.hp = 7;
    f.out = [];
    hurt(f, mud, 100, "true", "attack", crab);
    expect(only(f.out, "hit")[0]).toMatchObject({ amount: 100, lost: 7 });
    const rows = tally(sinceStart(f));
    expect(rowOf(rows, mud.id).taken).toBe(7);
    expect(rowOf(rows, crab.id).true).toBe(100);
  });

  test("damage is split by kind, and what came at a figure is split into taken and kept off", () => {
    const f = fightOf([at("crab7", 3, 0)], [at("mud", 3, 0)]);
    const crab = unitOf(f, "crab7");
    const mud = still(unitOf(f, "mud", 1), 1000);
    mud.armour = 100;
    f.out = [];
    shieldUp(f, mud, 20, 0, null);
    hurt(f, mud, 100, "physical", "attack", crab); // 50 after armour, 20 of it on the shield
    hurt(f, mud, 40, "magic", "ability", crab); // no ward: 40
    hurt(f, mud, 15, "true", "burn", crab);
    hurt(f, mud, 10, "true", "dusk", null); // nobody's
    const rows = tally(sinceStart(f));
    expect(rowOf(rows, crab.id)).toMatchObject({ physical: 50, magic: 40, true: 15 });
    expect(rowOf(rows, mud.id)).toMatchObject({ taken: 30 + 40 + 15 + 10, kept: 50 + 20, shielded: 20 });
    expect(measureOf(rowOf(rows, crab.id), "damage")).toBe(105);
    expect(partsOf(rowOf(rows, mud.id), "tanked")).toEqual([95, 70]);
  });
  test("healing and shields count for whoever gave them; healing nobody gave is the figure's own", () => {
    const f = fightOf([at("kettle", 3, 2), at("crab7", 3, 0)], [at("mud", 3, 0)]);
    const kettle = unitOf(f, "kettle");
    const crab = unitOf(f, "crab7");
    crab.hp = 100;
    f.out = [];
    heal(f, crab, 50, "ability", kettle);
    shieldUp(f, crab, 30, 4, kettle);
    heal(f, crab, 7, "regrow", null);
    const rows = tally(sinceStart(f));
    expect(rowOf(rows, kettle.id)).toMatchObject({ healed: 50, shielded: 30 });
    expect(rowOf(rows, crab.id)).toMatchObject({ healed: 7, shielded: 0 });
    expect(partsOf(rowOf(rows, kettle.id), "healing")).toEqual([50, 30]);
  });
  test("whoever brings a figure down has felled it, and the fallen no longer stand", () => {
    const f = fightOf([at("crab7", 3, 0)], [at("gnat", 3, 0), at("gnat", 5, 0)]);
    const crab = unitOf(f, "crab7");
    const [a, b] = f.units.filter((u) => u.side === 1);
    if (!a || !b) throw new Error("two gnats");
    f.out = [];
    hurt(f, a, 9999, "true", "item", crab);
    const rows = tally(
      sinceStart(f),
      f.units.map((u) => u.id),
    );
    expect(rowOf(rows, crab.id).felled).toBe(1);
    expect(rowOf(rows, a.id).stood).toBe(false);
    expect(rowOf(rows, b.id).stood).toBe(true);
  });
  test("what a summoned figure does counts for its summoner, and it has no entry of its own", () => {
    const f = fightOf([at("glorp", 3, 0)], [at("mud", 3, 0)]);
    const glorp = ready(unitOf(f, "glorp"));
    const mud = still(unitOf(f, "mud", 1), 5000);
    const events = [...f.opening, ...stepUntil(f, (e) => e.t === "summon")];
    const glorplet = f.units.find((u) => u.kind === "glorplet");
    if (!glorplet) throw new Error("no glorplet");
    events.push(...steps(f, 200));
    // The glorplet bites the mud, and is hurt by nobody.
    f.out = [];
    hurt(f, glorplet, 9999, "true", "item", mud);
    events.push(...f.out);
    const rows = tally(events);
    expect(rows.some((r) => r.id === glorplet.id)).toBe(false);
    const bitten = only(events, "hit")
      .filter((h) => h.by === glorplet.id)
      .reduce((n, h) => n + h.amount, 0);
    expect(bitten).toBeGreaterThan(0);
    expect(rowOf(rows, glorp.id).physical).toBe(glorp.dealt + glorplet.dealt);
    expect(rowOf(rows, glorp.id).taken).toBeGreaterThan(0);
    // The glorplet fell; Glorp still stands.
    expect(rowOf(rows, glorp.id).stood).toBe(true);
    expect(rowOf(rows, mud.id).felled).toBe(1);
  });
  test("figures that have done nothing yet are there when asked for", () => {
    const f = openFight({ seed: 1, sides: [partyOfFigures([at("rock", 3, 0)]), partyOfFigures([at("rock", 3, 0)])] });
    const rows = tally([], [0, 1]);
    expect(rows.map((r) => r.id)).toEqual([0, 1]);
    expect(rows.every((r) => measureOf(r, "damage") === 0 && r.stood)).toBe(true);
    expect(f.units.length).toBe(2);
  });
  test("over a whole fight it agrees with what the fight counted for itself", () => {
    const setup: FightSetup = {
      seed: 5,
      sides: [
        partyOfFigures([
          at("crab7", 3, 0, 2, ["wasptail"]),
          at("glorp", 2, 0),
          at("emberkit", 4, 0),
          at("kettle", 3, 2),
          at("mossmote", 1, 2),
        ]),
        partyOfFigures([
          at("barrowgnome", 3, 0, 2),
          at("crab12", 2, 2),
          at("moth", 4, 2, 1, ["mosscharm"]),
          at("cindernewt", 3, 1),
        ]),
      ],
    };
    const tape = recordFight(setup);
    const events = [...tape.opening, ...tape.steps.flat()];
    const f = openFight(setup);
    while (!f.over) stepFight(f);
    const rows = tally(events);
    for (const u of f.units) {
      if (u.summoned && u.owner >= 0) continue;
      const own = f.units.filter((o) => o.id === u.id || o.owner === u.id);
      const d = rowOf(rows, u.id);
      expect(measureOf(d, "damage"), u.name).toBe(own.reduce((n, o) => n + o.dealt, 0));
      // The fight counts all of a felling hit; the tally only the health there was left to lose.
      const past = only(events, "hit")
        .filter((h) => own.some((o) => o.id === h.id))
        .reduce((n, h) => n + h.amount - h.soaked - h.lost, 0);
      expect(d.taken + d.kept, u.name).toBeGreaterThanOrEqual(own.reduce((n, o) => n + o.taken, 0) - past);
      expect(d.stood, u.name).toBe(u.alive);
    }
    const ends = only(events, "end");
    expect(ends.length).toBe(1);
  });
});
