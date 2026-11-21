/**
 * Every ability, checked against its own sentence. Each test puts the caster on our front line
 * (hex 3,4), stands plain targets where the sentence needs them, fills the caster's mana and steps
 * the clock. Targets have no armour or ward, so the damage that lands is the number in the table.
 */
import { describe, expect, test } from "bun:test";

import { abilityNumber, type Stars, type UnitKind } from "../content/figures.ts";
import type { ItemId } from "../content/items.ts";
import { FIGHT } from "../content/rooms.ts";
import { cellAt, cone, distance, line, neighbours, rowOf, within } from "../hex.ts";
import type { Placed } from "../party.ts";
import { fightOf, inOrder, onCell, only, ready, steps, stepUntil, still, unitOf } from "../testkit.ts";
import { hurt, HZ } from "./core.ts";
import { speedNow } from "./engine.ts";
import type { Fight, FightEvent, Unit } from "./types.ts";

const HOME = cellAt(3, 4);
/** Hexes one, two, three and four away from the caster, straight up the board. */
const NEAR = cellAt(3, 3);
const BESIDE = cellAt(2, 3);
const TWO = cellAt(3, 2);
const THREE = cellAt(3, 1);
const FOUR = cellAt(3, 0);

const n = (kind: UnitKind, name: string, stars: Stars = 1): number => abilityNumber(kind, name, stars);
function foeAt(f: Fight, cell: number): Unit {
  const u = f.units.find((o) => o.side === 1 && o.cell === cell);
  if (!u) throw new Error(`nobody of theirs on ${cell}`);
  return u;
}
/** The caster with its mana full, facing plain targets on the given hexes. */
function scene(
  caster: UnitKind,
  foes: readonly number[],
  more: { stars?: Stars; allies?: Placed[]; holding?: Record<number, ItemId[]>; keepAttack?: boolean } = {},
): { f: Fight; u: Unit } {
  const f = fightOf(
    [onCell(caster, 0, HOME, more.stars ?? 1), ...(more.allies ?? [])],
    foes.map((cell) => onCell("mud", 1, cell, 1, more.holding?.[cell] ?? [])),
  );
  for (const o of f.units) if (o.side === 1) still(o);
  const u = unitOf(f, caster);
  if (more.keepAttack !== true) u.attack = 0;
  ready(u);
  return { f, u };
}
const hitsOn = (events: readonly FightEvent[], who: Unit) => only(events, "hit").filter((e) => e.id === who.id);
const statusOn = (events: readonly FightEvent[], who: Unit, status: string) =>
  only(events, "status").find((e) => e.id === who.id && e.status === status && e.on);

describe("one-acorn figures", () => {
  test("Emberkit: magic damage to its target and to whoever is standing behind it", () => {
    const behind = line(HOME, NEAR, 2)[1] ?? -1;
    const { f, u } = scene("emberkit", [NEAR, behind, BESIDE]);
    u.target = foeAt(f, NEAR).id;
    const events = steps(f, 1);
    const cast = only(events, "cast")[0];
    expect(cast?.shape).toBe("line");
    expect(cast?.cells).toEqual([NEAR, behind]);
    for (const cell of [NEAR, behind]) {
      const hits = hitsOn(events, foeAt(f, cell));
      expect(hits.length).toBe(1);
      expect(hits[0]?.amount).toBe(n("emberkit", "damage"));
      expect(hits[0]?.kind).toBe("magic");
    }
    expect(hitsOn(events, foeAt(f, BESIDE)).length).toBe(0);
    expect(u.mana).toBe(0);
  });
  test("Mossmote: a shield for whoever in the party is most hurt, for a few seconds", () => {
    const { f, u } = scene("mossmote", [FOUR], {
      allies: [onCell("crab7", 0, cellAt(1, 5)), onCell("emberkit", 0, cellAt(5, 5))],
    });
    const crab = unitOf(f, "crab7");
    crab.hp = Math.round(crab.maxHp / 2);
    unitOf(f, "emberkit").hp -= 10;
    const events = stepUntil(f, (e) => e.t === "shield");
    const shield = only(events, "shield")[0];
    expect(only(events, "cast")[0]?.targets).toEqual([crab.id]);
    expect(only(events, "shot")[0]?.what).toBe("ability");
    expect(shield?.id).toBe(crab.id);
    expect(shield?.amount).toBe(n("mossmote", "shield"));
    expect(crab.shield).toBe(n("mossmote", "shield"));
    expect(shield?.ticks).toBe(n("mossmote", "lasts") * HZ);
    expect(u.casts).toBe(1);
  });
  test("Moth: magic damage to its target and every enemy touching it", () => {
    const { f, u } = scene("moth", [TWO, THREE, cellAt(6, 0)]);
    u.target = foeAt(f, TWO).id;
    const events = stepUntil(f, (e) => e.t === "hit");
    for (const cell of [TWO, THREE]) {
      const hits = hitsOn(events, foeAt(f, cell));
      expect(hits.map((h) => h.amount)).toEqual([n("moth", "damage")]);
      expect(hits[0]?.kind).toBe("magic");
    }
    expect(hitsOn(events, foeAt(f, cellAt(6, 0))).length).toBe(0);
    // It flew there: the dust landed some steps after the cast.
    expect(only(events, "cast")[0]?.ticks).toBe(distance(HOME, TWO) * FIGHT.flight);
  });
  test("Worm: comes up beside the enemy furthest away and bites it", () => {
    const { f, u } = scene("worm", [NEAR, FOUR]);
    const far = foeAt(f, FOUR);
    const events = steps(f, 1);
    const leap = only(events, "leap")[0];
    expect(leap?.id).toBe(u.id);
    expect(leap?.why).toBe("ability");
    expect(distance(u.cell, far.cell)).toBe(1);
    expect(hitsOn(events, far).map((h) => [h.amount, h.kind])).toEqual([[n("worm", "damage"), "physical"]]);
    expect(hitsOn(events, foeAt(f, NEAR)).length).toBe(0);
  });
  test("Twig Finch: three seeds at its target, one after another", () => {
    const { f } = scene("finch", [TWO]);
    const events = steps(f, 30);
    const hits = hitsOn(events, foeAt(f, TWO));
    expect(hits.length).toBe(n("finch", "seeds"));
    for (const h of hits) {
      expect(h.amount).toBe(n("finch", "damage"));
      expect(h.kind).toBe("physical");
      expect(h.source).toBe("ability");
    }
    expect(only(events, "shot").map((s) => s.ticks)).toEqual([4, 6, 8]);
  });
  test("Crab #7: physical damage, and the target is stunned", () => {
    const { f } = scene("crab7", [NEAR]);
    const target = foeAt(f, NEAR);
    const events = steps(f, 1);
    expect(hitsOn(events, target).map((h) => [h.amount, h.kind])).toEqual([[n("crab7", "damage"), "physical"]]);
    expect(statusOn(events, target, "stun")?.ticks).toBe(n("crab7", "stun") * HZ);
    expect(target.stunUntil).toBe(f.tick + n("crab7", "stun") * HZ);
  });
  test("Barrow Gnome: a shield for itself, and physical damage to every enemy touching it", () => {
    const { f, u } = scene("barrowgnome", [NEAR, BESIDE, THREE]);
    const events = steps(f, 1);
    expect(only(events, "shield")[0]?.id).toBe(u.id);
    expect(u.shield).toBe(n("barrowgnome", "shield"));
    for (const cell of [NEAR, BESIDE]) {
      expect(hitsOn(events, foeAt(f, cell)).map((h) => h.amount)).toEqual([n("barrowgnome", "damage")]);
    }
    expect(hitsOn(events, foeAt(f, THREE)).length).toBe(0);
    steps(f, n("barrowgnome", "lasts") * HZ);
    expect(u.shield).toBe(0);
  });
});

describe("two-acorn figures", () => {
  test("Kettle: health back for whoever is most hurt, and it waits if nobody is", () => {
    const { f, u } = scene("kettle", [FOUR], { allies: [onCell("crab7", 0, cellAt(1, 5))] });
    const crab = unitOf(f, "crab7");
    // Nobody is hurt: the tea stays in the pot.
    expect(only(steps(f, 5), "cast").length).toBe(0);
    expect(u.mana).toBe(u.manaFull);
    crab.maxHp = 5000;
    crab.hp = 1000;
    const events = stepUntil(f, (e) => e.t === "heal");
    const healed = only(events, "heal")[0];
    expect(healed?.id).toBe(crab.id);
    expect(healed?.amount).toBe(n("kettle", "heal"));
    expect(crab.hp).toBe(1000 + n("kettle", "heal"));
  });
  test("Slug: magic damage and a slow for every enemy touching it; nothing if none is", () => {
    const { f } = scene("slug", [NEAR, BESIDE, THREE]);
    const events = steps(f, 1);
    for (const cell of [NEAR, BESIDE]) {
      const foe = foeAt(f, cell);
      expect(hitsOn(events, foe).map((h) => [h.amount, h.kind])).toEqual([[n("slug", "damage"), "magic"]]);
      expect(statusOn(events, foe, "slow")?.amount).toBe(n("slug", "slow"));
      expect(statusOn(events, foe, "slow")?.ticks).toBe(n("slug", "lasts") * HZ);
    }
    expect(hitsOn(events, foeAt(f, THREE)).length).toBe(0);
    const alone = scene("slug", [FOUR]);
    alone.u.rooted = true;
    expect(only(steps(alone.f, 5), "cast").length).toBe(0);
    expect(alone.u.mana).toBe(alone.u.manaFull);
  });
  test("Glorp: a Glorplet with the health and attack it says joins beside it", () => {
    const { f, u } = scene("glorp", [NEAR]);
    const events = steps(f, 1);
    const summon = only(events, "summon")[0];
    expect(summon?.kind).toBe("glorplet");
    expect(summon?.by).toBe(u.id);
    const bit = unitOf(f, "glorplet");
    expect(bit.side).toBe(0);
    expect(bit.summoned).toBe(true);
    expect(bit.maxHp).toBe(n("glorp", "health"));
    expect(bit.attack).toBe(n("glorp", "attack"));
    expect(distance(u.cell, bit.cell)).toBe(1);
    expect(f.standing[0]).toBe(2);
  });
  test("Chickaree: physical damage and a stun for the enemy furthest away", () => {
    const { f } = scene("chickaree", [NEAR, cellAt(0, 0)]);
    const far = foeAt(f, cellAt(0, 0));
    const events = stepUntil(f, (e) => e.t === "hit");
    expect(hitsOn(events, far).map((h) => [h.amount, h.kind])).toEqual([[n("chickaree", "damage"), "physical"]]);
    expect(statusOn(events, far, "stun")?.ticks).toBe(n("chickaree", "stun") * HZ);
    expect(hitsOn(events, foeAt(f, NEAR)).length).toBe(0);
  });
  test("Dusk Jay: attacks faster for a few seconds", () => {
    const { f, u } = scene("jay", [NEAR]);
    const plain = speedNow(f, u);
    const events = steps(f, 1);
    expect(statusOn(events, u, "haste")?.amount).toBe(n("jay", "haste"));
    expect(speedNow(f, u)).toBeCloseTo(plain * (1 + n("jay", "haste") / 100));
    steps(f, n("jay", "lasts") * HZ);
    expect(speedNow(f, u)).toBeCloseTo(plain);
  });
  test("Crab #12: the pebble hits its target and skips on to two more close by, each once", () => {
    const { f, u } = scene("crab12", [TWO, THREE, FOUR, cellAt(0, 3)]);
    u.target = foeAt(f, TWO).id;
    const events = steps(f, 60);
    for (const cell of [TWO, THREE, FOUR]) {
      expect(hitsOn(events, foeAt(f, cell)).map((h) => h.amount)).toEqual([n("crab12", "damage")]);
    }
    expect(only(events, "hit").length).toBe(1 + n("crab12", "skips"));
    expect(only(events, "shot").map((s) => s.to)).toEqual([TWO, THREE, FOUR]);
  });
  test("Crab #12: with nobody close by, the pebble stops", () => {
    const { f, u } = scene("crab12", [TWO, cellAt(6, 0)]);
    u.target = foeAt(f, TWO).id;
    expect(only(steps(f, 60), "hit").length).toBe(1);
  });
  test("Lantern Gnome: magic damage to the three nearest enemies", () => {
    const { f } = scene("lanterngnome", [NEAR, TWO, THREE, FOUR]);
    const events = steps(f, 40);
    for (const cell of [NEAR, TWO, THREE]) {
      expect(hitsOn(events, foeAt(f, cell)).map((h) => [h.amount, h.kind])).toEqual([
        [n("lanterngnome", "damage"), "magic"],
      ]);
    }
    expect(hitsOn(events, foeAt(f, FOUR)).length).toBe(0);
    expect(n("lanterngnome", "count")).toBe(3);
  });
});

describe("three-acorn figures", () => {
  test("Leafling: more attack for the two friends nearest it, for the rest of the fight", () => {
    const { f } = scene("leafling", [FOUR], {
      allies: [
        onCell("crab7", 0, cellAt(2, 4)),
        onCell("emberkit", 0, cellAt(4, 4)),
        onCell("finch", 0, cellAt(0, 7)),
        onCell("rock", 0, cellAt(3, 5)),
      ],
    });
    const crab = unitOf(f, "crab7");
    const kit = unitOf(f, "emberkit");
    const finch = unitOf(f, "finch");
    const before = [crab.attack, kit.attack, finch.attack];
    const events = steps(f, 1);
    const boosts = only(events, "boost");
    expect(inOrder(boosts.map((b) => b.id))).toEqual(inOrder([crab.id, kit.id]));
    const share = n("leafling", "attack") / 100;
    expect(crab.attack).toBe((before[0] ?? 0) + Math.round(crab.attack0 * share));
    expect(kit.attack).toBe((before[1] ?? 0) + Math.round(kit.attack0 * share));
    expect(finch.attack).toBe(before[2] ?? 0);
    // A Rock is glad of the advice, and still does nothing.
    expect(unitOf(f, "rock").attack).toBe(0);
  });
  test("Cinder Newt: magic damage to every enemy in a cone two hexes deep", () => {
    const inCone = cone(HOME, NEAR, 2);
    const outside = cellAt(0, 3);
    expect(inCone).not.toContain(outside);
    const others = inCone.filter((c) => c !== NEAR && rowOf(c) < 4).slice(0, 2);
    const { f, u } = scene("cindernewt", [NEAR, ...others, outside]);
    u.target = foeAt(f, NEAR).id;
    const events = steps(f, 1);
    expect(only(events, "cast")[0]?.shape).toBe("cone");
    for (const cell of [NEAR, ...others]) {
      expect(hitsOn(events, foeAt(f, cell)).map((h) => [h.amount, h.kind])).toEqual([
        [n("cindernewt", "damage"), "magic"],
      ]);
    }
    expect(hitsOn(events, foeAt(f, outside)).length).toBe(0);
    expect(others.length).toBe(2);
  });
  test("Drizzle Frog: magic damage to its target, and it is slowed", () => {
    const { f } = scene("drizzlefrog", [TWO]);
    const target = foeAt(f, TWO);
    const events = stepUntil(f, (e) => e.t === "hit");
    expect(hitsOn(events, target).map((h) => [h.amount, h.kind])).toEqual([[n("drizzlefrog", "damage"), "magic"]]);
    expect(statusOn(events, target, "slow")?.amount).toBe(n("drizzlefrog", "slow"));
  });
  test("Rock: takes less from every hit for a while, and whoever attacks it up close stubs a toe", () => {
    const f = fightOf([onCell("rock", 0, HOME)], [onCell("gnat", 1, NEAR)]);
    const rock = ready(unitOf(f, "rock"));
    const gnat = unitOf(f, "gnat", 1);
    gnat.maxHp = 10_000;
    gnat.hp = 10_000;
    const first = steps(f, 1);
    expect(statusOn(first, rock, "braced")?.ticks).toBe(n("rock", "lasts") * HZ);
    // It does nothing, pointedly; the gnat goes on attacking it and stubs its toe every time.
    const events = steps(f, 3 * HZ);
    const swings = only(events, "swing");
    const stubbed = only(events, "hit").filter((e) => e.id === gnat.id);
    expect(swings.length).toBeGreaterThan(1);
    expect(swings.every((e) => e.id === gnat.id)).toBe(true);
    expect(stubbed.length).toBe(swings.length);
    for (const h of stubbed) expect([h.amount, h.source]).toEqual([n("rock", "stub"), "thorns"]);
    const before = rock.hp;
    hurt(f, rock, 1000, "true", "attack", gnat);
    expect(before - rock.hp).toBe(1000 * (1 - n("rock", "less") / 100));
    steps(f, n("rock", "lasts") * HZ);
    expect(rock.bracedUntil).toBeLessThanOrEqual(f.tick);
    rock.mana = 0;
    const later = rock.hp;
    hurt(f, rock, 100, "true", "attack", gnat);
    expect(later - rock.hp).toBe(100);
  });
  test("Gnome In A Bush: physical damage, and half as much again if its target was busy with somebody else", () => {
    const busy = scene("bushgnome", [NEAR]);
    expect(hitsOn(steps(busy.f, 1), foeAt(busy.f, NEAR))[0]?.amount).toBe(n("bushgnome", "damage") * 1.5);
    const watching = scene("bushgnome", [NEAR]);
    foeAt(watching.f, NEAR).target = watching.u.id;
    expect(hitsOn(steps(watching.f, 1), foeAt(watching.f, NEAR))[0]?.amount).toBe(n("bushgnome", "damage"));
  });
  test("Crab #23: health back for the two most hurt in the party", () => {
    const { f } = scene("crab23", [FOUR], {
      allies: [
        onCell("crab7", 0, cellAt(2, 4)),
        onCell("emberkit", 0, cellAt(4, 4)),
        onCell("finch", 0, cellAt(3, 5)),
        onCell("worm", 0, cellAt(2, 5)),
      ],
    });
    const hurtTo = (kind: UnitKind, share: number): Unit => {
      const o = unitOf(f, kind);
      o.maxHp = 10_000;
      o.hp = 10_000 * share;
      return o;
    };
    const worst = hurtTo("crab7", 0.2);
    const bad = hurtTo("emberkit", 0.5);
    const scratched = hurtTo("finch", 0.9);
    const events = steps(f, 20);
    const healed = only(events, "heal");
    expect(inOrder(healed.map((h) => h.id))).toEqual(inOrder([worst.id, bad.id]));
    for (const h of healed) expect(h.amount).toBe(n("crab23", "heal"));
    expect(scratched.hp).toBe(9000);
    expect(n("crab23", "count")).toBe(2);
  });
});

describe("four-acorn figures", () => {
  test("Badger: physical damage to every enemy touching it, and it heals for a share of what lands", () => {
    const { f, u } = scene("badger", [NEAR, BESIDE, THREE]);
    u.hp = 100;
    const events = steps(f, 1);
    for (const cell of [NEAR, BESIDE]) {
      expect(hitsOn(events, foeAt(f, cell)).map((h) => [h.amount, h.kind])).toEqual([
        [n("badger", "damage"), "physical"],
      ]);
    }
    expect(hitsOn(events, foeAt(f, THREE)).length).toBe(0);
    const back = Math.round((2 * n("badger", "damage") * n("badger", "leech")) / 100);
    expect(only(events, "heal")[0]?.amount).toBe(back);
    expect(u.hp).toBe(100 + back);
  });
  test("Fog Owl: swoops onto the enemy furthest away, hurts it and stuns it", () => {
    const { f, u } = scene("fogowl", [NEAR, FOUR]);
    const far = foeAt(f, FOUR);
    const events = steps(f, 1);
    expect(only(events, "leap")[0]?.id).toBe(u.id);
    expect(distance(u.cell, far.cell)).toBe(1);
    expect(hitsOn(events, far).map((h) => [h.amount, h.kind])).toEqual([[n("fogowl", "damage"), "physical"]]);
    expect(statusOn(events, far, "stun")?.ticks).toBe(n("fogowl", "stun") * HZ);
    expect(u.target).toBe(far.id);
  });
  test("Reed Heron: physical damage to every enemy on a line five hexes long", () => {
    const path = line(HOME, NEAR, n("heron", "length"));
    expect(path.length).toBe(4);
    const outside = cellAt(0, 3);
    const { f, u } = scene("heron", [...path, outside]);
    u.target = foeAt(f, NEAR).id;
    const events = steps(f, 1);
    expect(only(events, "cast")[0]?.cells).toEqual(path);
    for (const cell of path) {
      expect(hitsOn(events, foeAt(f, cell)).map((h) => [h.amount, h.kind])).toEqual([
        [n("heron", "damage"), "physical"],
      ]);
    }
    expect(hitsOn(events, foeAt(f, outside)).length).toBe(0);
  });
  test("Crab #40: a shield for itself, and every enemy within two hexes has to attack it", () => {
    const { f, u } = scene("crab40", [NEAR, TWO, THREE]);
    const events = steps(f, 1);
    expect(u.shield).toBe(n("crab40", "shield"));
    for (const cell of [NEAR, TWO]) {
      const foe = foeAt(f, cell);
      expect(statusOn(events, foe, "taunt")?.ticks).toBe(n("crab40", "taunt") * HZ);
      expect(foe.tauntBy).toBe(u.id);
      expect(foe.target).toBe(u.id);
    }
    expect(statusOn(events, foeAt(f, THREE), "taunt")).toBeUndefined();
  });
  test("Apothecary Gnome: health and quicker attacks for itself and every friend within two hexes", () => {
    const { f, u } = scene("apothecary", [FOUR], {
      allies: [onCell("crab7", 0, cellAt(3, 6)), onCell("finch", 0, cellAt(0, 7))],
    });
    const near = unitOf(f, "crab7");
    const far = unitOf(f, "finch");
    for (const o of [u, near, far]) {
      o.maxHp = 10_000;
      o.hp = 5000;
    }
    const events = steps(f, 1);
    expect(inOrder(only(events, "heal").map((h) => h.id))).toEqual(inOrder([u.id, near.id]));
    expect(near.hp).toBe(5000 + n("apothecary", "heal"));
    expect(u.hp).toBe(5000 + n("apothecary", "heal"));
    expect(far.hp).toBe(5000);
    expect(statusOn(events, near, "haste")?.amount).toBe(n("apothecary", "haste"));
    expect(statusOn(events, far, "haste")).toBeUndefined();
  });
});

describe("five-acorn figures", () => {
  test("Greg: sits down; every enemy within two hexes is hurt and stunned", () => {
    const { f } = scene("greg", [NEAR, TWO, THREE]);
    const events = steps(f, 1);
    for (const cell of [NEAR, TWO]) {
      const foe = foeAt(f, cell);
      expect(hitsOn(events, foe).map((h) => [h.amount, h.kind])).toEqual([[n("greg", "damage"), "magic"]]);
      expect(statusOn(events, foe, "stun")?.ticks).toBe(n("greg", "stun") * HZ);
    }
    expect(hitsOn(events, foeAt(f, THREE)).length).toBe(0);
  });
  test("White Fox: magic damage within two hexes, and the whole party attacks faster", () => {
    const { f, u } = scene("whitefox", [NEAR, THREE], { allies: [onCell("finch", 0, cellAt(0, 7))] });
    const finch = unitOf(f, "finch");
    const events = steps(f, 1);
    expect(hitsOn(events, foeAt(f, NEAR)).map((h) => [h.amount, h.kind])).toEqual([[n("whitefox", "damage"), "magic"]]);
    expect(hitsOn(events, foeAt(f, THREE)).length).toBe(0);
    expect(statusOn(events, u, "haste")?.amount).toBe(n("whitefox", "haste"));
    expect(statusOn(events, finch, "haste")?.amount).toBe(n("whitefox", "haste"));
    expect(statusOn(events, finch, "haste")?.ticks).toBe(n("whitefox", "lasts") * HZ);
  });
  test("Hearth Cat: hurts its target, bats it back two hexes and stuns it; a Rock stays put", () => {
    const { f, u } = scene("hearthcat", [NEAR]);
    const target = foeAt(f, NEAR);
    target.rooted = false;
    target.busyUntil = 10_000;
    const events = steps(f, 1);
    expect(hitsOn(events, target).map((h) => [h.amount, h.kind])).toEqual([[n("hearthcat", "damage"), "physical"]]);
    const knocked = only(events, "leap").find((l) => l.id === target.id);
    expect(knocked?.why).toBe("knocked");
    expect(distance(u.cell, target.cell)).toBe(1 + n("hearthcat", "push"));
    expect(statusOn(events, target, "stun")?.ticks).toBe(n("hearthcat", "stun") * HZ);

    const rocky = fightOf([onCell("hearthcat", 0, HOME)], [onCell("rock", 1, NEAR)]);
    const cat = ready(unitOf(rocky, "hearthcat"));
    const rock = unitOf(rocky, "rock", 1);
    const after = steps(rocky, 1);
    expect(only(after, "cast").length).toBe(1);
    expect(rock.cell).toBe(NEAR);
    expect(only(after, "leap").length).toBe(0);
    expect(cat.casts).toBe(1);
  });
  test("abilities are stronger with stars, by the numbers in the table", () => {
    for (const stars of [2, 3] as const) {
      const { f } = scene("crab7", [NEAR], { stars });
      expect(hitsOn(steps(f, 1), foeAt(f, NEAR))[0]?.amount).toBe(n("crab7", "damage", stars));
    }
  });
});

describe("the forest's trouble", () => {
  test("Wasp: its sting goes straight through armour", () => {
    const { f } = scene("wasp", [NEAR]);
    const target = foeAt(f, NEAR);
    target.armour = 300;
    target.ward = 300;
    const hit = hitsOn(steps(f, 1), target)[0];
    expect(hit?.amount).toBe(n("wasp", "damage"));
    expect(hit?.kind).toBe("true");
  });
  test("Puddle and Mud: splash and squelch whoever is touching", () => {
    const puddle = scene("puddle", [NEAR, THREE]);
    const wet = steps(puddle.f, 1);
    expect(hitsOn(wet, foeAt(puddle.f, NEAR))[0]?.amount).toBe(n("puddle", "damage"));
    expect(statusOn(wet, foeAt(puddle.f, NEAR), "slow")?.amount).toBe(n("puddle", "slow"));
    expect(hitsOn(wet, foeAt(puddle.f, THREE)).length).toBe(0);
    const mud = scene("mud", [NEAR, THREE]);
    const stuck = steps(mud.f, 1);
    expect(hitsOn(stuck, foeAt(mud.f, NEAR))[0]?.amount).toBe(n("mud", "damage"));
    expect(statusOn(stuck, foeAt(mud.f, NEAR), "stun")?.ticks).toBe(n("mud", "stun") * HZ);
    expect(hitsOn(stuck, foeAt(mud.f, THREE)).length).toBe(0);
  });
  test("Gust: blows its target back and slows it", () => {
    const { f, u } = scene("gust", [TWO]);
    const target = foeAt(f, TWO);
    // Free to be blown about, but not to wander off before the wind arrives.
    target.rooted = false;
    target.busyUntil = 10_000;
    const events = stepUntil(f, (e) => e.t === "hit");
    expect(hitsOn(events, target).map((h) => [h.amount, h.kind])).toEqual([[n("gust", "damage"), "magic"]]);
    expect(distance(u.cell, target.cell)).toBe(2 + n("gust", "push"));
    expect(statusOn(events, target, "slow")?.amount).toBe(n("gust", "slow"));
  });
  test("Magpie: flies to the far back row as the fight starts, and pecks harder at anyone holding something", () => {
    const { f, u } = scene("magpie", [cellAt(2, 0), cellAt(4, 0)], { holding: { [cellAt(4, 0)]: ["thorn"] } });
    const leap = only(f.opening, "leap")[0];
    expect(leap?.id).toBe(u.id);
    expect(leap?.why).toBe("sneak");
    expect(rowOf(u.cell)).toBe(0);
    u.target = foeAt(f, cellAt(2, 0)).id;
    expect(hitsOn(steps(f, 1), foeAt(f, cellAt(2, 0)))[0]?.amount).toBe(n("magpie", "damage"));
    ready(u).target = foeAt(f, cellAt(4, 0)).id;
    u.busyUntil = 0;
    expect(hitsOn(steps(f, 1), foeAt(f, cellAt(4, 0)))[0]?.amount).toBe(n("magpie", "damage") * 1.5);
  });
  test("Bramble: whoever attacks it up close is pricked; from range, not", () => {
    const f = fightOf([onCell("crab7", 0, HOME), onCell("finch", 0, cellAt(3, 6))], [onCell("bramble", 1, NEAR)]);
    const crab = unitOf(f, "crab7");
    const finch = unitOf(f, "finch");
    crab.manaFull = 0;
    finch.manaFull = 0;
    unitOf(f, "bramble", 1).attack = 0;
    const events = steps(f, 2 * HZ);
    const pricks = only(events, "hit").filter((e) => e.source === "thorns");
    expect(pricks.length).toBeGreaterThan(0);
    for (const p of pricks) {
      expect(p.id).toBe(crab.id);
      expect(p.amount).toBe(Math.round((n("bramble", "thorns") * 100) / (100 + crab.armour)));
    }
    expect(finch.hp).toBe(finch.maxHp);
  });
  test("Toadstool: puffs spores when it falls, on every enemy within two hexes", () => {
    const f = fightOf(
      [onCell("mud", 0, HOME), onCell("mud", 0, cellAt(3, 5)), onCell("mud", 0, cellAt(3, 7))],
      [onCell("toadstool", 1, NEAR)],
    );
    for (const o of f.units) if (o.side === 0) still(o);
    const stool = unitOf(f, "toadstool", 1);
    f.out = [];
    hurt(f, stool, 99_999, "true", "item", null);
    const puffed = only(f.out, "hit").filter((e) => e.id !== stool.id);
    expect(puffed.length).toBe(2);
    for (const p of puffed) expect([p.amount, p.kind]).toEqual([n("toadstool", "damage"), "magic"]);
  });
  test("Counted Crab: starts inside a shell that lasts until it is broken", () => {
    const f = fightOf([onCell("mud", 0, HOME)], [onCell("crab", 1, NEAR)]);
    for (const o of f.units) still(o);
    const crab = unitOf(f, "crab", 1);
    expect(only(f.opening, "shield")[0]?.amount).toBe(n("crab", "shell"));
    crab.shield = n("crab", "shell");
    steps(f, 20 * HZ);
    expect(crab.shield).toBe(n("crab", "shell"));
  });
  test("Old Bramble: puts out runners beside the nearest enemy, up to its most, and is thorny", () => {
    const { f, u } = scene("oldbramble", [NEAR]);
    expect(u.thorns).toBe(n("oldbramble", "thorns"));
    for (let i = 0; i < n("oldbramble", "most"); i++) {
      ready(u).busyUntil = 0;
      const events = steps(f, 1);
      const summon = only(events, "summon")[0];
      expect(summon?.kind).toBe("sprout");
      expect(distance(summon?.cell ?? -1, NEAR)).toBe(1);
    }
    ready(u).busyUntil = 0;
    expect(only(steps(f, 1), "summon").length).toBe(0);
    expect(f.units.filter((o) => o.kind === "sprout" && o.alive).length).toBe(n("oldbramble", "most"));
    expect(u.steady).toBe(true);
  });
  test("The Magpie With The Hoard: swoops on whoever holds the most shiny things", () => {
    const shiny = cellAt(0, 0);
    const { f, u } = scene("hoardmagpie", [NEAR, shiny], { holding: { [shiny]: ["thorn", "wasptail"] } });
    const target = foeAt(f, shiny);
    const events = steps(f, 1);
    expect(only(events, "leap")[0]?.id).toBe(u.id);
    expect(distance(u.cell, target.cell)).toBe(1);
    expect(hitsOn(events, target)[0]?.amount).toBe(n("hoardmagpie", "damage"));
    expect(statusOn(events, target, "stun")?.ticks).toBe(n("hoardmagpie", "stun") * HZ);
  });
  test("The Crab Nobody Counted: a shell, a temper, a pinch across a cone, and a roll call at half health", () => {
    const { f, u } = scene("bigcrab", [NEAR, THREE], { keepAttack: true });
    expect(only(f.opening, "shield").find((e) => e.id === u.id)?.amount).toBe(n("bigcrab", "shell"));
    u.cool = 99;
    u.target = foeAt(f, NEAR).id;
    const before = u.attack;
    const events = steps(f, 1);
    expect(u.attack).toBe(before + Math.round((u.attack0 * n("bigcrab", "attack")) / 100));
    expect(only(events, "boost")[0]?.id).toBe(u.id);
    expect(hitsOn(events, foeAt(f, NEAR)).map((h) => [h.amount, h.kind])).toEqual([
      [n("bigcrab", "damage"), "physical"],
    ]);
    expect(hitsOn(events, foeAt(f, THREE)).length).toBe(0);
    // Roll call.
    u.shield = 0;
    f.out = [];
    hurt(f, u, u.maxHp * 0.6, "true", "item", null);
    const called = only(f.out, "summon");
    expect(called.length).toBe(n("bigcrab", "crabs"));
    for (const c of called) expect(c.kind).toBe("uncounted");
    hurt(f, u, 10, "true", "item", null);
    expect(f.units.filter((o) => o.kind === "uncounted").length).toBe(n("bigcrab", "crabs"));
    // Too big to push about: stuns on it last half as long.
    expect(u.steady).toBe(true);
  });
});

describe("what an ability says it covers, for whoever draws it", () => {
  test("an ability that spreads two hexes names every hex within two, its own first", () => {
    for (const kind of ["greg", "whitefox", "crab40", "apothecary"] as const) {
      const { f, u } = scene(kind, [NEAR]);
      const cast = only(steps(f, 1), "cast")[0];
      expect(cast?.id).toBe(u.id);
      expect(cast?.cells[0]).toBe(HOME);
      expect(inOrder(cast?.cells ?? [])).toEqual(inOrder([HOME, ...within(HOME, 2)]));
    }
  });
  test("an ability that only reaches whoever is touching names the hex and the six round it", () => {
    const { f } = scene("slug", [NEAR]);
    const cast = only(steps(f, 1), "cast")[0];
    expect(inOrder(cast?.cells ?? [])).toEqual(inOrder([HOME, ...neighbours(HOME)]));
  });
  test("a falling toadstool says its spores as an ability, with who they caught", () => {
    const f = fightOf([onCell("mud", 0, HOME), onCell("mud", 0, cellAt(3, 7))], [onCell("toadstool", 1, NEAR)]);
    for (const o of f.units) if (o.side === 0) still(o);
    const stool = unitOf(f, "toadstool", 1);
    f.out = [];
    hurt(f, stool, 99_999, "true", "item", null);
    const cast = only(f.out, "cast")[0];
    expect(cast?.id).toBe(stool.id);
    expect(cast?.name).toBe("Spores");
    expect(cast?.shape).toBe("ring");
    expect(inOrder(cast?.cells ?? [])).toEqual(inOrder([NEAR, ...within(NEAR, 2)]));
    expect(cast?.targets).toEqual([unitOf(f, "mud", 0).id]);
    // The fall is said before the spores, and the spores before what they did.
    const order = f.out.map((e) => e.t);
    expect(order.indexOf("fall")).toBeLessThan(order.indexOf("cast"));
    expect(order.indexOf("cast")).toBeLessThan(order.lastIndexOf("hit"));
  });
});
