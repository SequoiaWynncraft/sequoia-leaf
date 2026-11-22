import { describe, expect, jest, test } from "bun:test";

import { asking, mouseHeld, pressedTwice, unask, unheld, when } from "./dom.ts";
import { heldAgain, noKeysHeld } from "./keys.ts";

test("a button that spends is done on its second press, and goes back if it is left alone", () => {
  noKeysHeld();
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

test("a key that presses no button, held through both presses, does not stop the second", () => {
  noKeysHeld();
  // Shift is down the whole time, as when placing several pieces in the Works; the mouse presses twice.
  heldAgain({ code: "ShiftLeft", repeat: false });
  expect(pressedTwice("plan:rakes", () => undefined)).toBe(false);
  expect(pressedTwice("plan:rakes", () => undefined)).toBe(true);
  noKeysHeld();
});

test("a key held from the first press does not make the second, and a confirmation can be dropped", () => {
  noKeysHeld();
  let drawn = 0;
  const redraw = (): void => void drawn++;
  // Enter goes down and presses the button; held, the browser says it again and again.
  heldAgain({ code: "Enter", repeat: false });
  expect(pressedTwice("pull:grove:10", redraw)).toBe(false);
  for (const repeat of [true, true, false]) {
    heldAgain({ code: "Enter", repeat });
    expect(pressedTwice("pull:grove:10", redraw)).toBe(false);
  }
  expect(asking("pull:grove:10")).toBe(true);
  expect(drawn).toBe(1);
  // Let go and pressed again, it is a second press.
  noKeysHeld();
  heldAgain({ code: "Enter", repeat: false });
  expect(pressedTwice("pull:grove:10", redraw)).toBe(true);
  // Dropped (the pool or the screen changed), the button is drawn as it was, and asks again.
  noKeysHeld();
  pressedTwice("pull:grove:10", redraw);
  unask();
  expect(asking("pull:grove:10")).toBe(false);
  expect(drawn).toBe(3);
  expect(pressedTwice("pull:grove:10", redraw)).toBe(false);
  unask();
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
