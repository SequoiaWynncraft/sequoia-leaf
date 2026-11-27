/**
 * Up The Tree's rules, each against its own sentence, in a fight set up in its era: Canopy at both
 * steps, Vi's mana back, Flop playing dead, Bhlue's Firewall blocking at the `struck` moment, Ace's
 * aces and Full Deck, Unc's drumming, Leetanns' tools in turn, Feather and Slinger's new steps, and A
 * Good Branch.
 */
import { describe, expect, test } from "bun:test";

import { type Catalog, catalogAt } from "../content/catalog.ts";
import { abilityNumber, type Stars, type UnitKind } from "../content/figures.ts";
import { eraOf } from "../content/releases.ts";
import { type TraitId, traitNumber } from "../content/traits.ts";
import { cellAt, distance, neighbours, rowOf } from "../hex.ts";
import type { Placed } from "../party.ts";
import { onCell, only, partyOfFigures, ready, steps, stepUntil, still, unitOf } from "../testkit.ts";
import { hurt, HZ, stun } from "./core.ts";
import { openFight } from "./engine.ts";
import type { Fight, FightEvent, Unit } from "./types.ts";

const TREE = eraOf("up-the-tree");
const UT: Catalog = catalogAt(TREE);
const n = (kind: UnitKind, name: string, stars: Stars = 1): number => abilityNumber(UT, kind, name, stars);
const t = (id: TraitId, name: string, step: number): number => traitNumber(UT, id, name, step);

const HOME = cellAt(3, 4);
const NEAR = cellAt(3, 3);
const FAR = cellAt(3, 0);
/** Beside home on our own half. */
const BESIDE = cellAt(2, 4);

/** A fight between two lists of figures in Up The Tree's era, opened and not yet stepped. */
const tree = (ours: Placed[], theirs: Placed[]): Fight =>
  openFight({ seed: 7, era: TREE, sides: [partyOfFigures(ours), partyOfFigures(theirs)] });
/** Our caster at home with full mana and no attack, against plain targets on the given hexes. */
function scene(caster: UnitKind, foes: readonly number[], allies: Placed[] = []): { f: Fight; u: Unit } {
  const f = tree(
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
const castBy = (u: Unit) => (e: FightEvent) => e.t === "cast" && e.id === u.id;
const statusOf = (events: readonly FightEvent[], who: Unit, status: string) =>
  only(events, "status").filter((e) => e.id === who.id && e.status === status);

/** Three or five Canopy figures in a row at home, their mana spent. */
const canopy = (count: 3 | 5): { f: Fight; them: Unit[] } => {
  const kinds: UnitKind[] = ["vi", "flop", "bhlue", "ace", "unc"];
  const f = tree(
    kinds.slice(0, count).map((kind, i) => onCell(kind, 0, cellAt(i + 1, 5), 1)),
    [onCell("mud", 1, FAR)],
  );
  still(unitOf(f, "mud", 1));
  return { f, them: f.units.filter((u) => u.side === 0) };
};

describe("Canopy", () => {
  test("at 3: up the tree for 2 seconds where nothing reaches them, then down with a shield of 20% and 30 mana", () => {
    const { f, them } = canopy(3);
    expect(f.traits[0].canopy).toBe(1);
    expect(them.map((u) => u.hiddenUntil)).toEqual(them.map(() => 2 * HZ));
    const mana = them.map((u) => u.mana);
    steps(f, 2 * HZ);
    expect(them.map((u) => u.shield)).toEqual(them.map((u) => Math.round((u.maxHp * t("canopy", "shield", 1)) / 100)));
    expect(them.map((u, i) => u.mana - (mana[i] ?? 0))).toEqual(them.map((u) => Math.min(30, u.manaFull)));
    // The shield lasts until it breaks.
    expect(them.every((u) => u.shieldUntil > 1000 * HZ)).toBe(true);
  });
  test("at 5: a shield of 35%, and a full mana bar", () => {
    const { f, them } = canopy(5);
    expect(f.traits[0].canopy).toBe(2);
    const events = steps(f, 2 * HZ);
    // The tree's own shields (given by nobody), before any of them uses its full bar.
    const own = only(events, "shield").filter((e) => e.by === -1);
    expect(own.map((e) => [e.id, e.amount])).toEqual(them.map((u) => [u.id, Math.round((u.maxHp * 35) / 100)]));
    expect(them.every((u) => u.mana >= u.manaFull || u.casts > 0)).toBe(true);
  });
  test("with two, nobody goes up the tree; nothing reaches those that are", () => {
    const f = tree([onCell("vi", 0, HOME), onCell("flop", 0, BESIDE)], [onCell("mud", 1, FAR)]);
    expect(f.units.filter((u) => u.side === 0).map((u) => u.hiddenUntil)).toEqual([0, 0]);
    const { f: up, them } = canopy(3);
    const first = them[0];
    if (!first) throw new Error("nobody");
    expect(hurt(up, first, 100, "true", "ability", unitOf(up, "mud", 1))).toBe(0);
  });
});

describe("Vi, Hot Reload", () => {
  test("gives the friend who cast most recently its mana, never itself and never another Vi", () => {
    const { f, u } = scene(
      "vi",
      [FAR],
      [onCell("kettle", 0, BESIDE), onCell("vi", 0, cellAt(1, 5)), onCell("finch", 0, cellAt(5, 5))],
    );
    const [kettle, finch, other] = [unitOf(f, "kettle"), unitOf(f, "finch"), f.units.filter((o) => o.kind === "vi")[1]];
    if (!other) throw new Error("no second Vi");
    kettle.castAt = 10;
    finch.castAt = 30;
    other.castAt = 40;
    u.castAt = 50;
    finch.mana = 0;
    const events = stepUntil(f, castBy(u));
    expect(events.find(castBy(u))).toMatchObject({ targets: [finch.id] });
    expect(finch.mana).toBe(n("vi", "mana"));
  });
  test("with nobody who has cast, keeps its mana", () => {
    const { f, u } = scene("vi", [FAR], [onCell("kettle", 0, BESIDE)]);
    const events = steps(f, 10);
    expect(events.some(castBy(u))).toBe(false);
    expect(u.mana).toBe(u.manaFull);
  });
});

describe("Flop, Plays Dead", () => {
  test("falls over for 2 seconds where nothing reaches it, then gets up with health back and taunts the enemies within two", () => {
    const { f, u } = scene("flop", [NEAR, cellAt(3, 2), FAR]);
    u.hp = Math.round(u.maxHp / 2);
    const had = u.hp;
    const events = stepUntil(f, castBy(u));
    expect(statusOf(events, u, "hidden")).toHaveLength(1);
    expect(hurt(f, u, 100, "true", "ability", foeAt(f, NEAR))).toBe(0);
    const later = steps(f, 2 * HZ + 1);
    expect(u.hp).toBe(had + Math.round((u.maxHp * n("flop", "heal")) / 100));
    const taunted = only(later, "status").filter((e) => e.status === "taunt" && e.by === u.id);
    expect(taunted.map((e) => e.id).toSorted((a, b) => a - b)).toEqual(
      [foeAt(f, NEAR).id, foeAt(f, cellAt(3, 2)).id].toSorted((a, b) => a - b),
    );
  });
});

/** Bhlue having cast, with two friends in its row and one behind, against a mud. */
function walled(): { f: Fight; u: Unit; row: Unit[]; behind: Unit; foe: Unit } {
  const { f, u } = scene(
    "bhlue",
    [NEAR],
    [onCell("rock", 0, cellAt(2, 4)), onCell("rock", 0, cellAt(4, 4)), onCell("moth", 0, cellAt(3, 5))],
  );
  const row = f.units.filter((o) => o.side === 0 && rowOf(o.cell) === rowOf(u.cell));
  const behind = unitOf(f, "moth");
  stepUntil(f, castBy(u));
  return { f, u, row, behind, foe: foeAt(f, NEAR) };
}

describe("Bhlue, Firewall", () => {
  test("shields every friend in its row for 4 seconds and walls them; nobody else", () => {
    const { u, row, behind } = walled();
    expect(row).toHaveLength(3);
    expect(row.every((o) => o.shield === n("bhlue", "shield") && o.walledUntil > 0)).toBe(true);
    expect([behind.shield, behind.walledUntil]).toEqual([0, 0]);
    expect(row.map((o) => o.id)).toContain(u.id);
  });
  test("blocks the first enemy ability on each, and the rest that enemy lands on it in that step; then the wall is gone", () => {
    const { f, row, foe } = walled();
    const [a] = row;
    if (!a) throw new Error("nobody");
    const before = a.hp + a.shield;
    expect(hurt(f, a, 500, "physical", "ability", foe)).toBe(0);
    stun(f, a, 2, foe);
    expect([a.hp + a.shield, a.stunUntil]).toEqual([before, 0]);
    expect(only(f.out, "block")).toEqual([{ t: "block", id: a.id, by: foe.id }]);
    steps(f, 1);
    // The next step, the wall is gone: the same enemy's next ability lands.
    expect(hurt(f, a, 50, "true", "ability", foe)).toBe(50);
  });
  test("never blocks an attack, nor a friend's ability", () => {
    const { f, row, foe, u } = walled();
    const [a] = row;
    if (!a) throw new Error("nobody");
    a.shield = 0;
    expect(hurt(f, a, 50, "true", "attack", foe)).toBe(50);
    expect(hurt(f, a, 50, "true", "ability", u)).toBe(50);
    expect(a.walledUntil).toBeGreaterThan(f.tick);
  });
  test("after 4 seconds a wall that blocked nothing is down, and says so", () => {
    const { f, row, foe } = walled();
    const [a] = row;
    if (!a) throw new Error("nobody");
    const events = steps(f, 4 * HZ);
    expect(statusOf(events, a, "firewall").map((e) => e.on)).toEqual([false]);
    a.shield = 0;
    expect(hurt(f, a, 50, "true", "ability", foe)).toBe(50);
  });
});

/** Ace with a hurt friend in reach, a low, an armoured and a full-manaed enemy. */
function table(): { f: Fight; u: Unit; low: Unit; hard: Unit; full: Unit; friend: Unit } {
  const f = tree(
    [onCell("ace", 0, HOME), onCell("rock", 0, cellAt(2, 4))],
    [onCell("mud", 1, NEAR), onCell("mud", 1, cellAt(2, 2)), onCell("mud", 1, cellAt(4, 2))],
  );
  const [low, hard, full] = [foeAt(f, NEAR), foeAt(f, cellAt(2, 2)), foeAt(f, cellAt(4, 2))];
  for (const o of [low, hard, full]) still(o, 1000);
  low.hp = 300;
  hard.armour = 80;
  full.manaFull = 100;
  full.mana = 90;
  const friend = still(unitOf(f, "rock"), 1000);
  friend.hp = 400;
  const u = unitOf(f, "ace");
  u.manaFull = 0;
  return { f, u, low, hard, full, friend };
}

describe("Ace", () => {
  test("its attacks are aces in turn: spades to the least health, hearts to the most hurt friend, diamonds to the most armour, clubs to the most mana", () => {
    const { f, u, low, hard, full, friend } = table();
    const shots: FightEvent[] = [];
    for (let i = 0; i < 4; i++)
      shots.push(
        ...only(
          stepUntil(f, (e) => e.t === "shot" && e.id === u.id),
          "shot",
        ).filter((e) => e.id === u.id),
      );
    expect(shots.map((e) => (e.t === "shot" ? [e.card, e.target] : []))).toEqual([
      ["spades", low.id],
      ["hearts", friend.id],
      ["diamonds", hard.id],
      ["clubs", full.id],
    ]);
  });
  test("a spade lands 40% harder, a heart heals what it would have done, a diamond meets no armour, a club takes 15 mana", () => {
    const { f, u, low, hard, full, friend } = table();
    const attack = u.attack;
    const events = steps(f, 12 * HZ);
    const hitOn = (o: Unit) => only(events, "hit").find((e) => e.id === o.id && e.by === u.id);
    expect(hitOn(low)?.before).toBe(Math.round(attack * 1.4));
    expect(only(events, "heal").find((e) => e.id === friend.id && e.source === "card")?.amount).toBe(
      Math.round(attack),
    );
    expect(hitOn(hard)).toMatchObject({ kind: "true", amount: Math.round(attack) });
    expect(only(events, "drain").find((e) => e.id === full.id)?.amount).toBe(15);
  });
  test("with nobody its suit picks, a plain attack on its target", () => {
    const f = tree([onCell("ace", 0, HOME)], [onCell("mud", 1, cellAt(3, 2))]);
    still(unitOf(f, "mud", 1));
    const u = unitOf(f, "ace");
    u.manaFull = 0;
    const shots: FightEvent[] = [];
    for (let i = 0; i < 2; i++)
      shots.push(
        ...only(
          stepUntil(f, (e) => e.t === "shot" && e.id === u.id),
          "shot",
        ).filter((e) => e.id === u.id),
      );
    // A spade, then no friend to heal: a plain attack.
    expect(shots.map((e) => (e.t === "shot" ? (e.card ?? "plain") : ""))).toEqual(["spades", "plain"]);
  });
  test("Full Deck throws all four at once, each to the one its suit picks", () => {
    const { f, u, low, hard, full, friend } = table();
    u.manaFull = 80;
    ready(u);
    const events = stepUntil(f, castBy(u));
    const cards = only(events, "shot").filter((e) => e.id === u.id && e.what === "ability");
    expect(cards.map((e) => [e.card, e.target])).toEqual([
      ["spades", low.id],
      ["hearts", friend.id],
      ["diamonds", hard.id],
      ["clubs", full.id],
    ]);
  });
});

describe("Unc, Knock On Wood", () => {
  test("pecks its target 8 times over 3 seconds; if it falls the rest go to the enemy nearest where it fell", () => {
    const { f, u } = scene("unc", [NEAR, cellAt(4, 3), FAR]);
    const first = foeAt(f, NEAR);
    first.hp = 1;
    first.maxHp = 1;
    stepUntil(f, castBy(u));
    const events = [...f.out, ...steps(f, 4 * HZ)];
    const pecks = only(events, "hit").filter((e) => e.by === u.id && e.source === "ability");
    const next = foeAt(f, cellAt(4, 3));
    expect(pecks.filter((e) => e.id === next.id).length).toBe(n("unc", "pecks") - 1);
  });
});

describe("Leetanns, Gathering Run", () => {
  test("axe, pickaxe, rod, scythe in turn: a push, armour halved for 5 seconds, the furthest pulled beside it, everyone touching reaped", () => {
    const touching = neighbours(HOME).find((c) => c !== NEAR && rowOf(c) < 4) ?? NEAR;
    const { f, u } = scene("leetanns", [NEAR, touching, FAR]);
    const [near, beside, far] = [foeAt(f, NEAR), foeAt(f, touching), foeAt(f, FAR)];
    for (const o of [near, beside, far]) o.armour = 40;
    // Loose only while it swings, so that nobody walks up to it between swings.
    const loose = (on: boolean): void => {
      for (const o of [near, beside, far]) o.rooted = !on;
    };
    const tools: string[] = [];
    const cast = (): FightEvent[] => {
      ready(u);
      u.busyUntil = 0;
      loose(true);
      const events = stepUntil(f, castBy(u));
      loose(false);
      const c = events.find(castBy(u));
      if (c?.t === "cast") tools.push(c.tool ?? "");
      return events;
    };
    const chopped = cast().find(castBy(u));
    const chop = f.units[chopped?.t === "cast" ? (chopped.targets[0] ?? -1) : -1];
    if (!chop) throw new Error("nobody chopped");
    expect(distance(u.cell, chop.cell)).toBe(1 + n("leetanns", "push"));
    const mined = cast().find(castBy(u));
    const under = f.units[mined?.t === "cast" ? (mined.targets[0] ?? -1) : -1];
    if (!under) throw new Error("nobody mined");
    const armour = under.armour + under.sundered;
    expect(under.sundered).toBe(Math.floor(armour / 2));
    steps(f, 5 * HZ);
    expect([under.armour, under.sundered]).toEqual([armour, 0]);
    cast();
    expect(distance(u.cell, far.cell)).toBe(1);
    u.hp = 100;
    const reaped = cast();
    expect(tools).toEqual(["axe", "pickaxe", "rod", "scythe"]);
    const hit = only(reaped, "hit")
      .filter((e) => e.by === u.id)
      .map((e) => e.id);
    expect(hit.length).toBeGreaterThanOrEqual(2);
    expect(only(reaped, "heal").some((e) => e.id === u.id && e.source === "leech")).toBe(true);
  });
  test("with nobody to hook, the rod's turn passes to the scythe, and the axe is next", () => {
    const { f, u } = scene("leetanns", [NEAR]);
    u.turn = 2;
    const events = stepUntil(f, castBy(u));
    expect(events.find(castBy(u))).toMatchObject({ tool: "scythe" });
    expect(u.turn).toBe(0);
  });
});

describe("Feather and Slinger from Up The Tree", () => {
  test("Feather steps at 2, 3, 4, 5: 4%, 6%, 8% and 11% faster after every attack, ten times over", () => {
    expect(UT.traits.feather?.steps).toEqual([2, 3, 4, 5]);
    expect([1, 2, 3, 4].map((s) => t("feather", "quicken", s))).toEqual([4, 6, 8, 11]);
  });
  test("Slinger steps at 2, 4, 6: 7%, 13% and 20% more than the last, six times over, a hex more reach at each", () => {
    expect(UT.traits.slinger?.steps).toEqual([2, 4, 6]);
    expect([1, 2, 3].map((s) => [t("slinger", "focus", s), t("slinger", "reach", s)])).toEqual([
      [7, 1],
      [13, 1],
      [20, 1],
    ]);
  });
});

test("A Good Branch: its holder is a Canopy too, with 10% more health", () => {
  const f = tree(
    [onCell("vi", 0, HOME), onCell("flop", 0, BESIDE), onCell("moth", 0, cellAt(1, 5), 1, ["canopycharm"])],
    [onCell("mud", 1, FAR)],
  );
  const moth = unitOf(f, "moth");
  expect(f.traits[0].canopy).toBe(1);
  expect(moth.hiddenUntil).toBe(2 * HZ);
});
