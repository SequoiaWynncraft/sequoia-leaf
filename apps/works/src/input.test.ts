/**
 * The mouse over the yard points at what is under it now, whether the mouse moved or the yard moved
 * under it (the keys, an eased look, a zoom). While the yard moves under it, the mouse rests on
 * nothing, so no card comes up for whatever passes beneath; once the yard stands still, what is under
 * the mouse then is pointed at, and a card for it may follow. A tunnel is laid with two clicks or
 * taps: where it goes in, then where it comes up.
 */
import { afterEach, describe, expect, jest, test } from "bun:test";

import { at, BELT, build, check, CRATE, create, NONE, TUNNEL, type Yard } from "@sequoia-leaf/factory";
import { near, xy } from "@sequoia-leaf/factory/test/near.ts";
import { deck } from "@sequoia-leaf/kit/card.ts";
import { keyboard } from "@sequoia-leaf/kit/keyboard.ts";
import { noKeysHeld } from "@sequoia-leaf/kit/keys.ts";
import { LONG_PRESS } from "@sequoia-leaf/kit/press.ts";

import { ctx, type FakeLeaf, isRecord, opened, until, useFakeLeaf } from "../test/fake-leaf.ts";
import { aimOf } from "./hand.ts";
import { WORKS_KEYS } from "./keymap.ts";
import { S, toPage } from "./state.ts";
import { confirm, rotate, setTool } from "./tools.ts";
import { refAt } from "./ui/card.ts";
import { handPrint, openTools } from "./ui/dock.ts";
import { differences } from "./yard.ts";

// The camera's module draws onto canvases that are made as it loads (`scene.ts`): a document is there
// first whose canvases take any drawing and keep none of it.
const inert: () => unknown = new Proxy(() => inert, { get: () => inert, set: () => true });
Object.defineProperty(globalThis, "document", { value: { createElement: () => inert }, configurable: true });
const { pan, zoomSteps } = await import("./camera.ts");
const { initInput, stepInput } = await import("./input.ts");

useFakeLeaf();

/**
 * A page for the input to listen on: a window, a document and the yard's canvas. What the page itself
 * waits for on the window (a clack, dust) never comes; a long press waits in the kit's scope, on the
 * clock a test holds (`jest.useFakeTimers`).
 */
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

// Asking what a key is for notes it down (`heldAgain`); no page here lets it go.
afterEach(noKeysHeld);
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

/** A key as a keyboard sends it: where it is, what it types there, whether Shift is held, and whether the browser says it is held down. */
const sent = (code: string, typed: string, shiftKey = false, repeat = false) => ({
  code,
  key: typed,
  shiftKey,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  repeat,
});
/** A key going down, or up, on the page. A key going up is let go of (`keys.ts`, which no page here listens for). */
const key = (kind: "keydown" | "keyup", code: string, typed: string, shift = false, repeat = false): void => {
  window.dispatchEvent(Object.assign(new Event(kind), sent(code, typed, shift, repeat)));
  if (kind === "keyup") noKeysHeld();
};

describe("the keys", () => {
  test("no two of the Works' actions share a key", () => {
    expect(WORKS_KEYS.shared()).toEqual([]);
  });

  test("on AZERTY go by their place: its Q, where QWERTY has A, moves the view left; its A picks the piece pointed at", async () => {
    const y = create({ seed: 5, tier: 1 });
    build(y, BELT, ...xy(-6, -5), 0, Infinity);
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
      S.hover = { ...near(-6, -5) };
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

  test("a tool's key is its slot's: tool 3 put on Y is picked by Y, and tool 4 still by 4", async () => {
    await openedEmptyHanded();
    canvasPage();
    const tools = openTools();
    expect(tools.length).toBeGreaterThanOrEqual(4);
    try {
      WORKS_KEYS.put("tool", 2, "KeyY");
      expect(WORKS_KEYS.names("tool").slice(0, 4)).toEqual(["1", "2", "Y", "4"]);
      key("keydown", "KeyY", "y");
      key("keyup", "KeyY", "y");
      expect(S.tool).toBe(tools[2] ?? null);
      key("keydown", "Digit4", "4");
      key("keyup", "Digit4", "4");
      expect(S.tool).toBe(tools[3] ?? null);
      // Its old key, 3, picks nothing now.
      key("keydown", "Digit3", "3");
      key("keyup", "Digit3", "3");
      expect(S.tool).toBe(tools[3] ?? null);
    } finally {
      WORKS_KEYS.resetAll();
    }
  });

  test("held down, R rotates once; held, zoom goes on", async () => {
    await openedEmptyHanded();
    canvasPage();
    setTool(BELT);
    const dir = S.dir;
    key("keydown", "KeyR", "r");
    key("keydown", "KeyR", "r", false, true);
    key("keydown", "KeyR", "r", false, true);
    key("keyup", "KeyR", "r");
    const turned = S.dir;
    key("keydown", "KeyR", "r");
    key("keyup", "KeyR", "r");
    expect([turned !== dir, S.dir !== turned]).toEqual([true, true]);
    const z = zoomSteps();
    key("keydown", "Minus", "_", true);
    key("keydown", "Minus", "_", true, true);
    key("keyup", "Minus", "_", true);
    expect(zoomSteps() - z).toBe(-2);
  });
});

describe("a finger", () => {
  // A long press waits in the kit's scope: the tests' clock moves only when they say.
  afterEach(() => {
    jest.useRealTimers();
  });

  test("kept on a piece asks for its card as a tap does, and from then on the line does not say how", async () => {
    await openedEmptyHanded();
    S.finger = true;
    const canvas = canvasPage();
    jest.useFakeTimers();
    expect(handPrint().line.text).toBe("Tap a piece for its card.");
    const [x, y] = S.world.land.depot;
    const p = toPage(x * 16 + 8, y * 16 + 8);
    canvas.dispatchEvent(
      Object.assign(new Event("pointerdown"), {
        pointerId: 2,
        pointerType: "touch",
        button: 0,
        clientX: p.x,
        clientY: p.y,
      }),
    );
    expect(handPrint().line.text).toBe("Tap a piece for its card.");
    // The finger has rested on it long enough, and lifts.
    jest.advanceTimersByTime(LONG_PRESS);
    canvas.dispatchEvent(
      Object.assign(new Event("pointerup"), {
        pointerId: 2,
        pointerType: "touch",
        button: 0,
        clientX: p.x,
        clientY: p.y,
      }),
    );
    expect(handPrint().line.text).toBe("");
  });

  test("kept on a piece but losing its hold before the moment asks for nothing, and lifting is no tap", async () => {
    await openedEmptyHanded();
    S.finger = true;
    const canvas = canvasPage();
    jest.useFakeTimers();
    const [x, y] = S.world.land.depot;
    const p = toPage(x * 16 + 8, y * 16 + 8);
    const finger = (type: string): void => {
      canvas.dispatchEvent(
        Object.assign(new Event(type), { pointerId: 2, pointerType: "touch", button: 0, clientX: p.x, clientY: p.y }),
      );
    };
    finger("pointerdown");
    finger("lostpointercapture");
    jest.advanceTimersByTime(LONG_PRESS);
    finger("pointerup");
    expect([deck.open, handPrint().line.text]).toEqual([null, "Tap a piece for its card."]);
  });

  test("resting on bare ground and then moving on leaves a pinned card up; a tap there puts it away", async () => {
    await openedEmptyHanded();
    S.finger = true;
    const canvas = canvasPage();
    jest.useFakeTimers();
    const w = S.world;
    let bare = -1;
    for (let i = 0; i < w.kind.length && bare < 0; i++)
      if (refAt(i % w.land.w, Math.floor(i / w.land.w)) === null) bare = i;
    const p = toPage((bare % w.land.w) * 16 + 8, Math.floor(bare / w.land.w) * 16 + 8);
    const press = (type: string): void => {
      canvas.dispatchEvent(
        Object.assign(new Event(type), { pointerId: 3, pointerType: "touch", button: 0, clientX: p.x, clientY: p.y }),
      );
    };
    const pinned = {
      stack: ["tile:0"],
      pinned: true,
      via: "touch",
      at: {},
      from: {},
      side: false,
      preview: false,
    } as const;
    deck.open = pinned;
    press("pointerdown");
    jest.advanceTimersByTime(LONG_PRESS);
    expect(deck.open).toBe(pinned);
    press("pointerup");
    expect(deck.open).toBe(pinned);
    // A tap: down and up, with no rest.
    press("pointerdown");
    press("pointerup");
    expect(deck.open).toBeNull();
  });
});

/**
 * A yard with tunnels to hand and a crate at (19, 13) and (21, 13), a tile apart: a tunnel going in
 * at (18, 13) comes up between them by itself. The page listens; the tunnel is in hand, facing right.
 */
async function crates(tier = 2, more?: (y: Yard) => void): Promise<{ canvas: EventTarget; leaf: FakeLeaf["leaf"] }> {
  const y = create({ seed: 5, tier });
  y.at = ctx().now;
  for (const dx of [-5, -3]) expect(build(y, CRATE, ...xy(dx, -5), 0, Infinity).ok).toBe(true);
  more?.(y);
  const fake = await opened(y, 1000);
  const canvas = canvasPage();
  S.finger = false;
  setTool(TUNNEL);
  S.dir = 0;
  return { canvas, leaf: fake.leaf };
}
/** A pointer's event over the middle of a tile: the mouse's left or right button, or a finger. */
const on = (canvas: EventTarget, type: string, x: number, y: number, how: "left" | "right" | "finger"): void => {
  const p = toPage(x * 16 + 8, y * 16 + 8);
  canvas.dispatchEvent(
    Object.assign(new Event(type), {
      pointerId: how === "finger" ? 4 : 1,
      pointerType: how === "finger" ? "touch" : "mouse",
      button: how === "right" ? 2 : 0,
      clientX: p.x,
      clientY: p.y,
    }),
  );
};
const click = (canvas: EventTarget, x: number, y: number, how: "left" | "right" | "finger" = "left"): void => {
  if (how !== "finger") on(canvas, "pointermove", x, y, how);
  on(canvas, "pointerdown", x, y, how);
  on(canvas, "pointerup", x, y, how);
};
const kindOf = (x: number, y: number): number => S.world.kind[at(S.world, x, y)] ?? NONE;
const span = (x: number, y: number): number => S.world.span[at(S.world, x, y)] ?? 0;
const names = (commands: unknown[]): unknown[] => commands.map((c) => (isRecord(c) ? c.do : null));

describe("a tunnel", () => {
  test("a first click sets where it goes in and builds nothing; a second, past the crates, builds both ends there", async () => {
    const { canvas } = await crates();
    click(canvas, ...xy(-6, -5));
    expect([S.hand.is, kindOf(...xy(-6, -5))]).toEqual(["tunnel", NONE]);
    // Pointing past both crates: it would come up there.
    on(canvas, "pointermove", ...xy(-2, -5), "left");
    expect([S.aim?.why, S.aim?.far]).toEqual([null, at(S.world, ...xy(-2, -5))]);
    click(canvas, ...xy(-2, -5));
    expect([kindOf(...xy(-6, -5)), kindOf(...xy(-2, -5)), span(...xy(-6, -5)), kindOf(...xy(-4, -5))]).toEqual([
      TUNNEL,
      TUNNEL,
      3,
      NONE,
    ]);
    // The tunnel stays in hand, with no way in set.
    expect([S.hand.is, S.tool]).toEqual(["build", TUNNEL]);
  });

  test("a second click where it goes in comes up at the nearest tile it can, as one click did", async () => {
    const { canvas, leaf } = await crates();
    click(canvas, ...xy(-6, -5));
    click(canvas, ...xy(-6, -5));
    expect([kindOf(...xy(-6, -5)), kindOf(...xy(-4, -5)), span(...xy(-6, -5))]).toEqual([TUNNEL, TUNNEL, 1]);
    await Bun.sleep(5);
    expect(names(leaf.commands)).toEqual(["build"]);
  });

  test("pointing where it cannot come up shows the nearest tile, says why, and a click there builds nothing", async () => {
    const { canvas, leaf } = await crates();
    click(canvas, ...xy(-6, -5));
    const nearest = at(S.world, ...xy(-4, -5));
    for (const [x, y, why] of [
      [...xy(-2, -4), "A tunnel comes up straight ahead of where it goes in"],
      [...xy(-1, -5), "A tunnel passes under 1 to 3 tiles"],
      [...xy(-5, -5), "A tunnel passes under 1 to 3 tiles"],
      [...xy(-3, -5), "Something is here already"],
    ] as const) {
      on(canvas, "pointermove", x, y, "left");
      expect([S.aim?.why, S.aim?.far]).toEqual([why, nearest]);
      click(canvas, x, y);
      expect([S.hand.is, kindOf(...xy(-6, -5))]).toEqual(["tunnel", NONE]);
      expect(handPrint().line).toEqual({ text: why, bad: true });
    }
    await Bun.sleep(5);
    expect(leaf.commands).toEqual([]);
  });

  test("points the way of a tile in line with where it goes in; R turns it, and Escape or the right button lets the way in go", async () => {
    const { canvas } = await crates();
    click(canvas, ...xy(-6, -5));
    // Two tiles down: it faces down and would come up there.
    on(canvas, "pointermove", ...xy(-6, -2), "left");
    expect([S.dir, S.aim?.why, S.aim?.far]).toEqual([1, null, at(S.world, ...xy(-6, -2))]);
    // Turned, it no longer comes up under the pointer, which stays where it is.
    rotate();
    expect([S.dir, S.aim?.why]).toEqual([2, "A tunnel comes up straight ahead of where it goes in"]);
    // The right button lets the way in go, and takes nothing away.
    click(canvas, ...xy(-6, -2), "right");
    expect([S.hand.is, S.tool]).toEqual(["build", TUNNEL]);
    click(canvas, ...xy(-6, -5));
    expect(S.hand.is).toBe("tunnel");
    key("keydown", "Escape", "Escape");
    key("keyup", "Escape", "Escape");
    expect([S.hand.is, S.tool]).toEqual(["build", TUNNEL]);
  });

  test("on a phone: tap where it goes in, tap where it comes up, then the gold button", async () => {
    const { canvas, leaf } = await crates();
    click(canvas, ...xy(-6, -5), "finger");
    expect([S.hand.is, handPrint().line.text]).toEqual(["tunnel", "Now tap where it comes up."]);
    click(canvas, ...xy(-2, -5), "finger");
    expect([kindOf(...xy(-6, -5)), handPrint().go]).toEqual([NONE, { label: "Build", bad: false }]);
    expect(confirm()).toBe(true);
    expect([kindOf(...xy(-6, -5)), kindOf(...xy(-2, -5)), span(...xy(-6, -5))]).toEqual([TUNNEL, TUNNEL, 3]);
    await until(() => leaf.posts >= 1);
    await Bun.sleep(5);
    expect(names(leaf.commands)).toEqual(["lay"]);
    // Leaf laid it as the page did.
    expect([differences(), check(S.world)]).toEqual([0, check(leaf.yard)]);
  });

  test("on a tunnel already standing, one click raises it as before", async () => {
    // Where tunnels may be built at grade II.
    const { canvas } = await crates(3, (y) => expect(build(y, TUNNEL, ...xy(-6, -3), 0, Infinity).ok).toBe(true));
    S.grades[TUNNEL] = 2;
    click(canvas, ...xy(-6, -3));
    expect([S.hand.is, S.world.grade[at(S.world, ...xy(-6, -3))]]).toEqual(["build", 2]);
  });
});
