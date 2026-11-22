import { describe, expect, jest, test } from "bun:test";

import { asking, mouseHeld, pressedTwice, unheld, when } from "./dom.ts";

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

describe("nothing is drawn again under a held mouse button", () => {
  test("a part and a card wait for the button to lift, the card until after the click it ends in", async () => {
    let says = "a";
    const drawn: string[] = [];
    const part = when(
      () => says,
      () => drawn.push(says),
    );
    const card = unheld(() => drawn.push("card"));
    part();
    mouseHeld(true);
    says = "b";
    part();
    card();
    card();
    expect(drawn).toEqual(["a"]);
    mouseHeld(false);
    expect(drawn).toEqual(["a"]);
    await Bun.sleep(1);
    expect(drawn).toEqual(["a", "card"]);
    part();
    expect(drawn).toEqual(["a", "card", "b"]);
  });

  test("a part's first drawing does not wait: nothing was under the button", () => {
    const drawn: number[] = [];
    mouseHeld(true);
    when(
      () => "x",
      () => drawn.push(1),
    )();
    mouseHeld(false);
    expect(drawn).toEqual([1]);
  });
});
