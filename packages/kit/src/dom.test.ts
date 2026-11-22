import { expect, jest, test } from "bun:test";

import { asking, pressedTwice } from "./dom.ts";

test("a button that spends is done on its second press, and goes back if it is left alone", () => {
  jest.useFakeTimers();
  let drawn = 0;
  const redraw = (): void => void drawn++;
  expect(pressedTwice("plot:meadow", redraw)).toBe(false);
  expect(asking("plot:meadow")).toBe(true);
  expect(drawn).toBe(1);
  expect(pressedTwice("plot:meadow", redraw)).toBe(true);
  expect(asking("plot:meadow")).toBe(false);
  // Another button pressed in between: the first is no longer waiting.
  pressedTwice("plot:meadow", redraw);
  expect(pressedTwice("plan:rakes", redraw)).toBe(false);
  expect(asking("plot:meadow")).toBe(false);
  // Left alone for four seconds, it is drawn as it was.
  const before = drawn;
  jest.advanceTimersByTime(4000);
  expect(asking("plan:rakes")).toBe(false);
  expect(drawn).toBe(before + 1);
  jest.useRealTimers();
});
