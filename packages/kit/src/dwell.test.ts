import { describe, expect, test } from "bun:test";

import { dwell } from "./dwell.ts";

/** A thing as a page describes it in one frame: made anew each time, where it is now. */
const pet = (x: number) => ({ id: "pet:cat", tip: ["Moss", "A cat."], x });

/** A dwell that writes down what it does. */
function resting(): { told: string[]; at: (on: ReturnType<typeof pet> | null, now: number) => void } {
  const told: string[] = [];
  const at = dwell<ReturnType<typeof pet>>({
    ms: 400,
    show: (on) => told.push(`show ${on.x}`),
    follow: (on) => told.push(`follow ${on.x}`),
    hide: () => told.push("hide"),
  });
  return { told, at };
}

describe("a pointer resting on a thing drawn on a canvas", () => {
  test("shows its tip after the wait, though the thing is described anew each frame", () => {
    const { told, at } = resting();
    for (let t = 0; t <= 400; t += 16) at(pet(10), t);
    at(pet(10), 401);
    expect(told[0]).toBe("show 10");
  });

  test("keeps it up while the thing moves, the tip going with it", () => {
    const { told, at } = resting();
    at(pet(10), 0);
    at(pet(11), 400);
    at(pet(12), 416);
    expect(told).toEqual(["show 11", "follow 12"]);
  });

  test("puts it away on another thing or none, and waits again", () => {
    const { told, at } = resting();
    at(pet(10), 0);
    at(pet(10), 400);
    at({ id: "crab:2", tip: ["Crab", ""], x: 40 }, 410);
    at({ id: "crab:2", tip: ["Crab", ""], x: 40 }, 810);
    at(null, 900);
    at(pet(10), 1000);
    at(pet(10), 1399);
    expect(told).toEqual(["show 10", "hide", "show 40", "hide"]);
  });
});
