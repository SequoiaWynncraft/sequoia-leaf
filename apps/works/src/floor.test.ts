/**
 * The floor on the screen (`floor.ts`), on the guild's land of seven plots by seven. There is no
 * canvas and no graphics card here: stand-ins (`@sequoia-leaf/kit/standin-gl.ts`) keep each canvas's
 * size and write down what the card is asked, and the ground's painting is watched for the boxes it
 * paints.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { LAND, type Land } from "@sequoia-leaf/factory";
import { Painter } from "@sequoia-leaf/kit/painter.ts";
import { scope } from "@sequoia-leaf/kit/scope.ts";
import { FakeCard, type SentBox, standInCanvases } from "@sequoia-leaf/kit/standin-gl.ts";
import { must } from "@sequoia-leaf/kit/util.ts";

import { TILE } from "./art/belts.ts";
import { type Box, type Ground, makeGround } from "./art/ground.ts";
import { floorOf } from "./figure/dust.ts";
import { CHUNK, type Cleared, Floor, type Hands, handsNow } from "./floor.ts";
import { labelLeft } from "./ui/mapprice.ts";

const card = new FakeCard();
const away = { take: (): void => undefined };
beforeAll(() => {
  away.take = standInCanvases(card);
});
afterAll(() => away.take());

/** A floor on the stand-in card, with every box its ground is asked to paint written down, and a clock that moves only as painting does: `takes` milliseconds a chunk painted before a frame. */
interface Watched {
  readonly floor: Floor;
  readonly p: Painter;
  readonly gr: Ground;
  readonly painted: Box[];
}
function watched(land: Land, takes = 0): Watched {
  const real = makeGround(land);
  const painted: Box[] = [];
  const clock = { at: 0 };
  const gr: Ground = {
    ...real,
    paint: (g, b, owned) => {
      painted.push(b);
      clock.at += takes;
      real.paint(g, b, owned);
    },
    painting: (g, b, owned) => (painted.push(b), real.painting(g, b, owned)),
  };
  const c = document.createElement("canvas");
  c.width = 400;
  c.height = 300;
  const p = must(Painter.open(c, scope()), "painter");
  return { floor: new Floor(gr, p, () => clock.at), p, gr, painted };
}

/** Whose the land is: `cleared` the plots cleared, none being cleared unless `clearing`. */
const hands = (cleared: Cleared, clearing: readonly number[] = []): Hands => ({ cleared, clearing });
const ALL = (): boolean => true;

/** A frame's floor under a view: how many boxes the ground painted for it, and the boxes the card drew, with the pictures copied to it. */
function frame(w: Watched, view: Box, h: Hands): { painted: number; drawn: SentBox[]; copied: number } {
  w.painted.length = 0;
  card.clear();
  w.p.begin(null);
  w.floor.lay(view, h);
  w.p.end();
  return { painted: w.painted.length, drawn: card.batches.flatMap((b) => b.boxes), copied: card.copied.length };
}

/** Paints ahead, as frames with time to spare would, until nothing is left. */
function settle(w: Watched, h: Hands): void {
  for (let k = 0; k < 400 && w.floor.waiting > 0; k++) w.floor.paintAhead(h, { x: 0, y: 0 }, 50);
}

/** How many pixels some boxes cover, together. */
const area = (bs: readonly { w: number; h: number }[]): number => bs.reduce((sum, b) => sum + b.w * b.h, 0);

/** The Long Meadow, a plot of four chunks exactly, as a view; and its place in the land's list. */
const meadow = LAND.plots.findIndex((q) => q.name === "Long Meadow");
const MEADOW = (() => {
  const p = must(LAND.plots[meadow], "meadow");
  return { x: p.x * TILE, y: p.y * TILE, w: 2 * CHUNK.w, h: 2 * CHUNK.h };
})();
/** A phone's view at the size that suits it, its middle on a tile. */
const viewAt = (tx: number, ty: number): Box => ({ x: tx * TILE - 90, y: ty * TILE - 200, w: 181, h: 401 });

describe("the floor on the screen", () => {
  test("the first frame paints all of its view before it is laid, and lays exactly the view", () => {
    const w = watched(LAND);
    const view = viewAt(56, 42);
    const first = frame(w, view, hands(ALL));
    // Two chunks across and six down cover a view of 181 by 401 here.
    expect(first.painted).toBe(12);
    expect(first.copied).toBe(12);
    expect(area(first.drawn)).toBe(view.w * view.h);
    // The same view again paints nothing.
    expect(frame(w, view, hands(ALL)).painted).toBe(0);
  });

  test("a view that has outrun the painting is painted before it is laid: no frame lays ground that is not painted", () => {
    const w = watched(LAND);
    frame(w, viewAt(56, 42), hands(ALL));
    const far = viewAt(8, 70);
    const moved = frame(w, far, hands(ALL));
    // Two chunks across and five down, there: each painted, and copied to its own place on the card, before the view is laid.
    expect(moved.painted).toBe(10);
    expect(new Set(card.copied.map((c) => `${c.x},${c.y}`)).size).toBe(10);
    expect(area(moved.drawn)).toBe(far.w * far.h);
  });

  test("no frame waits more than 50 ms for its ground: what it could not paint is laid in flat colours, and the frames after paint it", () => {
    // Each chunk takes 20 ms: three fit before 50 ms have gone.
    const w = watched(LAND, 20);
    const view: Box = { x: 512, y: 384, w: 512, h: 384 };
    const first = frame(w, view, hands(ALL));
    expect(first.painted).toBe(3);
    // The view is 4 chunks by 4: the sheet laid whole, and over the 13 not painted a box a tile, 48 each, and one for the forest under them.
    const flat = first.drawn.filter((b) => b.sw === 1 && b.sh === 1);
    expect(flat.length).toBe(13 * 49);
    expect(area(flat.filter((b) => b.w === 16))).toBe(13 * CHUNK.w * CHUNK.h);
    // The nearest the middle of the view were painted first.
    const mid = { x: view.x + view.w / 2, y: view.y + view.h / 2 };
    for (const b of w.painted) expect(Math.hypot(b.x + b.w / 2 - mid.x, b.y + b.h / 2 - mid.y)).toBeLessThan(CHUNK.w);
    // Five more frames and it is whole: nothing flat is laid, and nothing more painted.
    for (let k = 0; k < 5; k++) frame(w, view, hands(ALL));
    const whole = frame(w, view, hands(ALL));
    expect([whole.painted, whole.drawn.length]).toEqual([0, 1]);
  });

  test("the land is painted ahead and kept whole: once it is, a view anywhere paints nothing", () => {
    const w = watched(LAND);
    frame(w, viewAt(56, 42), hands(ALL));
    expect(w.floor.waiting).toBeGreaterThan(200);
    settle(w, hands(ALL));
    expect(w.floor.waiting).toBe(0);
    for (const [tx, ty] of [
      [3, 3],
      [108, 3],
      [3, 80],
      [108, 80],
      [56, 42],
    ] as const)
      expect(frame(w, viewAt(tx, ty), hands(ALL)).painted).toBe(0);
    // And painting ahead looks for nothing more.
    w.painted.length = 0;
    w.floor.paintAhead(hands(ALL), { x: 0, y: 0 }, 50);
    expect(w.painted.length).toBe(0);
  });

  test("painting ahead goes nearest the view first", () => {
    const w = watched(LAND);
    const mid = { x: 20 * TILE, y: 60 * TILE };
    w.painted.length = 0;
    w.floor.paintAhead(hands(ALL), mid, 50);
    const first = must(w.painted[0], "a chunk painted");
    expect(Math.hypot(first.x + first.w / 2 - mid.x, first.y + first.h / 2 - mid.y)).toBeLessThan(CHUNK.w);
  });

  test("a plot that changes hands is painted for its new owner before the frame is laid, and only that plot", () => {
    const w = watched(LAND);
    const owned = new Set(LAND.plots.map((_, n) => n));
    settle(
      w,
      hands((n) => owned.has(n)),
    );
    owned.delete(meadow);
    const after = frame(
      w,
      MEADOW,
      hands((n) => owned.has(n)),
    );
    expect(after.painted).toBe(4);
    const plot = must(LAND.plots[meadow], "meadow");
    const inside = (b: Box): boolean =>
      b.x >= plot.x * TILE &&
      b.y >= plot.y * TILE &&
      b.x + b.w <= (plot.x + plot.w) * TILE &&
      b.y + b.h <= (plot.y + plot.h) * TILE;
    expect(w.painted.filter((b) => !inside(b))).toEqual([]);
  });

  test("a plot being cleared has its chunks as they will be painted once, laid within the plot, and made the ground when it is done without painting again", () => {
    const w = watched(LAND);
    const before: Cleared = (n) => n !== meadow;
    settle(w, hands(before));
    // Bought: the ground stays as it was, and the plot's four chunks are painted beside it.
    const clearing = frame(w, MEADOW, hands(before, [meadow]));
    expect(clearing.painted).toBe(4);
    card.clear();
    w.p.begin(null);
    w.floor.layClearing(MEADOW, meadow);
    w.p.end();
    const laid = card.batches.flatMap((b) => b.boxes);
    expect(area(laid)).toBe(MEADOW.w * MEADOW.h);
    // The next frame of the clearing paints nothing more.
    expect(frame(w, MEADOW, hands(before, [meadow])).painted).toBe(0);
    // Done: the same four pictures are copied to the ground.
    const done = frame(w, MEADOW, hands(ALL));
    expect([done.painted, done.copied]).toEqual([0, 4]);
    expect(w.floor.waiting).toBe(0);
  });

  test("after the card took everything back and returned, the next frame paints its view before laying it", () => {
    const w = watched(LAND);
    const view = viewAt(56, 42);
    settle(w, hands(ALL));
    expect(frame(w, view, hands(ALL)).painted).toBe(0);
    // The painter tells the floor itself that the card is back, empty.
    card.lose();
    card.restore();
    const back = frame(w, view, hands(ALL));
    expect([back.painted, back.copied]).toEqual([12, 12]);
    expect(area(back.drawn)).toBe(view.w * view.h);
  });

  test("on a card whose largest texture is smaller than the land, the ground is kept on several sheets and a view across them is laid whole", () => {
    card.most = 1024;
    const w = watched(LAND);
    card.most = 4096;
    const view: Box = { x: 800, y: 700, w: 400, h: 300 };
    const across = frame(w, view, hands(ALL));
    expect(area(across.drawn)).toBe(view.w * view.h);
    // Four sheets meet in the view: a box from each.
    expect(across.drawn.length).toBe(4);
    expect(new Set(card.batches.map((b) => b.from)).size).toBe(4);
    for (const b of card.batches)
      expect(Math.max(card.textures.get(b.from)?.w ?? 0, card.textures.get(b.from)?.h ?? 0)).toBeLessThanOrEqual(1024);
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
    const before = card.canvases;
    for (let k = 0; k < 64; k++)
      expect(under(((quarry?.x ?? 0) + 5) * TILE + k, ((quarry?.y ?? 0) + 3) * TILE + k)).not.toBeNull();
    expect(card.canvases - before).toBe(0);
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
