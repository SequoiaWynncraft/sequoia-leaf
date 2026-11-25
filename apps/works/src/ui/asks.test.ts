/**
 * A button that spends asks to be pressed again, on the page against a stand-in Leaf: the second
 * press does it only for the thing the first was for, at the price the first was quoted, while the
 * player still looks at it. Marking another area, or putting a blueprint down and taking it up
 * again, makes the next press a first one (`handSession`); so does an order's panel shut and opened
 * again, for its Swap, and a plot's card that has followed what lies in its ground and come back,
 * for its Buy.
 */
import { expect, test } from "bun:test";

import { ALL_ITEMS, at, BELT, build, create, plot, type Yard } from "@sequoia-leaf/factory";
import { Deck } from "@sequoia-leaf/kit/card.ts";
import { pressedTwice } from "@sequoia-leaf/kit/dom.ts";
import { scope } from "@sequoia-leaf/kit/scope.ts";

import { ctx, type FakeLeaf, isRecord, opened, useFakeLeaf } from "../../test/fake-leaf.ts";
import { askSave, deleteKey, saveIn } from "../plans.ts";
import { handSession, S } from "../state.ts";
import { cancel, hold, markEnd, markOver, markStart, setTool } from "../tools.ts";
import { handPrint, pressUpgrade } from "./dock.ts";
import { plotCard } from "./land.ts";
import { swapPressed } from "./panels.ts";
import { printOf } from "./prints.ts";
import { itemRef, plotRef } from "./refs.ts";

useFakeLeaf();

/** A yard Leaf has, with every goal of the tiers below `tier` done; nothing in hand, and a mouse. */
function yardAt(tier: number): Yard {
  const y = create({ seed: 5, tier });
  y.at = ctx().now;
  S.finger = false;
  setTool(null);
  return y;
}

/** Marks the pieces between two corners with Select. */
function mark(x0: number, y0: number, x1: number, y1: number): void {
  setTool("select");
  markStart(x0, y0);
  markOver(x1, y1);
  markEnd();
}

const redraw = (): void => undefined;
const grades = (xs: readonly number[], z: number): number[] => xs.map((x) => S.world.grade[at(S.world, x, z)] ?? 0);
/** What was sent to Leaf, by what each command does. */
const sent = (fake: FakeLeaf): unknown[] => fake.leaf.commands.map((c) => (isRecord(c) ? c.do : null));

test("Upgrade pressed once over one area, then pressed over another, only asks: it raises the second area on its own second press", async () => {
  const y = yardAt(4);
  for (const x of [18, 19, 20]) build(y, BELT, x, 13, 0, Infinity);
  const fake = await opened(y, 100_000);
  mark(18, 13, 18, 13);
  pressUpgrade(false);
  expect(handPrint().upgrade).toMatchObject({ asking: true });
  // Two other belts marked within the four seconds: the button is theirs, at their price, and asks afresh.
  mark(19, 13, 20, 13);
  expect(handPrint().upgrade).toMatchObject({ asking: false });
  pressUpgrade(false);
  expect(grades([18, 19, 20], 13)).toEqual([1, 1, 1]);
  expect(handPrint().upgrade).toMatchObject({ asking: true });
  pressUpgrade(false);
  expect(grades([18, 19, 20], 13)).toEqual([1, 2, 2]);
  await Bun.sleep(5);
  expect(sent(fake)).toEqual(["upgrade"]);
});

test("Upgrade asked over an area, marked again over the same area after another, asks again", async () => {
  const y = yardAt(4);
  for (const x of [18, 19]) build(y, BELT, x, 13, 0, Infinity);
  await opened(y, 100_000);
  mark(18, 13, 18, 13);
  pressUpgrade(false);
  mark(19, 13, 19, 13);
  mark(18, 13, 18, 13);
  pressUpgrade(false);
  expect(grades([18, 19], 13)).toEqual([1, 1]);
  pressUpgrade(false);
  expect(grades([18, 19], 13)).toEqual([2, 1]);
});

/** A yard with blueprints: a row of belts kept as the blueprint in its first place. */
async function withBlueprint(): Promise<void> {
  const y = yardAt(6);
  for (const x of [18, 19, 20]) build(y, BELT, x, 13, 0, Infinity);
  await opened(y, 100_000);
  expect(S.world.open.blueprints).toBeGreaterThan(0);
  mark(18, 13, 20, 13);
  askSave();
  saveIn(0);
  expect(S.world.blueprints[0]).toBeTruthy();
}

test("Delete asked on a blueprint in hand, put down and taken up again, asks again", async () => {
  await withBlueprint();
  setTool("select");
  hold(0);
  expect(S.group?.as).toBe(0);
  expect(pressedTwice(handSession(), deleteKey(0), redraw)).toBe(false);
  expect(handPrint().bin).toMatchObject({ asking: true });
  // Put down (Escape), and taken up again from its place.
  cancel();
  expect(S.group).toBeNull();
  hold(0);
  expect(handPrint().bin).toMatchObject({ slot: 0, asking: false });
  expect(pressedTwice(handSession(), deleteKey(0), redraw)).toBe(false);
  expect(pressedTwice(handSession(), deleteKey(0), redraw)).toBe(true);
});

test("Swap on an order given something asks while its panel is open: shut and opened again, one press only asks", () => {
  const y = create({ seed: 3, tier: 4 });
  S.world = y;
  const order = y.board[0];
  if (!order) throw new Error("no board");
  // Given nothing, it goes at once.
  expect(swapPressed(scope(), order.id, redraw)).toBe(true);
  const first = ALL_ITEMS.find((n) => (order.want[n] ?? 0) > 1);
  if (first === undefined) throw new Error("an order that wants nothing");
  order.filled[first] = 1;
  const panel = scope();
  expect(swapPressed(panel, order.id, redraw)).toBe(false);
  // The panel shut, and opened again within the four seconds.
  panel.close();
  const reopened = scope();
  expect(swapPressed(reopened, order.id, redraw)).toBe(false);
  // More given between the presses: what a swap loses has changed, and it asks again.
  order.filled[first] = 2;
  expect(swapPressed(reopened, order.id, redraw)).toBe(false);
  expect(swapPressed(reopened, order.id, redraw)).toBe(true);
});

/** Just enough of an element for a card's words and pictures: it takes what it is given and holds nothing. */
class Part extends EventTarget {
  className = "";
  textContent = "";
  readonly style = { setProperty: (): void => undefined };
  readonly setAttribute = (): void => undefined;
  readonly appendChild = <T>(kid: T): T => kid;
}

test("Buy on a plot's card, pressed once, asks again after the card follows what lies in its ground and comes back", async () => {
  await opened(yardAt(3), 1_000);
  const ref = plotRef(plot("meadow"));
  const print = printOf(ref);
  if (print?.card !== "plot") throw new Error("no plot card");
  // Its card, drawn once on a page that holds nothing.
  const doc = { createElement: () => new Part(), createTextNode: () => new Part() };
  Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
  const card = plotCard(print, () => true);
  Reflect.deleteProperty(globalThis, "document");
  const [buy] = card.actions ?? [];
  const [inGround] = print.ground;
  if (!buy || !inGround) throw new Error("a plot with nothing to buy or nothing in its ground");
  // The page's cards, on a deck that draws nothing.
  const deck = new Deck({ render: () => undefined });
  deck.register("plot", () => card);
  deck.register("item", (id) => ({ name: id }));
  deck.press(ref, {}, "mouse", {});
  expect(deck.confirms(buy, redraw)).toBe(false);
  // Following one of its "In the ground" links, then Back.
  expect(deck.follow(itemRef(inGround[0]))).toBe(true);
  expect(deck.back()).toBe(true);
  expect(deck.confirms(buy, redraw)).toBe(false);
  // Drawn again where it is (the Coins came in), it is the same card: the second press buys.
  deck.refresh();
  expect(deck.confirms(buy, redraw)).toBe(true);
});
