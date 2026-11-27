/**
 * Penguin Month's rules, each against its own sentence, in a fight set up in its era: Huddle's one
 * shield at 2, 4 and 5 (made as the fight starts, before the Sneaks leap, taken after a figure's own
 * shield, back once at 5, never grown by Mender), and the six new abilities.
 */
import { describe, expect, test } from "bun:test";

import { type Catalog, catalogAt } from "../content/catalog.ts";
import { abilityNumber, type Stars, type UnitKind } from "../content/figures.ts";
import { eraOf } from "../content/releases.ts";
import { FIGHT } from "../content/rooms.ts";
import { type TraitId, traitNumber } from "../content/traits.ts";
import { cellAt, distance, groupsTouching, line, rowOf, touching } from "../hex.ts";
import type { Placed } from "../party.ts";
import { onCell, only, partyOfFigures, ready, steps, stepUntil, still, unitOf } from "../testkit.ts";
import { hide, hurt, secs, shieldUp } from "./core.ts";
import { openFight } from "./engine.ts";
import { covered } from "./mind.ts";
import type { Fight, FightEvent, Unit } from "./types.ts";

const PENGUINS = eraOf("penguin-month");
const PM: Catalog = catalogAt(PENGUINS);
const n = (kind: UnitKind, name: string, stars: Stars = 1): number => abilityNumber(PM, kind, name, stars);
const t = (id: TraitId, name: string, step: number): number => traitNumber(PM, id, name, step);

const HOME = cellAt(3, 4);
const RIGHT = cellAt(4, 4);
const LEFT = cellAt(2, 4);
const NEAR = cellAt(3, 3);
const TWO = cellAt(3, 2);
const THREE = cellAt(3, 1);
const FOUR = cellAt(3, 0);
const FAR = cellAt(0, 7);

const fight = (ours: Placed[], theirs: Placed[]): Fight =>
  openFight({ seed: 7, era: PENGUINS, sides: [partyOfFigures(ours), partyOfFigures(theirs)] });
/** Our figure at home, with full mana and no attack, facing plain targets on the given hexes. */
function scene(caster: UnitKind, foes: readonly number[], allies: Placed[] = []): { f: Fight; u: Unit } {
  const f = fight(
    [onCell(caster, 0, HOME), ...allies],
    foes.map((cell) => onCell("mud", 1, cell)),
  );
  for (const o of f.units) if (o.side === 1) still(o);
  const u = unitOf(f, caster);
  u.attack = 0;
  ready(u);
  return { f, u };
}
const foeAt = (f: Fight, cell: number): Unit => {
  const u = f.units.find((o) => o.side === 1 && o.cell === cell);
  if (!u) throw new Error(`nobody of theirs on ${cell}`);
  return u;
};
const byNumber = (a: number, b: number): number => a - b;
const castBy = (u: Unit) => (e: FightEvent) => e.t === "cast" && e.id === u.id;
const castOf = (events: readonly FightEvent[], u: Unit) => only(events, "cast").find((e) => e.id === u.id);
/** The pools as the fight opened them: who shares each, and what it holds. */
const pools = (f: Fight) => f.pools.map((p) => ({ ids: [...p.ids], left: p.left }));
const healthOf = (f: Fight, ids: readonly number[]): number =>
  ids.reduce((sum, id) => sum + (f.units[id]?.maxHp ?? 0), 0);

// ---------- Huddle ----------

describe("Huddle", () => {
  test("hexes that touch make one group, a touch at a time; one touching none is its own", () => {
    expect(groupsTouching([HOME, FAR, RIGHT, cellAt(5, 4), cellAt(0, 0)])).toEqual([[0, 2, 3], [1], [4]]);
  });

  test("2: those that start touching share one shield, a share of their health added together; one touching none has none", () => {
    const f = fight(
      [onCell("dibs", 0, HOME), onCell("jet", 0, RIGHT), onCell("flurry", 0, FAR)],
      [onCell("mud", 1, FOUR)],
    );
    const [dibs, jet, flurry] = [unitOf(f, "dibs"), unitOf(f, "jet"), unitOf(f, "flurry")];
    expect(f.traits[0].huddle).toBe(1);
    const share = t("huddle", "share", 1);
    expect(pools(f)).toEqual([{ ids: [dibs.id, jet.id], left: Math.round(((dibs.maxHp + jet.maxHp) * share) / 100) }]);
    expect([dibs.pool, jet.pool, flurry.pool]).toEqual([0, 0, -1]);
    expect(only(f.opening, "pool")).toEqual([
      { t: "pool", group: 0, ids: [dibs.id, jet.id], left: f.pools[0]?.left ?? 0, on: true },
    ]);
  });

  test("a hit takes from the figure's own shield first, then the group's, then its health; the group's is one number for all", () => {
    const f = fight([onCell("dibs", 0, HOME), onCell("jet", 0, RIGHT)], [onCell("mud", 1, FOUR)]);
    const [dibs, jet] = [unitOf(f, "dibs"), unitOf(f, "jet")];
    jet.armour = 0;
    const pool = f.pools[0];
    if (!pool) throw new Error("no pool");
    const left = pool.left;
    shieldUp(f, jet, 50, 0, null);
    f.out = [];
    hurt(f, jet, 80, "true", "attack", null);
    expect([jet.shield, pool.left, jet.hp]).toEqual([0, left - 30, jet.maxHp]);
    const hit = only(f.out, "hit")[0];
    expect([hit?.soaked, hit?.lost]).toEqual([80, 0]);
    // A hit on the other takes from the same shield; what is over hurts.
    hurt(f, dibs, left, "true", "attack", null);
    expect([pool.left, dibs.hp]).toEqual([0, dibs.maxHp - 30]);
    expect(only(f.out, "pool").at(-1)).toMatchObject({ group: 0, left: 0, on: false });
    // Broken, it stays broken below 5.
    steps(f, secs(8));
    expect(pool.left).toBe(0);
  });

  test("4: the shield is a bigger share", () => {
    const f = fight(
      [onCell("dibs", 0, HOME), onCell("jet", 0, RIGHT), onCell("larp", 0, LEFT), onCell("flurry", 0, cellAt(3, 5))],
      [onCell("mud", 1, FOUR)],
    );
    expect(f.traits[0].huddle).toBe(2);
    const ids = f.pools[0]?.ids ?? [];
    expect(ids.length).toBe(4);
    expect(f.pools[0]?.left).toBe(Math.round((healthOf(f, ids) * t("huddle", "share", 2)) / 100));
  });

  test("5: 6 seconds after it breaks it comes back once, worth a share of the health of those still up", () => {
    const f = fight(
      [
        onCell("dibs", 0, HOME),
        onCell("jet", 0, RIGHT),
        onCell("larp", 0, LEFT),
        onCell("flurry", 0, cellAt(3, 5)),
        onCell("yule", 0, cellAt(2, 5)),
      ],
      [onCell("mud", 1, FOUR)],
    );
    expect(f.traits[0].huddle).toBe(3);
    still(unitOf(f, "mud", 1));
    for (const u of f.units.filter((o) => o.side === 0)) {
      u.attack = 0;
      u.manaFull = 0;
    }
    const pool = f.pools[0];
    if (!pool) throw new Error("no pool");
    expect(pool.ids.length).toBe(5);
    const jet = unitOf(f, "jet");
    hurt(f, jet, pool.left, "true", "attack", null);
    // One of the group falls before it comes back: its health is not counted.
    const larp = unitOf(f, "larp");
    larp.hp = 1;
    hurt(f, larp, 1000, "true", "attack", null);
    expect([pool.left, larp.alive]).toEqual([0, false]);
    const events = steps(f, secs(t("huddle", "wait", 3)) + 1);
    const up = pool.ids.filter((id) => f.units[id]?.alive);
    expect(pool.left).toBe(Math.round((healthOf(f, up) * t("huddle", "back", 3)) / 100));
    expect(only(events, "pool").at(-1)).toMatchObject({ group: 0, on: true, left: pool.left });
    // Only once.
    hurt(f, jet, pool.left, "true", "attack", null);
    steps(f, secs(8));
    expect(pool.left).toBe(0);
  });

  test("Mender does not grow it; an emblem's holder is in the group; it is made before a Sneak leaps, who keeps it", () => {
    const f = fight(
      [
        onCell("jet", 0, HOME),
        onCell("dibs", 0, RIGHT),
        onCell("kettle", 0, LEFT, 1, ["huddlecharm"]),
        onCell("yule", 0, cellAt(3, 5)),
        onCell("worm", 0, FAR),
      ],
      [onCell("mud", 1, FOUR)],
    );
    // Brew and Yule: Mender on, and Brew counts as a Huddle by its emblem.
    expect([f.traits[0].mender, f.traits[0].huddle, f.traits[0].sneak]).toEqual([1, 2, 1]);
    const ids = f.pools[0]?.ids ?? [];
    expect(ids).toContain(unitOf(f, "kettle").id);
    expect(f.pools[0]?.left).toBe(Math.round((healthOf(f, ids) * t("huddle", "share", 2)) / 100));
    const jet = unitOf(f, "jet");
    const leapt = only(f.opening, "leap").find((e) => e.id === jet.id);
    expect(leapt?.why).toBe("sneak");
    expect(f.opening.findIndex((e) => e.t === "pool")).toBeLessThan(f.opening.findIndex((e) => e === leapt));
    expect(jet.pool).toBe(0);
  });
  test("one whose group's shield would take what is on its way is not counted as covered: targeting sees the pool", () => {
    const f = fight([onCell("dibs", 0, HOME), onCell("jet", 0, RIGHT)], [onCell("mud", 1, FOUR)]);
    const jet = unitOf(f, "jet");
    const pool = f.pools[0];
    if (!pool) throw new Error("no pool");
    jet.hp = 10;
    jet.incoming = 100;
    expect([pool.left > 100, covered(f, jet)]).toEqual([true, false]);
    pool.left = 0;
    expect(covered(f, jet)).toBe(true);
  });
});

// ---------- the abilities ----------

describe("Budge Up (Dibs)", () => {
  test("a shield on itself and on the most hurt friend touching it; with none touching, on itself", () => {
    const { f, u } = scene(
      "dibs",
      [FOUR],
      [onCell("moth", 0, RIGHT), onCell("finch", 0, LEFT), onCell("heron", 0, FAR)],
    );
    const [moth, finch, heron] = [unitOf(f, "moth"), unitOf(f, "finch"), unitOf(f, "heron")];
    moth.hp = moth.maxHp - 10;
    finch.hp = Math.round(finch.maxHp / 2);
    heron.hp = 1;
    const cast = castOf(stepUntil(f, castBy(u)), u);
    expect(cast?.targets).toEqual([u.id, finch.id]);
    expect([u.shield, finch.shield, moth.shield, heron.shield]).toEqual([
      n("dibs", "shield"),
      n("dibs", "shield"),
      0,
      0,
    ]);
    const alone = scene("dibs", [FOUR]);
    alone.u.hp -= 100;
    expect(castOf(stepUntil(alone.f, castBy(alone.u)), alone.u)?.targets).toEqual([alone.u.id]);
  });
});

describe("Belly First (Jet)", () => {
  test("slides through its target: every enemy on the line hurt, ice there that slows, and it stops on the furthest free hex", () => {
    const cells = line(HOME, NEAR, 4);
    const [first, third] = [cells[0] ?? -1, cells[2] ?? -1];
    const { f, u } = scene("jet", [first, third, cellAt(6, 0)]);
    const [near, two] = [foeAt(f, first), foeAt(f, third)];
    const events = stepUntil(f, castBy(u));
    expect(castOf(events, u)?.cells).toEqual(cells);
    const hits = only(events, "hit").filter((e) => e.by === u.id && e.source === "ability");
    expect(hits.map((e) => e.id).toSorted(byNumber)).toEqual([near.id, two.id].toSorted(byNumber));
    expect(hits.every((e) => e.amount === n("jet", "damage"))).toBe(true);
    const free = cells.findLast((c) => c !== first && c !== third);
    expect(u.cell).toBe(free ?? -1);
    for (const c of cells) expect(f.zones[c]).toMatchObject({ kind: "ice", slow: n("jet", "slow"), side: 0 });
    // Gone after its seconds.
    steps(f, secs(n("jet", "lasts")) + 1);
    expect(cells.every((c) => f.zones[c] === null)).toBe(true);
  });
});

describe("Snowball Fight (Larp)", () => {
  test("a snowball at each of different enemies in its reach; spare ones go round again from the nearest", () => {
    const { f, u } = scene("larp", [NEAR, TWO, THREE, FOUR, cellAt(4, 2)]);
    const events = stepUntil(f, castBy(u));
    expect(new Set(castOf(events, u)?.targets).size).toBe(n("larp", "balls"));
    const two = scene("larp", [NEAR, FOUR]);
    const targets = castOf(stepUntil(two.f, castBy(two.u)), two.u)?.targets ?? [];
    const [near, four] = [foeAt(two.f, NEAR), foeAt(two.f, FOUR)];
    expect(targets).toEqual([near.id, four.id, near.id, four.id]);
    const landed = only(steps(two.f, 40), "hit").filter((e) => e.by === two.u.id);
    expect(landed.length).toBe(4);
    expect(landed.every((e) => e.amount === n("larp", "damage"))).toBe(true);
  });
});

describe("Shake It (Flurry)", () => {
  test("snow on the enemy in its reach with the most enemies touching it and the hexes round it: magic a second, and slower", () => {
    const crowd = [cellAt(1, 1), cellAt(0, 1), cellAt(2, 1), cellAt(1, 0)];
    const { f, u } = scene("flurry", [NEAR, ...crowd]);
    const events = stepUntil(f, castBy(u));
    const cast = castOf(events, u);
    const middle = cast?.cells[0] ?? -1;
    const most = (cell: number) => crowd.filter((c) => c !== cell && touching(c, cell)).length;
    expect(most(middle)).toBe(Math.max(...crowd.map(most)));
    expect(cast?.cells.length).toBe(7);
    for (const c of cast?.cells ?? [])
      expect(f.zones[c]).toMatchObject({ kind: "snow", slow: n("flurry", "slow"), damage: n("flurry", "damage") });
    const pulses = only(steps(f, secs(1) + 1), "hit").filter((e) => e.by === u.id);
    expect(pulses.length).toBeGreaterThan(0);
    expect(pulses.every((e) => e.amount === n("flurry", "damage"))).toBe(true);
  });
});

describe("Fanfare (Pomp)", () => {
  test("every friend in its row gains mana, as a gift, and attacks faster; not itself, nobody in another row", () => {
    const { f, u } = scene(
      "pomp",
      [FOUR],
      [onCell("moth", 0, RIGHT), onCell("finch", 0, LEFT), onCell("kettle", 0, FAR)],
    );
    const [moth, finch, kettle] = [unitOf(f, "moth"), unitOf(f, "finch"), unitOf(f, "kettle")];
    for (const o of [moth, finch, kettle]) {
      o.mana = 0;
      o.attack = 0;
    }
    expect(rowOf(moth.cell)).toBe(rowOf(u.cell));
    const events = stepUntil(f, castBy(u));
    expect(castOf(events, u)?.targets.toSorted(byNumber)).toEqual([moth.id, finch.id].toSorted(byNumber));
    expect([moth.mana, finch.mana, kettle.mana]).toEqual([n("pomp", "mana"), n("pomp", "mana"), 0]);
    expect([moth.hasteBy, finch.hasteBy, kettle.hasteBy, u.hasteBy]).toEqual([
      n("pomp", "haste"),
      n("pomp", "haste"),
      0,
      0,
    ]);
    // The gift's cap holds: again at once, only what is left of it in 2 seconds.
    ready(u);
    stepUntil(f, castBy(u));
    expect(moth.mana).toBe(Math.min(FIGHT.giftMost, 2 * n("pomp", "mana")));
  });
});

/** Yule at the back with friends in front, all hurt, facing a plain target. */
function bath(): { f: Fight; u: Unit; friends: Unit[] } {
  const { f, u } = scene(
    "yule",
    [FOUR],
    [onCell("moth", 0, RIGHT), onCell("finch", 0, LEFT), onCell("heron", 0, cellAt(3, 5)), onCell("rock", 0, FAR)],
  );
  const friends = (["moth", "finch", "heron", "rock"] as const).map((k) => unitOf(f, k));
  friends.forEach((o, i) => {
    o.attack = 0;
    o.mana = 0;
    o.hp = Math.round(o.maxHp * (0.2 + i * 0.1));
  });
  return { f, u, friends };
}

describe("Bubble Bath (Yule)", () => {
  test("the most hurt friend in a bubble: nothing hurts them and they do nothing; out with health back and a full mana bar", () => {
    const { f, u, friends } = bath();
    const [moth] = friends;
    if (!moth) throw new Error("no moth");
    const events = stepUntil(f, castBy(u));
    const cast = castOf(events, u);
    expect([cast?.targets, cast?.ticks]).toEqual([[moth.id], secs(n("yule", "lasts"))]);
    expect(only(events, "status").find((e) => e.id === moth.id && e.status === "hidden")).toMatchObject({
      on: true,
      by: u.id,
    });
    const hp = moth.hp;
    expect(hurt(f, moth, 500, "true", "attack", null)).toBe(0);
    expect(moth.hp).toBe(hp);
    const later = stepUntil(f, (e) => e.t === "heal" && e.id === moth.id);
    const healed = only(later, "heal").find((e) => e.id === moth.id && e.by === u.id);
    expect(healed?.amount).toBe(Math.min(n("yule", "heal"), moth.maxHp - hp));
    // Its mana bar full as it comes out: it casts at once, or still has it.
    expect(moth.mana === moth.manaFull || castOf(later, moth) !== undefined).toBe(true);
  });

  test("each later use bubbles 1 more friend, up to its most; one already in a bubble is passed over", () => {
    const { f, u, friends } = bath();
    const counts: number[] = [];
    for (let i = 0; i < 4; i++) {
      for (const o of friends) o.hp = Math.min(o.hp, Math.round(o.maxHp * 0.3));
      ready(u);
      counts.push(castOf(stepUntil(f, castBy(u)), u)?.targets.length ?? 0);
      steps(f, secs(n("yule", "lasts")) + 1);
    }
    expect(counts).toEqual([1, 2, 3, n("yule", "most")]);
    expect(n("yule", "most", 3)).toBe(4);
  });

  test("never bubbles itself: the most hurt friend but itself, and with only itself hurt it waits", () => {
    const { f, u, friends } = bath();
    const [, finch] = friends;
    if (!finch) throw new Error("no finch");
    for (const o of friends) o.hp = o.maxHp;
    finch.hp = Math.round(finch.maxHp * 0.4);
    u.hp = Math.round(u.maxHp * 0.1);
    expect(castOf(stepUntil(f, castBy(u)), u)?.targets).toEqual([finch.id]);
    const alone = bath();
    for (const o of alone.friends) o.hp = o.maxHp;
    alone.u.hp = Math.round(alone.u.maxHp * 0.1);
    expect(castOf(steps(alone.f, 40), alone.u)).toBeUndefined();
    expect(alone.u.hiddenUntil).toBe(0);
  });

  test("a figure put in a bubble stops channelling, as a stun stops it: the pulses left are lost", () => {
    const { f, u } = scene("kettle", [FOUR], [onCell("moth", 0, RIGHT), onCell("yule", 0, LEFT)]);
    const moth = unitOf(f, "moth");
    moth.attack = 0;
    moth.hp = 10;
    const cast = castOf(stepUntil(f, castBy(u)), u);
    expect(cast?.pulses).toBeGreaterThan(1);
    hide(f, u, secs(3), unitOf(f, "yule"));
    // A sip already poured still lands; none more is poured.
    const poured = only(steps(f, secs(3)), "shot").filter((e) => e.id === u.id && e.what === "ability");
    expect(poured).toEqual([]);
  });

  test("a Yule in a bubble gets the health and not the mana", () => {
    const f = fight([onCell("yule", 0, HOME), onCell("yule", 0, RIGHT)], [onCell("mud", 1, FOUR)]);
    still(unitOf(f, "mud", 1));
    const [a, b] = f.units.filter((o) => o.kind === "yule");
    if (!a || !b) throw new Error("no Yules");
    for (const y of [a, b]) y.attack = 0;
    b.hp = Math.round(b.maxHp / 3);
    b.mana = 0;
    ready(a);
    stepUntil(f, castBy(a));
    steps(f, secs(n("yule", "lasts")) + 1);
    expect([b.hp > Math.round(b.maxHp / 3), b.mana]).toEqual([true, 0]);
    expect(distance(a.cell, b.cell)).toBe(1);
  });
});
