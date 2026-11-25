import { describe, expect, jest, test } from "bun:test";

import { asking, mouseHeld, pressedTwice, type Spend, unheld, when } from "./dom.ts";
import { heldAgain, noKeysHeld } from "./keys.ts";
import { scope } from "./scope.ts";

/** What the buttons are on in these tests: a panel that stays open. */
const panel = scope();

const MEADOW: Spend = { on: "plot:meadow", price: 900 };
const RAKES: Spend = { on: "plan:rakes", price: 40 };
const PULL: Spend = { on: "pull:grove:10", price: 1000 };
const FERN: Spend = { on: "seeds:fern", price: 30 };

test("a button that spends is done on its second press, and goes back if it is left alone", () => {
  noKeysHeld();
  jest.useFakeTimers();
  let drawn = 0;
  const redraw = (): void => void drawn++;
  expect(pressedTwice(panel, MEADOW, redraw)).toBe(false);
  expect(asking(MEADOW)).toBe(true);
  expect(drawn).toBe(1);
  expect(pressedTwice(panel, MEADOW, redraw)).toBe(true);
  expect(asking(MEADOW)).toBe(false);
  // Another button pressed in between: the first is no longer waiting.
  pressedTwice(panel, MEADOW, redraw);
  expect(pressedTwice(panel, RAKES, redraw)).toBe(false);
  expect(asking(MEADOW)).toBe(false);
  // Left alone for four seconds, it is drawn as it was.
  const before = drawn;
  jest.advanceTimersByTime(4000);
  expect(asking(RAKES)).toBe(false);
  expect(drawn).toBe(before + 1);
  jest.useRealTimers();
});

/** A button drawn by nothing: these presses only ask what they are. */
const undrawn = (): void => undefined;

test("a second press is for the same thing at the same price: another thing, or a new price, only asks", () => {
  noKeysHeld();
  // Pressed once over one belt; the area marked is now two others.
  expect(pressedTwice(panel, { on: "upgrade:18,13,18,13", price: 40 }, undrawn)).toBe(false);
  expect(pressedTwice(panel, { on: "upgrade:19,13,20,13", price: 80 }, undrawn)).toBe(false);
  // The same area, at a price that changed between the presses.
  expect(pressedTwice(panel, { on: "upgrade:19,13,20,13", price: 120 }, undrawn)).toBe(false);
  expect(asking({ on: "upgrade:19,13,20,13", price: 80 })).toBe(false);
  expect(asking({ on: "upgrade:19,13,20,13", price: 120 })).toBe(true);
  expect(pressedTwice(panel, { on: "upgrade:19,13,20,13", price: 120 }, undrawn)).toBe(true);
});

test("a key that presses no button, held through both presses, does not stop the second", () => {
  noKeysHeld();
  // Shift is down the whole time, as when placing several pieces in the Works; the mouse presses twice.
  heldAgain({ code: "ShiftLeft", repeat: false });
  expect(pressedTwice(panel, RAKES, () => undefined)).toBe(false);
  expect(pressedTwice(panel, RAKES, () => undefined)).toBe(true);
  noKeysHeld();
});

test("a key held from the first press does not make the second, and leaving what it is on drops it", () => {
  noKeysHeld();
  let drawn = 0;
  const redraw = (): void => void drawn++;
  const banner = scope();
  // Enter goes down and presses the button; held, the browser says it again and again.
  heldAgain({ code: "Enter", repeat: false });
  expect(pressedTwice(banner, PULL, redraw)).toBe(false);
  for (const repeat of [true, true, false]) {
    heldAgain({ code: "Enter", repeat });
    expect(pressedTwice(banner, PULL, redraw)).toBe(false);
  }
  expect(asking(PULL)).toBe(true);
  expect(drawn).toBe(1);
  // Let go and pressed again, it is a second press.
  noKeysHeld();
  heldAgain({ code: "Enter", repeat: false });
  expect(pressedTwice(banner, PULL, redraw)).toBe(true);
  // Left (the pool or the screen changed), it no longer asks, and the next press there is a first.
  noKeysHeld();
  pressedTwice(banner, PULL, redraw);
  banner.close();
  expect(asking(PULL)).toBe(false);
  const next = scope();
  expect(pressedTwice(next, PULL, redraw)).toBe(false);
  next.close();
});

test("a button waits only while what it is on is open: put away and opened again, one press asks again", () => {
  noKeysHeld();
  jest.useFakeTimers();
  let drawn = 0;
  const redraw = (): void => void drawn++;
  // The Seeds panel: an exchange is pressed once, and the panel is put away.
  const seeds = scope();
  expect(pressedTwice(seeds, FERN, redraw)).toBe(false);
  seeds.close();
  expect(asking(FERN)).toBe(false);
  // Opened again within the four seconds: the same offer, pressed once, only asks.
  const reopened = scope();
  expect(pressedTwice(reopened, FERN, redraw)).toBe(false);
  expect(pressedTwice(reopened, FERN, redraw)).toBe(true);
  // A button left on what was put away does nothing, and waits for nothing.
  expect(pressedTwice(seeds, FERN, redraw)).toBe(false);
  expect(asking(FERN)).toBe(false);
  // The closed panel drew nothing as it went, and nothing is drawn when its four seconds are up.
  expect(drawn).toBe(2);
  jest.advanceTimersByTime(4000);
  expect(drawn).toBe(2);
  jest.useRealTimers();
});

test("a press on a button of another panel stops the first waiting, and draws the first as it was", () => {
  noKeysHeld();
  const drawn: string[] = [];
  const [banner, book] = [scope(), scope()];
  expect(pressedTwice(banner, PULL, () => drawn.push("banner"))).toBe(false);
  expect(pressedTwice(book, FERN, () => drawn.push("book"))).toBe(false);
  expect(drawn).toEqual(["banner", "banner", "book"]);
  expect([asking(PULL), asking(FERN)]).toEqual([false, true]);
  // The same spend on the other panel is a first press there.
  expect(pressedTwice(banner, FERN, () => drawn.push("banner"))).toBe(false);
  banner.close();
  book.close();
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
