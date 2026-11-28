/**
 * A redwood's card, on the page against a stand-in Leaf: on the yard's own plot, once felling is
 * studied, it has Fell, at its price now (dearer for each redwood the yard has felled), which asks to
 * be pressed again and then fells it, sending Leaf the command; drawn short of Coins it fells nothing
 * and says why. Before felling is studied it says so, and has no Fell. A redwood on a plot the yard
 * does not own asks about the plot.
 */
import { expect, test } from "bun:test";

import {
  at,
  buyPlot,
  create,
  fell as fellTree,
  fellPrice,
  goal,
  plot,
  plotPrice,
  redwoodAt,
  type Yard,
} from "@sequoia-leaf/factory";
import { learn } from "@sequoia-leaf/factory/test/goals.ts";
import { near, xy } from "@sequoia-leaf/factory/test/near.ts";
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

/** A yard in tier 5 that owns the Meadow, where a redwood stands at 22, 33: felling studied, unless said. */
function meadow(felling = true): Yard {
  const y = create({ seed: 5, tier: 5 });
  if (!buyPlot(y, plot("meadow"), 300, Infinity).ok) throw new Error("the Meadow was not bought");
  if (felling) learn(y, goal("felling"));
  return y;
}

/** The redwood card for a tile, as the page prints and draws it. */
function cardAt(x: number, y: number, refused: string[] = []) {
  const ref = refAt(x, y);
  const print = ref ? printOf(ref) : null;
  if (!ref || print?.card !== "ground") throw new Error("no ground card");
  return { ref, print, card: groundCard(print, { fell: fellAt, refuse: (why) => void refused.push(why) }) };
}

test("on the yard's own plot, the first Fell costs 1,000 Coins and asks to be pressed again; the second press fells it and tells Leaf", async () => {
  const fake = await opened(meadow(), 1_000);
  const page = aPage();
  const { ref, print, card } = cardAt(...xy(-1, 16));
  expect([card.name, print]).toEqual([
    "Redwood",
    {
      card: "ground",
      ground: "redwood",
      fell: { ...near(-1, 16), price: 1000, short: 0 },
      locked: null,
      clears: "Clears 120 smog /min from this plot.",
    },
  ]);
  const [fell] = card.actions ?? [];
  if (!fell) throw new Error("no Fell");
  expect([fell.label, fell.ask]).toEqual(["Fell", { again: "Press again to fell", price: 1000 }]);
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
  const tile = at(S.world, ...xy(-2, 15));
  expect([redwoodAt(S.world, tile), S.felling.has(S.world.land.tree[tile] ?? -1)]).toEqual([false, true]);
  await until(() => fake.leaf.commands.some((c) => isRecord(c) && c.do === "fell"));
  expect(fake.leaf.commands.filter((c) => isRecord(c) && c.do === "fell")).toEqual([
    expect.objectContaining({ do: "fell", ...near(-1, 16) }),
  ]);
  // Gone, the tile has no card: it is ground like any other.
  expect(refAt(...xy(-2, 15))).toBeNull();
});

test("drawn short of Coins, Fell says how many more and fells nothing", async () => {
  await opened(meadow(), 400);
  const page = aPage();
  const refused: string[] = [];
  const { card } = cardAt(...xy(-2, 15), refused);
  expect(card.blocks).toEqual([{ body: "Clears 120 smog /min from this plot." }, { body: "You need 600 Coins more." }]);
  const [fell] = card.actions ?? [];
  if (!fell) throw new Error("no Fell");
  expect(fell.ask).toBeUndefined();
  fell.on(el("button"));
  expect([redwoodAt(S.world, at(S.world, ...xy(-2, 15))), refused]).toEqual([true, ["Not enough Coins"]]);
  page.done();
});

test("with a redwood felled before, the card's Fell is at the next one's price, half as much again", async () => {
  const y = meadow();
  // Every plot it may buy, the Clay Bank among them, and the Clay Bank's redwood felled.
  for (let more = true; more;) {
    more = false;
    for (const p of y.land.plots)
      if (!y.plots.includes(p.plot) && buyPlot(y, p.plot, plotPrice(y, p.plot), Infinity).ok) more = true;
  }
  if (!fellTree(y, ...xy(-14, -4), fellPrice(y), Infinity).ok)
    throw new Error("the Clay Bank's redwood was not felled");
  await opened(y, 5_000);
  const page = aPage();
  const { print, card } = cardAt(...xy(-2, 15));
  expect(print).toMatchObject({ fell: { price: 1500, short: 0 } });
  expect(card.actions?.[0]?.ask).toEqual({ again: "Press again to fell", price: 1500 });
  page.done();
});

test("before felling is studied, the card says so and has no Fell", async () => {
  await opened(meadow(false), 5_000);
  const { print, card } = cardAt(...xy(-2, 15));
  expect(print).toEqual({
    card: "ground",
    ground: "redwood",
    fell: null,
    locked: "Felling is not unlocked yet",
    clears: "Clears 120 smog /min from this plot.",
  });
  expect([card.blocks, card.actions]).toEqual([
    [{ body: "Clears 120 smog /min from this plot." }, { body: "Felling is not unlocked yet." }],
    [],
  ]);
});

test("a redwood on a plot the yard does not own asks about the plot", async () => {
  await opened(meadow(), 1_000);
  expect(refAt(...xy(-14, -4))).toBe(plotRef(plot("bank")));
});
