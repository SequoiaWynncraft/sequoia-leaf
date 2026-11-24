import { afterEach, describe, expect, test } from "bun:test";

import { fly } from "./pursebar.ts";

/** A picture in flight: it is placed, measured, and animated, and its animation finishes when told. */
class Flying extends EventTarget {
  readonly style = { cssText: "" };
  readonly classList = { add: (): void => undefined };
  readonly landed: EventTarget[] = [];
  removed = false;
  getBoundingClientRect = () => ({ width: 16 });
  animate(): EventTarget {
    const run = new EventTarget();
    this.landed.push(run);
    return run;
  }
  remove(): void {
    this.removed = true;
  }
}

/** A page that may ask for less motion, where everything made is a picture in flight. */
function page(lessMotion: boolean): Flying[] {
  const made: Flying[] = [];
  const win = { matchMedia: (q: string) => ({ matches: lessMotion && q === "(prefers-reduced-motion: reduce)" }) };
  const doc = {
    body: { append: (): void => undefined },
    createElement: () => {
      const f = new Flying();
      made.push(f);
      return f;
    },
  };
  Object.defineProperty(globalThis, "window", { value: win, configurable: true });
  Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
  return made;
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "document");
});

describe("things flying across the page", () => {
  test("land at once, with nothing drawn, for a player who asked for less motion", () => {
    const made = page(true);
    const landed: number[] = [];
    fly(
      () => document.createElement("canvas"),
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      3,
      (i) => landed.push(i),
    );
    expect(landed).toEqual([0, 1, 2]);
    expect(made).toEqual([]);
  });

  test("otherwise fly, the picture the page gives each one, and land as each arrives", () => {
    const made = page(false);
    const landed: number[] = [];
    fly(
      () => document.createElement("canvas"),
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      2,
      (i) => landed.push(i),
    );
    expect([made.length, landed]).toEqual([2, []]);
    for (const f of made) for (const run of f.landed) run.dispatchEvent(new Event("finish"));
    expect(landed).toEqual([0, 1]);
    expect(made.every((f) => f.removed)).toBe(true);
  });
});
