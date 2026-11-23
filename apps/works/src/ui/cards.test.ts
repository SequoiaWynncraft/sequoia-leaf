/**
 * A card is kept by everything it prints. Its print is what it shows of the yard and the purse, as
 * plain values; the card that is up is drawn again when that differs, and the module that draws a
 * card from its print reaches no yard. So a value that changes alone (a machine's rate as power runs
 * short, the Coins a plot still needs) changes what the card is kept by.
 */
import { describe, expect, test } from "bun:test";

import {
  ALL_GOALS,
  ALL_ITEMS,
  ALL_KINDS,
  at,
  BENCH,
  build,
  create,
  DEPOT,
  item,
  plot,
  power,
  setRecipe,
  type Yard,
} from "@sequoia-leaf/factory";
import { fromLeaf } from "@sequoia-leaf/kit/purse.ts";

import { draws, S } from "../state.ts";
import { cardKey, itemRef, machineRef, nodeRef, orderRef, plotRef, tileRef } from "./card.ts";
import { printOf } from "./prints.ts";

/** A bench told to make tools, waiting for its planks and ingots, and `others` more benches drawing power near the depot. */
function benches(others: number): Yard {
  const y = create({ seed: 5, tier: 2 });
  build(y, BENCH, 20, 15, 0, Infinity);
  setRecipe(y, 20, 15, item("tool"));
  for (let k = 0; k < others; k++) build(y, BENCH, 18 + (k % 6) * 2, 21 + Math.floor(k / 6) * 2, 0, Infinity);
  return y;
}

describe("a card", () => {
  test("of a machine is kept by what it makes a minute: power run short changes it, though nothing else on the card does", () => {
    const ref = tileRef(at(S.world, 20, 15));
    const enough = benches(0);
    const short = benches(8);
    expect([power(enough).pace, power(short).pace < 1]).toEqual([1, true]);
    S.world = enough;
    const before = printOf(ref);
    const key = cardKey(ref);
    // The same count of changes: only power, which the card does not name, differs.
    S.world = short;
    const after = printOf(ref);
    expect(before).toMatchObject({ line: "Waiting for planks and ingots to make tools.", perMinute: 30 });
    expect(after).toMatchObject({ line: "Waiting for planks and ingots to make tools.", perMinute: 21 });
    expect(cardKey(ref)).not.toBe(key);
  });

  test("of the depot is whole: the page draws the depot, though nobody builds one, so its card is not a later kind's", () => {
    S.world = create({ seed: 5, tier: 1 });
    expect(draws(DEPOT)).toBe(true);
    expect(printOf(machineRef(DEPOT))).toMatchObject({ card: "machine", later: false, gives: S.world.open.depot });
    const [x, z] = S.world.land.depot;
    expect(printOf(tileRef(at(S.world, x, z)))).toMatchObject({ machine: { later: false } });
  });

  test("of a plot is kept by exactly how many Coins it still needs", () => {
    S.world = create({ seed: 5, tier: 3 });
    const ref = plotRef(plot("meadow"));
    fromLeaf(280);
    const key = cardKey(ref);
    expect(printOf(ref)).toMatchObject({ state: "for sale", price: 300, short: 20 });
    fromLeaf(270);
    expect(printOf(ref)).toMatchObject({ short: 30 });
    expect(cardKey(ref)).not.toBe(key);
    fromLeaf(0);
  });

  test("prints plain values only, read back as they are: every card of a yard with a piece of each kind it can stand", () => {
    const y = create({ seed: 5, tier: 4 });
    ALL_KINDS.forEach((k, n) => build(y, k, 17 + (n % 7) * 2, 13 + Math.floor(n / 7) * 2, 0, Infinity));
    S.world = y;
    const refs = [
      // Every tile: what stands on it, the stream, a redwood, or nothing.
      ...Array.from({ length: y.kind.length }, (_, i) => tileRef(i)),
      ...ALL_ITEMS.map(itemRef),
      ...ALL_KINDS.map(machineRef),
      ...y.land.plots.map((p) => plotRef(p.plot)),
      ...ALL_GOALS.map(nodeRef),
      orderRef("story"),
      ...y.board.map((_, slot) => orderRef(slot)),
    ];
    let printed = 0;
    for (const ref of refs) {
      const p = printOf(ref);
      if (p === null) continue;
      printed++;
      expect(JSON.parse(JSON.stringify(p))).toEqual(p);
    }
    expect(printed).toBeGreaterThan(100);
  });

  test("is drawn by a module that reaches no yard: it imports nothing of the page's that holds one", async () => {
    const text = await Bun.file(new URL("./cards.ts", import.meta.url).pathname).text();
    const from = [...text.matchAll(/^import(?! type)[^;]*? from "([^"]+)";/gms)].map((m) => m[1] ?? "");
    expect(from.filter((f) => f.startsWith(".")).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "../art/belts.ts",
      "../sound.ts",
      "./parts.ts",
    ]);
    expect(text).not.toMatch(/\bS\.|coins\(/);
  });
});
