/** Every item, checked against its own sentence as it plays out in a fight. */
import { describe, expect, test } from "bun:test";

import { figureIn } from "../content/figures.ts";
import { componentIn, type FinishedId, finishedIn, type ItemId, itemStats } from "../content/items.ts";
import { FIGHT } from "../content/rooms.ts";
import { cellAt } from "../hex.ts";
import { CAT, fightOf, onCell, only, ready, steps, stepUntil, still, stillSide, unitOf } from "../testkit.ts";
import { hurt, HZ, stun } from "./core.ts";
import type { Fight, Unit } from "./types.ts";

const HOME = cellAt(3, 4);
const NEAR = cellAt(3, 3);
const BESIDE = cellAt(2, 3);
const num = (id: FinishedId, name: string): number => finishedIn(CAT, id).n[name] ?? 0;

/** A Crab #7 holding some items, facing a plain target; it only attacks unless told otherwise. */
function holder(items: ItemId[], kind: "crab7" | "finch" | "moth" = "crab7"): { f: Fight; u: Unit; target: Unit } {
  const f = fightOf([onCell(kind, 0, HOME, 1, items)], [onCell("mud", 1, NEAR), onCell("mud", 1, BESIDE)]);
  stillSide(f, 1);
  const u = unitOf(f, kind);
  u.manaFull = 0;
  const target = f.units.find((o) => o.side === 1 && o.cell === NEAR);
  if (!target) throw new Error("no target");
  u.target = target.id;
  return { f, u, target };
}

describe("components", () => {
  test("each adds its one stat", () => {
    const base = figureIn(CAT, "crab7");
    expect(holder(["thorn"]).u.attack).toBe(
      Math.round(base.attack * (1 + componentIn(CAT, "thorn").stats.attack / 100)),
    );
    expect(holder(["plume"]).u.speed).toBeCloseTo(base.speed * (1 + componentIn(CAT, "plume").stats.speed / 100));
    expect(holder(["glowcap"]).u.power).toBe(100 + componentIn(CAT, "glowcap").stats.power);
    expect(holder(["bark"]).u.armour).toBe(base.armour + componentIn(CAT, "bark").stats.armour);
    expect(holder(["bark"]).u.ward).toBe(base.ward + componentIn(CAT, "bark").stats.ward);
    expect(holder(["chestnut"]).u.maxHp).toBe(
      Math.round(base.hp * (1 + componentIn(CAT, "chestnut").stats.health / 100)),
    );
    expect(holder([]).u.attack).toBe(base.attack);
  });
  test("a finished item gives both halves' stats, and three items add up", () => {
    const base = figureIn(CAT, "crab7");
    const { u } = holder(["wasptail", "hedgehog", "hoard"]);
    const attack = itemStats(CAT, "wasptail").attack + itemStats(CAT, "hedgehog").attack;
    expect(u.attack).toBe(Math.round(base.attack * (1 + attack / 100)));
    expect(u.speed).toBeCloseTo(base.speed * (1 + itemStats(CAT, "wasptail").speed / 100));
    expect(u.armour).toBe(base.armour + itemStats(CAT, "hedgehog").armour);
    expect(u.maxHp).toBe(Math.round(base.hp * (1 + itemStats(CAT, "hoard").health / 100)));
    expect(u.items).toEqual(["wasptail", "hedgehog", "hoard"]);
  });
});

describe("finished items", () => {
  test("Blackthorn Sprig: its attacks go through part of the target's armour", () => {
    const { f, u, target } = holder(["blackthorn"]);
    target.armour = 100;
    const hit = only(
      stepUntil(f, (e) => e.t === "hit"),
      "hit",
    )[0];
    const left = 100 * (1 - num("blackthorn", "pierce") / 100);
    expect(hit?.amount).toBe(Math.round((u.attack * 100) / (100 + left)));
    expect(hit?.amount).toBeGreaterThan(Math.round((u.attack * 100) / 200));
  });
  test("Wasp-Tail Dart: every third attack lands twice", () => {
    const { f, u } = holder(["wasptail"]);
    const events = steps(f, 12 * HZ);
    const swings = only(events, "swing").length;
    const hits = only(events, "hit").filter((e) => e.by === u.id).length;
    expect(swings).toBeGreaterThanOrEqual(6);
    expect(hits).toBe(swings + Math.floor(swings / num("wasptail", "every")));
    expect(only(events, "item").every((e) => e.item === "wasptail")).toBe(true);
    expect(only(events, "item").length).toBe(Math.floor(swings / 3));
  });
  test("Wasp-Tail Dart at range: the second one is thrown just behind the first", () => {
    const f = fightOf([onCell("finch", 0, cellAt(3, 6), 1, ["wasptail"])], [onCell("mud", 1, NEAR)]);
    stillSide(f, 1);
    const finch = unitOf(f, "finch");
    finch.manaFull = 0;
    const events = steps(f, 8 * HZ);
    const shots = only(events, "shot");
    const hits = only(events, "hit");
    expect(shots.length).toBeGreaterThanOrEqual(4);
    expect(hits.length).toBeGreaterThanOrEqual(shots.length - 1);
    expect(shots.filter((s) => s.ticks === 3 * FIGHT.flight + 2).length).toBe(Math.floor((shots.length + 0) / 4));
  });
  test("Glowthorn: each attack gives more mana", () => {
    const { f, u } = holder(["glowthorn"]);
    u.manaFull = 500;
    stepUntil(f, (e) => e.t === "swing");
    expect(u.mana).toBe(figureIn(CAT, "crab7").mana[0] + FIGHT.manaAttack + num("glowthorn", "mana"));
  });
  test("Hedgehog Coat: whoever attacks it up close takes magic damage worth a share of the wearer's health", () => {
    const f = fightOf([onCell("crab7", 0, HOME, 1, ["hedgehog"])], [onCell("gnat", 1, NEAR)]);
    const crab = unitOf(f, "crab7");
    crab.attack = 0;
    crab.manaFull = 0;
    const gnat = unitOf(f, "gnat", 1);
    gnat.maxHp = 10_000;
    gnat.hp = 10_000;
    const events = stepUntil(f, (e) => e.t === "hit" && e.source === "thorns");
    const prick = only(events, "hit").find((e) => e.source === "thorns");
    expect(prick?.id).toBe(gnat.id);
    expect(prick?.kind).toBe("magic");
    expect(prick?.amount).toBe(Math.round((crab.maxHp * num("hedgehog", "prickle")) / 100));
  });
  test("Conker On A String: its attacks swing on into one more enemy beside the target", () => {
    const { f, u, target } = holder(["conker"]);
    const events = stepUntil(f, (e) => e.t === "hit");
    const hits = only(events, "hit");
    expect(hits.length).toBe(2);
    expect(hits[0]?.id).toBe(target.id);
    expect(hits[0]?.amount).toBe(u.attack);
    expect(hits[1]?.id).not.toBe(target.id);
    expect(hits[1]?.amount).toBe(Math.round((u.attack * num("conker", "clip")) / 100));
  });
  test("Hummingbird Charm: reaches a hex further", () => {
    expect(holder(["hummingbird"]).u.range).toBe(figureIn(CAT, "crab7").range + num("hummingbird", "reach"));
    expect(holder(["hummingbird"], "finch").u.range).toBe(figureIn(CAT, "finch").range + 1);
  });
  test("Moth Lantern: starts with its mana bar half full", () => {
    const f = fightOf([onCell("moth", 0, HOME, 1, ["mothlantern"])], [onCell("mud", 1, NEAR)]);
    const moth = unitOf(f, "moth");
    expect(moth.mana).toBe(Math.round((moth.manaFull * num("mothlantern", "head")) / 100));
    expect(moth.mana).toBeGreaterThan(figureIn(CAT, "moth").mana[0]);
  });
  test("Quilted Vest: some attacks slip past it", () => {
    expect(holder(["quilt"]).u.slip).toBe(num("quilt", "slip"));
    const f = fightOf([onCell("crab7", 0, HOME)], [onCell("mud", 1, NEAR, 1, ["quilt"])]);
    stillSide(f, 1);
    const mud = unitOf(f, "mud", 1);
    mud.slip = num("quilt", "slip");
    const crab = unitOf(f, "crab7");
    crab.manaFull = 0;
    crab.speed = HZ;
    const events = steps(f, FIGHT.dusk * HZ - 1);
    const share = only(events, "slip").length / only(events, "swing").length;
    expect(share).toBeGreaterThan(num("quilt", "slip") / 100 - 0.05);
    expect(share).toBeLessThan(num("quilt", "slip") / 100 + 0.05);
  });
  test("Honey Cake: its attacks heal it for a share of the damage they do", () => {
    const { f, u } = holder(["honeycake"]);
    u.hp = 50;
    const events = stepUntil(f, (e) => e.t === "heal");
    const healed = only(events, "heal")[0];
    expect(healed?.source).toBe("leech");
    expect(healed?.amount).toBe(Math.round((u.attack * num("honeycake", "leech")) / 100));
    expect(u.hp).toBe(50 + (healed?.amount ?? 0));
  });
  test("Fairy Ring: every use of its ability makes the next ones stronger", () => {
    const f = fightOf([onCell("crab7", 0, HOME, 1, ["fairyring"])], [onCell("mud", 1, NEAR)]);
    stillSide(f, 1);
    const crab = unitOf(f, "crab7");
    crab.attack = 0;
    const start = crab.power;
    expect(start).toBe(100 + itemStats(CAT, "fairyring").power);
    const damage = figureIn(CAT, "crab7").ability?.n.damage?.[0] ?? 0;
    const first = only(steps(ready(crab) && f, 1), "hit")[0];
    expect(first?.amount).toBe(Math.round((damage * start) / 100));
    expect(crab.power).toBe(start + num("fairyring", "grow"));
    crab.busyUntil = 0;
    const second = only(steps(ready(crab) && f, 1), "hit")[0];
    expect(second?.amount).toBe(Math.round((damage * (start + num("fairyring", "grow"))) / 100));
  });
  test("Lichen Locket: using its ability shields it for a share of its health", () => {
    const f = fightOf([onCell("crab7", 0, HOME, 1, ["lichen"])], [onCell("mud", 1, NEAR)]);
    stillSide(f, 1);
    const crab = ready(unitOf(f, "crab7"));
    const events = steps(f, 1);
    const shield = only(events, "shield")[0];
    expect(shield?.id).toBe(crab.id);
    expect(shield?.amount).toBe(Math.round((crab.maxHp * num("lichen", "shield")) / 100));
    expect(shield?.ticks).toBe(num("lichen", "lasts") * HZ);
  });
  test("Stewpot: every few seconds it serves whoever in the party is most hurt", () => {
    const f = fightOf(
      [onCell("crab7", 0, HOME, 1, ["stewpot"]), onCell("emberkit", 0, cellAt(4, 4))],
      [onCell("mud", 1, cellAt(3, 0))],
    );
    for (const u of f.units) still(u, u.maxHp);
    const kit = unitOf(f, "emberkit");
    kit.maxHp = 2000;
    kit.hp = 500;
    const every = num("stewpot", "every");
    const events = steps(f, every * 2 * HZ);
    const served = only(events, "heal").filter((e) => e.source === "item");
    expect(served.length).toBe(2);
    for (const s of served) {
      expect(s.id).toBe(kit.id);
      expect(s.amount).toBe((2000 * num("stewpot", "heal")) / 100);
    }
    expect(only(events, "item").map((e) => e.item)).toEqual(["stewpot", "stewpot"]);
  });
  test("Stump Shield: nothing lands hard on it, and stuns on it last half as long", () => {
    const f = fightOf(
      [onCell("worm", 0, cellAt(1, 7)), onCell("bushgnome", 0, cellAt(5, 7))],
      [onCell("mud", 1, cellAt(1, 0), 1, ["stump"])],
    );
    const mud = unitOf(f, "mud", 1);
    expect(mud.noHard).toBe(true);
    mud.attack = 0;
    mud.manaFull = 0;
    for (const u of f.units) if (u.side === 0) u.manaFull = 0;
    const hits = only(steps(f, 4 * HZ), "hit").filter((e) => e.id === mud.id);
    // Two Sneaks' first hits, which would have landed hard on anybody else.
    expect(hits.length).toBeGreaterThan(2);
    expect(hits.some((h) => h.hard)).toBe(false);
    stun(f, mud, 2, null);
    expect(mud.stunUntil - f.tick).toBe((2 * HZ * (100 - num("stump", "steady"))) / 100);
  });
  test("Hollow Log: once a fight, under two fifths health, it climbs inside a shield", () => {
    const { f, u, target } = holder(["hollowlog"]);
    f.out = [];
    hurt(f, u, u.maxHp * 0.5, "true", "attack", target);
    expect(u.shield).toBe(0);
    hurt(f, u, u.maxHp * 0.2, "true", "attack", target);
    const worth = Math.round((u.maxHp * num("hollowlog", "shield")) / 100);
    expect(u.shield).toBe(worth);
    expect(only(f.out, "item").map((e) => e.item)).toEqual(["hollowlog"]);
    expect(only(f.out, "shield")[0]?.ticks).toBe(num("hollowlog", "lasts") * HZ);
    u.shield = 0;
    hurt(f, u, 1, "true", "attack", target);
    expect(u.shield).toBe(0);
  });
  test("Winter Hoard: regrows a share of its health every second", () => {
    const { f, u } = holder(["hoard"]);
    u.attack = 0;
    u.hp = 100;
    const events = steps(f, 2 * HZ);
    const grown = only(events, "heal").filter((e) => e.source === "regrow");
    expect(grown.length).toBe(2);
    for (const g of grown) expect(g.amount).toBe(Math.round((u.maxHp * num("hoard", "regrow")) / 100));
  });
});
