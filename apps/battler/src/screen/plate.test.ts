import { describe, expect, test } from "bun:test";

import { GOLD, INK, STONE } from "@sequoia-leaf/kit/palette.ts";
import { must } from "@sequoia-leaf/kit/util.ts";

import { HEX_W } from "./geometry.ts";
import { heldAt } from "./held.ts";
import {
  aboveHead,
  BAR_W,
  barTall,
  BIG_BAR_W,
  healthOf,
  type Plate,
  plateAt,
  plated,
  shapeOf,
  starBoxes,
  starColours,
  starsWide,
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
/** The columns a plate takes, from its leftmost to its rightmost, stars, bar and held boxes together. */
function span(p: Plate, cx: number): [number, number] {
  const at = plateAt(p, cx, 40);
  const lefts = [at.left, ...(at.stars ? [at.stars.x] : []), ...at.held.map((h) => h.x)];
  const rights = [
    at.left + at.w,
    ...(at.stars ? [at.stars.x + starsWide(p.stars)] : []),
    ...at.held.map((h) => h.x + h.w),
  ];
  return [Math.min(...lefts), Math.max(...rights)];
}

/** The stars over a plate as pixels: each star's body (its colour, its left, and its shape as rows of `X` and `.`), and whether ink edges them all round. */
function drawn(p: Plate): { bodies: { x: number; colour: string; shape: string[] }[]; edged: boolean } {
  const at = plateAt(p, 50, 40);
  if (!at.stars) return { bodies: [], edged: true };
  const px = new Map<string, string>();
  for (const b of starBoxes(p.stars, at.stars.x, at.stars.y))
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) px.set(`${x},${y}`, b.c);
  const at0 = at.stars;
  const lit = (x: number, y: number): boolean => {
    const c = px.get(`${x},${y}`);
    return c !== undefined && c !== INK;
  };
  const bodies = Array.from({ length: Math.min(p.stars, 3) }, (_, i) => {
    const x = at0.x + 1 + i * 4;
    const y = at0.y + 1;
    return {
      x,
      colour: must(px.get(`${x + 1},${y}`)),
      shape: [0, 1, 2].map((dy) => [0, 1, 2].map((dx) => (lit(x + dx, y + dy) ? "X" : ".")).join("")),
    };
  });
  const edged = [...px.keys()].every((k) => {
    const [x = 0, y = 0] = k.split(",").map(Number);
    if (!lit(x, y)) return true;
    return [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].every(([dx = 0, dy = 0]) => px.has(`${x + dx},${y + dy}`));
  });
  return { bodies, edged };
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

  test("the stars are its level: one bronze, two silver, three gold; a summon none", () => {
    for (const [stars, body] of [
      [1, "#a3662a"],
      [2, STONE[3]],
      [3, GOLD[2]],
    ] as const) {
      const star = drawn(plate({ stars }));
      expect(star.bodies.length).toBe(stars);
      expect(star.bodies.every((b) => b.colour === body)).toBe(true);
      // Each a star, not a square: four points round a middle, its corners ink, the middle the glint.
      for (const b of star.bodies) expect(b.shape).toEqual([".X.", "XXX", ".X."]);
      // An ink edge all round: nothing touches a star but ink or another star's ink.
      expect(star.edged).toBe(true);
    }
    expect(plateAt(plate({ stars: 0 }), 50, 40).stars).toBeNull();
    expect(drawn(plate({ stars: 0 })).bodies).toEqual([]);
    expect(shapeOf({ summoned: true, stars: 2, items: [], manaFull: 0 }).stars).toBe(0);
    // Bright as three become one.
    expect(starColours(3, true)).not.toEqual(starColours(3));
  });

  test("the stars are centred on the bar, their edge on its top, no wider than it, a boss's too", () => {
    for (const big of [false, true])
      for (const stars of [1, 2, 3]) {
        const p = plate({ stars, big });
        const at = plateAt(p, 50, 40);
        const edge = must(at.stars);
        const wide = starsWide(stars);
        expect(wide).toBeLessThanOrEqual(at.w);
        // Centred: as many columns of bar either side, or one more on the right where the two are odd and even.
        const leftOver = edge.x - at.left;
        const rightOver = at.left + at.w - (edge.x + wide);
        expect(rightOver - leftOver).toBeGreaterThanOrEqual(0);
        expect(rightOver - leftOver).toBeLessThanOrEqual(1);
        // The stars' own colour too, each a pixel in from the edge.
        const star = drawn(p);
        const xs = star.bodies.flatMap((b) => [b.x, b.x + 3]);
        expect(Math.min(...xs) - at.left).toBe(leftOver + 1);
        // Their ink edge's foot is the row over the bar.
        expect(edge.y + 5).toBe(at.top);
        expect(at.peak).toBe(edge.y);
      }
    expect([starsWide(0), starsWide(1), starsWide(2), starsWide(3)]).toEqual([0, 5, 9, 13]);
    // On the bench, no bar: the stars centred over what it holds.
    const resting = plateAt(plate({ stars: 3, resting: true, items: ["thorn"] }), 50, 40);
    expect([resting.h, resting.stars, resting.peak]).toEqual([0, { x: 44, y: 29 }, 29]);
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
    // Stars 5, bar 4, and one clear row over the 3 to its foot.
    expect(aboveHead(plate())).toBe(13);
    expect(aboveHead(plate({ items: ["thorn"] }))).toBe(19);
    expect(aboveHead(plate({ stars: 1 }))).toBe(13);
    expect(aboveHead(plate({ stars: 0 }))).toBe(8);
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
