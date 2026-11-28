/**
 * The prices on the map (`mapprice.ts`): every plot for sale that touches the yard's land has its
 * price now, whether it can be bought yet or must be cleared first; those it can are marked ready.
 */
import { expect, test } from "bun:test";

import {
  buyPlot,
  CLEARING,
  create,
  play,
  plot,
  plotName,
  plotPrice,
  plotState,
  readCommand,
  type Yard,
} from "@sequoia-leaf/factory";
import { whole } from "@sequoia-leaf/kit/say.ts";

import { salesOf } from "./mapprice.ts";

/** A yard past tier 4's commission that owns the first ring's nine plots: the second ring for sale round them. */
function nine(): Yard {
  const y = create({ seed: 5, tier: 5 });
  for (let more = true; more;) {
    const p = y.land.plots.find((q) => q.ring === 1 && plotState(y, q.plot).state === "for sale");
    more = p !== undefined;
    if (p) buyPlot(y, p.plot, plotPrice(y, p.plot), Infinity);
  }
  return y;
}

/** Gives the yard a command it must take. */
function give(y: Yard, c: Record<string, unknown>): void {
  const read = readCommand({ tick: y.tick, ...c });
  if (!read || "refused" in play(y, read)) throw new Error(`${String(c.do)} was refused`);
}

/** The plots the map prices, by name, each with its price and whether it is ready to buy. */
const priced = (y: Yard): string[] =>
  salesOf(y, 1).map((s) => {
    const p = y.land.plots.find((q) => q.x + q.w / 2 === s.x && q.y + q.h / 2 === s.y);
    return `${p ? plotName(p.plot) : "?"} ${s.price}${s.ready ? " ready" : ""}`;
  });

test("prices every plot for sale that touches the yard's land, cleared or not, at its price now; marks those that can be bought now", () => {
  const y = nine();
  const forSale = y.land.plots.filter((p) => plotState(y, p.plot).state === "for sale");
  expect(forSale.length).toBeGreaterThan(4);
  // Each plot of the second ring round the nine must be cleared first: priced, not ready.
  expect(priced(y)).toEqual(forSale.map((p) => `${plotName(p.plot)} ${whole(plotPrice(y, p.plot))}`));
  // The Old Workings cleared, it is ready to buy, at its price then; the rest are as they were.
  const workings = plot("workings");
  give(y, { do: "clearPlot", plot: "workings" });
  expect(priced(y)).toEqual(forSale.map((p) => `${plotName(p.plot)} ${whole(plotPrice(y, p.plot))}`));
  y.clearing?.filled.set(CLEARING[workings] ?? []);
  give(y, { do: "handClearing", plot: "workings", begun: y.begun });
  expect(priced(y).filter((s) => s.endsWith(" ready"))).toEqual([`workings ${whole(plotPrice(y, workings))} ready`]);
  expect(priced(y).length).toBe(forSale.length);
});

test("a plot that needs no clearing is ready to buy as soon as it is for sale", () => {
  const y = create({ seed: 5, tier: 5 });
  const sales = salesOf(y, 1);
  expect(sales.length).toBeGreaterThan(0);
  expect(sales.every((s) => s.ready)).toBe(true);
});
