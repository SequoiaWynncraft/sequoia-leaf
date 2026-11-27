/**
 * A plot's clearing on the page: its card says what it wants before it is taken on and how far it
 * has come while it is; Orders shows it above the side orders, its Stop asking first and saying that
 * the goods delivered are not given back, its Hand over once everything is delivered.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";

import { buyPlot, CLEARING, create, plot, type PlotName, plotPrice, plotState, type Yard } from "@sequoia-leaf/factory";
import { el } from "@sequoia-leaf/kit/dom.ts";
import { scope } from "@sequoia-leaf/kit/scope.ts";
import { aPage, Part, press } from "@sequoia-leaf/kit/standin.ts";

import { type FakeLeaf, isRecord, opened, until, useFakeLeaf } from "../../test/fake-leaf.ts";
import { clearLand } from "../plots.ts";
import { S } from "../state.ts";
import { setTool } from "../tools.ts";
import { clearingCard } from "./clearing.ts";
import { plotCard, type PlotPrint } from "./land.ts";
import { printOf } from "./prints.ts";
import { plotRef } from "./refs.ts";

useFakeLeaf();
// The rows of what a clearing wants draw each thing's picture: on the stand-in page, none is a canvas.
class NoCanvas {
  readonly width = 0;
}
beforeAll(() => Object.defineProperty(globalThis, "HTMLCanvasElement", { value: NoCanvas, configurable: true }));
afterAll(() => Reflect.deleteProperty(globalThis, "HTMLCanvasElement"));

const WORKINGS = plot("workings");

/** A yard Leaf has past tier 4's commission, owning today's nine plots, with a mouse. */
function nine(): Yard {
  const y = create({ seed: 5, tier: 5 });
  for (let more = true; more;) {
    const p = y.land.plots.find((q) => q.ring === 1 && plotState(y, q.plot).state === "for sale");
    more = p !== undefined;
    if (p) buyPlot(y, p.plot, plotPrice(y, p.plot), Infinity);
  }
  y.history = [];
  S.finger = false;
  setTool(null);
  return y;
}

/** A plot's card as the page prints it now. */
function card(name: PlotName): PlotPrint {
  const p = printOf(plotRef(plot(name)));
  if (p?.card !== "plot") throw new Error("no plot card");
  return p;
}
const said: string[] = [];
const hands = {
  buy: () => true,
  clear: clearLand,
  refuse: (why: string): void => void said.push(why),
};
/** The words of a card's blocks. */
const bodies = (p: PlotPrint): string[] =>
  (plotCard(p, hands).blocks ?? []).flatMap((b) => ("body" in b && typeof b.body === "string" ? [b.body] : []));
/** What was sent to Leaf, by what each command does. */
const sent = (fake: FakeLeaf): unknown[] => fake.leaf.commands.map((c) => (isRecord(c) ? c.do : null));
/** A card as the stand-in page holds it. */
function partOf(node: unknown): Part {
  if (!(node instanceof Part)) throw new Error("not on the stand-in page");
  return node;
}
/** The text of every line of a card that has one class. */
const texts = (node: unknown, cls: string): string[] =>
  partOf(node)
    .querySelectorAll(cls)
    .map((p) => p.textContent);
/** Presses a card's first button, as a finger or the mouse does: down on it, then its click. */
function pressButton(node: unknown): void {
  const b = partOf(node).querySelectorAll("k-btn")[0];
  press(b ?? null);
  b?.dispatchEvent(new Event("click"));
}

test("a plot to clear: its card says what it wants and its price, and offers Clear it, not Buy", async () => {
  const page = aPage();
  await opened(nine(), 1_000_000);
  const p = card("workings");
  expect(p.clearing).toMatchObject({ state: "to clear", words: "600 lanterns and 900 pipes", other: null });
  expect(bodies(p)).toEqual([
    "Clear it: 600 lanterns and 900 pipes, delivered to the depot. Then it can be bought.",
    "It costs 100,000 Coins.",
    expect.stringContaining("15%"),
  ]);
  expect(plotCard(p, hands).actions?.map((a) => a.label)).toEqual(["Clear it"]);
  page.done();
});

test("Clear it takes the clearing on: its card shows what has been delivered; another plot's Clear it says plainly why not", async () => {
  const page = aPage();
  const fake = await opened(nine(), 1_000_000);
  const [clear] = plotCard(card("workings"), hands).actions ?? [];
  clear?.on(el("button"));
  await until(() => sent(fake).includes("clearPlot"));
  expect([S.world.clearing?.plot, sent(fake)]).toEqual([WORKINGS, ["clearPlot"]]);
  const p = card("workings");
  expect(p.clearing?.state).toBe("clearing");
  expect(bodies(p)[0]).toBe("Being cleared. Hand it over in Orders once everything is delivered.");
  expect(plotCard(p, hands).rows?.[0]?.things?.map((t) => t.note)).toEqual(["0 of 600", "0 of 900"]);
  expect(plotCard(p, hands).actions).toEqual([]);
  const flats = card("flats");
  const [other] = plotCard(flats, hands).actions ?? [];
  expect(other?.look).toContain("off");
  other?.on(el("button"));
  expect([said.at(-1), S.world.clearing?.plot]).toEqual(["You are clearing The Old Workings already", WORKINGS]);
  page.done();
});

test("in Orders, Stop asks first, saying the goods delivered are not given back; pressed again, it stops", async () => {
  const page = aPage();
  const y = nine();
  y.clearing = { plot: WORKINGS, filled: new Float64Array(CLEARING[WORKINGS]?.length ?? 0) };
  const fake = await opened(y, 1_000_000);
  const life = scope();
  // Each card drawn on the page, as Orders draws it, for its button's question to be seen.
  const drawn = (): HTMLElement | undefined => {
    const [c] = clearingCard(life, () => undefined, []);
    page.body.replaceChildren(c);
    return c;
  };
  const first = drawn();
  expect(texts(first, "k-name")).toEqual(["Clearing The Old Workings"]);
  expect(texts(first, "k-d")).toEqual(["Once it is handed over, it can be bought for 100,000 Coins."]);
  pressButton(first);
  const asked = drawn();
  expect(texts(asked, "k-d")).toEqual(["Stop clearing The Old Workings? The goods delivered are not given back."]);
  expect(S.world.clearing?.plot).toBe(WORKINGS);
  pressButton(asked);
  await until(() => sent(fake).includes("stopClearing"));
  expect([S.world.clearing, sent(fake), clearingCard(life, () => undefined, [])]).toEqual([null, ["stopClearing"], []]);
  page.done();
});

test("in Orders, once everything is delivered, Hand over clears the plot, and its card offers Buy at its price then", async () => {
  const page = aPage();
  const y = nine();
  const want = CLEARING[WORKINGS] ?? new Float64Array();
  y.clearing = { plot: WORKINGS, filled: Float64Array.from(want) };
  const fake = await opened(y, 1_000_000);
  const [ready] = clearingCard(scope(), () => undefined, []);
  page.body.replaceChildren(ready);
  expect(ready?.className).toContain("ready");
  pressButton(ready);
  await until(() => sent(fake).includes("handClearing"));
  expect([S.world.cleared, sent(fake)]).toEqual([[WORKINGS], ["handClearing"]]);
  const p = card("workings");
  expect(p.clearing?.state).toBe("cleared");
  expect(plotCard(p, hands).actions?.map((a) => a.label)).toEqual(["Buy for 100,000"]);
  page.done();
});
