import { afterEach, describe, expect, jest, test } from "bun:test";

import {
  asking,
  asksAgain,
  el,
  heard,
  mouseHeld,
  pressedTwice,
  type Spend,
  tappedTwice,
  unask,
  unheld,
  when,
} from "./dom.ts";
import { heldAgain, noKeysHeld } from "./keys.ts";
import { type Scope, scope } from "./scope.ts";
import { aPage, type Part } from "./standin.ts";

/** What the buttons are on in these tests: a panel that stays open. */
const panel = scope();

const MEADOW: Spend = { on: "plot:meadow", price: 900 };
const RAKES: Spend = { on: "plan:rakes", price: 40 };
const PULL: Spend = { on: "pull:grove:10", price: 1000 };
const FERN: Spend = { on: "seeds:fern", price: 30 };

/** A press lands on `on` (on no page, nothing in particular). */
const press = (on: EventTarget | null = null): void => heard({ is: "down", on });
/** A key goes down on `target`. */
const key = (code: string, repeat = false, target: EventTarget | null = null): void =>
  heard({ is: "key", key: { code, repeat, target } });
/** The press is over, and the tick after it has passed. */
async function over(): Promise<void> {
  heard({ is: "up" });
  await Bun.sleep(1);
}
/** `pressedTwice` for a new press on `on`. */
const pressOn = (on: EventTarget | null, life: Scope, spend: Spend, redraw: () => void): boolean => {
  press(on);
  return pressedTwice(life, spend, redraw);
};

/** A button drawn by nothing: these presses only ask what they are. */
const undrawn = (): void => undefined;

test("a button that spends is done on its second press, and goes back if it is left alone", () => {
  noKeysHeld();
  jest.useFakeTimers();
  let drawn = 0;
  const redraw = (): void => void drawn++;
  expect(pressOn(null, panel, MEADOW, redraw)).toBe(false);
  expect(asking(MEADOW)).toBe(true);
  expect(drawn).toBe(1);
  expect(pressOn(null, panel, MEADOW, redraw)).toBe(true);
  expect(asking(MEADOW)).toBe(false);
  // Another button pressed in between: the first is no longer waiting.
  pressOn(null, panel, MEADOW, redraw);
  expect(pressOn(null, panel, RAKES, redraw)).toBe(false);
  expect(asking(MEADOW)).toBe(false);
  // Left alone for four seconds, it is drawn as it was.
  const before = drawn;
  jest.advanceTimersByTime(4000);
  expect(asking(RAKES)).toBe(false);
  expect(drawn).toBe(before + 1);
  jest.useRealTimers();
});

test("a second press is for the same thing at the same price: another thing, or a new price, only asks", () => {
  noKeysHeld();
  // Pressed once over one belt; the area marked is now two others.
  expect(pressOn(null, panel, { on: "upgrade:18,13,18,13", price: 40 }, undrawn)).toBe(false);
  expect(pressOn(null, panel, { on: "upgrade:19,13,20,13", price: 80 }, undrawn)).toBe(false);
  // The same area, at a price that changed between the presses.
  expect(pressOn(null, panel, { on: "upgrade:19,13,20,13", price: 120 }, undrawn)).toBe(false);
  expect(asking({ on: "upgrade:19,13,20,13", price: 80 })).toBe(false);
  expect(asking({ on: "upgrade:19,13,20,13", price: 120 })).toBe(true);
  expect(pressOn(null, panel, { on: "upgrade:19,13,20,13", price: 120 }, undrawn)).toBe(true);
});

test("a key that presses no button, held through both presses, does not stop the second", () => {
  noKeysHeld();
  // Shift is down the whole time, as when placing several pieces in the Works; the mouse presses twice.
  heldAgain({ code: "ShiftLeft", repeat: false });
  expect(pressOn(null, panel, RAKES, undrawn)).toBe(false);
  expect(pressOn(null, panel, RAKES, undrawn)).toBe(true);
  noKeysHeld();
});

test("only the very next press is a second one: any press between, on anything, makes the next a first", () => {
  noKeysHeld();
  expect(pressOn(null, panel, PULL, undrawn)).toBe(false);
  // History, Back to town, a tab, empty space: a press the button does not hear.
  press();
  expect(pressOn(null, panel, PULL, undrawn)).toBe(false);
  expect(pressOn(null, panel, PULL, undrawn)).toBe(true);
  // One press heard twice (a press's own handler asking again) is still the first.
  expect(pressOn(null, panel, PULL, undrawn)).toBe(false);
  expect(pressedTwice(panel, PULL, undrawn)).toBe(false);
  expect(asking(PULL)).toBe(true);
  expect(pressOn(null, panel, PULL, undrawn)).toBe(true);
});

test("Enter asks, and the next Enter does it; Tab between moves the keyboard and presses nothing", () => {
  noKeysHeld();
  key("Enter");
  expect(pressedTwice(panel, FERN, undrawn)).toBe(false);
  noKeysHeld();
  key("Tab");
  key("Space");
  expect(pressedTwice(panel, FERN, undrawn)).toBe(true);
  noKeysHeld();
});

test("a key held from the first press does not make the second, and leaving what it is on drops it", () => {
  noKeysHeld();
  let drawn = 0;
  const redraw = (): void => void drawn++;
  const banner = scope();
  // Enter goes down and presses the button; held, the browser says it again and again.
  key("Enter");
  expect(pressedTwice(banner, PULL, redraw)).toBe(false);
  for (const repeat of [true, true, false]) {
    key("Enter", repeat);
    expect(pressedTwice(banner, PULL, redraw)).toBe(false);
  }
  expect(asking(PULL)).toBe(true);
  expect(drawn).toBe(1);
  // Let go and pressed again, it is a second press.
  noKeysHeld();
  key("Enter");
  expect(pressedTwice(banner, PULL, redraw)).toBe(true);
  // Left (the pool or the screen changed), it no longer asks, and the next press there is a first.
  noKeysHeld();
  pressOn(null, banner, PULL, redraw);
  banner.close();
  expect(asking(PULL)).toBe(false);
  const next = scope();
  expect(pressOn(null, next, PULL, redraw)).toBe(false);
  next.close();
});

test("a click no press made (a screen reader's) is a press of its own; the clicks a held key makes are not", () => {
  noKeysHeld();
  // A screen reader presses the button twice, by clicks alone.
  heard({ is: "click", on: null });
  expect(pressedTwice(panel, MEADOW, undrawn)).toBe(false);
  heard({ is: "click", on: null });
  expect(pressedTwice(panel, MEADOW, undrawn)).toBe(true);
  // Enter held on a button clicks it again and again: one press.
  key("Enter");
  heard({ is: "click", on: null });
  expect(pressedTwice(panel, MEADOW, undrawn)).toBe(false);
  for (const repeat of [true, true]) {
    key("Enter", repeat);
    heard({ is: "click", on: null });
    expect(pressedTwice(panel, MEADOW, undrawn)).toBe(false);
  }
  noKeysHeld();
  expect(asking(MEADOW)).toBe(true);
});

test("a button waits only while what it is on is open: put away and opened again, one press asks again", () => {
  noKeysHeld();
  jest.useFakeTimers();
  let drawn = 0;
  const redraw = (): void => void drawn++;
  // The Seeds panel: an exchange is pressed once, and the panel is put away.
  const seeds = scope();
  expect(pressOn(null, seeds, FERN, redraw)).toBe(false);
  seeds.close();
  expect(asking(FERN)).toBe(false);
  // Opened again within the four seconds: the same offer, pressed once, only asks.
  const reopened = scope();
  expect(pressOn(null, reopened, FERN, redraw)).toBe(false);
  expect(pressOn(null, reopened, FERN, redraw)).toBe(true);
  // A button left on what was put away does nothing, and waits for nothing.
  expect(pressOn(null, seeds, FERN, redraw)).toBe(false);
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
  expect(pressOn(null, banner, PULL, () => drawn.push("banner"))).toBe(false);
  expect(pressOn(null, book, FERN, () => drawn.push("book"))).toBe(false);
  expect(drawn).toEqual(["banner", "banner", "book"]);
  expect([asking(PULL), asking(FERN)]).toEqual([false, true]);
  // The same spend on the other panel is a first press there.
  expect(pressOn(null, banner, FERN, () => drawn.push("banner"))).toBe(false);
  banner.close();
  book.close();
});

/** A part of the page holding one button for `spend`, drawn again by `draw` as it is now: asking or not. */
function shelf(body: Part, spend: Spend, label: string, question: string) {
  const holder = el("div");
  body.appendChild(holder);
  let drawnNow: HTMLElement = el("button");
  let draws = 0;
  const draw = (): void => {
    draws++;
    drawnNow = el("button", "k-btn", { type: "button" }, asksAgain(spend, [label], question));
    holder.replaceChildren(drawnNow);
  };
  draw();
  return { holder, draw, button: (): HTMLElement => drawnNow, draws: (): number => draws };
}

describe("on a page, the second press is only on a button that shows the question", () => {
  let page: ReturnType<typeof aPage> | null = null;
  afterEach(() => {
    // A test may end while a button still asks: put it away while the page is there, or its wait
    // ends in a later test, with no page to draw on.
    unask();
    page?.done();
    page = null;
  });

  test("pressed twice in a row with the mouse, or with Enter, it is done", async () => {
    page = aPage();
    noKeysHeld();
    const pull = shelf(page.body, PULL, "Pull 10", "Pull?");
    expect(pressOn(pull.button(), panel, PULL, pull.draw)).toBe(false);
    await over();
    expect(asking(PULL)).toBe(true);
    expect(pressOn(pull.button(), panel, PULL, pull.draw)).toBe(true);
    await over();
    // Enter on the button, then Enter again once let go.
    key("Enter", false, pull.button());
    expect(pressedTwice(panel, PULL, pull.draw)).toBe(false);
    noKeysHeld();
    await over();
    key("Enter", false, pull.button());
    expect(pressedTwice(panel, PULL, pull.draw)).toBe(true);
    noKeysHeld();
  });

  test("Pull 10 pressed once, History opened and put away, Pull 10 pressed once: it only asks", async () => {
    page = aPage();
    noKeysHeld();
    const banner = scope();
    const pull = shelf(page.body, PULL, "Pull 10", "Pull?");
    const history = el("button", "k-btn", { text: "History" });
    const close = el("button", "k-btn", { text: "Close" });
    page.body.append(history, close);
    expect(pressOn(pull.button(), banner, PULL, pull.draw)).toBe(false);
    await over();
    // History opens: the button no longer asks, and is drawn so once the press is over.
    press(history);
    expect(asking(PULL)).toBe(true);
    await over();
    expect(asking(PULL)).toBe(false);
    expect(pull.draws()).toBe(3);
    press(close);
    await over();
    expect(pressOn(pull.button(), banner, PULL, pull.draw)).toBe(false);
    await over();
    expect(pressOn(pull.button(), banner, PULL, pull.draw)).toBe(true);
    banner.close();
  });

  test("an exchange in Seeds pressed once, Back to town, and the Grove opened again: one press only asks", async () => {
    page = aPage();
    noKeysHeld();
    const grove = scope();
    let book = grove.child();
    const fern = shelf(page.body, FERN, "30 Seeds", "Exchange?");
    const back = el("button", "k-btn", { text: "Back to town" });
    page.body.append(back);
    expect(pressOn(fern.button(), book, FERN, fern.draw)).toBe(false);
    await over();
    // Back to town is pressed; the panel is still the same when the Grove is opened again.
    press(back);
    await over();
    expect(asking(FERN)).toBe(false);
    press(page.body);
    await over();
    expect(pressOn(fern.button(), book, FERN, fern.draw)).toBe(false);
    book.close();
    book = grove.child();
    await over();
    expect(pressOn(fern.button(), book, FERN, fern.draw)).toBe(false);
    await over();
    expect(pressOn(fern.button(), book, FERN, fern.draw)).toBe(true);
    grove.close();
  });

  test("a press on a button that does not show the question is a first press, so what it does not show it never does", async () => {
    page = aPage();
    noKeysHeld();
    const meadow = shelf(page.body, MEADOW, "Buy for 900", "Press again to buy");
    const stale = meadow.button();
    // Asked, but drawn by nothing: the button the player sees still says "Buy for 900".
    expect(pressOn(stale, panel, MEADOW, undrawn)).toBe(false);
    expect(asking(MEADOW)).toBe(true);
    expect(pressOn(stale, panel, MEADOW, undrawn)).toBe(false);
    await over();
    // Drawn asking, then hidden with what holds it, or put away: still a first press.
    expect(pressOn(stale, panel, MEADOW, meadow.draw)).toBe(false);
    meadow.holder.hidden = true;
    expect(pressOn(meadow.button(), panel, MEADOW, meadow.draw)).toBe(false);
    meadow.holder.hidden = false;
    await over();
    const shown = meadow.button();
    shown.remove();
    expect(pressOn(shown, panel, MEADOW, meadow.draw)).toBe(false);
    await over();
    // On the question as it shows: done.
    expect(pressOn(meadow.button(), panel, MEADOW, meadow.draw)).toBe(true);
  });

  test("a button still showing its question once it was done, not drawn again, asks and then does it again", async () => {
    page = aPage();
    noKeysHeld();
    const reroll = shelf(page.body, RAKES, "Reroll", "Reroll?");
    expect(pressOn(reroll.button(), panel, RAKES, reroll.draw)).toBe(false);
    await over();
    expect(pressOn(reroll.button(), panel, RAKES, undrawn)).toBe(true);
    await over();
    // Nothing drew it again (refused, say): it still says "Reroll?", and nothing new is drawn as it asks.
    expect(pressOn(reroll.button(), panel, RAKES, undrawn)).toBe(false);
    await over();
    expect(pressOn(reroll.button(), panel, RAKES, undrawn)).toBe(true);
  });

  test("a press on another button, or on nothing, stops it asking once the press is over", async () => {
    page = aPage();
    noKeysHeld();
    const rakes = shelf(page.body, RAKES, "Upgrade", "Press again");
    const tab = el("button", "k-btn", { role: "tab", text: "Orders" });
    page.body.append(tab);
    const leftFor = async (elsewhere: EventTarget): Promise<void> => {
      expect(pressOn(rakes.button(), panel, RAKES, rakes.draw)).toBe(false);
      await over();
      press(elsewhere);
      // Not drawn again under the press: once it is over.
      expect(asking(RAKES)).toBe(true);
      await over();
      expect(asking(RAKES)).toBe(false);
      expect(pressOn(rakes.button(), panel, RAKES, rakes.draw)).toBe(false);
      await over();
      expect(pressOn(rakes.button(), panel, RAKES, rakes.draw)).toBe(true);
      await over();
    };
    await leftFor(tab);
    await leftFor(page.body);
  });

  test("the keyboard on a button that stops asking stays on the button drawn in its place", async () => {
    page = aPage();
    noKeysHeld();
    const reroll = shelf(page.body, RAKES, "Reroll", "Reroll?");
    jest.useFakeTimers();
    key("Enter", false, reroll.button());
    reroll.button().focus();
    expect(pressedTwice(panel, RAKES, reroll.draw)).toBe(false);
    noKeysHeld();
    const asked = reroll.button();
    asked.focus();
    jest.advanceTimersByTime(4000);
    jest.useRealTimers();
    expect(asking(RAKES)).toBe(false);
    expect(reroll.button()).not.toBe(asked);
    expect(document.activeElement).toBe(reroll.button());
    // Pressed elsewhere, the keyboard went with the press: it is left there.
    key("Enter", false, reroll.button());
    expect(pressedTwice(panel, RAKES, reroll.draw)).toBe(false);
    noKeysHeld();
    const tab = el("button", "k-btn", { text: "News" });
    page.body.append(tab);
    tab.focus();
    press(tab);
    await over();
    expect(document.activeElement).toBe(tab);
  });

  test("a finger on the question stays a second press until its click comes, after the lift", async () => {
    page = aPage();
    noKeysHeld();
    const pull = shelf(page.body, PULL, "Pull 10", "Pull?");
    expect(pressOn(pull.button(), panel, PULL, pull.draw)).toBe(false);
    await over();
    press(pull.button());
    await over();
    heard({ is: "click", on: pull.button() });
    expect(pressedTwice(panel, PULL, pull.draw)).toBe(true);
  });

  test("a spend taken by taps is done by two taps in a row on the yard, and not past a press on a button", async () => {
    page = aPage();
    noKeysHeld();
    const yard = el("canvas");
    page.body.appendChild(yard);
    const place = shelf(page.body, PULL, "Place", "Press again");
    const rotate = el("button", "k-btn", { text: "Rotate" });
    page.body.append(rotate);
    const tap = (on: EventTarget): boolean => {
      press(on);
      return tappedTwice(panel, PULL, place.draw);
    };
    expect([tap(yard), tap(yard)]).toEqual([false, true]);
    await over();
    // Asked by a tap, done on the dock's Place showing the question; or asked there, done by a tap.
    expect([tap(yard), tap(place.button())]).toEqual([false, true]);
    await over();
    expect([tap(place.button()), tap(yard)]).toEqual([false, true]);
    await over();
    // A button pressed between, or one that does not show the question: a first press.
    expect(tap(yard)).toBe(false);
    press(rotate);
    await over();
    expect([tap(yard), tap(yard)]).toEqual([false, true]);
    await over();
    expect(tap(yard)).toBe(false);
    expect(tap(rotate)).toBe(false);
    // A spend not taken by taps is never done by one.
    await over();
    expect([pressOn(yard, panel, MEADOW, undrawn), pressOn(yard, panel, MEADOW, undrawn)]).toEqual([false, false]);
  });
  test("a key that is not Enter, Space or Tab is a press on nothing: Orders opened by O and shut by Escape, and Enter only asks", async () => {
    page = aPage();
    noKeysHeld();
    const up = shelf(page.body, RAKES, "Upgrade", "Press again");
    key("Enter", false, up.button());
    expect(pressedTwice(panel, RAKES, up.draw)).toBe(false);
    noKeysHeld();
    await over();
    key("KeyO", false, up.button());
    noKeysHeld();
    await over();
    expect(asking(RAKES)).toBe(false);
    key("Escape", false, up.button());
    noKeysHeld();
    await over();
    key("Enter", false, up.button());
    expect(pressedTwice(panel, RAKES, up.draw)).toBe(false);
    noKeysHeld();
  });

  test("a finger that scrolls from the question makes no click: the ask goes, and a click after it is a first press", async () => {
    page = aPage();
    noKeysHeld();
    const fern = shelf(page.body, FERN, "Exchange", "Exchange?");
    expect(pressOn(fern.button(), panel, FERN, fern.draw)).toBe(false);
    await over();
    press(fern.button());
    heard({ is: "cancel" });
    await Bun.sleep(1);
    expect(asking(FERN)).toBe(false);
    heard({ is: "click", on: fern.button() });
    expect(pressedTwice(panel, FERN, fern.draw)).toBe(false);
    await over();
  });

  test("a click on something other than what the press landed on is a press of its own", async () => {
    page = aPage();
    noKeysHeld();
    const pull = shelf(page.body, PULL, "Pull 10", "Pull?");
    const empty = el("div");
    page.body.appendChild(empty);
    expect(pressOn(pull.button(), panel, PULL, pull.draw)).toBe(false);
    await over();
    // A mouse button held down on nothing, and a click no press made on the question before it is let go.
    press(empty);
    heard({ is: "click", on: pull.button() });
    expect(pressedTwice(panel, PULL, pull.draw)).toBe(false);
    await over();
  });
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
