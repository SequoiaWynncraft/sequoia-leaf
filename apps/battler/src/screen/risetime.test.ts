import { describe, expect, test } from "bun:test";

import { beatOf, dimAt, fateOf, quartersAt, risingAt, STUDS } from "./risetime.ts";

const playing = { over: false, tick: 119 };

describe("a true form rising", () => {
  test("goes through its five beats on the fight's clock, in the second the rules give it", () => {
    const r = risingAt(100, 20);
    expect(r).toEqual({ fell: 100, up: 120 });
    const beats = [100, 105, 108, 110, 115, 119, 120, 140].map((c) => beatOf(r, c));
    expect(beats).toEqual(["lies", "lies", "dims", "draws", "draws", "draws", "stands", "stands"]);
    // The table dims through the catch and is lit again the moment it stands.
    expect([dimAt(r, 105), dimAt(r, 110), dimAt(r, 119.9), dimAt(r, 120)]).toEqual([0, 1, 1, 0]);
    // The ring draws a stud at a time, and is whole as it stands.
    const quarters = [109, 110, 112.5, 115, 117.5, 119.9, 120].map((c) => quartersAt(r, c));
    expect(quarters).toEqual([0, 0, 1, 2, 3, 3, STUDS]);
  });

  test("is the same at 4x as at 1x: everything is counted in the fight's steps, never in the frame's time", () => {
    const r = risingAt(40, 20);
    const at1 = Array.from({ length: 30 }, (_, i) => beatOf(r, 40 + i));
    const at4 = Array.from({ length: 30 }, (_, i) => beatOf(r, 40 + i));
    expect(at4).toEqual(at1);
  });

  test("stands only when the rules get it up; a fight that ends first, or a step played without it, leaves it down", () => {
    const r = risingAt(100, 20);
    expect(fateOf(r, { over: false, tick: 110 }, false)).toBe("waits");
    expect(fateOf(r, { over: false, tick: 120 }, true)).toBe("stands");
    // The fight was decided before its step: there is no rise, and it stays down.
    expect(fateOf(r, { over: true, tick: 112 }, false)).toBe("stays down");
    // Its step came and went and it did not get up: nowhere was free to stand.
    expect(fateOf(r, { over: false, tick: 121 }, false)).toBe("stays down");
    expect(fateOf(r, playing, false)).toBe("waits");
  });
});
