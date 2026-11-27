/**
 * Being somebody in your own yard, on the page: the walking keys walk you and the view goes with you;
 * a drag lets go of you, and walking or a tap-walk takes hold again; a zoom while it goes with you
 * zooms about you; an empty-handed tap on the ground walks there and one on a piece opens its card;
 * the settings menu stops a walk; and you put pieces down and take them up within reach, the plot you
 * stand on and the eight round it, judged on the very command a press sends, so that what its
 * preview shows (gold or coral, and the line over the dock) is what the press then does.
 */
import { afterEach, describe, expect, test } from "bun:test";

import {
  BELT,
  build,
  CRATE,
  create,
  LAND,
  type Leg,
  MILL,
  type Piece,
  TUNNEL,
  type Yard,
  yardSolid,
} from "@sequoia-leaf/factory";
import { deck } from "@sequoia-leaf/kit/card.ts";
import { noKeysHeld } from "@sequoia-leaf/kit/keys.ts";

import { opened, useFakeLeaf } from "../../test/fake-leaf.ts";
import { aimOf } from "../hand.ts";
import { WORKS_KEYS } from "../keymap.ts";
import { S, toolHooks, toPage } from "../state.ts";
import { aimAt, confirm, hold, markEnd, markOver, markStart, setGrade, setTool, takeAway } from "../tools.ts";
import { setWayIn } from "../tunnel.ts";
import { handPrint } from "../ui/dock.ts";
import { doNow } from "../yard.ts";
import { beyondReach, OUT_OF_REACH, reachBox, reaches } from "./reach.ts";
import { leave, placeYou, walkTo, you } from "./you.ts";

// The camera's module draws onto canvases that are made as it loads (`scene.ts`): a document is there
// first whose canvases take any drawing and keep none of it.
const inert: () => unknown = new Proxy(() => inert, { get: () => inert, set: () => true });
Object.defineProperty(globalThis, "document", { value: { createElement: () => inert }, configurable: true });
const { following, pan, setCamera, setZoom, zoom } = await import("../camera.ts");
const { fingerTap, initInput, letGo, stepInput } = await import("../input.ts");

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
/** Builds a piece from anywhere (no figure of yours stands in the yard yet), facing east, which must be built; a tunnel passing under `span` tiles. */
function stands(y: Yard, kind: Piece["kind"], x: number, z: number, span?: number): void {
  if (!build(y, kind, x, z, 0, Infinity, span === undefined ? {} : { span }).ok)
    throw new Error(`nothing built at ${x}, ${z}`);
}
/** Does something with a finger, as on a phone: aiming first, and Build (`confirm`) or a second tap to build. */
function onPhone(act: () => void): void {
  S.finger = true;
  try {
    act();
  } finally {
    S.finger = false;
  }
}
/** A leg of a run of belt on row 9, heading east, at grade 2. */
const beltAt = (x: number): Leg => ({ tunnel: false, x, y: 9, dir: 0, grade: 2 });
/** Where you stand in Windfall Hollow, the north-west corner: tiles 0 to 31 across and 0 to 23 down are in reach. */
const HOLLOW = mid(8, 6);
/** Whether what is in hand is shown as it would go: its aim (or run) says nothing against it, and nor does any piece of it. */
function gold(): boolean {
  const a = S.run ?? aimOf(S.hand);
  return a !== null && a.why === null && (S.group?.why.every((r) => r === null) ?? true);
}
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

/** With Select, the piece on row 9 at `x` marked, taken in hand to move, and set down at `to`: whether it was shown gold, which is whether it went. */
function moved(x: number, to: number): boolean {
  setTool("select");
  markStart(x, 9);
  markOver(x, 9);
  markEnd();
  hold("move");
  aimAt(to, 9);
  const shown = gold();
  expect(confirm()).toBe(shown);
  return shown;
}

/** The blueprint in place 0 taken in hand and set down aimed at `x` on row 20: whether it was shown gold, which is whether it went. */
function setPrint(x: number): boolean {
  setTool("select");
  hold(0);
  aimAt(x, 20);
  const shown = gold();
  expect(confirm()).toBe(shown);
  return shown;
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

  test("a build, a run, a removal and a set-down out of reach are refused, a build over one of its kind too; turning and painting are not limited", async () => {
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
    // A piece standing far away (built from the middle) is neither raised by a build nor taken away.
    leave();
    placeYou(mid(24, 21));
    expect("refused" in doNow({ do: "build", kind: MILL, x: far.x, y: far.y, dir: 0, grade: 1 })).toBe(false);
    leave();
    placeYou(mid(8, 6));
    expect(beyondReach({ do: "build", kind: MILL, x: far.x, y: far.y, dir: 0, grade: 2 })).toEqual(refused);
    expect(doNow({ do: "remove", x: far.x, y: far.y })).toEqual(refused);
    expect(doNow({ do: "clear", tiles: [far.y * y.land.w + far.x] })).toEqual(refused);
    // In reach, the rules decide.
    expect("refused" in doNow({ do: "build", kind: BELT, x: 10, y: 6, dir: 0, grade: 1 })).toBe(false);
  });

  test("an aim out of reach says so, and its ghost shows it; the brush aims anywhere", async () => {
    await opened(everywhere(), 100_000);
    placeYou(HOLLOW);
    setTool(MILL);
    aimAt(44, 33);
    expect(aimOf(S.hand)?.why).toBe(OUT_OF_REACH);
    aimAt(10, 8);
    expect(aimOf(S.hand)?.why).toBeNull();
    // Reach is said first: past it, what the rules would say there does not matter yet.
    aimAt(40, 30);
    expect(aimOf(S.hand)?.why).toBe(OUT_OF_REACH);
    setTool("paint");
    aimAt(44, 33);
    expect(aimOf(S.hand)?.why).not.toBe(OUT_OF_REACH);
    // Without a figure (a visit, a review page's own yard) nothing is out of reach.
    leave();
    setTool(MILL);
    aimAt(44, 33);
    expect(aimOf(S.hand)?.why).not.toBe(OUT_OF_REACH);
  });

  test("a tunnel whose far mouth is out of reach is refused, built and taken away, and its preview says so", async () => {
    const y = everywhere();
    // A tunnel from 30 to 33 on row 10, its far mouth out of reach of the Hollow.
    stands(y, TUNNEL, 30, 10, 2);
    await opened(y, 100_000);
    placeYou(HOLLOW);
    const far = { refused: "out_of_reach", why: OUT_OF_REACH };
    expect(beyondReach({ do: "build", kind: TUNNEL, x: 30, y: 12, dir: 0, grade: 1 })).toEqual(far);
    expect(doNow({ do: "lay", legs: [{ tunnel: true, x: 30, y: 12, dir: 0, span: 2, grade: 1 }] })).toEqual(far);
    // With the tunnel in hand: in at 30, 12, up at 33, 12 is coral and refused; up at 31, 12 is gold and built.
    setTool(TUNNEL);
    expect(setWayIn(30, 12)).toBe(true);
    aimAt(33, 12);
    expect([gold(), aimOf(S.hand)?.why]).toEqual([false, OUT_OF_REACH]);
    expect(confirm()).toBe(false);
    // A way in out of reach is not set: nothing it could become is in reach.
    setTool(TUNNEL);
    expect(setWayIn(33, 14)).toBe(false);
    expect(setWayIn(28, 14)).toBe(true);
    aimAt(31, 14);
    expect(gold()).toBe(true);
    expect(confirm()).toBe(true);
    // Taking the far one away is out of reach by its far mouth, with the spade as with a card's Remove.
    setTool("remove");
    aimAt(30, 10);
    expect([gold(), aimOf(S.hand)?.why]).toEqual([false, OUT_OF_REACH]);
    expect(doNow({ do: "remove", x: 30, y: 10 })).toEqual(far);
    aimAt(28, 14);
    expect(gold()).toBe(true);
    expect(doNow({ do: "remove", x: 28, y: 14 })).not.toEqual(far);
  });

  test("a move: gold where it leaves and lands in reach, coral and refused where it leaves from out of reach", async () => {
    const y = everywhere();
    stands(y, MILL, 33, 9);
    stands(y, MILL, 28, 9);
    await opened(y, 100_000);
    placeYou(HOLLOW);
    expect(moved(33, 26)).toBe(false);
    expect(S.world.kind[9 * y.land.w + 33]).toBe(MILL);
    expect(moved(28, 26)).toBe(true);
    expect(S.world.kind[9 * y.land.w + 26]).toBe(MILL);
  });

  test("a blueprint holding a tunnel: gold only with both its mouths in reach, and the press does as shown", async () => {
    const y = everywhere();
    stands(y, TUNNEL, 10, 18);
    await opened(y, 100_000);
    placeYou(HOLLOW);
    expect(doNow({ do: "saveBlueprint", slot: 0, tiles: [18 * y.land.w + 10, 18 * y.land.w + 12] })).not.toHaveProperty(
      "refused",
    );
    // Its box is three tiles wide, aimed at its middle: at 31 its far mouth would be at 32.
    expect(setPrint(31)).toBe(false);
    expect(S.world.kind[20 * y.land.w + 30]).not.toBe(TUNNEL);
    expect(setPrint(30)).toBe(true);
    expect(S.world.kind[20 * y.land.w + 29]).toBe(TUNNEL);
  });

  test("a piece built over one of its kind counts, out of reach too; the turn and grade commands do not", async () => {
    const y = everywhere();
    stands(y, BELT, 40, 9);
    await opened(y, 100_000);
    placeYou(HOLLOW);
    // With the belt in hand, turning or raising the far belt is a build on its tile: coral, and refused.
    setTool(BELT);
    S.dir = 1;
    aimAt(40, 9);
    expect([gold(), aimOf(S.hand)?.why]).toEqual([false, OUT_OF_REACH]);
    expect(confirm()).toBe(false);
    setGrade(2);
    aimAt(40, 9);
    expect([gold(), aimOf(S.hand)?.raises]).toEqual([false, 1]);
    expect(confirm()).toBe(false);
    expect([S.world.dir[9 * y.land.w + 40], S.world.grade[9 * y.land.w + 40]]).toEqual([0, 1]);
    // Turning it (R, or its card) and the grade command put nothing down and take nothing up.
    expect(beyondReach({ do: "upgrade", tiles: [9 * y.land.w + 40] })).toBeNull();
    expect(doNow({ do: "turn", x: 40, y: 9, dir: 1 })).not.toHaveProperty("refused");
    expect(S.world.dir[9 * y.land.w + 40]).toBe(1);
  });

  test("moving a tunnel's way in onto its far mouth, which would bring the far mouth out of reach, is coral and refused", async () => {
    // The reviewer's case: an eastbound tunnel from 28 to 31; moved one tile on, it would come up at 34.
    const y = everywhere();
    stands(y, TUNNEL, 28, 11, 2);
    await opened(y, 100_000);
    placeYou(HOLLOW);
    setTool("select");
    markStart(28, 11);
    markOver(31, 11);
    markEnd();
    hold("move");
    // Its box is four tiles wide, aimed at its second: aimed at 32, its way in lands on 31.
    aimAt(32, 11);
    expect(S.group?.at[0]).toMatchObject({ x: 31, y: 11 });
    expect(gold()).toBe(false);
    expect(confirm()).toBe(false);
    expect(S.world.kind[11 * y.land.w + 28]).toBe(TUNNEL);
  });

  test("a run of belt over standing belts counts every tile of it: re-laying far belts is refused", async () => {
    const y = everywhere();
    for (let x = 30; x <= 35; x++) stands(y, BELT, x, 9);
    await opened(y, 100_000);
    placeYou(HOLLOW);
    const legs = [30, 31, 32, 33].map(beltAt);
    expect(doNow({ do: "lay", legs })).toEqual({ refused: "out_of_reach", why: OUT_OF_REACH });
    expect(doNow({ do: "lay", legs: legs.slice(0, 2) })).not.toHaveProperty("refused");
  });

  test("the tunnel's first click, which only sets where it goes in, is judged on that tile alone", async () => {
    await opened(everywhere(), 100_000);
    placeYou(HOLLOW);
    setTool(TUNNEL);
    S.dir = 0;
    // East from 30, 12 it would come up at 32, out of reach; the click sets the way in, in reach.
    aimAt(30, 12);
    expect([gold(), aimOf(S.hand)?.far]).toEqual([true, 12 * S.world.land.w + 32]);
    aimAt(32, 12);
    expect(aimOf(S.hand)?.why).toBe(OUT_OF_REACH);
    expect(setWayIn(30, 12)).toBe(true);
  });

  test("raising a standing tunnel shows the mouths that stand, and is judged on them", async () => {
    const y = everywhere();
    stands(y, TUNNEL, 30, 10, 2);
    stands(y, TUNNEL, 27, 13, 2);
    await opened(y, 100_000);
    placeYou(HOLLOW);
    setTool(TUNNEL);
    setGrade(2);
    S.dir = 0;
    // From 30 to 33: its far mouth is out of reach.
    aimAt(30, 10);
    expect([aimOf(S.hand)?.far, aimOf(S.hand)?.why, aimOf(S.hand)?.raises]).toEqual([
      10 * y.land.w + 33,
      OUT_OF_REACH,
      1,
    ]);
    expect(confirm()).toBe(false);
    // From 27 to 30, wholly in reach: gold, and raised.
    aimAt(27, 13);
    expect([aimOf(S.hand)?.far, gold()]).toEqual([13 * y.land.w + 30, true]);
    expect(confirm()).toBe(true);
    expect(S.world.grade[13 * y.land.w + 27]).toBe(2);
  });

  test("a phone's run start on a machine is its first belt, at the machine's outlet: gold, and Build lays it", async () => {
    // A mill at 10, 9 facing east: it hands things on to 11, 9.
    const y = everywhere();
    stands(y, MILL, 10, 9);
    stands(y, MILL, 10, 16);
    await opened(y, 100_000);
    placeYou(HOLLOW);
    const t = (x: number, z: number): number => z * y.land.w + x;
    onPhone(() => {
      S.dir = 3;
      setTool(BELT);
      fingerTap(10, 9);
      // The start is the mill; the belt shown and laid is at its outlet, facing out of it.
      expect([S.from, aimOf(S.hand)?.x, aimOf(S.hand)?.y, S.dir, gold()]).toEqual([{ x: 10, y: 9 }, 11, 9, 0, true]);
      expect(handPrint().go).toEqual({ label: "Build", bad: false });
      expect(confirm()).toBe(true);
      expect([S.world.kind[t(11, 9)], S.world.dir[t(11, 9)], S.world.kind[t(10, 9)]]).toEqual([BELT, 0, MILL]);
      // A second tap on a machine lays the same belt as Build: at its outlet, never on the machine.
      setTool(BELT);
      fingerTap(10, 16);
      fingerTap(10, 16);
      expect([S.world.kind[t(11, 16)], S.world.dir[t(11, 16)], S.world.kind[t(10, 16)]]).toEqual([BELT, 0, MILL]);
    });
  });

  test("a machine's outlet that cannot take a belt, or is out of reach, is coral with the reason", async () => {
    const y = everywhere();
    stands(y, MILL, 10, 12);
    stands(y, CRATE, 11, 12);
    stands(y, MILL, 40, 9);
    await opened(y, 100_000);
    placeYou(HOLLOW);
    onPhone(() => {
      setTool(BELT);
      fingerTap(10, 12);
      const why = aimOf(S.hand)?.why;
      expect([aimOf(S.hand)?.x, why === null, why === OUT_OF_REACH]).toEqual([11, false, false]);
      expect(handPrint().go?.bad).toBe(true);
      expect(confirm()).toBe(false);
      // A far mill: its outlet, 41, 9, is out of reach.
      setTool(BELT);
      fingerTap(40, 9);
      expect([aimOf(S.hand)?.x, aimOf(S.hand)?.why]).toEqual([41, OUT_OF_REACH]);
      expect(handPrint().go).toEqual({ label: "Build", bad: true });
      expect(confirm()).toBe(false);
      expect(S.world.kind[9 * y.land.w + 41]).not.toBe(BELT);
    });
  });

  test("a phone's run start on a crate, which no run leaves from by itself, is judged on the crate's own tile", async () => {
    const y = everywhere();
    stands(y, CRATE, 14, 9);
    await opened(y, 100_000);
    placeYou(HOLLOW);
    onPhone(() => {
      setTool(BELT);
      fingerTap(14, 9);
      expect([aimOf(S.hand)?.x, aimOf(S.hand)?.y, gold()]).toEqual([14, 9, false]);
      expect(handPrint().go?.bad).toBe(true);
      expect(confirm()).toBe(false);
    });
  });

  test("a card's Remove on a distant piece, with nothing in hand, says why", async () => {
    const y = everywhere();
    stands(y, MILL, 40, 9);
    await opened(y, 100_000);
    placeYou(HOLLOW);
    setTool(null);
    const said: string[] = [];
    const was = toolHooks.said;
    toolHooks.said = (text) => said.push(text);
    try {
      expect(takeAway(40, 9)).toBe(false);
      expect(said).toEqual(["Out of reach."]);
    } finally {
      toolHooks.said = was;
    }
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

/** A row of mills down x = 26 from `top` to the map's foot, every plot owned; from 25, 35 a tap at 27, 35 walks round it. */
async function roundTheWall(top: number): Promise<void> {
  const y = everywhere();
  for (let z = top; z <= 35; z++) build(y, MILL, 26, z, 0, Infinity);
  await opened(y);
  canvasPage();
  // Mills, and a redwood where none could be built: solid all the way down.
  for (let z = top; z <= 35; z++) expect(yardSolid(S.world).at(mid(26, z).x, mid(26, z).y)).not.toBeNull();
  const c = placeYou(mid(25, 35));
  expect(walkTo(27 * 16 + 5, 35 * 16 + 9)).toBe(true);
  for (let k = 0; k < 60 * 40 && c.going; k++) stepInput(1 / 60);
  expect(c.tile).toEqual({ x: 27, y: 35 });
}

describe("a walk asked for by a tap", () => {
  test("takes hold of the view again after a drag let go of it: a phone has no Space", async () => {
    await opened(everywhere());
    const canvas = canvasPage();
    setTool(null);
    placeYou(mid(24, 21));
    stepInput(1 / 60);
    pan(-120, -60);
    expect(following()).toBe(false);
    click(canvas, 30 * 16 + 5, 21 * 16 + 9);
    expect([you()?.going, following()]).toEqual([true, true]);
  });

  test("stops when the settings menu comes up over the yard, as held keys do", async () => {
    await opened(everywhere());
    canvasPage();
    const c = placeYou(mid(24, 21));
    expect(walkTo(mid(40, 21).x, mid(40, 21).y)).toBe(true);
    for (let k = 0; k < 10; k++) stepInput(1 / 60);
    letGo();
    for (let k = 0; k < 30; k++) stepInput(1 / 60);
    const x = c.x;
    for (let k = 0; k < 30; k++) stepInput(1 / 60);
    expect([c.going, c.moving, c.x]).toEqual([false, false, x]);
  });

  test("finds its way round a wall from y = 4 to the map's foot: the reviewer's yard", async () => {
    await roundTheWall(4);
  });

  test("and from y = 1, where 3,000 squares of search found nothing nearer than where you stand", async () => {
    await roundTheWall(1);
  });

  test("with no way there at all, goes as near as anyone can get", async () => {
    // A place shut in by mills on every side: walked to, you end beside them.
    const y = everywhere();
    for (let x = 9; x <= 13; x++) for (const z of [26, 30]) build(y, MILL, x, z, 0, Infinity);
    for (let z = 27; z <= 29; z++) for (const x of [9, 13]) build(y, MILL, x, z, 0, Infinity);
    await opened(y);
    canvasPage();
    const c = placeYou(mid(3, 28));
    const to = mid(11, 28);
    expect(walkTo(to.x, to.y)).toBe(true);
    for (let k = 0; k < 60 * 20 && c.going; k++) stepInput(1 / 60);
    // Three tiles from it, outside the ring, on whichever side is nearest: never standing where it began.
    expect(c.going).toBe(false);
    expect(Math.hypot(c.tile.x - 11, c.tile.y - 28)).toBe(3);
  });
});

describe("a zoom while the view goes with you", () => {
  test("zooms about you in one step: you stay where you are on the screen, then and at the next frame", async () => {
    await opened(everywhere());
    canvasPage();
    setCamera(
      { width: 320, height: 200, style: { transform: "" } },
      { x: -56, y: -88, w: 48 * 16 + 112, h: 36 * 16 + 144 },
    );
    setZoom(0);
    // The view fitted to this screen first, at the size that suits it.
    zoom(0, 0, 0);
    const c = placeYou(mid(24, 21));
    for (let k = 0; k < 5; k++) stepInput(1 / 60);
    expect(following()).toBe(true);
    const z = S.view.z;
    const before = toPage(c.x, c.y);
    // The pointer is far from you: it is not what the zoom keeps.
    expect(zoom(1, 10, 10)).toBe(true);
    expect(S.view.z).toBeGreaterThan(z);
    const after = toPage(c.x, c.y);
    expect([Math.abs(after.x - before.x) <= 1, Math.abs(after.y - before.y) <= 1]).toEqual([true, true]);
    const cam = { ...S.cam };
    stepInput(1 / 60);
    expect([Math.abs(S.cam.x - cam.x) < 1, Math.abs(S.cam.y - cam.y) < 1, following()]).toEqual([true, true, true]);
    // Let go of, it zooms about the pointer as ever.
    pan(-40, 0);
    const under = { x: S.cam.x + 10 * (S.view.dpr / S.view.z), y: S.cam.y + 10 * (S.view.dpr / S.view.z) };
    expect(zoom(-1, 10, 10)).toBe(true);
    expect(Math.abs(S.cam.x + 10 * (S.view.dpr / S.view.z) - under.x)).toBeLessThan(1);
    setZoom(0);
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
