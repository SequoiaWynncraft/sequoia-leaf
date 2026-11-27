/**
 * The floor on the screen on tier 5's land of seven plots by seven (the tests' rings,
 * `packages/factory/test/ring.ts`): buying a plot paints again only that plot, and what is kept
 * grows with the view, not the land, wherever the view goes. There is no canvas here: a stand-in
 * keeps each canvas's size and draws nothing, and the ground's painting is watched for the boxes it
 * paints.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { SEVEN } from "@sequoia-leaf/factory/test/ring.ts";
import { makeCanvas } from "@sequoia-leaf/kit/util.ts";

import { Around } from "./around.ts";
import { TILE } from "./art/belts.ts";
import { type Box, type Ground, makeGround } from "./art/ground.ts";
import { Floor } from "./floor.ts";
import { PATCH } from "./patches.ts";

const clear = (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) });

/** A canvas that is only its size; whatever is drawn on it is let go. */
class Canvas {
  width = 300;
  height = 150;
  addEventListener(): void {}
  removeEventListener(): void {}
  getContext(): unknown {
    const answers: Record<string, unknown> = {
      canvas: this,
      getImageData: (_x: number, _y: number, w: number, h: number) => clear(w, h),
      createImageData: clear,
      measureText: () => ({ width: 0 }),
      createLinearGradient: () => ({ addColorStop: () => undefined }),
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

/** The ground of the 7x7 land, with every box it is asked to paint written down. */
function watched(): { gr: Ground; painted: Box[] } {
  const gr = makeGround(SEVEN);
  const painted: Box[] = [];
  return {
    gr: { ...gr, painting: (g, b, owned) => (painted.push(b), gr.painting(g, b, owned)) },
    painted,
  };
}

/** A phone's view at the size that suits it, its middle on a tile. */
const viewAt = (tx: number, ty: number): Box => ({ x: tx * TILE - 90, y: ty * TILE - 200, w: 181, h: 401 });

/** Lays the floor of a view and paints everything it wants, as frames with time to spare would. */
function settle(floor: Floor, view: Box, cleared: (plot: number) => boolean): void {
  const { g } = makeCanvas(view.w, view.h);
  for (let k = 0; k < 4; k++) {
    floor.lay(g, view, cleared, [], cleared);
    floor.paintSpare(Number.POSITIVE_INFINITY - 1);
  }
}

describe("the floor on the screen", () => {
  test("buying a plot paints again only the patches of that plot", () => {
    const { gr, painted } = watched();
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

  test("what is kept grows with the view, not the land, wherever the view goes", () => {
    const { gr } = watched();
    const floor = new Floor(gr, () => undefined);
    const most = (Math.ceil(181 / PATCH.w) + 3) * (Math.ceil(401 / PATCH.h) + 3);
    for (const [tx, ty] of [
      [56, 42],
      [4, 4],
      [108, 80],
      [56, 80],
    ] as const) {
      settle(floor, viewAt(tx, ty), () => true);
      expect(floor.kept).toBeLessThanOrEqual(most);
    }
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
});
