/**
 * The mouse over the yard points at what is under it now, whether the mouse moved or the yard moved
 * under it (the keys, an eased look, a zoom). While the yard moves under it, the mouse rests on
 * nothing, so no card comes up for whatever passes beneath; once the yard stands still, what is under
 * the mouse then is pointed at, and a card for it may follow.
 */
import { describe, expect, test } from "bun:test";

import { BELT } from "@sequoia-leaf/factory";
import { deck } from "@sequoia-leaf/kit/card.ts";

import { opened, useFakeLeaf } from "../test/fake-leaf.ts";
import { aimOf } from "./hand.ts";
import { S, toPage } from "./state.ts";
import { setTool } from "./tools.ts";
import { refAt } from "./ui/card.ts";

// The camera's module draws onto canvases that are made as it loads (`scene.ts`): a document is there
// first whose canvases take any drawing and keep none of it.
const inert: () => unknown = new Proxy(() => inert, { get: () => inert, set: () => true });
Object.defineProperty(globalThis, "document", { value: { createElement: () => inert }, configurable: true });
const { pan } = await import("./camera.ts");
const { initInput, stepInput } = await import("./input.ts");

useFakeLeaf();

/** A page for the input to listen on: a window, a document and the yard's canvas. A card's moment never comes. */
function canvasPage(): EventTarget {
  const win = Object.assign(new EventTarget(), {
    setTimeout: () => 0,
    clearTimeout: () => {},
    innerWidth: 320,
    innerHeight: 200,
  });
  Object.defineProperty(globalThis, "window", { value: win, configurable: true });
  Object.defineProperty(globalThis, "document", { value: new EventTarget(), configurable: true });
  const canvas = Object.assign(new EventTarget(), { dataset: {}, setPointerCapture: () => {} });
  initInput(canvas);
  return canvas;
}

/** The page opened on a new yard, with nothing in hand and the mouse not yet over it. */
async function openedEmptyHanded(): Promise<void> {
  await opened();
  setTool(null);
  S.hover = null;
}

/** The mouse moved to a point of the page, over the canvas. */
const mouseTo = (canvas: EventTarget, x: number, y: number): void => {
  canvas.dispatchEvent(
    Object.assign(new Event("pointermove"), { pointerId: 1, pointerType: "mouse", clientX: x, clientY: y }),
  );
};

/** A tile with something lying on it to point at (a deposit), and a tile further along its row with something else, or nothing. */
function twoTiles(): { a: { x: number; y: number }; b: { x: number; y: number } } {
  const w = S.world;
  for (let i = 0; i < w.kind.length; i++) {
    const a = { x: i % w.land.w, y: Math.floor(i / w.land.w) };
    const ref = refAt(a.x, a.y);
    if (!ref?.startsWith("item:")) continue;
    for (let n = 1; n < 12; n++) {
      const other = refAt(a.x + n, a.y);
      if (other !== ref && !other?.startsWith("plot:")) return { a, b: { x: a.x + n, y: a.y } };
    }
  }
  throw new Error("no deposit");
}

describe("the mouse over the yard", () => {
  test("points at nothing while the yard moves under it, and once still, at what is under it then", async () => {
    await openedEmptyHanded();
    const canvas = canvasPage();
    const { a, b } = twoTiles();
    stepInput(1 / 60);
    const p = toPage(a.x * 16 + 8, a.y * 16 + 8);
    mouseTo(canvas, p.x, p.y);
    stepInput(1 / 60);
    expect(deck.pointed).toBe(refAt(a.x, a.y));
    // The keys move the view, the mouse stays where it is: the yard slides under it to the other tile.
    pan(-(b.x - a.x) * 16 * (S.view.z / S.view.dpr), 0);
    stepInput(1 / 60);
    expect([deck.pointed, S.hover]).toEqual([null, b]);
    // Still again: what is under the mouse now is pointed at.
    stepInput(1 / 60);
    expect([deck.pointed, S.hover]).toEqual([refAt(b.x, b.y), b]);
  });

  test("with a piece in hand, aims where the mouse is as the yard moves under it", async () => {
    await openedEmptyHanded();
    const canvas = canvasPage();
    const { a, b } = twoTiles();
    setTool(BELT);
    const p = toPage(a.x * 16 + 8, a.y * 16 + 8);
    mouseTo(canvas, p.x, p.y);
    expect(aimOf(S.hand)).toMatchObject(a);
    pan(-(b.x - a.x) * 16 * (S.view.z / S.view.dpr), 0);
    stepInput(1 / 60);
    expect(aimOf(S.hand)).toMatchObject(b);
  });
});
