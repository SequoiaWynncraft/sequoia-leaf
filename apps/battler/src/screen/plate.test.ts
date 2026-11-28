import { describe, expect, test } from "bun:test";

import { HEX_W } from "./geometry.ts";
import { heldAt } from "./held.ts";
import {
  aboveHead,
  BAR_W,
  barTall,
  BIG_BAR_W,
  healthOf,
  pipsWide,
  type Plate,
  plateAt,
  plated,
  shapeOf,
  ticksOf,
} from "./plate.ts";

/** The ticks on a figure of `hp` at full health, as where each is and whether it is the full height. */
const ticksAt = (hp: number): string[] => ticksOf(hp, hp, BAR_W).map((t) => `${t.x}${t.full ? " full" : ""}`);
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
/** The columns a plate takes, from its leftmost to its rightmost, pips, bar and held boxes together. */
function span(p: Plate, cx: number): [number, number] {
  const at = plateAt(p, cx, 40);
  const lefts = [at.left, ...(at.pips ? [at.pips.x] : []), ...at.held.map((h) => h.x)];
  const rights = [
    at.left + at.w,
    ...(at.pips ? [at.pips.x + pipsWide(p.stars)] : []),
    ...at.held.map((h) => h.x + h.w),
  ];
  return [Math.min(...lefts), Math.max(...rights)];
}

describe("the plate over a figure", () => {
  test("the bar is slim: 2 rows of health, 1 of mana, 1 dark row under them; 14 wide, a boss's 26", () => {
    expect([barTall(100), barTall(0)]).toEqual([4, 3]);
    const at = plateAt(plate(), 50, 40);
    expect([at.left, at.top, at.w, at.h]).toEqual([43, 36, BAR_W, 4]);
    expect(plateAt(plate({ big: true }), 50, 40).w).toBe(BIG_BAR_W);
  });

  test("ticks every 250 of health, in the lower row, up to 1,250; past that every 1,000, both rows, thinned where they would crowd", () => {
    expect(ticksAt(110)).toEqual([]);
    expect(ticksAt(700)).toEqual(["5", "10"]);
    expect(ticksAt(1250)).toEqual(["3", "6", "8", "11"]);
    expect(ticksAt(1584)).toEqual(["9 full"]);
    expect(ticksAt(5400)).toEqual(["3 full", "5 full", "8 full", "10 full", "13 full"]);
    // Late in an endless run: never closer than 2.5 pixels, every 5,000, 10,000, 50,000 and so on.
    expect(ticksAt(9000)).toEqual(["8 full"]);
    expect(ticksAt(48_000)).toEqual(["3 full", "6 full", "9 full", "12 full"]);
    expect(ticksAt(4_000_000).length).toBeLessThanOrEqual(5);
  });

  test("a shield comes after the health; over full health, the bar is the two together", () => {
    // Full health and a shield of 200 over it: the bar spans 700, health then shield fill it.
    const over = healthOf({ hp: 500, maxHp: 500, shield: 200 }, BAR_W);
    expect(over).toEqual({ hp: 10, shield: 4, whole: 700 });
    expect(over.hp + over.shield).toBe(BAR_W);
    // Hurt, the shield sits after what is left and the bar is still full health.
    expect(healthOf({ hp: 100, maxHp: 500, shield: 100 }, BAR_W)).toEqual({ hp: 3, shield: 3, whole: 500 });
    // The ticks are counted along the whole bar, health and shield.
    expect(ticksOf(500, over.whole, BAR_W).map((t) => t.x)).toEqual([5, 10]);
  });

  test("stars are pips: none for one, two for two, three for three; a pip 2 wide, 1 apart, so three take 8", () => {
    expect([pipsWide(0), pipsWide(1), pipsWide(2), pipsWide(3)]).toEqual([0, 0, 7, 10]);
    // Less their edge, a pixel each side.
    expect(pipsWide(3) - 2).toBe(8);
    expect(plateAt(plate({ stars: 1 }), 50, 40).pips).toBeNull();
    expect(plateAt(plate({ stars: 0 }), 50, 40).pips).toBeNull();
    expect(shapeOf({ summoned: true, stars: 2, items: [], manaFull: 0 }).stars).toBe(0);
  });

  test("the pips sit on the row over the bar, their colour flush with its left end; on the bench, centred", () => {
    const at = plateAt(plate({ stars: 3 }), 50, 40);
    expect(at.pips).toEqual({ x: at.left - 1, y: at.top - 4 });
    expect(at.peak).toBe(at.top - 4);
    // On the bench, no bar: the pips centred over what it holds.
    const resting = plateAt(plate({ resting: true, items: ["thorn"] }), 50, 40);
    expect([resting.h, resting.pips, resting.peak]).toEqual([0, { x: 47, y: 30 }, 30]);
    // With no pips, the plate's top is the bar's.
    expect(plateAt(plate({ stars: 1 }), 50, 40).peak).toBe(36);
  });

  test("what it holds sits under the bar in boxes, three sharing their edges, and each is found under a point", () => {
    const p = plate({ items: ["thorn", "plume", "glowcap"] });
    const at = plateAt(p, 50, 40);
    expect(at.held.map((h) => [h.item, h.x, h.y, h.w, h.h])).toEqual([
      ["thorn", 41, 33, 7, 7],
      ["plume", 47, 33, 7, 7],
      ["glowcap", 53, 33, 7, 7],
    ]);
    // The bar's dark row is the boxes' top edge.
    expect(at.top + at.h - 1).toBe(33);
    for (const h of at.held) expect(heldAt(at.held, h.x + 3, h.y + 3)?.item).toBe(h.item);
    expect(heldAt(at.held, 40, 36)).toBeNull();
  });

  test("two neighbours' plates never touch, even with three items and three stars each", () => {
    const full = plate({ stars: 3, items: ["thorn", "plume", "glowcap"] });
    const [l0, r0] = span(full, 50);
    const [l1] = span(full, 50 + HEX_W);
    expect(r0 - l0).toBeLessThan(HEX_W);
    expect(r0).toBeLessThan(l1);
  });

  test("what rises over a head starts above the plate", () => {
    // Pips 4, bar 4, and one clear row over the 3 to its foot.
    expect(aboveHead(plate())).toBe(12);
    expect(aboveHead(plate({ items: ["thorn"] }))).toBe(18);
    expect(aboveHead(plate({ stars: 1 }))).toBe(8);
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
