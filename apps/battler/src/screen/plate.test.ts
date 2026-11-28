import { describe, expect, test } from "bun:test";

import { heldAt } from "./held.ts";
import { aboveHead, healthOf, type Plate, PLATE_W, plateAt, plated, shapeOf, ticksOf } from "./plate.ts";

/** A plate's health bar is the frame's width but its two ink columns. */
const BAR = PLATE_W - 2;
/** The ticks on a figure of `hp` at full health, as where each is and whether it is the full height. */
const ticksAt = (hp: number): string[] => ticksOf(hp, hp, BAR).map((t) => `${t.x}${t.full ? " full" : ""}`);
const plate = (o: Partial<Plate> = {}): Plate => ({
  stars: 2,
  ours: true,
  hp: 700,
  maxHp: 700,
  shield: 0,
  mana: 0,
  manaFull: 100,
  items: [],
  big: false,
  ...o,
});

describe("the plate over a figure", () => {
  test("ticks every 250 of health, 2 rows tall, up to 1,250; past that every 1,000, the bar's full height", () => {
    expect(ticksAt(110)).toEqual([]);
    expect(ticksAt(700)).toEqual(["6", "12"]);
    expect(ticksAt(1250)).toEqual(["3", "7", "10", "14"]);
    expect(ticksAt(1584)).toEqual(["11 full"]);
    expect(ticksAt(5400)).toEqual(["3 full", "6 full", "9 full", "13 full", "16 full"]);
  });

  test("a shield comes after the health; over full health, the bar is the two together", () => {
    // Full health and a shield of 200 over it: the bar spans 700, health then shield fill it.
    const over = healthOf({ hp: 500, maxHp: 500, shield: 200 }, BAR);
    expect(over).toEqual({ hp: 12, shield: 5, whole: 700 });
    expect(over.hp + over.shield).toBe(BAR);
    // Hurt, the shield sits after what is left and the bar is still full health.
    expect(healthOf({ hp: 100, maxHp: 500, shield: 100 }, BAR)).toEqual({ hp: 3, shield: 3, whole: 500 });
    // The ticks are counted along the whole bar, health and shield.
    expect(ticksOf(500, over.whole, BAR).map((t) => t.x)).toEqual([6, 12]);
  });

  test("what it holds sits under the bars, centred, each picture sharing an edge with the next, and each is found under a point", () => {
    const p = plate({ items: ["thorn", "plume", "glowcap"] });
    const at = plateAt(p, 50, 40);
    expect(at.held.map((h) => [h.item, h.x, h.y])).toEqual([
      ["thorn", 41, 33],
      ["plume", 47, 33],
      ["glowcap", 53, 33],
    ]);
    // Three are as wide as the plate, and its frame's foot is their top.
    expect((at.held.at(-1)?.x ?? 0) + 7 - (at.held[0]?.x ?? 0)).toBe(PLATE_W);
    expect(at.top + at.h - 1).toBe(33);
    for (const h of at.held) expect(heldAt(at.held, h.x + 3, h.y + 3)?.item).toBe(h.item);
    expect(heldAt(at.held, 40, 36)).toBeNull();
  });

  test("its stars sit on the frame's top; on the bench, on what it holds; a summon has none", () => {
    const at = plateAt(plate(), 50, 40);
    expect([at.top, at.h, at.starsAt, at.peak]).toEqual([32, 8, 33, 27]);
    const resting = plateAt(plate({ resting: true, items: ["thorn"] }), 50, 40);
    expect([resting.h, resting.starsAt]).toEqual([0, 34]);
    expect(plateAt(plate({ stars: 0 }), 50, 40).peak).toBe(32);
    expect(shapeOf({ summoned: true, stars: 2, items: [], manaFull: 0 }).stars).toBe(0);
  });

  test("with no mana it has no mana rows, and what rises over a head starts above it", () => {
    expect(plateAt(plate({ manaFull: 0 }), 50, 40).h).toBe(6);
    // Mana and stars: 3 to its foot, 8 of bars, 5 of stars over them, and one clear row.
    expect(aboveHead(plate())).toBe(17);
    expect(aboveHead(plate({ items: ["thorn"] }))).toBe(23);
  });

  test("there is none on a figure fallen, hidden or gone under the board, and one on a figure that has dropped in", () => {
    const standing = { down: false, sunk: false, waiting: false };
    expect(plated({ alive: true, hiddenUntil: 0 }, 40, standing)).toBe(true);
    expect(plated({ alive: false, hiddenUntil: 0 }, 40, standing)).toBe(false);
    expect(plated({ alive: true, hiddenUntil: 0 }, 40, { ...standing, down: true })).toBe(false);
    expect(plated({ alive: true, hiddenUntil: 0 }, 40, { ...standing, sunk: true })).toBe(false);
    // Up the tree until step 60: none until then, one once it has dropped.
    expect(plated({ alive: true, hiddenUntil: 60 }, 40, standing)).toBe(false);
    expect(plated({ alive: true, hiddenUntil: 60 }, 60, standing)).toBe(true);
    // A friend of Yule's whose own bubble has not closed yet stands as itself.
    expect(plated({ alive: true, hiddenUntil: 60 }, 40, { ...standing, waiting: true })).toBe(true);
  });
});
