/**
 * The floor on the screen, on today's land and on tier 5's of seven plots by seven (the tests'
 * rings, `packages/factory/test/ring.ts`). There is no canvas here: a stand-in keeps each canvas's
 * size, draws nothing, and writes down what is laid on the view's picture; the ground's painting is
 * watched for the boxes it paints.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { LAND, type Land } from "@sequoia-leaf/factory";
import { SEVEN } from "@sequoia-leaf/factory/test/ring.ts";
import { makeCanvas } from "@sequoia-leaf/kit/util.ts";

import { Around } from "./around.ts";
import { TILE } from "./art/belts.ts";
import { type Box, type Ground, makeGround } from "./art/ground.ts";
import { floorOf } from "./figure/dust.ts";
import { Floor } from "./floor.ts";
import { PATCH } from "./patches.ts";
import { labelLeft } from "./ui/mapprice.ts";

const clear = (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) });

/** Every canvas made, and each picture laid on one: on which, and its size. */
const made: Canvas[] = [];
const laid: { on: Canvas; w: number; h: number }[] = [];

/** A canvas that is only its size; whatever is drawn on it is let go, but what is laid on it is written down. */
class Canvas {
  width = 300;
  height = 150;
  constructor() {
    made.push(this);
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  getContext(): unknown {
    const answers: Record<string, unknown> = {
      canvas: this,
      getImageData: (_x: number, _y: number, w: number, h: number) => clear(w, h),
      createImageData: clear,
      measureText: () => ({ width: 0 }),
      createLinearGradient: () => ({ addColorStop: () => undefined }),
      drawImage: (src: { width: number; height: number }) => laid.push({ on: this, w: src.width, h: src.height }),
    };
    return new Proxy(answers, {
      get: (known, name) => (typeof name === "string" && name in known ? known[name] : () => undefined),
      set: () => true,
    });
  }
}

beforeAll(() => {
  Object.defineProperty(globalThis, "document", { value: { createElement: () => new Canvas() }, configurable: true });
});
afterAll(() => {
  Reflect.deleteProperty(globalThis, "document");
});

/** The ground of a land, with every box it is asked to paint written down. */
function watched(land: Land): { gr: Ground; painted: Box[] } {
  const gr = makeGround(land);
  const painted: Box[] = [];
  return {
    gr: { ...gr, painting: (g, b, owned) => (painted.push(b), gr.painting(g, b, owned)) },
    painted,
  };
}

/** A phone's view at the size that suits it, its middle on a tile. */
const viewAt = (tx: number, ty: number): Box => ({ x: tx * TILE - 90, y: ty * TILE - 200, w: 181, h: 401 });

/** A frame's floor on a view's picture, after the page's first: how many patches were laid, and how many times the map's flat colours. */
function frame(
  floor: Floor,
  land: Land,
  view: Box,
  cleared: (plot: number) => boolean,
): { patches: number; flat: number } {
  const { g } = makeCanvas(view.w, view.h);
  const on = made.at(-1);
  laid.length = 0;
  floor.lay(g, view, cleared, [], cleared, false);
  const mine = laid.filter((l) => l.on === on);
  return {
    patches: mine.filter((l) => l.w === PATCH.w && l.h === PATCH.h).length,
    flat: mine.filter((l) => l.w === land.w && l.h === land.h).length,
  };
}

/** Lays the floor of a view and paints everything it wants, as frames with time to spare would. */
function settle(floor: Floor, view: Box, cleared: (plot: number) => boolean): void {
  const { g } = makeCanvas(view.w, view.h);
  for (let k = 0; k < 4; k++) {
    floor.lay(g, view, cleared, [], cleared, false);
    floor.paintSpare(Number.POSITIVE_INFINITY - 1);
  }
}

/** Today's Long Meadow, four patches exactly, as a view. */
const MEADOW = (() => {
  const p = LAND.plots.find((q) => q.name === "Long Meadow");
  return { x: (p?.x ?? 0) * TILE, y: (p?.y ?? 0) * TILE, w: 2 * PATCH.w, h: 2 * PATCH.h };
})();
const meadow = LAND.plots.findIndex((q) => q.name === "Long Meadow");

describe("the floor on the screen", () => {
  test("a plot that changes hands never shows its old floor: the flat colours until it is painted again", () => {
    const floor = new Floor(watched(LAND).gr, () => undefined);
    const owned = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    settle(floor, MEADOW, (n) => owned.has(n));
    expect(frame(floor, LAND, MEADOW, (n) => owned.has(n))).toEqual({ patches: 4, flat: 0 });
    owned.delete(meadow);
    expect(frame(floor, LAND, MEADOW, (n) => owned.has(n))).toEqual({ patches: 0, flat: 1 });
    settle(floor, MEADOW, (n) => owned.has(n));
    expect(frame(floor, LAND, MEADOW, (n) => owned.has(n))).toEqual({ patches: 4, flat: 0 });
  });

  test("today's land, once painted, is still painted on coming back from its far corner", () => {
    const floor = new Floor(watched(LAND).gr, () => undefined);
    settle(floor, MEADOW, () => true);
    settle(floor, viewAt(2, 2), () => true);
    settle(floor, viewAt(46, 2), () => true);
    expect(frame(floor, LAND, MEADOW, () => true)).toEqual({ patches: 4, flat: 0 });
  });

  test("only the page's first frame paints before it lays: any later one, the first at the picture's zoom too, waits for time to spare", () => {
    const later = watched(SEVEN);
    const { g } = makeCanvas(181, 401);
    new Floor(later.gr, () => undefined).lay(
      g,
      viewAt(56, 42),
      () => true,
      [],
      () => true,
      false,
    );
    expect(later.painted).toEqual([]);
    const first = watched(SEVEN);
    new Floor(first.gr, () => undefined).lay(
      g,
      viewAt(56, 42),
      () => true,
      [],
      () => true,
      true,
    );
    expect(first.painted.length).toBeGreaterThan(0);
  });

  test("buying a plot paints again only the patches of that plot", () => {
    const { gr, painted } = watched(SEVEN);
    const floor = new Floor(gr, () => undefined);
    const owned = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    // At the west edge of the guild's land, the first ring's plot beyond it in view.
    const view = viewAt(34, 42);
    settle(floor, view, (n) => owned.has(n));
    const west = SEVEN.plots.findIndex((p) => p.x === 16 && p.y === 36);
    expect(west).toBeGreaterThan(8);
    painted.length = 0;
    owned.add(west);
    settle(floor, view, (n) => owned.has(n));
    const plot = SEVEN.plots[west];
    const inside = (b: Box): boolean =>
      plot !== undefined &&
      b.x >= plot.x * TILE &&
      b.y >= plot.y * TILE &&
      b.x + b.w <= (plot.x + plot.w) * TILE &&
      b.y + b.h <= (plot.y + plot.h) * TILE;
    expect(painted.length).toBeGreaterThan(0);
    expect(painted.filter((b) => !inside(b))).toEqual([]);
  });

  test("what is kept stays within its budget wherever the view goes on the large land", () => {
    const floor = new Floor(watched(SEVEN).gr, () => undefined);
    for (const [tx, ty] of [
      [56, 42],
      [4, 4],
      [108, 80],
      [56, 80],
      [4, 80],
      [108, 4],
    ] as const) {
      settle(floor, viewAt(tx, ty), () => true);
      expect(floor.kept).toBeLessThanOrEqual(80);
    }
  });
});

describe("the dust a foot raises", () => {
  test("finds the floor's colour under the foot without making a picture", () => {
    const under = floorOf(makeGround(LAND));
    const quarry = LAND.plots.find((q) => q.name === "The Old Quarry");
    const before = made.length;
    for (let k = 0; k < 64; k++)
      expect(under(((quarry?.x ?? 0) + 5) * TILE + k, ((quarry?.y ?? 0) + 3) * TILE + k)).not.toBeNull();
    expect(made.length - before).toBe(0);
  });
});

describe("a price on the map", () => {
  test("stays inside the map, its coin's edge and its writing's too, wherever its plot is", () => {
    for (const [cx, wide, mapW] of [
      [24, 52, 336],
      [312, 52, 336],
      [168, 52, 336],
      [24, 26, 144],
    ] as const) {
      const left = labelLeft(cx, wide, mapW);
      expect([left - 1 >= 0, left + 7 + wide + 1 <= mapW]).toEqual([true, true]);
    }
    // Where it fits, it is centred as it always was.
    expect(labelLeft(168, 52, 336)).toBe(Math.round(168 - 59 / 2));
  });
});

/** How many pixels some boxes cover, together. */
const area = (bs: readonly Box[]): number => bs.reduce((sum, b) => sum + b.w * b.h, 0);

describe("the picture kept round the view", () => {
  test("a view moved, or zoomed, keeps what it still shows and says what came in, all of it and only that", () => {
    const around = new Around(() => undefined);
    expect(around.follow({ x: 0, y: 0, w: 181, h: 401 }, 32, TILE, -56, -88)).toBeNull();
    for (const view of [
      { x: 40, y: 8, w: 181, h: 401 },
      { x: -300, y: 500, w: 181, h: 401 },
      { x: -260, y: 480, w: 362, h: 802 },
      { x: -200, y: 500, w: 181, h: 401 },
    ]) {
      const came = around.follow(view, 32, TILE, -56, -88) ?? [];
      // Each box that came in lies outside the rest, so none is drawn twice.
      for (const [n, a] of came.entries())
        for (const b of came.slice(n + 1))
          expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false);
      expect(area(came)).toBeLessThanOrEqual((view.w + 96) * (view.h + 96));
    }
  });

  test("lets go of its canvas at the plan's zoom, and draws all again when the view comes back", () => {
    const from = made.length;
    const around = new Around(() => undefined);
    around.follow({ x: 0, y: 0, w: 181, h: 401 }, 32, TILE, -56, -88);
    expect(made.slice(from).some((c) => c.width * c.height > 100_000)).toBe(true);
    around.release();
    const kept = made.slice(from).filter((c) => c.width * c.height > 100_000);
    expect(kept.length).toBe(0);
    expect(around.follow({ x: 0, y: 0, w: 181, h: 401 }, 32, TILE, -56, -88)).toBeNull();
  });
});
