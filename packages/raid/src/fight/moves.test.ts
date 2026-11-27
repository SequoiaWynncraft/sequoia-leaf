/**
 * The verbs that move figures about or take time, each on a board set up for it: dash, pull, zone,
 * channel and telegraph; and a fight full of the figures that use them, played twice.
 */
import { describe, expect, test } from "bun:test";

import { LEGACY_ERA } from "../content/releases.ts";
import { FIGHT } from "../content/rooms.ts";
import { cellAt, distance, neighbours, walkLength } from "../hex.ts";
import { fightOf, onCell, only, partyOfFigures, steps, still, unitOf } from "../testkit.ts";
import { hurt, HZ, leap, stun, targetable } from "./core.ts";
import { recordFight, speedNow } from "./engine.ts";
import { channel, dash, pull, slowNow, telegraph, zone } from "./moves.ts";
import type { Fight, FightSetup, Unit } from "./types.ts";

const HOME = cellAt(3, 4);
const NEAR = cellAt(3, 3);

/** A Dusk Jay of ours at the back and a plain target of theirs, neither of which does anything by itself. */
function quiet(ours: Parameters<typeof fightOf>[0] = [], theirs: Parameters<typeof fightOf>[1] = []): Fight {
  const f = fightOf([onCell("jay", 0, cellAt(3, 7)), ...ours], [onCell("mud", 1, cellAt(3, 0)), ...theirs]);
  for (const u of f.units) still(u);
  f.out = [];
  return f;
}
const at = (f: Fight, cell: number): Unit => {
  const u = f.units.find((o) => o.cell === cell);
  if (!u) throw new Error(`nobody on ${cell}`);
  return u;
};

describe("dash", () => {
  test("runs to a free hex along a free way, 2 steps a hex, and can be hit on the way", () => {
    const f = quiet();
    const jay = unitOf(f, "jay");
    jay.rooted = false;
    expect(dash(f, jay, HOME)).toBe(true);
    expect(only(f.out, "leap")).toEqual([{ t: "leap", id: jay.id, from: cellAt(3, 7), to: HOME, why: "dash" }]);
    expect(jay.cell).toBe(HOME);
    expect(f.taken[HOME]).toBe(jay.id);
    expect(jay.busyUntil).toBe(f.tick + 3 * FIGHT.dash);
    expect(targetable(f, jay)).toBe(true);
  });
  test("goes round whoever is in the way, and the way round is what it takes", () => {
    const wall = [cellAt(2, 6), cellAt(3, 6), cellAt(4, 6), cellAt(2, 5), cellAt(3, 5)];
    const f = quiet(wall.map((c) => onCell("crab7", 0, c)));
    const jay = unitOf(f, "jay");
    jay.rooted = false;
    const way = walkLength(f.taken, jay.cell, HOME);
    expect(way).toBeGreaterThan(distance(jay.cell, HOME));
    expect(dash(f, jay, HOME)).toBe(true);
    expect(jay.busyUntil).toBe(f.tick + way * FIGHT.dash);
  });
  test("onto a taken hex, with no free way, or rooted, it does not go", () => {
    const f = quiet([], [onCell("mud", 1, NEAR)]);
    const jay = unitOf(f, "jay");
    jay.rooted = false;
    expect(dash(f, jay, NEAR)).toBe(false);
    const boxed = quiet(neighbours(cellAt(3, 7)).map((c) => onCell("crab7", 0, c)));
    const stuck = unitOf(boxed, "jay");
    stuck.rooted = false;
    expect(dash(boxed, stuck, HOME)).toBe(false);
    expect(dash(f, still(jay), HOME)).toBe(false);
    expect(only([...f.out, ...boxed.out], "leap").length).toBe(0);
  });
});

describe("pull", () => {
  test("moves an enemy one hex toward a figure, onto a free hex", () => {
    const f = quiet([onCell("crab40", 0, HOME)], [onCell("gnat", 1, cellAt(3, 2))]);
    const crab = unitOf(f, "crab40");
    const gnat = unitOf(f, "gnat", 1);
    gnat.rooted = false;
    expect(pull(f, crab, gnat)).toBe(true);
    expect(distance(gnat.cell, HOME)).toBe(1);
    expect(only(f.out, "leap")[0]).toMatchObject({ id: gnat.id, from: cellAt(3, 2), why: "pull" });
  });
  test("only onto a free hex: with every hex nearer taken, it stays", () => {
    const from = cellAt(3, 2);
    const nearer = neighbours(from).filter((c) => distance(c, HOME) < distance(from, HOME));
    const f = quiet([onCell("crab40", 0, HOME)], [onCell("gnat", 1, from), ...nearer.map((c) => onCell("mud", 1, c))]);
    const gnat = unitOf(f, "gnat", 1);
    gnat.rooted = false;
    expect(pull(f, unitOf(f, "crab40"), gnat)).toBe(false);
    expect(gnat.cell).toBe(from);
  });
  test("a Rock stays, and so does anything too big", () => {
    const f = quiet([onCell("crab40", 0, HOME)], [onCell("rock", 1, cellAt(3, 2)), onCell("bigcrab", 1, cellAt(5, 2))]);
    const crab = unitOf(f, "crab40");
    for (const kind of ["rock", "bigcrab"] as const) {
      const o = unitOf(f, kind, 1);
      o.rooted = kind === "rock";
      expect(pull(f, crab, o)).toBe(false);
    }
  });
});

describe("zone", () => {
  test("slows enemies standing in it, not friends, while it lasts", () => {
    const f = quiet([onCell("crab7", 0, HOME)], [onCell("gnat", 1, NEAR)]);
    const jay = unitOf(f, "jay");
    const gnat = unitOf(f, "gnat", 1);
    const friend = unitOf(f, "crab7");
    gnat.speed = 1;
    zone(f, jay, [NEAR, HOME], "slime", 3, { slow: 30 });
    expect(only(f.out, "zone")[0]).toEqual({
      t: "zone",
      id: jay.id,
      side: 0,
      kind: "slime",
      cells: [NEAR, HOME],
      ticks: 3 * HZ,
      on: true,
    });
    expect(slowNow(f, gnat)).toBe(30);
    expect(speedNow(f, gnat)).toBeCloseTo(0.7);
    expect(slowNow(f, friend)).toBe(0);
    // A slow of its own that is stronger wins; walking out leaves the zone's behind.
    gnat.slowBy = 50;
    gnat.slowUntil = f.tick + HZ;
    expect(slowNow(f, gnat)).toBe(50);
    gnat.slowUntil = 0;
    leap(f, gnat, cellAt(0, 0), "ability");
    expect(slowNow(f, gnat)).toBe(0);
    const later = steps(f, 3 * HZ);
    expect(only(later, "zone")).toEqual([
      { t: "zone", id: jay.id, side: 0, kind: "slime", cells: [NEAR, HOME], ticks: 0, on: false },
    ]);
    expect(f.zones[NEAR]).toBeNull();
  });
  test("hurts enemies standing in it every second, as magic damage from its owner", () => {
    const f = quiet([], [onCell("mud", 1, NEAR)]);
    const jay = unitOf(f, "jay");
    const mud = at(f, NEAR);
    zone(f, jay, [NEAR], "dust", 2, { damage: 25 });
    const events = steps(f, 3 * HZ);
    const hits = only(events, "hit").filter((h) => h.id === mud.id);
    expect(hits.map((h) => [h.amount, h.kind, h.source, h.by])).toEqual([
      [25, "magic", "ability", jay.id],
      [25, "magic", "ability", jay.id],
    ]);
  });
  test("zones do not stack: the newest holds a hex, and the older one's end leaves it be", () => {
    const f = quiet([onCell("crab7", 0, HOME)], [onCell("mud", 1, NEAR)]);
    const jay = unitOf(f, "jay");
    const crab = unitOf(f, "crab7");
    const mud = at(f, NEAR);
    zone(f, jay, [NEAR, cellAt(4, 3)], "dust", 2, { damage: 25 });
    zone(f, crab, [NEAR], "puddle", 4, { slow: 30 });
    expect(f.zones[NEAR]?.kind).toBe("puddle");
    expect(f.zones[cellAt(4, 3)]?.kind).toBe("dust");
    const events = steps(f, 2 * HZ);
    // The dust no longer holds the hex the mud stands on, and ends only where it still was.
    expect(only(events, "hit").filter((h) => h.id === mud.id).length).toBe(0);
    expect(only(events, "zone").map((z) => [z.kind, z.cells, z.on])).toEqual([["dust", [cellAt(4, 3)], false]]);
    expect(slowNow(f, mud)).toBe(30);
  });
});

describe("channel", () => {
  test("lands in pulses, the first at once, while its owner stands still", () => {
    const f = quiet();
    const jay = unitOf(f, "jay");
    const landed: number[] = [];
    channel(f, jay, { pulses: 3, every: 10 }, () => landed.push(f.tick));
    expect(jay.busyUntil).toBe(f.tick + 20);
    steps(f, 30);
    expect(landed).toEqual([0, 10, 20]);
  });
  test("a stun ends it, and the pulses left are lost", () => {
    const f = quiet();
    const jay = unitOf(f, "jay");
    let pulses = 0;
    channel(f, jay, { pulses: 3, every: 10 }, () => pulses++);
    steps(f, 5);
    stun(f, jay, 0.1, null);
    steps(f, 30);
    expect(pulses).toBe(1);
  });
  test("a fall ends it, and so does being moved", () => {
    const fallen = quiet();
    const jay = unitOf(fallen, "jay");
    let pulses = 0;
    channel(fallen, jay, { pulses: 3, every: 10 }, () => pulses++);
    hurt(fallen, jay, 999_999, "true", "item", null);
    steps(fallen, 30);
    expect(pulses).toBe(1);
    const moved = quiet();
    const other = unitOf(moved, "jay");
    let more = 0;
    channel(moved, other, { pulses: 3, every: 10 }, () => more++);
    steps(moved, 12);
    leap(moved, other, cellAt(3, 6), "knocked");
    steps(moved, 30);
    expect(more).toBe(2);
  });
});

describe("telegraph", () => {
  test("marks the hexes, then lands on whoever is there by then", () => {
    const marked = [NEAR, cellAt(3, 2)];
    const f = quiet([], [onCell("mud", 1, NEAR), onCell("gnat", 1, cellAt(1, 2))]);
    const jay = unitOf(f, "jay");
    const leaving = at(f, NEAR);
    const coming = unitOf(f, "gnat", 1);
    const struck: number[] = [];
    telegraph(f, jay, marked, 10, () => {
      for (const c of marked) {
        const o = f.units.find((u) => u.alive && u.cell === c);
        if (o) struck.push(o.id);
      }
    });
    expect(only(f.out, "telegraph")).toEqual([{ t: "telegraph", id: jay.id, cells: marked, ticks: 10 }]);
    expect(jay.busyUntil).toBe(f.tick + 10);
    steps(f, 5);
    leap(f, leaving, cellAt(0, 0), "ability");
    leap(f, coming, cellAt(3, 2), "ability");
    steps(f, 4);
    expect(struck).toEqual([]);
    steps(f, 1);
    expect(struck).toEqual([coming.id]);
  });
});

describe("a fight full of figures that move, linger and channel", () => {
  const ours = [
    onCell("jay", 0, cellAt(1, 4)),
    onCell("crab40", 0, cellAt(3, 4)),
    onCell("slug", 0, cellAt(5, 4)),
    onCell("greg", 0, cellAt(2, 4), 2),
    onCell("kettle", 0, cellAt(1, 7)),
    onCell("heron", 0, cellAt(3, 7)),
    onCell("moth", 0, cellAt(5, 7)),
    onCell("cindernewt", 0, cellAt(4, 5)),
  ];
  const theirs = [
    onCell("bushgnome", 1, cellAt(2, 3)),
    onCell("fogowl", 1, cellAt(4, 3)),
    onCell("badger", 1, cellAt(3, 3)),
    onCell("drizzlefrog", 1, cellAt(1, 0)),
    onCell("finch", 1, cellAt(3, 0)),
    onCell("apothecary", 1, cellAt(5, 1)),
    onCell("crab23", 1, cellAt(4, 2)),
    onCell("mossmote", 1, cellAt(6, 0)),
  ];
  const setup: FightSetup = { seed: 4242, era: LEGACY_ERA, sides: [partyOfFigures(ours), partyOfFigures(theirs)] };
  test("the same setup gives the same fight, event for event", () => {
    const once = recordFight(setup);
    const again = recordFight(setup);
    expect(JSON.stringify(again)).toBe(JSON.stringify(once));
    const all = [...once.opening, ...once.steps.flat()];
    const kinds = new Set(all.map((e) => (e.t === "leap" ? `leap ${e.why}` : e.t)));
    for (const kind of ["zone", "telegraph", "leap dash", "leap pull"]) expect(kinds.has(kind), kind).toBe(true);
    expect(all.some((e) => e.t === "cast" && (e.pulses ?? 0) > 1)).toBe(true);
  });
});
