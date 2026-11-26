/**
 * A redwood's card, on the page against a stand-in Leaf: on the yard's own plot it has Fell, at its
 * price, which asks to be pressed again and then fells it, sending Leaf the command; drawn short of
 * Coins it fells nothing and says why. A redwood on a plot the yard does not own asks about the plot.
 */
import { expect, test } from "bun:test";

import { at, buyPlot, create, plot, redwoodAt, type Yard } from "@sequoia-leaf/factory";
import { Deck } from "@sequoia-leaf/kit/card.ts";
import { el } from "@sequoia-leaf/kit/dom.ts";
import { aPage, press } from "@sequoia-leaf/kit/standin.ts";

import { isRecord, opened, until, useFakeLeaf } from "../../test/fake-leaf.ts";
import { S } from "../state.ts";
import { fellAt } from "../trees.ts";
import { refAt } from "./card.ts";
import { groundCard } from "./land.ts";
import { printOf } from "./prints.ts";
import { plotRef } from "./refs.ts";

useFakeLeaf();

/** A yard at tier 1 that owns the Meadow, where a redwood stands at 22, 33. */
function meadow(): Yard {
  const y = create({ seed: 5, tier: 1 });
  if (!buyPlot(y, plot("meadow"), Infinity).ok) throw new Error("the Meadow was not bought");
  return y;
}

/** The redwood card for a tile, as the page prints and draws it. */
function cardAt(x: number, y: number, refused: string[] = []) {
  const ref = refAt(x, y);
  const print = ref ? printOf(ref) : null;
  if (!ref || print?.card !== "ground") throw new Error("no ground card");
  return { ref, print, card: groundCard(print, { fell: fellAt, refuse: (why) => void refused.push(why) }) };
}

test("on the yard's own plot, Fell costs 100 Coins and asks to be pressed again; the second press fells it and tells Leaf", async () => {
  const fake = await opened(meadow(), 1_000);
  const page = aPage();
  const { ref, print, card } = cardAt(23, 34);
  expect([card.name, print]).toEqual([
    "Redwood",
    { card: "ground", ground: "redwood", fell: { x: 23, y: 34, price: 100, short: 0 } },
  ]);
  const [fell] = card.actions ?? [];
  if (!fell) throw new Error("no Fell");
  expect([fell.label, fell.ask]).toEqual(["Fell", { again: "Press again to fell", price: 100 }]);
  const button = el("button");
  page.done();
  // The page's cards, on a deck that draws nothing.
  const deck = new Deck({ render: () => undefined });
  deck.register("tile", () => card);
  deck.press(ref, {}, "mouse", {});
  press();
  expect(deck.confirms(fell, () => undefined)).toBe(false);
  press();
  expect(deck.confirms(fell, () => undefined)).toBe(true);
  fell.on(button);
  const tile = at(S.world, 22, 33);
  expect([redwoodAt(S.world, tile), S.felling.has(S.world.land.tree[tile] ?? -1)]).toEqual([false, true]);
  await until(() => fake.leaf.commands.some((c) => isRecord(c) && c.do === "fell"));
  expect(fake.leaf.commands.filter((c) => isRecord(c) && c.do === "fell")).toEqual([
    expect.objectContaining({ do: "fell", x: 23, y: 34 }),
  ]);
  // Gone, the tile has no card: it is ground like any other.
  expect(refAt(22, 33)).toBeNull();
});

test("drawn short of Coins, Fell says how many more and fells nothing", async () => {
  await opened(meadow(), 40);
  const page = aPage();
  const refused: string[] = [];
  const { card } = cardAt(22, 33, refused);
  expect(card.blocks).toEqual([{ body: "You need 60 Coins more." }]);
  const [fell] = card.actions ?? [];
  if (!fell) throw new Error("no Fell");
  expect(fell.ask).toBeUndefined();
  fell.on(el("button"));
  expect([redwoodAt(S.world, at(S.world, 22, 33)), refused]).toEqual([true, ["Not enough Coins"]]);
  page.done();
});

test("a redwood on a plot the yard does not own asks about the plot", async () => {
  await opened(meadow(), 1_000);
  expect(refAt(10, 14)).toBe(plotRef(plot("bank")));
});
