import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";

import { LONG_PRESS } from "@sequoia-leaf/kit/press.ts";
import { scope } from "@sequoia-leaf/kit/scope.ts";

import { CLEAR_MS, type World, worldPress } from "./gesture.ts";

/** The world's canvas: it hears presses, and holds on to a pointer when asked. */
class Canvas extends EventTarget {
  captured: number[] = [];
  setPointerCapture(id: number): void {
    this.captured.push(id);
  }
}

const pointer = (type: string, pointerId: number, x = 0, y = 0, pointerType = "touch"): Event =>
  Object.assign(new Event(type), { pointerId, pointerType, clientX: x, clientY: y });

/** A press on the world, with a stage that writes down what it is told; `ground` says whether a touch is on bare ground. */
function stage(ground = false) {
  const told: string[] = [];
  const world: World = {
    down: (x, y, finger) => {
      told.push(`down ${x},${y}${finger ? " finger" : ""}`);
      return ground;
    },
    drag: (x, y) => told.push(`drag ${x},${y}`),
    release: (x, y) => told.push(`release ${x},${y}`),
    cancel: () => told.push("cancel"),
    asked: (x, y) => told.push(`asked ${x},${y}`),
    cleared: () => told.push("cleared"),
  };
  const canvas = new Canvas();
  const press = worldPress(scope(), canvas, world);
  return { told, canvas, press };
}

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe("a press on the world", () => {
  test("drags with its pointer, and is let go of where it lifts", () => {
    const { told, canvas } = stage();
    canvas.dispatchEvent(pointer("pointerdown", 1, 10, 10, "mouse"));
    canvas.dispatchEvent(pointer("pointermove", 1, 20, 10, "mouse"));
    canvas.dispatchEvent(pointer("pointerup", 1, 30, 10, "mouse"));
    canvas.dispatchEvent(pointer("pointermove", 1, 40, 10, "mouse"));
    expect(told).toEqual(["down 10,10", "drag 20,10", "release 30,10"]);
    expect(canvas.captured).toEqual([1]);
  });

  test("interrupted, is never let go of: a cancel, a lost hold or the page left puts back what it dragged", () => {
    for (const end of ["pointercancel", "lostpointercapture"]) {
      const { told, canvas } = stage();
      canvas.dispatchEvent(pointer("pointerdown", 1, 10, 10));
      canvas.dispatchEvent(pointer("pointermove", 1, 20, 10));
      canvas.dispatchEvent(pointer(end, 1, 20, 10));
      canvas.dispatchEvent(pointer("pointerup", 1, 20, 10));
      expect(told).toEqual(["down 10,10 finger", "drag 20,10", "cancel"]);
    }
    const { told, canvas, press } = stage();
    canvas.dispatchEvent(pointer("pointerdown", 1, 10, 10));
    press.letGo();
    press.letGo();
    canvas.dispatchEvent(pointer("pointerup", 1, 20, 10));
    expect(told).toEqual(["down 10,10 finger", "cancel"]);
  });

  test("is the first finger's: a second finger down, moving or lifting does nothing", () => {
    const { told, canvas } = stage();
    canvas.dispatchEvent(pointer("pointerdown", 1, 10, 10));
    canvas.dispatchEvent(pointer("pointerdown", 2, 50, 50));
    canvas.dispatchEvent(pointer("pointermove", 2, 60, 50));
    canvas.dispatchEvent(pointer("pointerup", 2, 60, 50));
    canvas.dispatchEvent(pointer("pointercancel", 2, 60, 50));
    canvas.dispatchEvent(pointer("pointermove", 1, 15, 10));
    canvas.dispatchEvent(pointer("pointerup", 1, 15, 10));
    expect(told).toEqual(["down 10,10 finger", "drag 15,10", "release 15,10"]);
    expect(canvas.captured).toEqual([1]);
  });

  test("lifted over the tray is let go of there, and cancelled over it is not", () => {
    const lifted = stage();
    lifted.canvas.dispatchEvent(pointer("pointerdown", 1, 10, 10));
    lifted.canvas.dispatchEvent(pointer("pointermove", 1, 10, 300));
    lifted.canvas.dispatchEvent(pointer("pointerup", 1, 10, 300));
    expect(lifted.told.at(-1)).toBe("release 10,300");
    const cancelled = stage();
    cancelled.canvas.dispatchEvent(pointer("pointerdown", 1, 10, 10));
    cancelled.canvas.dispatchEvent(pointer("pointermove", 1, 10, 300));
    cancelled.canvas.dispatchEvent(pointer("pointercancel", 1, 10, 300));
    expect(cancelled.told.filter((t) => t.startsWith("release"))).toEqual([]);
  });

  test("on bare ground steers towards the finger once it has gone far enough", () => {
    const { canvas, press } = stage(true);
    canvas.dispatchEvent(pointer("pointerdown", 1, 10, 10));
    canvas.dispatchEvent(pointer("pointermove", 1, 15, 10));
    expect(press.toward()).toBeNull();
    canvas.dispatchEvent(pointer("pointermove", 1, 30, 10));
    expect(press.toward()).toEqual({ x: 30, y: 10 });
    canvas.dispatchEvent(pointer("pointerup", 1, 30, 10));
    expect(press.toward()).toBeNull();
  });

  test("a finger resting on a thing asks what it is, and the line goes after a while", () => {
    const { told, canvas } = stage();
    canvas.dispatchEvent(pointer("pointerdown", 1, 10, 10));
    jest.advanceTimersByTime(LONG_PRESS);
    canvas.dispatchEvent(pointer("pointerup", 1, 10, 10));
    expect(told.slice(1)).toEqual(["asked 10,10", "release 10,10"]);
    jest.advanceTimersByTime(CLEAR_MS);
    expect(told.at(-1)).toBe("cleared");
  });

  test("lifted or let go of before it has rested, a press asks nothing", () => {
    const { told, canvas, press } = stage();
    canvas.dispatchEvent(pointer("pointerdown", 1, 10, 10));
    canvas.dispatchEvent(pointer("pointerup", 1, 10, 10));
    canvas.dispatchEvent(pointer("pointerdown", 2, 10, 10));
    press.letGo();
    jest.advanceTimersByTime(LONG_PRESS + CLEAR_MS);
    expect(told.filter((t) => t.startsWith("asked") || t === "cleared")).toEqual([]);
  });

  test("the line a long press left is not cleared once the place has changed, nor by an older press's wait", () => {
    const { told, canvas, press } = stage();
    canvas.dispatchEvent(pointer("pointerdown", 1, 10, 10));
    jest.advanceTimersByTime(LONG_PRESS);
    canvas.dispatchEvent(pointer("pointerup", 1, 10, 10));
    press.newPlace();
    jest.advanceTimersByTime(CLEAR_MS);
    expect(told.filter((t) => t === "cleared")).toEqual([]);
    // A second line, asked for before the first's wait ran out: cleared once, at its own time.
    canvas.dispatchEvent(pointer("pointerdown", 1, 10, 10));
    jest.advanceTimersByTime(LONG_PRESS);
    canvas.dispatchEvent(pointer("pointerup", 1, 10, 10));
    jest.advanceTimersByTime(1000);
    canvas.dispatchEvent(pointer("pointerdown", 1, 20, 20));
    jest.advanceTimersByTime(LONG_PRESS);
    canvas.dispatchEvent(pointer("pointerup", 1, 20, 20));
    jest.advanceTimersByTime(CLEAR_MS - 1);
    expect(told.filter((t) => t === "cleared")).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(told.filter((t) => t === "cleared")).toEqual(["cleared"]);
  });
});
