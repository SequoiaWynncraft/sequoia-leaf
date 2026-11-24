import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";

import { HOVER_MS, IDLE_MS, paced, REST_FPS } from "./pace.ts";
import { scope } from "./scope.ts";

/** The screen's frames, by hand: `draw(t)` draws the one asked for, at `t`. */
const frames = new Map<number, (t: number) => void>();
let asked = 0;
beforeEach(() => {
  jest.useFakeTimers();
  frames.clear();
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: (fn: (t: number) => void) => {
      frames.set(++asked, fn);
      return asked;
    },
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    value: (id: number) => frames.delete(id),
  });
});
afterEach(() => {
  jest.useRealTimers();
  Reflect.deleteProperty(globalThis, "requestAnimationFrame");
  Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
});

/** A page with a hand-set clock and focus, its loop, and the steps its frames were given. */
function rig(focused: boolean) {
  const page = { target: new EventTarget(), focused: () => state.focused, now: () => state.t };
  const state = { t: 1000, focused };
  const steps: number[] = [];
  const sc = scope();
  const loop = paced(sc, (_t, dt) => steps.push(dt), page);
  /** Moves the clock on. */
  const wait = (ms: number): void => {
    state.t += ms;
    jest.advanceTimersByTime(ms);
  };
  /** Moves the clock on and draws the frame asked for then, if there is one. */
  const draw = (ms: number): boolean => {
    wait(ms);
    const [id, fn] = [...frames][0] ?? [];
    if (id === undefined || !fn) return false;
    frames.delete(id);
    fn(state.t);
    return true;
  };
  const touch = (kind: string): void => void page.target.dispatchEvent(new Event(kind));
  return { state, steps, sc, loop, wait, draw, touch };
}

describe("a game's frames", () => {
  test("come every time the screen shows one while the member is at the page", () => {
    const r = rig(true);
    r.loop.wake();
    for (let k = 0; k < 5; k++) expect(r.draw(7)).toBe(true);
    expect(r.steps).toEqual([0.007, 0.007, 0.007, 0.007, 0.007]);
  });

  test("come a rest apart once another program has the window and the pointer has been still a moment", () => {
    const r = rig(false);
    r.loop.wake();
    r.draw(HOVER_MS);
    // Resting, nothing is asked of the screen until just before the rest is over; then its next frame.
    r.wait(1000 / REST_FPS - 8 - 1);
    expect(frames.size).toBe(0);
    r.wait(1);
    expect(frames.size).toBe(1);
    expect(r.draw(8)).toBe(true);
    expect(r.steps.at(-1)).toBeCloseTo(1 / REST_FPS, 6);
  });

  test("rest once nobody has touched the page for a while, though its window is the member's", () => {
    const r = rig(true);
    r.loop.wake();
    r.draw(IDLE_MS - 1);
    expect(r.draw(1)).toBe(true);
    expect(r.draw(1)).toBe(false);
  });

  test("wake at once to a touch, and come every frame again", () => {
    const r = rig(false);
    r.loop.wake();
    r.draw(HOVER_MS);
    expect(r.draw(1)).toBe(false);
    r.touch("pointermove");
    expect(r.draw(1)).toBe(true);
    expect(r.draw(7)).toBe(true);
  });

  test("wake when the window comes back", () => {
    const r = rig(false);
    r.loop.wake();
    r.draw(HOVER_MS);
    expect(r.draw(1)).toBe(false);
    r.state.focused = true;
    r.touch("focus");
    expect(r.draw(1)).toBe(true);
    expect(r.draw(1000)).toBe(true);
  });

  test("a long stall is not a jump: awake, a step is a twentieth of a second at most", () => {
    const r = rig(true);
    r.loop.wake();
    r.draw(500);
    expect(r.steps).toEqual([0.05]);
  });

  test("stopped, ask for nothing, and a touch does not start them; woken, they begin with no jump", () => {
    const r = rig(true);
    r.loop.wake();
    r.loop.stop();
    expect(frames.size).toBe(0);
    r.touch("keydown");
    expect(r.draw(7)).toBe(false);
    r.loop.wake();
    expect(r.draw(7)).toBe(true);
    expect(r.steps).toEqual([0.007]);
  });

  test("end with their scope", () => {
    const r = rig(true);
    r.loop.wake();
    r.sc.close();
    expect(frames.size).toBe(0);
    r.loop.wake();
    expect(frames.size).toBe(0);
  });
});
