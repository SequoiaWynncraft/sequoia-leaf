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
import { type Cleared, Floor, type Hands, handsNow } from "./floor.ts";
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

/** The ground of a land, and every box it is asked to paint, written down. */
interface Watched {
  readonly gr: Ground;
  readonly painted: Box[];
}
function watched(land: Land): Watched {
  const gr = makeGround(land);
  const painted: Box[] = [];
  return {
    gr: { ...gr, painting: (g, b, owned) => (painted.push(b), gr.painting(g, b, owned)) },
    painted,
  };
}

/** A phone's view at the size that suits it, its middle on a tile. */
const viewAt = (tx: number, ty: number): Box => ({ x: tx * TILE - 90, y: ty * TILE - 200, w: 181, h: 401 });

/** Whose the land is: `cleared` the plots cleared, every plot the yard's land unless `land` says, none being cleared unless `clearing`. */
const hands = (cleared: Cleared, land: Cleared = () => true, clearing: readonly number[] = []): Hands => ({
  cleared,
  land,
  clearing,
});

/** A frame's floor on a view's picture, after the page's first: how many patches were laid, how many times the map's flat colours, and how many patches were painted before laying. */
function frame(floor: Floor, w: Watched, view: Box, h: Hands): { patches: number; flat: number; painted: number } {
  const { g } = makeCanvas(view.w, view.h);
  const on = made.at(-1);
  laid.length = 0;
  w.painted.length = 0;
  floor.lay(g, view, h, false);
  const mine = laid.filter((l) => l.on === on);
  return {
    patches: mine.filter((l) => l.w === PATCH.w && l.h === PATCH.h).length,
    flat: mine.filter((l) => l.w === w.gr.land.w && l.h === w.gr.land.h).length,
    painted: w.painted.length,
  };
}

/** Paints all a floor wants, as frames with time to spare would, until it wants nothing more. */
function drain(floor: Floor): void {
  for (let k = 0; k < 8 && floor.waiting > 0; k++) floor.paintSpare(Number.POSITIVE_INFINITY - 1);
}

/** Lays the floor of a view and paints everything it wants. */
function settle(floor: Floor, view: Box, h: Hands): void {
  const { g } = makeCanvas(view.w, view.h);
  for (let k = 0; k < 3; k++) {
    floor.lay(g, view, h, false);
    drain(floor);
  }
}

/** Today's Long Meadow, four patches exactly, as a view. */
const MEADOW = (() => {
  const p = LAND.plots.find((q) => q.name === "Long Meadow");
  return { x: (p?.x ?? 0) * TILE, y: (p?.y ?? 0) * TILE, w: 2 * PATCH.w, h: 2 * PATCH.h };
})();
const meadow = LAND.plots.findIndex((q) => q.name === "Long Meadow");
const ALL = (): boolean => true;

describe("the floor on the screen", () => {
  test("a plot that changes hands is painted for its new owner before the frame is laid: never its old floor, nor flat colours", () => {
    const w = watched(LAND);
    const floor = new Floor(w.gr, () => undefined);
    const owned = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    settle(
      floor,
      MEADOW,
      hands((n) => owned.has(n)),
    );
    owned.delete(meadow);
    expect(
      frame(
        floor,
        w,
        MEADOW,
        hands((n) => owned.has(n)),
      ),
    ).toEqual({ patches: 4, flat: 0, painted: 4 });
  });

  test("a view that crosses today's land row by row and comes back finds every patch of the yard's land still painted", () => {
    const w = watched(LAND);
    const floor = new Floor(w.gr, () => undefined);
    const hollow = viewAt(8, 6);
    settle(floor, hollow, hands(ALL));
    for (let ty = 0; ty <= 36; ty += 6) for (let tx = 0; tx <= 48; tx += 8) settle(floor, viewAt(tx, ty), hands(ALL));
    expect(frame(floor, w, hollow, hands(ALL))).toMatchObject({ flat: 0, painted: 0 });
  });

  test("the yard's land is painted ahead and kept whole: on the large land, every patch of it after the view went to every corner", () => {
    const w = watched(SEVEN);
    const floor = new Floor(w.gr, () => undefined);
    for (const [tx, ty] of [
      [56, 42],
      [4, 4],
      [108, 80],
      [4, 80],
      [108, 4],
    ] as const)
      settle(floor, viewAt(tx, ty), hands(ALL));
    // Seven plots by seven, two patches by two each, and the forest beyond no more than its budget and the view's.
    expect(floor.kept).toBeGreaterThanOrEqual(196);
    expect(floor.kept).toBeLessThanOrEqual(196 + 40 + 24);
    expect(frame(floor, w, viewAt(56, 42), hands(ALL))).toMatchObject({ flat: 0, painted: 0 });
  });

  test("at the plan's zoom the land is painted ahead, so the first view near shows it painted, painting nothing first", () => {
    const w = watched(LAND);
    const floor = new Floor(w.gr, () => undefined);
    floor.plan(hands(ALL), { x: 400, y: 300 }, Number.POSITIVE_INFINITY - 1);
    drain(floor);
    expect(frame(floor, w, MEADOW, hands(ALL))).toEqual({ patches: 4, flat: 0, painted: 0 });
  });

  test("after the browser empties the pictures, the next frame paints its view before laying it", () => {
    const w = watched(LAND);
    const floor = new Floor(w.gr, () => undefined);
    settle(floor, MEADOW, hands(ALL));
    floor.wipe();
    expect(frame(floor, w, MEADOW, hands(ALL))).toEqual({ patches: 4, flat: 0, painted: 4 });
  });

  test("a frame paints nothing before laying when nothing in view changed hands, though it is not all painted yet", () => {
    const w = watched(SEVEN);
    const floor = new Floor(w.gr, () => undefined);
    frame(floor, w, viewAt(56, 42), hands(ALL));
    expect(frame(floor, w, viewAt(20, 20), hands(ALL))).toMatchObject({ painted: 0 });
  });

  test("a plot bought shows its cleared floor where the clearing has reached from its first frame, with no time to spare", () => {
    const w = watched(LAND);
    const floor = new Floor(w.gr, () => undefined);
    const before = (n: number): boolean => n !== meadow;
    settle(floor, MEADOW, hands(before));
    const { g } = makeCanvas(MEADOW.w, MEADOW.h);
    floor.lay(g, MEADOW, hands(before, ALL, [meadow]), false);
    laid.length = 0;
    floor.layClearing(g, MEADOW, meadow);
    expect(laid.filter((l) => l.w === PATCH.w && l.h === PATCH.h).length).toBe(4);
  });

  test("buying a plot paints again only the patches of that plot", () => {
    const { gr, painted } = watched(SEVEN);
    const floor = new Floor(gr, () => undefined);
    const owned = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    // At the west edge of the guild's land, the first ring's plot beyond it in view.
    const view = viewAt(34, 42);
    settle(
      floor,
      view,
      hands((n) => owned.has(n)),
    );
    const west = SEVEN.plots.findIndex((p) => p.x === 16 && p.y === 36);
    expect(west).toBeGreaterThan(8);
    painted.length = 0;
    owned.add(west);
    settle(
      floor,
      view,
      hands((n) => owned.has(n)),
    );
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
});

describe("whose the land is", () => {
  test("a plot being cleared that is not the yard's (Leaf put the purchase back) stops clearing at once", () => {
    const owned = LAND.plots.map((_, n) => n !== meadow);
    const plot = LAND.plots[meadow]?.plot;
    const clearing = new Map(plot === undefined ? [] : [[plot, { at: 0, x: 0, y: 0 }]]);
    const h = handsNow({ owned, signs: [], yard: { land: LAND } }, clearing);
    expect([h.clearing, clearing.size, h.cleared(meadow)]).toEqual([[], 0, false]);
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
