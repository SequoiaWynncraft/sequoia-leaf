/**
 * Being somebody in your own yard, on the page: the walking keys walk you and the view goes with you;
 * a drag lets go of you and walking takes hold again; an empty-handed tap on the ground walks there and
 * one on a piece opens its card; and you build within reach, the plot you stand on and the eight round
 * it, and are refused "Out of reach." past it, with the aim showing why.
 */
import { afterEach, describe, expect, test } from "bun:test";

import { BELT, create, LAND, MILL, type Yard } from "@sequoia-leaf/factory";
import { deck } from "@sequoia-leaf/kit/card.ts";
import { noKeysHeld } from "@sequoia-leaf/kit/keys.ts";

import { opened, useFakeLeaf } from "../../test/fake-leaf.ts";
import { aimOf } from "../hand.ts";
import { WORKS_KEYS } from "../keymap.ts";
import { S, toPage } from "../state.ts";
import { aimAt, setTool } from "../tools.ts";
import { doNow } from "../yard.ts";
import { beyondReach, OUT_OF_REACH, reachBox, reaches } from "./reach.ts";
import { leave, placeYou, you } from "./you.ts";

// The camera's module draws onto canvases that are made as it loads (`scene.ts`): a document is there
// first whose canvases take any drawing and keep none of it.
const inert: () => unknown = new Proxy(() => inert, { get: () => inert, set: () => true });
Object.defineProperty(globalThis, "document", { value: { createElement: () => inert }, configurable: true });
const { following, pan } = await import("../camera.ts");
const { initInput, stepInput } = await import("../input.ts");

useFakeLeaf();
afterEach(() => {
  leave();
  noKeysHeld();
  Reflect.deleteProperty(globalThis, "HTMLElement");
});

/** A yard at tier 4 that owns every plot of the guild's land. */
function everywhere(): Yard {
  const y = create({ seed: 6, tier: 4 });
  y.plots = LAND.plots.map((p) => p.plot);
  return y;
}
/** The middle of a tile, in pixels of the art. */
const mid = (x: number, y: number): { x: number; y: number } => ({ x: x * 16 + 8, y: y * 16 + 8 });
/** A page for the input to listen on: a window, a document and the yard's canvas. */
function canvasPage(): EventTarget {
  const win = Object.assign(new EventTarget(), {
    setTimeout: () => 0,
    clearTimeout: () => {},
    innerWidth: 320,
    innerHeight: 200,
  });
  Object.defineProperty(globalThis, "window", { value: win, configurable: true });
  Object.defineProperty(globalThis, "document", { value: new EventTarget(), configurable: true });
  // Space on a button is the button's: nothing here is one.
  const element = class {
    matches(): boolean {
      return false;
    }
  };
  Object.defineProperty(globalThis, "HTMLElement", { value: element, configurable: true });
  const canvas = Object.assign(new EventTarget(), { dataset: {}, setPointerCapture: () => {} });
  initInput(canvas);
  return canvas;
}
/** A key going down, or up, on the page. */
const key = (kind: "keydown" | "keyup", code: string, typed: string): void => {
  const e = { code, key: typed, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, repeat: false };
  window.dispatchEvent(Object.assign(new Event(kind), e));
  if (kind === "keyup") noKeysHeld();
};
/** A click of the mouse's main button at a point of the yard, in its pixels, that does not move. */
function click(canvas: EventTarget, x: number, y: number): void {
  const p = toPage(x, y);
  const e = (type: string): Event =>
    Object.assign(new Event(type), { pointerId: 1, pointerType: "mouse", button: 0, clientX: p.x, clientY: p.y });
  canvas.dispatchEvent(e("pointerdown"));
  canvas.dispatchEvent(e("pointerup"));
}

describe("reach", () => {
  test("from the yard's middle plot, all nine plots of the guild's land are in reach", async () => {
    await opened(everywhere());
    placeYou(mid(24, 21));
    expect(reachBox()).toEqual({ x0: 0, y0: 0, x1: 47, y1: 35 });
    expect([reaches(0, 0), reaches(47, 35), reaches(47, 0), reaches(0, 35)]).toEqual([true, true, true, true]);
  });

  test("from a corner plot, the plot stood on and the eight round it: the far side of the map is out of reach", async () => {
    await opened(everywhere());
    // Windfall Hollow, the north-west corner.
    placeYou(mid(8, 6));
    expect(reachBox()).toEqual({ x0: -16, y0: -12, x1: 31, y1: 23 });
    expect([reaches(31, 23), reaches(32, 23), reaches(31, 24), reaches(44, 33)]).toEqual([true, false, false, false]);
  });

  test("at a plot's edge it is the plot stood on that counts: a step across moves reach a plot over", async () => {
    await opened(everywhere());
    // The last pixel of the Hollow's last column, then the first of the Grove's.
    placeYou({ x: 16 * 16 - 1, y: 6 * 16 + 8 });
    expect(reaches(31, 6)).toBe(true);
    expect(reaches(32, 6)).toBe(false);
    leave();
    placeYou({ x: 16 * 16, y: 6 * 16 + 8 });
    expect(reaches(47, 6)).toBe(true);
    expect(reaches(0, 30)).toBe(false);
  });

  test("a build, a run, a removal and a set-down out of reach are refused; raising, turning and painting are not limited", async () => {
    const y = everywhere();
    await opened(y, 100_000);
    placeYou(mid(8, 6));
    const far = { x: 44, y: 33 };
    const refused = { refused: "out_of_reach", why: OUT_OF_REACH };
    expect(doNow({ do: "build", kind: BELT, x: far.x, y: far.y, dir: 0, grade: 1 })).toEqual(refused);
    expect(
      doNow({
        do: "lay",
        legs: [
          { tunnel: false, x: 30, y: 20, dir: 0, grade: 1 },
          { ...far, tunnel: false, dir: 0, grade: 1 },
        ],
      }),
    ).toEqual(refused);
    expect(beyondReach({ do: "paint", x: far.x, y: far.y, tint: 2 })).toBeNull();
    expect(beyondReach({ do: "turn", x: far.x, y: far.y, dir: 1 })).toBeNull();
    // A piece standing far away (built from the middle) may be raised where it stands, not taken away.
    leave();
    placeYou(mid(24, 21));
    expect("refused" in doNow({ do: "build", kind: MILL, x: far.x, y: far.y, dir: 0, grade: 1 })).toBe(false);
    leave();
    placeYou(mid(8, 6));
    expect(beyondReach({ do: "build", kind: MILL, x: far.x, y: far.y, dir: 0, grade: 2 })).toBeNull();
    expect(doNow({ do: "remove", x: far.x, y: far.y })).toEqual(refused);
    expect(doNow({ do: "clear", tiles: [far.y * y.land.w + far.x] })).toEqual(refused);
    // In reach, the rules decide.
    expect("refused" in doNow({ do: "build", kind: BELT, x: 10, y: 6, dir: 0, grade: 1 })).toBe(false);
  });

  test("an aim out of reach says so, and its ghost shows it; the brush aims anywhere", async () => {
    await opened(everywhere(), 100_000);
    placeYou(mid(8, 6));
    setTool(MILL);
    aimAt(44, 33);
    expect(aimOf(S.hand)?.why).toBe(OUT_OF_REACH);
    aimAt(10, 8);
    expect(aimOf(S.hand)?.why).toBeNull();
    setTool("remove");
    aimAt(44, 33);
    expect(aimOf(S.hand)?.why).toBe(OUT_OF_REACH);
    // Reach is said first: past it, what the rules would say there does not matter yet.
    setTool(MILL);
    aimAt(40, 30);
    expect(aimOf(S.hand)?.why).toBe(OUT_OF_REACH);
    // Without a figure (a visit, a review page's own yard) nothing is out of reach.
    leave();
    aimAt(44, 33);
    expect(aimOf(S.hand)?.why).not.toBe(OUT_OF_REACH);
  });
});

describe("the walking keys", () => {
  test("walk you, and the view goes with you; without a figure of yours they move the view", async () => {
    await opened(everywhere());
    canvasPage();
    setTool(null);
    const c = placeYou(mid(24, 21));
    stepInput(1 / 60);
    const [x0, cam0] = [c.x, S.cam.x];
    key("keydown", "KeyD", "d");
    for (let k = 0; k < 30; k++) stepInput(1 / 60);
    key("keyup", "KeyD", "d");
    expect(c.x - x0).toBeCloseTo(32, 0);
    expect(S.cam.x).toBeGreaterThan(cam0 + 20);
    expect(following()).toBe(true);
    leave();
    const cam1 = S.cam.x;
    key("keydown", "KeyD", "d");
    stepInput(0.1);
    key("keyup", "KeyD", "d");
    expect(S.cam.x).toBeGreaterThan(cam1);
    expect(you()).toBeNull();
  });

  test("a drag lets go of you, a walk takes hold again, and Space brings the view back", async () => {
    await opened(everywhere());
    canvasPage();
    setTool(null);
    placeYou(mid(24, 21));
    stepInput(1 / 60);
    pan(-200, 0);
    expect(following()).toBe(false);
    const dragged = S.cam.x;
    stepInput(1 / 60);
    expect(S.cam.x).toBe(dragged);
    key("keydown", "KeyS", "s");
    stepInput(1 / 60);
    // Taking hold does not jump: the first step closes a little of the 50 pixels between.
    expect(following()).toBe(true);
    expect(Math.abs(S.cam.x - dragged)).toBeLessThan(5);
    key("keyup", "KeyS", "s");
    pan(-100, 0);
    key("keydown", "Space", " ");
    key("keyup", "Space", " ");
    for (let k = 0; k < 120; k++) stepInput(1 / 60);
    const c = you();
    const middle = S.cam.x + S.view.w / 2;
    expect(Math.abs(middle - (c?.x ?? 0))).toBeLessThan(1);
  });

  test("at the plan's steps the view opens on you, and does not go with you", async () => {
    await opened(everywhere());
    canvasPage();
    setTool(null);
    const view = S.view;
    S.view = { ...view, z: 0.5, w: view.w * 8, h: view.h * 8 };
    try {
      const c = placeYou(mid(24, 21));
      stepInput(1 / 60);
      expect(Math.abs(S.cam.x + S.view.w / 2 - c.x)).toBeLessThan(1);
      expect(following()).toBe(false);
      const cam = S.cam.x;
      key("keydown", "KeyD", "d");
      for (let k = 0; k < 30; k++) stepInput(1 / 60);
      key("keyup", "KeyD", "d");
      expect(c.x - mid(24, 21).x).toBeGreaterThan(20);
      expect(S.cam.x).toBe(cam);
    } finally {
      S.view = view;
    }
  });

  test("are named for walking in the Keys tab, and Space is the view back to you", () => {
    const walking = WORKS_KEYS.shelves().find((s) => s.name === "Walking");
    expect(walking?.lines.map((l) => [l.id, l.does])).toEqual([
      ["up", "Walk up"],
      ["left", "Walk left"],
      ["down", "Walk down"],
      ["right", "Walk right"],
      ["home", "Bring the view back to you"],
    ]);
    expect(WORKS_KEYS.name("home")).toBe("Space");
    expect(WORKS_KEYS.shared()).toEqual([]);
  });
});

describe("a tap with nothing in hand", () => {
  test("on the ground walks there; on a piece asks for its card and walks nowhere", async () => {
    const y = everywhere();
    await opened(y, 1000);
    const canvas = canvasPage();
    setTool(null);
    const c = placeYou(mid(24, 21));
    stepInput(1 / 60);
    click(canvas, 30 * 16 + 5, 21 * 16 + 9);
    expect(c.going).toBe(true);
    expect(c.bound).toEqual({ x: 30 * 16 + 5, y: 21 * 16 + 9 });
    c.steer(0, 0);
    expect("refused" in doNow({ do: "build", kind: MILL, x: 20, y: 21, dir: 0, grade: 1 })).toBe(false);
    c.put(mid(24, 21).x, mid(24, 21).y);
    // A piece: its card is asked for (no card is drawn here), and nobody walks.
    click(canvas, 20 * 16 + 8, 21 * 16 + 8);
    expect([c.going, c.bound]).toEqual([false, null]);
    // The ground again: the card is put away, and you go.
    click(canvas, 27 * 16 + 8, 21 * 16 + 8);
    expect([deck.open, c.going]).toEqual([null, true]);
  });
});
