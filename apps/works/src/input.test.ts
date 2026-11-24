/**
 * The mouse over the yard points at what is under it now, whether the mouse moved or the yard moved
 * under it (the keys, an eased look, a zoom). While the yard moves under it, the mouse rests on
 * nothing, so no card comes up for whatever passes beneath; once the yard stands still, what is under
 * the mouse then is pointed at, and a card for it may follow.
 */
import { describe, expect, test } from "bun:test";

import { BELT, build, create } from "@sequoia-leaf/factory";
import { deck } from "@sequoia-leaf/kit/card.ts";
import { keyboard } from "@sequoia-leaf/kit/keyboard.ts";

import { opened, useFakeLeaf } from "../test/fake-leaf.ts";
import { aimOf } from "./hand.ts";
import { WORKS_KEYS } from "./keymap.ts";
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

/** A key as a keyboard sends it: where it is, what it types there, and whether Shift is held. */
const sent = (code: string, typed: string, shiftKey = false) => ({
  code,
  key: typed,
  shiftKey,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
});
/** A key going down, or up, on the page. */
const key = (kind: "keydown" | "keyup", code: string, typed: string, shift = false): void => {
  window.dispatchEvent(Object.assign(new Event(kind), sent(code, typed, shift)));
};

describe("the keys", () => {
  test("no two of the Works' actions share a key", () => {
    expect(WORKS_KEYS.shared()).toEqual([]);
  });

  test("on AZERTY go by their place: its Q, where QWERTY has A, moves the view left; its A picks the piece pointed at", async () => {
    const y = create({ seed: 5, tier: 1 });
    build(y, BELT, 18, 13, 0, Infinity);
    await opened(y);
    setTool(null);
    canvasPage();
    keyboard.choose("azerty");
    try {
      // Room to move left: the view starts at the yard's edge.
      pan(-400, 0);
      const from = S.cam.x;
      key("keydown", "KeyA", "q");
      stepInput(0.1);
      key("keyup", "KeyA", "q");
      stepInput(0.1);
      const moved = S.cam.x;
      stepInput(0.1);
      expect([moved < from, S.cam.x]).toEqual([true, moved]);
      S.hover = { x: 18, y: 13 };
      key("keydown", "KeyQ", "a");
      expect(S.tool).toBe(BELT);
      // And named as AZERTY prints them, in the Keys tab and in every hint.
      expect([WORKS_KEYS.name("left"), WORKS_KEYS.name("another")]).toEqual(["Q", "A"]);
    } finally {
      keyboard.choose("qwerty");
    }
  });

  test("Minus and Equal pick the eleventh and twelfth tools; with Shift, they zoom; the number pad's + and - zoom too", () => {
    const of = (code: string, typed: string, shift = false): unknown => WORKS_KEYS.of(sent(code, typed, shift))?.id;
    expect([of("Minus", "-"), of("Equal", "="), of("Minus", "_", true), of("Equal", "+", true)]).toEqual([
      "tool",
      "tool",
      "zoomOut",
      "zoomIn",
    ]);
    expect([of("NumpadAdd", "+"), of("NumpadSubtract", "-"), WORKS_KEYS.of(sent("Equal", "="))?.nth]).toEqual([
      "zoomIn",
      "zoomOut",
      11,
    ]);
  });
});
