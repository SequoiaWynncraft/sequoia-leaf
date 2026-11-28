/**
 * What the yard's picture asks of whatever draws it, where the asking has rules of its own: the
 * dashes round an area marked, the lines between pylons, and when a plan's picture has been painted
 * again. A pen here only writes down the boxes it is asked for; canvases are the kit's stand-ins.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { create } from "@sequoia-leaf/factory";
import { bareLand } from "@sequoia-leaf/factory/test/land.ts";
import { lay, must } from "@sequoia-leaf/factory/test/yards.ts";
import { GOLD } from "@sequoia-leaf/kit/palette.ts";
import type { Pen } from "@sequoia-leaf/kit/pix.ts";
import { FakeCard, standInCanvases } from "@sequoia-leaf/kit/standin-gl.ts";

import { layout } from "./layout.ts";
import { dashes } from "./marks.ts";
import { makePlan, paintPlan } from "./plan.ts";
import { S } from "./state.ts";
import { Wires } from "./wires.ts";

const away = { take: (): void => undefined };
beforeAll(() => {
  away.take = standInCanvases(new FakeCard());
});
afterAll(() => away.take());

/** A box a pen was asked for. */
interface Asked {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly colour: string;
  readonly a: number;
}
/** A pen that writes down every box. */
function pen(): { pen: Pen; boxes: Asked[] } {
  const boxes: Asked[] = [];
  return {
    boxes,
    pen: { rect: (x, y, w, h, colour, a = 1) => void boxes.push({ x, y, w, h, colour, a }), pic: () => undefined },
  };
}

/** Whether a box asked for is a pixel on the ring of the box the dashes were drawn round: corners (10, 20) and (22, 26). */
const on = (b: Asked): boolean =>
  (b.x === 10 || b.x === 22 || b.y === 20 || b.y === 26) && b.x >= 10 && b.x <= 22 && b.y >= 20 && b.y <= 26;

/** How solid each pixel of the top edge is, left to right. */
const top = (march: number): number[] => {
  const { pen: g, boxes } = pen();
  dashes(g, 10, 20, 12, 6, "#ffffff", march);
  return Array.from({ length: 12 }, (_, k) => boxes.find((b) => b.y === 20 && b.x === 10 + k)?.a ?? 0);
};

describe("the dashes round an area marked", () => {
  test("are three pixels on and three off, each dash's two end pixels half as solid, a pixel wide", () => {
    expect(top(0)).toEqual([0.5, 1, 1, 0.5, 0, 0, 0.5, 1, 1, 0.5, 0, 0]);
    const { pen: g, boxes } = pen();
    dashes(g, 10, 20, 12, 6, "#ffffff", 0);
    expect(boxes.every((b) => b.w === 1 && b.h === 1)).toBe(true);
    // Every pixel asked for is on the ring of the box, and none twice.
    expect(boxes.filter((b) => !on(b))).toEqual([]);
    expect(new Set(boxes.map((b) => `${b.x},${b.y}`)).size).toBe(boxes.length);
    // Half of the way round is on: 36 pixels round, so 18 pixels' worth.
    expect(boxes.reduce((sum, b) => sum + b.a, 0)).toBe(18);
  });

  test("march with the clock, a pixel at a time, and come round every six", () => {
    expect(top(1)).toEqual([0, 0.5, 1, 1, 0.5, 0, 0, 0.5, 1, 1, 0.5, 0]);
    expect(top(6)).toEqual(top(0));
  });
});

/** A layout that is only its lines: each as its two ends, across and down. */
const strung = (...ends: number[][]): Parameters<Wires["draw"]>[2] => ({
  ...layout(S.world),
  wires: Int32Array.from(ends.flat()),
});

describe("the lines between pylons", () => {
  const view = { x: 0, y: 0, w: 400, h: 300 };

  test("every pixel of a line in view is drawn, faint, and the three under its glint in the glint's colour", () => {
    const { pen: g, boxes } = pen();
    new Wires().draw(g, view, strung([10, 50, 130, 50]), { x: 0, y: 0 });
    // A pixel for every 1.2 of its length, and one more: 101.
    expect(boxes.length).toBe(101);
    expect(boxes.every((b) => b.w === 1 && b.h === 1 && b.a === 0.6)).toBe(true);
    expect(boxes.filter((b) => b.colour === GOLD[2]).length).toBe(3);
    // It sags most in the middle, and is made fast at its ends.
    expect([boxes[0]?.y, boxes[50]?.y, boxes[100]?.y]).toEqual([50, 58, 50]);
  });

  test("a pixel two lines lie on is drawn for each, so it is darker; a line out of view is not drawn at all", () => {
    const { pen: g, boxes } = pen();
    // Two lines made fast to the same post at (130, 50), and one far off the view.
    new Wires().draw(g, view, strung([10, 50, 130, 50], [130, 50, 250, 50], [900, 900, 990, 900]), { x: 0, y: 0 });
    expect(boxes.filter((b) => b.x === 130 && b.y === 50).length).toBe(2);
    expect(boxes.some((b) => b.x >= 400)).toBe(false);
    expect(boxes.length).toBe(202);
  });
});

describe("a plan's picture", () => {
  test("counts a painting only when a tile was painted again: whoever keeps a copy copies it then", () => {
    const y = create({ land: bareLand(18, 9, [[2, 4, "deadfall"]], [12, 4]), tier: 4, seed: 1 });
    const plan = makePlan(4);
    paintPlan(plan, y, layout(y));
    expect(plan.painted).toBe(1);
    paintPlan(plan, y, layout(y));
    expect(plan.painted).toBe(1);
    must(y, { do: "build", kind: "pylon", x: 6, y: 6, dir: 0 });
    lay(y, [4, 4], y.land.depot);
    paintPlan(plan, y, layout(y));
    expect(plan.painted).toBe(2);
    paintPlan(plan, y, layout(y));
    expect(plan.painted).toBe(2);
  });
});
