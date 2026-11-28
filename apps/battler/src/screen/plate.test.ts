import { describe, expect, test } from "bun:test";

import { BARK, CREAM, GOLD, INK, STONE } from "@sequoia-leaf/kit/palette.ts";
import { must } from "@sequoia-leaf/kit/util.ts";
import type { RackItem } from "@sequoia-leaf/raid";

import { HEX_W } from "./geometry.ts";
import { heldAt } from "./held.ts";
import {
  aboveHead,
  BADGE,
  badgeColour,
  badgeOnly,
  badgeTones,
  BAR_H,
  BAR_W,
  BIG_BAR_W,
  healthOf,
  type Plate,
  PLATE_W,
  plateAt,
  plated,
  shapeOf,
  ticksOf,
} from "./plate.ts";

/** How many columns of health a bar has inside its frame. */
const INNER = BAR_W - 2;
/** The ticks on a figure of `hp` at full health, as where each is and whether it is the full height. */
const ticksAt = (hp: number): string[] => ticksOf(hp, INNER).map((t) => `${t.x}${t.full ? " full" : ""}`);
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
const THREE: readonly RackItem[] = ["thorn", "plume", "glowcap"];

/** The columns a plate takes, from its leftmost to its rightmost: badge, bar and held boxes together. */
function span(p: Plate, cx: number): [number, number] {
  const at = plateAt(p, cx, 40);
  const lefts = [at.left, ...(at.badge ? [at.badge.x] : []), ...at.held.map((h) => h.x)];
  const rights = [at.left + at.w, ...(at.badge ? [at.badge.x + BADGE] : []), ...at.held.map((h) => h.x + h.w)];
  return [Math.min(...lefts), Math.max(...rights)];
}

/** The badge as pixels, measured from the top left of its square. */
function badgePixels(stars: number, bright = false): Map<string, string> {
  const px = new Map<string, string>();
  for (let y = 0; y < BADGE; y++)
    for (let x = 0; x < BADGE; x++) {
      const c = badgeColour(stars, bright, x, y);
      if (c) px.set(`${x},${y}`, c);
    }
  return px;
}

describe("the plate over a figure", () => {
  test("the bar is an ink frame round 2 rows of health, a dark row and 1 of mana; with its badge as wide as three held items", () => {
    expect([PLATE_W, BADGE, BAR_W, BIG_BAR_W, BAR_H]).toEqual([19, 9, 11, 23, 6]);
    const at = plateAt(plate(), 50, 40);
    expect([at.left, at.top, at.w, at.h]).toEqual([49, 33, BAR_W, BAR_H]);
    expect(plateAt(plate({ big: true }), 50, 40).w).toBe(BIG_BAR_W);
  });

  test("ticks every 250 of health while they stand 2.5 pixels apart; closer, every 1,000 and both rows, thinned where they would crowd", () => {
    expect(ticksAt(110)).toEqual([]);
    expect(ticksAt(700)).toEqual(["3", "6"]);
    expect(ticksAt(900)).toEqual(["3", "5", "8"]);
    expect(ticksAt(1100)).toEqual(["8 full"]);
    expect(ticksAt(2400)).toEqual(["4 full", "8 full"]);
    // Late in an endless run: never closer than 2.5 pixels, every 5,000, 10,000, 50,000 and so on.
    expect(ticksAt(5400)).toEqual(["8 full"]);
    expect(ticksAt(31_000)).toEqual(["3 full", "6 full"]);
    for (const hp of [1000, 4000, 48_000, 4_000_000]) {
      const xs = ticksOf(hp, INNER).map((t) => t.x);
      for (let i = 1; i < xs.length; i++) expect(must(xs[i]) - must(xs[i - 1])).toBeGreaterThanOrEqual(2);
    }
  });

  test("a shield comes after the health; over full health, the bar is the two together", () => {
    // Full health and a shield of 200 over it: the bar spans 700, health then shield fill it.
    const over = healthOf({ hp: 500, maxHp: 500, shield: 200 }, INNER);
    expect(over).toEqual({ hp: 6, shield: 3, whole: 700 });
    expect(over.hp + over.shield).toBe(INNER);
    // Hurt, the shield sits after what is left and the bar is still full health.
    expect(healthOf({ hp: 100, maxHp: 500, shield: 100 }, INNER)).toEqual({ hp: 2, shield: 2, whole: 500 });
  });

  test("the badge is the level's metal: bronze for one star, silver for two, gold for three", () => {
    const tones = [
      [1, [GOLD[0], "#a3662a", BARK[2]]],
      [2, [CREAM, STONE[3], STONE[1]]],
      [3, [CREAM, GOLD[2], GOLD[1]]],
    ] as const;
    for (const [stars, [light, mid, shade]] of tones) {
      const px = badgePixels(stars);
      // A square on its point, 9 by 9: its ink edge all round, a hole in its middle.
      expect(px.size).toBe(41);
      for (const [x, y] of [
        [4, 0],
        [0, 4],
        [8, 4],
        [4, 8],
        [4, 4],
        [3, 4],
        [5, 4],
        [4, 3],
        [4, 5],
      ])
        expect(px.get(`${x},${y}`)).toBe(INK);
      // Lit on its top-left sides, shaded on its bottom-right, its middle tone between.
      expect([px.get("3,2"), px.get("2,4"), px.get("5,2"), px.get("3,6"), px.get("5,6"), px.get("6,4")]).toEqual([
        light,
        light,
        mid,
        mid,
        shade,
        shade,
      ]);
    }
    // Each level its own metal, and a summon's none.
    expect(new Set([1, 2, 3].map((s) => badgeTones(s)[1])).size).toBe(3);
    expect(plateAt(plate({ stars: 0 }), 50, 40).badge).toBeNull();
    expect(shapeOf({ summoned: true, stars: 2, items: [], manaFull: 0 }).stars).toBe(0);
    // Bright as three become one.
    expect(badgeTones(3, true)).not.toEqual(badgeTones(3));
    expect(badgePixels(3, true).get("5,6")).not.toBe(GOLD[1]);
  });

  test("the badge sits at the bar's left end, taller than the bar, centred on its height, its right point the bar's frame", () => {
    expect(BADGE).toBeGreaterThan(BAR_H);
    for (const big of [false, true])
      for (const stars of [1, 2, 3])
        for (const items of [[], ["thorn"], THREE] satisfies (readonly RackItem[])[]) {
          const at = plateAt(plate({ stars, big, items }), 50, 40);
          const badge = must(at.badge);
          const mid = (BADGE - 1) / 2;
          // Its right point is the column of the bar's left frame, on a row inside the bar.
          expect(badge.x + BADGE - 1).toBe(at.left);
          expect(badge.y + mid).toBeGreaterThan(at.top);
          expect(badge.y + mid).toBeLessThan(at.top + at.h - 1);
          expect(badgePixels(stars).get(`${BADGE - 1},${mid}`)).toBe(INK);
          // Centred on the bar's height: an odd badge on an even bar, half a pixel high.
          expect(badge.y + mid - (at.top + (at.h - 1) / 2)).toBe(-0.5);
          expect(at.peak).toBe(badge.y);
        }
  });

  test("a summon has no badge, and its bar is centred over it", () => {
    const at = plateAt(plate({ stars: 0 }), 50, 40);
    expect(at.badge).toBeNull();
    expect(at.left + (at.w - 1) / 2).toBe(50);
    expect(at.peak).toBe(at.top);
  });

  test("what it holds sits flush under the bar from its left edge; two or three run left under the badge to the bar's right end", () => {
    const one = plateAt(plate({ items: ["thorn"] }), 50, 40);
    expect(one.held.map((h) => [h.item, h.x, h.y, h.w, h.h])).toEqual([["thorn", one.left, one.top + BAR_H, 7, 7]]);
    const three = plateAt(plate({ items: THREE }), 50, 40);
    expect(three.held.map((h) => [h.item, h.x, h.y])).toEqual([
      ["thorn", 41, 33],
      ["plume", 47, 33],
      ["glowcap", 53, 33],
    ]);
    // Flush under the bar, their edges shared, from the badge's left to the bar's right end.
    expect(three.top + three.h).toBe(33);
    expect(must(three.held[2]).x + 7).toBe(three.left + three.w);
    expect(must(three.held[0]).x).toBe(must(three.badge).x);
    // The badge's lower point rests on their top edge.
    expect(must(three.badge).y + BADGE - 1).toBe(33);
    const two = plateAt(plate({ items: ["thorn", "plume"] }), 50, 40);
    expect(must(two.held[1]).x + 7).toBe(two.left + two.w);
    expect(must(two.held[0]).x).toBeLessThan(two.left);
    // A boss's bar is wide enough for all three from its left edge.
    const boss = plateAt(plate({ big: true, items: THREE }), 50, 40);
    expect(must(boss.held[0]).x).toBe(boss.left);
    // Each is found under a point, and nothing beside the row.
    for (const h of three.held) expect(heldAt(three.held, h.x + 3, h.y + 3)?.item).toBe(h.item);
    expect(heldAt(three.held, 40, 36)).toBeNull();
  });

  test("two neighbours' plates never touch, with three items and a badge each, a summon's too", () => {
    for (const full of [plate({ stars: 3, items: THREE }), plate({ stars: 0, items: THREE })]) {
      const [l0, r0] = span(full, 50);
      const [l1] = span(full, 50 + HEX_W);
      expect(r0 - l0).toBe(PLATE_W);
      expect(r0).toBeLessThan(l1);
    }
  });

  test("on the bench, and in the hand, the badge is centred over the figure, its lower point on what it holds", () => {
    const resting = plateAt(plate({ stars: 3, resting: true, items: ["thorn", "plume"] }), 50, 40);
    const badge = must(resting.badge);
    expect([resting.h, badge.x + (BADGE - 1) / 2, badge.y + BADGE - 1, resting.peak]).toEqual([0, 50, 33, badge.y]);
    expect(resting.held.map((h) => h.x)).toEqual([44, 50]);
    const hand = plateAt(badgeOnly(2), 50, 40);
    expect([hand.h, hand.held, must(hand.badge).x + (BADGE - 1) / 2, must(hand.badge).y + BADGE]).toEqual([
      0,
      [],
      50,
      40,
    ]);
  });

  test("what rises over a head starts above the plate", () => {
    // The badge 9 and one clear row over the 3 to its foot; held items 6 more.
    expect(aboveHead(plate())).toBe(13);
    expect(aboveHead(plate({ items: ["thorn"] }))).toBe(19);
    expect(aboveHead(plate({ stars: 1 }))).toBe(13);
    expect(aboveHead(plate({ stars: 0 }))).toBe(10);
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
