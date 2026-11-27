/**
 * Every ability, checked against its own sentence. Each test puts the caster on our front line
 * (hex 3,4), stands plain targets where the sentence needs them, fills the caster's mana and steps
 * the clock. Targets have no armour or ward, so the damage that lands is the number in the table.
 */
import { describe, expect, test } from "bun:test";

import { abilityNumber, type Stars, type UnitKind } from "../content/figures.ts";
import { type ItemId, itemNumber, itemStats } from "../content/items.ts";
import { FIGHT } from "../content/rooms.ts";
import { cellAt, cone, distance, line, neighbours, rowOf, within } from "../hex.ts";
import type { Placed } from "../party.ts";
import { CAT, fightOf, inOrder, onCell, only, ready, steps, stepUntil, still, unitOf } from "../testkit.ts";
import { getUp, hurt, HZ, leap as moveTo, targetable } from "./core.ts";
import { speedNow } from "./engine.ts";
import { slowNow } from "./moves.ts";
import type { Fight, FightEvent, Unit } from "./types.ts";

const HOME = cellAt(3, 4);
/** Hexes one, two, three and four away from the caster, straight up the board. */
const NEAR = cellAt(3, 3);
const BESIDE = cellAt(2, 3);
const TWO = cellAt(3, 2);
const THREE = cellAt(3, 1);
const FOUR = cellAt(3, 0);

const n = (kind: UnitKind, name: string, stars: Stars = 1): number => abilityNumber(CAT, kind, name, stars);
const STARS: readonly Stars[] = [1, 2, 3];
/** An ability's number at some ability power, as it lands on a target with no armour or ward. */
const at = (amount: number, power: number): number => Math.round((amount * power) / 100);
function foeAt(f: Fight, cell: number): Unit {
  const u = f.units.find((o) => o.side === 1 && o.cell === cell);
  if (!u) throw new Error(`nobody of theirs on ${cell}`);
  return u;
}
/** The caster with its mana full, facing plain targets on the given hexes. */
function scene(
  caster: UnitKind,
  foes: readonly number[],
  more: {
    stars?: Stars;
    items?: ItemId[];
    allies?: Placed[];
    holding?: Record<number, ItemId[]>;
    keepAttack?: boolean;
  } = {},
): { f: Fight; u: Unit } {
  const f = fightOf(
    [onCell(caster, 0, HOME, more.stars ?? 1, more.items ?? []), ...(more.allies ?? [])],
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
  test("Moth: magic damage to its target and every enemy touching it, then dust there that hurts every second", () => {
    for (const stars of STARS) {
      const { f, u } = scene("moth", [TWO, THREE, cellAt(6, 0)], { stars });
      u.target = foeAt(f, TWO).id;
      const events = steps(f, 1 + distance(HOME, TWO) * FIGHT.flight + n("moth", "lasts") * HZ);
      // Drawn round its target, not round the moth.
      expect(only(events, "cast")[0]?.shape).toBe("bolt");
      expect(only(events, "cast")[0]?.cells[0]).toBe(TWO);
      for (const cell of [TWO, THREE]) {
        const hits = hitsOn(events, foeAt(f, cell));
        expect(hits.map((h) => [h.amount, h.kind])).toEqual([
          [n("moth", "damage", stars), "magic"],
          [n("moth", "dust", stars), "magic"],
          [n("moth", "dust", stars), "magic"],
        ]);
      }
      expect(hitsOn(events, foeAt(f, cellAt(6, 0))).length).toBe(0);
      const [on, off] = only(events, "zone");
      expect([on?.kind, on?.ticks, inOrder(on?.cells ?? [])]).toEqual([
        "dust",
        n("moth", "lasts") * HZ,
        inOrder([TWO, ...neighbours(TWO)]),
      ]);
      expect(off?.on).toBe(false);
      expect(f.zones.every((z) => z === null)).toBe(true);
    }
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
  test("Twig Finch: a seed whose target has fallen flies on at the enemy nearest where it fell", () => {
    for (const stars of STARS) {
      const { f } = scene("finch", [TWO, THREE, cellAt(6, 0)], { stars });
      const target = foeAt(f, TWO);
      // The first seed fells it.
      target.hp = n("finch", "damage", stars);
      const events = steps(f, 30);
      expect(hitsOn(events, target).length).toBe(1);
      expect(target.alive).toBe(false);
      const next = foeAt(f, THREE);
      expect(hitsOn(events, next).map((h) => h.amount)).toEqual([
        n("finch", "damage", stars),
        n("finch", "damage", stars),
      ]);
      expect(only(events, "shot").filter((s) => s.from === TWO && s.target === next.id).length).toBe(2);
      expect(hitsOn(events, foeAt(f, cellAt(6, 0))).length).toBe(0);
    }
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
  test("Kettle: pours three sips over a second, each to whoever is most hurt as it is poured", () => {
    for (const stars of STARS) {
      const { f, u } = scene("kettle", [FOUR], {
        stars,
        allies: [onCell("crab7", 0, cellAt(1, 5)), onCell("worm", 0, cellAt(5, 5))],
      });
      const crab = still(unitOf(f, "crab7"), 10_000);
      const worm = still(unitOf(f, "worm"), 10_000);
      const sip = n("kettle", "heal", stars);
      // The crab is the most hurt; once it has had a sip, the worm is.
      crab.hp = 5000;
      worm.hp = 5000 + Math.round(sip / 2);
      const events = steps(f, 2 * HZ);
      const cast = only(events, "cast")[0];
      expect([cast?.pulses, cast?.every]).toEqual([n("kettle", "sips"), (n("kettle", "pours") * HZ) / 2]);
      expect(only(events, "heal").map((h) => [h.id, h.amount])).toEqual([
        [crab.id, sip],
        [worm.id, sip],
        [crab.id, sip],
      ]);
      expect(u.casts).toBe(1);
    }
  });
  test("Slug: magic damage to every enemy touching it, and slime round it where enemies are slower; nothing if none is", () => {
    for (const stars of STARS) {
      const { f } = scene("slug", [NEAR, BESIDE, THREE], { stars });
      const events = steps(f, 1);
      for (const cell of [NEAR, BESIDE]) {
        const foe = foeAt(f, cell);
        expect(hitsOn(events, foe).map((h) => [h.amount, h.kind])).toEqual([[n("slug", "damage", stars), "magic"]]);
        expect(statusOn(events, foe, "slow")).toBeUndefined();
        expect(slowNow(f, foe)).toBe(n("slug", "slow", stars));
      }
      expect(hitsOn(events, foeAt(f, THREE)).length).toBe(0);
      expect(slowNow(f, foeAt(f, THREE))).toBe(0);
      const slime = only(events, "zone")[0];
      expect([slime?.kind, slime?.on, slime?.ticks]).toEqual(["slime", true, n("slug", "lasts") * HZ]);
      expect(inOrder(slime?.cells ?? [])).toEqual(inOrder(neighbours(HOME)));
      const after = steps(f, n("slug", "lasts") * HZ);
      expect(only(after, "zone").map((z) => [z.kind, z.on])).toEqual([["slime", false]]);
      expect(slowNow(f, foeAt(f, NEAR))).toBe(0);
    }
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
  test("Dusk Jay: dashes to the enemy with the least health within three hexes, then attacks faster for a few seconds", () => {
    for (const stars of STARS) {
      const { f, u } = scene("jay", [TWO, THREE, FOUR], { stars });
      const weak = foeAt(f, THREE);
      weak.hp = 500;
      // Less health still, but four hexes off.
      foeAt(f, FOUR).hp = 100;
      const plain = speedNow(f, u);
      const events = steps(f, 1);
      const dash = only(events, "leap")[0];
      expect([dash?.id, dash?.why, dash?.from]).toEqual([u.id, "dash", HOME]);
      expect(distance(u.cell, weak.cell)).toBe(1);
      expect(u.target).toBe(weak.id);
      expect(statusOn(events, u, "haste")?.amount).toBe(n("jay", "haste", stars));
      expect(speedNow(f, u)).toBeCloseTo(plain * (1 + n("jay", "haste", stars) / 100));
      steps(f, n("jay", "lasts") * HZ);
      expect(speedNow(f, u)).toBeCloseTo(plain);
    }
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
  test("Cinder Newt: magic damage to every enemy in a cone two hexes deep, three times over a second", () => {
    const inCone = cone(HOME, NEAR, 2);
    const outside = cellAt(0, 3);
    expect(inCone).not.toContain(outside);
    const others = inCone.filter((c) => c !== NEAR && rowOf(c) < 4).slice(0, 2);
    expect(others.length).toBe(2);
    for (const stars of STARS) {
      const { f, u } = scene("cindernewt", [NEAR, ...others, outside], { stars });
      u.target = foeAt(f, NEAR).id;
      const events = steps(f, 1 + n("cindernewt", "lasts") * HZ);
      const cast = only(events, "cast")[0];
      expect([cast?.shape, cast?.pulses, cast?.every]).toEqual(["cone", n("cindernewt", "breaths"), HZ / 2]);
      for (const cell of [NEAR, ...others]) {
        expect(hitsOn(events, foeAt(f, cell)).map((h) => [h.amount, h.kind])).toEqual(
          Array.from({ length: n("cindernewt", "breaths") }, () => [n("cindernewt", "damage", stars), "magic"]),
        );
      }
      expect(hitsOn(events, foeAt(f, outside)).length).toBe(0);
    }
  });
  test("Cinder Newt: turns to its target for each breath", () => {
    const { f, u } = scene("cindernewt", [NEAR, TWO]);
    const target = foeAt(f, NEAR);
    const behind = foeAt(f, TWO);
    steps(f, 1);
    // Its target steps round to its side between breaths.
    moveTo(f, target, cellAt(2, 4), "ability");
    const rest = steps(f, n("cindernewt", "lasts") * HZ);
    expect(hitsOn(rest, target).length).toBe(n("cindernewt", "breaths") - 1);
    expect(hitsOn(rest, behind).length).toBe(0);
    expect(u.casts).toBe(1);
  });
  test("Cinder Newt: a fall ends its breath for good, though it is stood back up on its hex before the next", () => {
    const { f, u } = scene("cindernewt", [NEAR, TWO]);
    const target = foeAt(f, NEAR);
    steps(f, 1);
    expect(u.casts).toBe(1);
    const cell = u.cell;
    // It falls after its first breath, and is stood back up where it was before its second.
    hurt(f, u, 1_000_000, "true", "ability", null);
    expect(u.alive).toBe(false);
    expect(getUp(f, u, u.maxHp, "seqwawa")).toBe(true);
    expect(u.cell).toBe(cell);
    u.mana = 0;
    const rest = steps(f, n("cindernewt", "lasts") * HZ);
    expect(hitsOn(rest, target).filter((h) => h.by === u.id && h.source === "ability")).toEqual([]);
  });
  test("Drizzle Frog: magic damage to its target, and a puddle round it where enemies are slower", () => {
    for (const stars of STARS) {
      const { f } = scene("drizzlefrog", [TWO, THREE, cellAt(6, 0)], { stars });
      const target = foeAt(f, TWO);
      const events = stepUntil(f, (e) => e.t === "hit");
      expect(hitsOn(events, target).map((h) => [h.amount, h.kind])).toEqual([
        [n("drizzlefrog", "damage", stars), "magic"],
      ]);
      expect(statusOn(events, target, "slow")).toBeUndefined();
      const puddle = only(events, "zone")[0];
      expect([puddle?.kind, puddle?.ticks]).toEqual(["puddle", n("drizzlefrog", "lasts") * HZ]);
      expect(inOrder(puddle?.cells ?? [])).toEqual(inOrder([TWO, ...neighbours(TWO)]));
      for (const cell of [TWO, THREE]) expect(slowNow(f, foeAt(f, cell))).toBe(n("drizzlefrog", "slow", stars));
      expect(slowNow(f, foeAt(f, cellAt(6, 0)))).toBe(0);
    }
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
  test("Gnome In A Bush: hides for a second, then jumps out beside its target: 50% more if it was attacking somebody else", () => {
    for (const stars of STARS) {
      const { f, u } = scene("bushgnome", [TWO], { stars });
      const target = foeAt(f, TWO);
      const first = steps(f, 1);
      expect(statusOn(first, u, "hidden")?.ticks).toBe(n("bushgnome", "hides") * HZ);
      expect(targetable(f, u)).toBe(false);
      const out = stepUntil(f, (e) => e.t === "hit");
      expect(f.tick).toBe(1 + n("bushgnome", "hides") * HZ);
      expect(only(out, "leap")[0]?.id).toBe(u.id);
      expect(distance(u.cell, target.cell)).toBe(1);
      expect(hitsOn(out, target)[0]?.amount).toBe(n("bushgnome", "damage", stars) * 1.5);
    }
    const watching = scene("bushgnome", [NEAR]);
    foeAt(watching.f, NEAR).target = watching.u.id;
    const hit = hitsOn(
      stepUntil(watching.f, (e) => e.t === "hit"),
      foeAt(watching.f, NEAR),
    )[0];
    expect(hit?.amount).toBe(n("bushgnome", "damage"));
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
  test("Fog Owl: swoops onto the enemy with the least health among the furthest away, hurts it and stuns it", () => {
    for (const stars of STARS) {
      const { f, u } = scene("fogowl", [NEAR, THREE, FOUR], { stars });
      foeAt(f, FOUR).hp = 5000;
      // A hex nearer than the furthest, with less health: this one.
      const t = foeAt(f, THREE);
      t.hp = 3000;
      // Less health still, but too near.
      foeAt(f, NEAR).hp = 1000;
      const events = steps(f, 1);
      expect(only(events, "leap")[0]?.id).toBe(u.id);
      expect(distance(u.cell, t.cell)).toBe(1);
      expect(hitsOn(events, t).map((h) => [h.amount, h.kind])).toEqual([[n("fogowl", "damage", stars), "physical"]]);
      expect(statusOn(events, t, "stun")?.ticks).toBe(n("fogowl", "stun", stars) * HZ);
      expect(u.target).toBe(t.id);
    }
  });
  test("Reed Heron: marks a line five hexes long, then stabs every enemy on it by then", () => {
    const path = line(HOME, NEAR, n("heron", "length"));
    expect(path.length).toBe(4);
    const outside = cellAt(0, 3);
    for (const stars of STARS) {
      const { f, u } = scene("heron", [...path, outside], { stars });
      u.target = foeAt(f, NEAR).id;
      const second = path[1] ?? -1;
      const leaving = foeAt(f, second);
      const first = steps(f, 1);
      const mark = only(first, "telegraph")[0];
      expect([mark?.id, mark?.cells, mark?.ticks]).toEqual([u.id, path, n("heron", "mark") * HZ]);
      expect(only(first, "hit").length).toBe(0);
      // One walks off the line before it lands.
      moveTo(f, leaving, cellAt(0, 2), "ability");
      const rest = steps(f, n("heron", "mark") * HZ);
      for (const cell of path.filter((c) => c !== second)) {
        expect(hitsOn(rest, foeAt(f, cell)).map((h) => [h.amount, h.kind])).toEqual([
          [n("heron", "damage", stars), "physical"],
        ]);
      }
      expect(hitsOn(rest, leaving).length).toBe(0);
      expect(hitsOn(rest, foeAt(f, outside)).length).toBe(0);
    }
  });
  test("Crab #40: pulls every enemy within two hexes 1 hex nearer, shields itself, and they have to attack it", () => {
    for (const stars of STARS) {
      const { f, u } = scene("crab40", [NEAR, TWO, THREE], { stars });
      for (const o of f.units) {
        if (o.side !== 1) continue;
        o.rooted = false;
        o.busyUntil = 10_000;
      }
      const two = foeAt(f, TWO);
      const near = foeAt(f, NEAR);
      const three = foeAt(f, THREE);
      const events = steps(f, 1);
      // The one touching it is as near as it can be; the one three hexes off is out of it.
      expect(only(events, "leap").map((l) => [l.id, l.why])).toEqual([[two.id, "pull"]]);
      expect(distance(u.cell, two.cell)).toBe(1);
      expect(u.shield).toBe(n("crab40", "shield", stars));
      for (const foe of [near, two]) {
        expect(statusOn(events, foe, "taunt")?.ticks).toBe(n("crab40", "taunt", stars) * HZ);
        expect(foe.target).toBe(u.id);
      }
      expect(statusOn(events, three, "taunt")).toBeUndefined();
      expect(three.cell).toBe(THREE);
    }
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
  test("Greg: jumps onto the free hex within three with the most enemies touching it, and sits down", () => {
    const spot = TWO;
    const crowd = [cellAt(3, 1), cellAt(2, 1), cellAt(4, 2)];
    for (const cell of crowd) expect(distance(cell, spot)).toBe(1);
    for (const stars of STARS) {
      const { f, u } = scene("greg", [...crowd, cellAt(6, 0)], { stars });
      const events = steps(f, 1);
      expect(only(events, "leap")[0]?.to).toBe(spot);
      expect(u.cell).toBe(spot);
      for (const cell of crowd) {
        const foe = foeAt(f, cell);
        expect(hitsOn(events, foe).map((h) => [h.amount, h.kind])).toEqual([[n("greg", "damage", stars), "magic"]]);
        expect(statusOn(events, foe, "stun")?.ticks).toBe(n("greg", "stun", stars) * HZ);
      }
      expect(hitsOn(events, foeAt(f, cellAt(6, 0))).length).toBe(0);
    }
  });
  test("Orphion: magic damage within two hexes, and the whole party attacks faster", () => {
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
      u.hp = Math.round(u.maxHp / 2);
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

describe("an ability in flight keeps the strength it was used with", () => {
  // A Fairy Ring makes its holder's ability power grow the moment its ability is used, before
  // anything the ability sent has landed: the use it grew after keeps the strength it had.
  const RING: ItemId[] = ["fairyring"];
  const GROW = itemNumber(CAT, "fairyring", "grow");
  /** The caster's ring went off, and only after that did anything the ability sent arrive. */
  function grewFirst(events: readonly FightEvent[], u: Unit, start: number, arrived: FightEvent["t"]): void {
    const grew = events.findIndex((e) => e.t === "item" && e.id === u.id && e.item === "fairyring");
    expect(grew).toBeGreaterThanOrEqual(0);
    expect(grew).toBeLessThan(events.findIndex((e) => e.t === arrived));
    expect(u.power).toBe(start + GROW);
  }

  test("Moth with a Fairy Ring: its first dust lands as strong as it was shaken, and the next is stronger", () => {
    const { f, u } = scene("moth", [TWO, THREE], { items: RING });
    u.target = foeAt(f, TWO).id;
    const start = u.power;
    expect(start).toBe(100 + itemStats(CAT, "fairyring").power);
    const first = stepUntil(f, (e) => e.t === "hit");
    grewFirst(first, u, start, "hit");
    for (const cell of [TWO, THREE]) {
      expect(hitsOn(first, foeAt(f, cell)).map((h) => h.amount)).toEqual([at(n("moth", "damage"), start)]);
    }
    ready(u).busyUntil = 0;
    const second = stepUntil(f, (e) => e.t === "hit");
    expect(hitsOn(second, foeAt(f, TWO)).map((h) => h.amount)).toEqual([at(n("moth", "damage"), start + GROW)]);
    expect(at(n("moth", "damage"), start + GROW)).toBeGreaterThan(at(n("moth", "damage"), start));
  });
  test("Moth: dust already on its way lands as strong as it was shaken, though the Moth falls meanwhile", () => {
    const { f, u } = scene("moth", [TWO], { items: RING, allies: [onCell("crab7", 0, cellAt(0, 7))] });
    still(unitOf(f, "crab7"));
    u.target = foeAt(f, TWO).id;
    const start = u.power;
    expect(only(steps(f, 1), "cast").length).toBe(1);
    hurt(f, u, 99_999, "true", "item", null);
    expect(u.alive).toBe(false);
    const events = stepUntil(f, (e) => e.t === "hit");
    expect(hitsOn(events, foeAt(f, TWO)).map((h) => h.amount)).toEqual([at(n("moth", "damage"), start)]);
  });
  test("Mossmote: the cushion is as thick as when it was tucked", () => {
    const { f, u } = scene("mossmote", [FOUR], { items: RING, allies: [onCell("crab7", 0, cellAt(1, 5))] });
    const crab = unitOf(f, "crab7");
    crab.hp = Math.round(crab.maxHp / 2);
    const start = u.power;
    const events = stepUntil(f, (e) => e.t === "shield");
    grewFirst(events, u, start, "shield");
    const shield = only(events, "shield")[0];
    expect(shield?.id).toBe(crab.id);
    expect(shield?.amount).toBe(at(n("mossmote", "shield"), start));
  });
  test("Twig Finch: every seed of a volley is as strong as when it was spat", () => {
    const { f, u } = scene("finch", [TWO], { items: RING });
    const start = u.power;
    const events = steps(f, 30);
    grewFirst(events, u, start, "hit");
    const hits = hitsOn(events, foeAt(f, TWO)).map((h) => h.amount);
    expect(hits).toEqual(Array.from({ length: n("finch", "seeds") }, () => at(n("finch", "damage"), start)));
  });
  test("Kettle: the tea heals as much as when it was poured", () => {
    const { f, u } = scene("kettle", [FOUR], { items: RING, allies: [onCell("crab7", 0, cellAt(1, 5))] });
    const crab = unitOf(f, "crab7");
    crab.maxHp = 5000;
    crab.hp = 1000;
    const start = u.power;
    const events = stepUntil(f, (e) => e.t === "heal");
    grewFirst(events, u, start, "heal");
    expect(only(events, "heal").map((h) => [h.id, h.amount])).toEqual([[crab.id, at(n("kettle", "heal"), start)]]);
  });
  test("Chickaree: the cone lands as hard as when it was lobbed", () => {
    const { f, u } = scene("chickaree", [NEAR, cellAt(0, 0)], { items: RING });
    const start = u.power;
    const events = stepUntil(f, (e) => e.t === "hit");
    grewFirst(events, u, start, "hit");
    const far = foeAt(f, cellAt(0, 0));
    expect(hitsOn(events, far).map((h) => h.amount)).toEqual([at(n("chickaree", "damage"), start)]);
  });
  test("Crab #12: every skip of the pebble is as strong as when it was skimmed", () => {
    const { f, u } = scene("crab12", [TWO, THREE, FOUR], { items: RING });
    u.target = foeAt(f, TWO).id;
    const start = u.power;
    const events = steps(f, 60);
    grewFirst(events, u, start, "hit");
    for (const cell of [TWO, THREE, FOUR]) {
      expect(hitsOn(events, foeAt(f, cell)).map((h) => h.amount)).toEqual([at(n("crab12", "damage"), start)]);
    }
  });
  test("Lantern Gnome: every enemy lit is hurt as much as when the lantern went up", () => {
    const { f, u } = scene("lanterngnome", [NEAR, TWO, THREE], { items: RING });
    const start = u.power;
    const events = steps(f, 40);
    grewFirst(events, u, start, "hit");
    for (const cell of [NEAR, TWO, THREE]) {
      expect(hitsOn(events, foeAt(f, cell)).map((h) => h.amount)).toEqual([at(n("lanterngnome", "damage"), start)]);
    }
  });
  test("Drizzle Frog: the big drop lands as hard as when it was spat", () => {
    const { f, u } = scene("drizzlefrog", [TWO], { items: RING });
    const start = u.power;
    const events = stepUntil(f, (e) => e.t === "hit");
    grewFirst(events, u, start, "hit");
    expect(hitsOn(events, foeAt(f, TWO)).map((h) => h.amount)).toEqual([at(n("drizzlefrog", "damage"), start)]);
  });
  test("Crab #23: each plaster heals as much as when it was handed out", () => {
    const { f, u } = scene("crab23", [FOUR], {
      items: RING,
      allies: [onCell("crab7", 0, cellAt(2, 4)), onCell("emberkit", 0, cellAt(4, 4))],
    });
    for (const kind of ["crab7", "emberkit"] as const) {
      const o = unitOf(f, kind);
      o.maxHp = 10_000;
      o.hp = 2000;
    }
    const start = u.power;
    const events = steps(f, 20);
    grewFirst(events, u, start, "heal");
    const healed = only(events, "heal");
    expect(healed.length).toBe(2);
    for (const h of healed) expect(h.amount).toBe(at(n("crab23", "heal"), start));
  });
  test("Gust: the wind hurts as much as when it was blown", () => {
    const { f, u } = scene("gust", [TWO], { items: RING });
    const target = foeAt(f, TWO);
    target.busyUntil = 10_000;
    const start = u.power;
    const events = stepUntil(f, (e) => e.t === "hit");
    grewFirst(events, u, start, "hit");
    expect(hitsOn(events, target).map((h) => h.amount)).toEqual([at(n("gust", "damage"), start)]);
  });
});
