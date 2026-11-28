/**
 * Being somebody in your own yard, on the page: the walking keys walk you and the view goes with you;
 * a drag lets go of you, and walking or a tap-walk takes hold again; a zoom while it goes with you
 * zooms about you; an empty-handed tap on the ground walks there and one on a piece opens its card;
 * the settings menu stops a walk; and you build by hand only within reach, the plot you stand on and
 * the eight round it, judged on the very command a press sends, so that what its preview shows (gold
 * or coral, and the line over the dock) is what the press then does. The select tool and blueprints
 * work anywhere on the land.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  BELT,
  build,
  CRATE,
  create,
  goal,
  LAND,
  type Leg,
  MILL,
  NONE,
  type Piece,
  PLOT_H,
  PLOT_W,
  reopen,
  TUNNEL,
  type Yard,
  yardSolid,
} from "@sequoia-leaf/factory";
import { deck } from "@sequoia-leaf/kit/card.ts";
import { noKeysHeld } from "@sequoia-leaf/kit/keys.ts";

import { opened, useFakeLeaf } from "../../test/fake-leaf.ts";
import { aimOf } from "../hand.ts";
import { WORKS_KEYS } from "../keymap.ts";
import { codeIn, pasteIn, saveIn } from "../plans.ts";
import { S, toolHooks, toPage } from "../state.ts";
import {
  aimAt,
  clearMark,
  confirm,
  hold,
  markEnd,
  markOver,
  markStart,
  setGrade,
  setTool,
  takeAway,
} from "../tools.ts";
import { setWayIn } from "../tunnel.ts";
import { handPrint } from "../ui/dock.ts";
import { doNow } from "../yard.ts";
import { beyondReach, OUT_OF_REACH, reachBox, reaches, reachRule } from "./reach.ts";
import { leave, placeYou, walkTo, you } from "./you.ts";

// The camera's module draws onto canvases that are made as it loads (`scene.ts`): a document is there
// first whose canvases take any drawing and keep none of it.
const inert: () => unknown = new Proxy(() => inert, { get: () => inert, set: () => true });
Object.defineProperty(globalThis, "document", { value: { createElement: () => inert }, configurable: true });
const { following, holdView, inset, pan, setCamera, setZoom, zoom } = await import("../camera.ts");
const { fingerTap, initInput, letGo, stepInput } = await import("../input.ts");

useFakeLeaf();
// Reach is off for now (`reach.ts`); these test the rule, so they switch it on.
beforeEach(() => (reachRule.on = true));
afterEach(() => {
  reachRule.on = false;
  toolHooks.said = () => {};
  leave();
  noKeysHeld();
  Reflect.deleteProperty(globalThis, "HTMLElement");
});

/**
 * Every tile below is counted from the north-west corner of the first ring of plots round the yard
 * (Windfall Hollow's), three plots by three, 48 tiles by 36: the guild's whole land when these were
 * written, and all of it a yard of tier 4 may own.
 */
const [OX, OY] = [LAND.origin[0] - PLOT_W, LAND.origin[1] - PLOT_H];
/** A tile of the first ring, by its column and row there, as a place on the land. */
const T = (x: number, z: number): { x: number; y: number } => ({ x: OX + x, y: OY + z });
/** A tile's number on the land, by its column and row in the first ring. */
const at = (x: number, z: number): number => (OY + z) * LAND.w + OX + x;
/** A yard at tier 4 that owns every plot of the first ring, the nine round the depot, without Long reach. */
function everywhere(): Yard {
  const y = create({ seed: 6, tier: 4 });
  y.plots = LAND.plots.filter((p) => p.ring <= 1).map((p) => p.plot);
  y.done = y.done.filter((g) => g !== goal("longreach"));
  reopen(y);
  return y;
}
/** The middle of a tile, in pixels of the art. */
const mid = (x: number, y: number): { x: number; y: number } => ({ x: (OX + x) * 16 + 8, y: (OY + y) * 16 + 8 });
/** A point in pixels of the art, from the first ring's corner. */
const px = (x: number, y: number): { x: number; y: number } => ({ x: OX * 16 + x, y: OY * 16 + y });
/** Builds a piece from anywhere (no figure of yours stands in the yard yet), facing east, which must be built; a tunnel passing under `span` tiles. */
function stands(y: Yard, kind: Piece["kind"], x: number, z: number, span?: number): void {
  if (!build(y, kind, OX + x, OY + z, 0, Infinity, span === undefined ? {} : { span }).ok)
    throw new Error(`nothing built at ${x}, ${z}`);
}
/** The tools, the reach and the page, given tiles of the first ring. */
const aim = (x: number, z: number): void => aimAt(OX + x, OY + z);
const wayIn = (x: number, z: number): boolean => setWayIn(OX + x, OY + z);
const inReach = (x: number, z: number): boolean => reaches(OX + x, OY + z);
const startAt = (x: number, z: number): void => markStart(OX + x, OY + z);
const overAt = (x: number, z: number): void => markOver(OX + x, OY + z);
const tap = (x: number, z: number): void => fingerTap(OX + x, OY + z);
const removeAt = (x: number, z: number): boolean => takeAway(OX + x, OY + z);
/** What is in reach, as a box of tiles of the first ring. */
function box(): { x0: number; y0: number; x1: number; y1: number } | null {
  const b = reachBox();
  return b && { x0: b.x0 - OX, y0: b.y0 - OY, x1: b.x1 - OX, y1: b.y1 - OY };
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
const beltAt = (x: number): Leg => ({ tunnel: false, ...T(x, 9), dir: 0, grade: 2 });
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

/** Everything the page says from now on (a refusal, on the line over the dock), until the test ends. */
function sayings(): string[] {
  const said: string[] = [];
  toolHooks.said = (text) => void said.push(text);
  return said;
}

/** The blueprint in place 0 taken in hand and set down aimed at `x` on row 20: whether it was shown gold, which is whether it went. */
function setPrint(x: number): boolean {
  setTool("select");
  hold(0);
  aim(x, 20);
  const shown = gold();
  expect(confirm()).toBe(shown);
  return shown;
}

describe("reach", () => {
  test("from the yard's middle plot, all nine plots of the guild's land are in reach", async () => {
    await opened(everywhere());
    placeYou(mid(24, 21));
    expect(box()).toEqual({ x0: 0, y0: 0, x1: 47, y1: 35 });
    expect([inReach(0, 0), inReach(47, 35), inReach(47, 0), inReach(0, 35)]).toEqual([true, true, true, true]);
  });

  test("from a corner plot, the plot stood on and the eight round it: the far side of the map is out of reach", async () => {
    await opened(everywhere());
    // Windfall Hollow, the north-west corner.
    placeYou(mid(8, 6));
    expect(box()).toEqual({ x0: -16, y0: -12, x1: 31, y1: 23 });
    expect([inReach(31, 23), inReach(32, 23), inReach(31, 24), inReach(44, 33)]).toEqual([true, false, false, false]);
  });

  test("at a plot's edge it is the plot stood on that counts: a step across moves reach a plot over", async () => {
    await opened(everywhere());
    // The last pixel of the Hollow's last column, then the first of the Grove's.
    placeYou(px(16 * 16 - 1, 6 * 16 + 8));
    expect(inReach(31, 6)).toBe(true);
    expect(inReach(32, 6)).toBe(false);
    leave();
    placeYou(px(16 * 16, 6 * 16 + 8));
    expect(inReach(47, 6)).toBe(true);
    expect(inReach(0, 30)).toBe(false);
  });

  test("a build, a run and a removal out of reach are refused, a build over one of its kind too; turning and painting are not limited", async () => {
    const y = everywhere();
    await opened(y, 100_000);
    placeYou(mid(8, 6));
    const far = T(44, 33);
    const refused = { refused: "out_of_reach", why: OUT_OF_REACH };
    expect(doNow({ do: "build", kind: BELT, x: far.x, y: far.y, dir: 0, grade: 1 })).toEqual(refused);
    expect(
      doNow({
        do: "lay",
        legs: [
          { tunnel: false, ...T(30, 20), dir: 0, grade: 1 },
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
    // In reach, the rules decide.
    expect("refused" in doNow({ do: "build", kind: BELT, ...T(10, 6), dir: 0, grade: 1 })).toBe(false);
  });

  test("an aim out of reach says so, and its ghost shows it; the brush aims anywhere", async () => {
    await opened(everywhere(), 100_000);
    placeYou(HOLLOW);
    setTool(MILL);
    aim(44, 33);
    expect(aimOf(S.hand)?.why).toBe(OUT_OF_REACH);
    aim(10, 8);
    expect(aimOf(S.hand)?.why).toBeNull();
    // Reach is said first: past it, what the rules would say there does not matter yet.
    aim(40, 30);
    expect(aimOf(S.hand)?.why).toBe(OUT_OF_REACH);
    setTool("paint");
    aim(44, 33);
    expect(aimOf(S.hand)?.why).not.toBe(OUT_OF_REACH);
    // Without a figure (a visit, a review page's own yard) nothing is out of reach.
    leave();
    setTool(MILL);
    aim(44, 33);
    expect(aimOf(S.hand)?.why).not.toBe(OUT_OF_REACH);
  });

  test("a tunnel whose far mouth is out of reach is refused, built and taken away, and its preview says so", async () => {
    const y = everywhere();
    // A tunnel from 30 to 33 on row 10, its far mouth out of reach of the Hollow.
    stands(y, TUNNEL, 30, 10, 2);
    await opened(y, 100_000);
    placeYou(HOLLOW);
    const far = { refused: "out_of_reach", why: OUT_OF_REACH };
    expect(beyondReach({ do: "build", kind: TUNNEL, ...T(30, 12), dir: 0, grade: 1 })).toEqual(far);
    expect(doNow({ do: "lay", legs: [{ tunnel: true, ...T(30, 12), dir: 0, span: 2, grade: 1 }] })).toEqual(far);
    // With the tunnel in hand: in at 30, 12, up at 33, 12 is coral and refused; up at 31, 12 is gold and built.
    setTool(TUNNEL);
    expect(wayIn(30, 12)).toBe(true);
    aim(33, 12);
    expect([gold(), aimOf(S.hand)?.why]).toEqual([false, OUT_OF_REACH]);
    expect(confirm()).toBe(false);
    // A way in out of reach is not set: nothing it could become is in reach.
    setTool(TUNNEL);
    expect(wayIn(33, 14)).toBe(false);
    expect(wayIn(28, 14)).toBe(true);
    aim(31, 14);
    expect(gold()).toBe(true);
    expect(confirm()).toBe(true);
    // Taking the far one away is out of reach by its far mouth, with the spade as with a card's Remove.
    setTool("remove");
    aim(30, 10);
    expect([gold(), aimOf(S.hand)?.why]).toEqual([false, OUT_OF_REACH]);
    expect(doNow({ do: "remove", ...T(30, 10) })).toEqual(far);
    aim(28, 14);
    expect(gold()).toBe(true);
    expect(doNow({ do: "remove", ...T(28, 14) })).not.toEqual(far);
  });

  test("the select tool works anywhere on the land: a far area is moved, copied, cleared and saved", async () => {
    const y = everywhere();
    stands(y, MILL, 43, 22);
    stands(y, MILL, 46, 22);
    await opened(y, 100_000);
    placeYou(HOLLOW);
    expect([inReach(43, 22), inReach(47, 31)]).toEqual([false, false]);
    // Marked out of reach, Move, Copy, Remove and Save are offered, and none of them is refused.
    const said = sayings();
    setTool("select");
    startAt(43, 22);
    overAt(47, 23);
    markEnd();
    expect(handPrint().acting).toBe(true);
    // Moved within the far corner: gold, and it goes.
    hold("move");
    aim(44, 30);
    expect([gold(), aimOf(S.hand)?.why]).toEqual([true, null]);
    expect(confirm()).toBe(true);
    expect([S.world.kind[at(43, 22)], S.world.kind[at(43, 30)], S.world.kind[at(46, 30)]]).toEqual([NONE, MILL, MILL]);
    // The moved pieces stay marked: saved where they stand, then copied, then cleared.
    expect(saveIn(0)).toBe(true);
    expect(S.world.blueprints[0]).toBeTruthy();
    setTool("select");
    startAt(43, 30);
    overAt(47, 31);
    markEnd();
    hold("copy");
    aim(44, 26);
    expect(gold()).toBe(true);
    expect(confirm()).toBe(true);
    expect([S.world.kind[at(43, 26)], S.world.kind[at(46, 26)]]).toEqual([MILL, MILL]);
    setTool("select");
    startAt(43, 22);
    overAt(47, 31);
    markEnd();
    expect(clearMark()).toBe(true);
    const left = [at(43, 26), at(46, 26), at(43, 30), at(46, 30)].map((i) => S.world.kind[i]);
    expect(left).toEqual([NONE, NONE, NONE, NONE]);
    expect(said).toEqual([]);
  });

  test("a blueprint goes down anywhere on the land, a pasted code's too", async () => {
    const y = everywhere();
    stands(y, TUNNEL, 10, 18);
    await opened(y, 100_000);
    placeYou(HOLLOW);
    const said = sayings();
    expect(doNow({ do: "saveBlueprint", slot: 0, tiles: [at(10, 18), at(12, 18)] })).not.toHaveProperty("refused");
    // Its box is three tiles wide, aimed at its middle: at 45 on row 20 it stands from 44 to 46, all out of reach.
    expect(inReach(44, 20)).toBe(false);
    expect(setPrint(45)).toBe(true);
    expect([S.world.kind[at(44, 20)], S.world.kind[at(46, 20)]]).toEqual([TUNNEL, TUNNEL]);
    // The same blueprint by its code, kept in another place and set down further off.
    const code = codeIn(0);
    expect(code === null ? "no code" : pasteIn(1, code)).toBeNull();
    setTool("select");
    hold(1);
    aim(45, 34);
    expect(gold()).toBe(true);
    expect(confirm()).toBe(true);
    expect(S.world.kind[at(44, 34)]).toBe(TUNNEL);
    expect(said).toEqual([]);
  });

  test("building one piece by hand out there is still refused: coral, said why, and nothing stands", async () => {
    await opened(everywhere(), 100_000);
    placeYou(HOLLOW);
    setTool(MILL);
    aim(45, 33);
    // The aim's reason is what the line over the dock says.
    expect([gold(), aimOf(S.hand)?.why]).toEqual([false, OUT_OF_REACH]);
    expect(confirm()).toBe(false);
    expect(S.world.kind[at(45, 33)]).toBe(NONE);
    expect(doNow({ do: "stand", pieces: [{ kind: MILL, ...T(45, 33), dir: 0, span: 0 }] })).toEqual({
      refused: "out_of_reach",
      why: OUT_OF_REACH,
    });
  });

  test("a piece built over one of its kind counts, out of reach too; the turn and grade commands do not", async () => {
    const y = everywhere();
    stands(y, BELT, 40, 9);
    await opened(y, 100_000);
    placeYou(HOLLOW);
    // With the belt in hand, turning or raising the far belt is a build on its tile: coral, and refused.
    setTool(BELT);
    S.dir = 1;
    aim(40, 9);
    expect([gold(), aimOf(S.hand)?.why]).toEqual([false, OUT_OF_REACH]);
    expect(confirm()).toBe(false);
    setGrade(2);
    aim(40, 9);
    expect([gold(), aimOf(S.hand)?.raises]).toEqual([false, 1]);
    expect(confirm()).toBe(false);
    expect([S.world.dir[at(40, 9)], S.world.grade[at(40, 9)]]).toEqual([0, 1]);
    // Turning it (R, or its card) and the grade command put nothing down and take nothing up.
    expect(beyondReach({ do: "upgrade", tiles: [at(40, 9)] })).toBeNull();
    expect(doNow({ do: "turn", ...T(40, 9), dir: 1 })).not.toHaveProperty("refused");
    expect(S.world.dir[at(40, 9)]).toBe(1);
  });

  test("a tunnel raised from its far mouth counts its two mouths, both in reach: gold, and raised", async () => {
    // The reviewer's case: an eastbound tunnel from 28 to 31, reach from the Hollow ending at 31; raised
    // to grade 2 by a press on its far mouth, which is no tunnel going on past it to 34.
    const y = everywhere();
    stands(y, TUNNEL, 28, 11, 2);
    await opened(y, 100_000);
    placeYou(HOLLOW);
    expect(box()?.x1).toBe(31);
    expect(beyondReach({ do: "build", kind: TUNNEL, ...T(31, 11), dir: 0, grade: 2 })).toBeNull();
    setTool(TUNNEL);
    setGrade(2);
    aim(31, 11);
    expect([gold(), aimOf(S.hand)?.why ?? null]).toEqual([true, null]);
    expect(confirm()).toBe(true);
    expect([S.world.grade[at(28, 11)], S.world.grade[at(31, 11)]]).toEqual([2, 2]);
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
    aim(30, 12);
    expect([gold(), aimOf(S.hand)?.far]).toEqual([true, at(32, 12)]);
    aim(32, 12);
    expect(aimOf(S.hand)?.why).toBe(OUT_OF_REACH);
    expect(wayIn(30, 12)).toBe(true);
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
    aim(30, 10);
    expect([aimOf(S.hand)?.far, aimOf(S.hand)?.why, aimOf(S.hand)?.raises]).toEqual([at(33, 10), OUT_OF_REACH, 1]);
    expect(confirm()).toBe(false);
    // From 27 to 30, wholly in reach: gold, and raised.
    aim(27, 13);
    expect([aimOf(S.hand)?.far, gold()]).toEqual([at(30, 13), true]);
    expect(confirm()).toBe(true);
    expect(S.world.grade[at(27, 13)]).toBe(2);
  });

  test("a phone's run start on a machine stands as it is, as before #270: Build there is what the rules say of a belt on it", async () => {
    // A mill at 10, 9 facing east: it hands things on to 11, 9.
    const y = everywhere();
    stands(y, MILL, 10, 9);
    await opened(y, 100_000);
    placeYou(HOLLOW);
    onPhone(() => {
      S.dir = 3;
      setTool(BELT);
      tap(10, 9);
      // The start is the mill, aimed on its own tile, and the hand keeps its facing.
      expect([S.from, aimOf(S.hand)?.x, aimOf(S.hand)?.y, aimOf(S.hand)?.why, S.dir]).toEqual([
        T(10, 9),
        OX + 10,
        OY + 9,
        null,
        3,
      ]);
      expect(handPrint().go).toEqual({ label: "Build", bad: false });
      // Build, or the same tile again, is a belt on the mill: the rules refuse it, and nothing is laid.
      expect(confirm()).toBe(false);
      expect([aimOf(S.hand)?.why, S.world.kind[at(11, 9)], S.world.kind[at(10, 9)]]).toEqual([
        "Something is here already",
        255,
        MILL,
      ]);
      setTool(BELT);
      tap(10, 9);
      tap(10, 9);
      expect([S.world.kind[at(11, 9)], S.world.kind[at(10, 9)]]).toEqual([255, MILL]);
      // A run tapped out from it starts where it hands things on.
      setTool(BELT);
      tap(10, 9);
      tap(14, 9);
      expect(S.run?.legs[0]).toMatchObject(T(11, 9));
    });
  });

  test("a phone's run start on a crate stands as it is, gold, as before #270", async () => {
    const y = everywhere();
    stands(y, CRATE, 14, 9);
    await opened(y, 100_000);
    placeYou(HOLLOW);
    onPhone(() => {
      setTool(BELT);
      tap(14, 9);
      expect([aimOf(S.hand)?.x, aimOf(S.hand)?.y, aimOf(S.hand)?.why]).toEqual([OX + 14, OY + 9, null]);
      expect(handPrint().go).toEqual({ label: "Build", bad: false });
    });
  });

  test("a start on a far machine sends nothing; reach refuses Build only when it would send the belt", async () => {
    const y = everywhere();
    stands(y, MILL, 40, 9);
    await opened(y, 100_000);
    placeYou(HOLLOW);
    onPhone(() => {
      setTool(BELT);
      tap(40, 9);
      expect([aimOf(S.hand)?.x, aimOf(S.hand)?.why]).toEqual([OX + 40, null]);
      expect(confirm()).toBe(false);
      expect(aimOf(S.hand)?.why).toBe(OUT_OF_REACH);
      expect(S.world.kind[at(41, 9)]).not.toBe(BELT);
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
      expect(removeAt(40, 9)).toBe(false);
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

/** A row of mills down x = 26 from `top` to the first ring's foot, every plot of it owned and the land below not, so solid; from 25, 35 a tap at 27, 35 walks round it. */
async function roundTheWall(top: number): Promise<void> {
  const y = everywhere();
  for (let z = top; z <= 35; z++) build(y, MILL, OX + 26, OY + z, 0, Infinity);
  await opened(y);
  canvasPage();
  // Mills, and a redwood where none could be built: solid all the way down.
  for (let z = top; z <= 35; z++) expect(yardSolid(S.world).at(mid(26, z).x, mid(26, z).y)).not.toBeNull();
  const c = placeYou(mid(25, 35));
  expect(walkTo(px(27 * 16 + 5, 35 * 16 + 9).x, px(27 * 16 + 5, 35 * 16 + 9).y)).toBe(true);
  for (let k = 0; k < 60 * 40 && c.going; k++) stepInput(1 / 60);
  expect(c.tile).toEqual(T(27, 35));
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
    click(canvas, OX * 16 + 30 * 16 + 5, OY * 16 + 21 * 16 + 9);
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
    for (let x = 9; x <= 13; x++) for (const z of [26, 30]) build(y, MILL, OX + x, OY + z, 0, Infinity);
    for (let z = 27; z <= 29; z++) for (const x of [9, 13]) build(y, MILL, OX + x, OY + z, 0, Infinity);
    await opened(y);
    canvasPage();
    const c = placeYou(mid(3, 28));
    const to = mid(11, 28);
    expect(walkTo(to.x, to.y)).toBe(true);
    for (let k = 0; k < 60 * 20 && c.going; k++) stepInput(1 / 60);
    // Three tiles from it, outside the ring, on whichever side is nearest: never standing where it began.
    expect(c.going).toBe(false);
    expect(Math.hypot(c.tile.x - OX - 11, c.tile.y - OY - 28)).toBe(3);
  });
});

describe("a zoom while the view goes with you", () => {
  test("zooms about you in one step: you stay where you are on the screen, then and at the next frame", async () => {
    await opened(everywhere());
    canvasPage();
    setCamera(
      { width: 320, height: 200, style: { transform: "" } },
      { x: -56, y: -88, w: LAND.w * 16 + 112, h: LAND.h * 16 + 144 },
    );
    setZoom(0);
    setTool(null);
    // The view fitted to this screen first, at the size that suits it.
    zoom(0, 0, 0);
    const c = placeYou(mid(24, 21));
    holdView(true);
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

/** A page whose camera knows the picture and the ground, the view fitted to its screen, you standing in the yard. */
async function framed(): Promise<{ c: ReturnType<typeof placeYou> }> {
  await opened(everywhere(), 100_000);
  canvasPage();
  setCamera(
    { width: 320, height: 200, style: { transform: "" } },
    { x: -56, y: -88, w: LAND.w * 16 + 112, h: LAND.h * 16 + 144 },
  );
  setZoom(0);
  setTool(null);
  zoom(0, 0, 0);
  const c = placeYou(mid(24, 21));
  holdView(true);
  for (let k = 0; k < 60; k++) stepInput(1 / 60);
  return { c };
}

describe("with a tool in hand the view stays out of the way", () => {
  test("a zoom with a tool in hand keeps the tile under the pointer, as before #270, and lets go of you", async () => {
    await framed();
    setTool(BELT);
    expect(following()).toBe(true);
    const k0 = S.view.dpr / S.view.z;
    const under = { x: S.cam.x + 30 * k0, y: S.cam.y + 20 * k0 };
    expect(zoom(1, 30, 20)).toBe(true);
    const k1 = S.view.dpr / S.view.z;
    expect([Math.abs(S.cam.x + 30 * k1 - under.x) < 1, Math.abs(S.cam.y + 20 * k1 - under.y) < 1]).toEqual([
      true,
      true,
    ]);
    const cam = { ...S.cam };
    for (let k = 0; k < 30; k++) stepInput(1 / 60);
    expect([S.cam.x, S.cam.y, following()]).toEqual([cam.x, cam.y, false]);
    setTool(null);
    setZoom(0);
  });

  test("the line over the dock growing, or a card coming up, moves nothing under the finger", async () => {
    const { c } = await framed();
    setTool(BELT);
    expect(following()).toBe(true);
    const cam = { ...S.cam };
    const was = { ...inset };
    try {
      inset.bottom += 40;
      for (let k = 0; k < 10; k++) stepInput(1 / 60);
      expect([S.cam.x, S.cam.y]).toEqual([cam.x, cam.y]);
      inset.top += 30;
      for (let k = 0; k < 10; k++) stepInput(1 / 60);
      expect([S.cam.x, S.cam.y, following()]).toEqual([cam.x, cam.y, true]);
      // Walking, the view gathers on you again.
      expect(walkTo(mid(30, 21).x, mid(30, 21).y)).toBe(true);
      for (let k = 0; k < 60; k++) stepInput(1 / 60);
      expect([c.x > mid(24, 21).x, S.cam.x > cam.x]).toEqual([true, true]);
    } finally {
      Object.assign(inset, was);
      setTool(null);
      setZoom(0);
    }
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
    click(canvas, OX * 16 + 30 * 16 + 5, OY * 16 + 21 * 16 + 9);
    expect(c.going).toBe(true);
    expect(c.bound).toEqual(px(30 * 16 + 5, 21 * 16 + 9));
    c.steer(0, 0);
    expect("refused" in doNow({ do: "build", kind: MILL, ...T(20, 21), dir: 0, grade: 1 })).toBe(false);
    c.put(mid(24, 21).x, mid(24, 21).y);
    // A piece: its card is asked for (no card is drawn here), and nobody walks.
    click(canvas, OX * 16 + 20 * 16 + 8, OY * 16 + 21 * 16 + 8);
    expect([c.going, c.bound]).toEqual([false, null]);
    // The ground again: the card is put away, and you go.
    click(canvas, OX * 16 + 27 * 16 + 8, OY * 16 + 21 * 16 + 8);
    expect([deck.open, c.going]).toEqual([null, true]);
  });
});
