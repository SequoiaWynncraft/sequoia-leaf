import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";

import { type Click, LONG_PRESS, longPress } from "./press.ts";
import { scope } from "./scope.ts";
import { Listened } from "./standin.ts";

/** A thing on the page to press, which counts the listeners on it. */
class Thing extends Listened {
  isConnected = true;
}

const pointer = (type: string, pointerId: number, x = 0, y = 0, pointerType = "touch"): Event =>
  Object.assign(new Event(type), { pointerId, pointerType, clientX: x, clientY: y });
/** A pointer's click, as a browser that says which pointer gives it. */
const tap = (pointerId: number): Click => ({ detail: 1, pointerId });
/** A click from the keyboard: Chrome's names no pointer (-1); Safari's has no pointer at all. */
const KEYS: readonly Click[] = [{ detail: 0, pointerId: -1 }, { detail: 0 }];

/** A thing a finger presses: what it asked, and whether each click was the press's. */
function pressed(): { thing: Thing; asked: string[]; click: (c: Click) => boolean; owner: ReturnType<typeof scope> } {
  const thing = new Thing();
  const owner = scope();
  const asked: string[] = [];
  const click = longPress(owner, thing, {
    starts: (e) => e.pointerType !== "mouse",
    asked: () => asked.push("asked"),
  });
  return { thing, asked, click, owner };
}

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe("a long press", () => {
  test("held still asks once, and the click that ends it is the press's, not the thing's", () => {
    const { thing, asked, click } = pressed();
    thing.dispatchEvent(pointer("pointerdown", 1));
    jest.advanceTimersByTime(LONG_PRESS - 1);
    expect(asked).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(asked).toEqual(["asked"]);
    thing.dispatchEvent(pointer("pointerup", 1));
    expect(click(tap(1))).toBe(true);
    expect(click(tap(1))).toBe(false);
  });

  test("takes only the click its own finger makes: never a keyboard's, nor another pointer's", () => {
    const { thing, click } = pressed();
    // Cancelled after asking: the finger makes no click, and the keyboard's next is the thing's.
    thing.dispatchEvent(pointer("pointerdown", 3));
    jest.advanceTimersByTime(LONG_PRESS);
    thing.dispatchEvent(pointer("pointercancel", 3));
    for (const key of KEYS) expect(click(key)).toBe(false);
    // Asked and lifted: keys and other pointers still act; the finger's own click is the press's,
    // whether the browser names its pointer or not.
    for (const own of [tap(4), { detail: 1 }]) {
      thing.dispatchEvent(pointer("pointerdown", 4));
      jest.advanceTimersByTime(LONG_PRESS);
      thing.dispatchEvent(pointer("pointerup", 4));
      for (const key of KEYS) expect(click(key)).toBe(false);
      expect(click(tap(5))).toBe(false);
      expect([click(own), click(own)]).toEqual([true, false]);
    }
  });

  test("lifted, cancelled, moved away or lasting leaves nothing of itself on the thing for the next", () => {
    const { thing, asked } = pressed();
    const resting = thing.listening;
    for (let i = 0; i < 5; i++) {
      thing.dispatchEvent(pointer("pointerdown", 1));
      thing.dispatchEvent(pointer("pointerup", 1));
      expect(thing.listening).toBe(resting);
    }
    thing.dispatchEvent(pointer("pointerdown", 1));
    thing.dispatchEvent(pointer("pointercancel", 1));
    expect(thing.listening).toBe(resting);
    thing.dispatchEvent(pointer("pointerdown", 1, 0, 0));
    thing.dispatchEvent(pointer("pointermove", 1, 20, 0));
    expect(thing.listening).toBe(resting);
    thing.dispatchEvent(pointer("pointerdown", 1));
    jest.advanceTimersByTime(LONG_PRESS);
    expect(thing.listening).toBe(resting);
    expect(asked).toEqual(["asked"]);
  });

  test("on a thing that has left the page by the time it has lasted asks nothing", () => {
    const { thing, asked, click } = pressed();
    thing.dispatchEvent(pointer("pointerdown", 1));
    thing.isConnected = false;
    jest.advanceTimersByTime(LONG_PRESS);
    expect(asked).toEqual([]);
    expect(click(tap(1))).toBe(false);
  });

  test("ends only by its own finger, and a little wandering is still resting", () => {
    const { thing, asked } = pressed();
    thing.dispatchEvent(pointer("pointerdown", 1, 0, 0));
    thing.dispatchEvent(pointer("pointerup", 2));
    thing.dispatchEvent(pointer("pointermove", 1, 5, 5));
    jest.advanceTimersByTime(LONG_PRESS);
    expect(asked).toEqual(["asked"]);
  });

  test("a second finger's press replaces the first, and lifted before it lasts asks nothing", () => {
    const { thing, asked } = pressed();
    thing.dispatchEvent(pointer("pointerdown", 1));
    thing.dispatchEvent(pointer("pointerdown", 2));
    thing.dispatchEvent(pointer("pointerup", 2));
    jest.advanceTimersByTime(LONG_PRESS);
    expect(asked).toEqual([]);
  });

  test("is not begun by the mouse, and a new press forgets an old one's click", () => {
    const { thing, asked, click } = pressed();
    thing.dispatchEvent(pointer("pointerdown", 1, 0, 0, "mouse"));
    jest.advanceTimersByTime(LONG_PRESS);
    expect(asked).toEqual([]);
    thing.dispatchEvent(pointer("pointerdown", 1));
    jest.advanceTimersByTime(LONG_PRESS);
    // The finger slid off and no click came; the mouse presses next, and its click is the thing's.
    thing.dispatchEvent(pointer("pointerdown", 2, 0, 0, "mouse"));
    expect(click(tap(2))).toBe(false);
  });

  test("ends with its owner, which takes everything off the thing", () => {
    const { thing, asked, owner } = pressed();
    thing.dispatchEvent(pointer("pointerdown", 1));
    owner.close();
    jest.advanceTimersByTime(LONG_PRESS);
    expect(asked).toEqual([]);
    expect(thing.listening).toBe(0);
  });
});
