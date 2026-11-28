/**
 * The card on the stand-in page (`standin.ts`), through the page's own deck: a card drawn again
 * stays where it is, the same node on the page, so it is never on the page without its place.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { close, deck, pick, refresh, register } from "./card.ts";
import { el } from "./dom.ts";
import { aPage, type Part } from "./standin.ts";

/** The window the card is placed in: 1280 by 800, where a finger's card is no sheet. */
const WINDOW = { innerWidth: 1280, innerHeight: 800, matchMedia: () => ({ matches: false }) };

const shown = { page: null as ReturnType<typeof aPage> | null };
beforeEach(() => {
  shown.page = aPage();
  Object.defineProperty(globalThis, "window", { value: WINDOW, configurable: true });
});
afterEach(() => {
  close();
  shown.page?.done();
  Reflect.deleteProperty(globalThis, "window");
});

/** The words of an element and of everything it holds. */
const words = (at: Part): string => at.textContent + at.kids.map(words).join(" ");
/** Whether an element is a card. */
const isCard = (at: Part): boolean => at.className.split(" ").includes("k-info");
/** The cards on the page. */
const cards = (body: Part): Part[] => body.kids.filter(isCard);

describe("a card drawn again", () => {
  test("as what it says changes, four times a second, keeps its node and its place: no card goes on the page without one", () => {
    const page = shown.page;
    if (!page) throw new Error("no page");
    const said = { n: 0 };
    register("gauge", () => ({ name: "Gauge", tag: `Holds ${said.n}` }));
    // Clicked on a canvas, beside the tile at 600, 300: pinned, and placed.
    pick("gauge:1", 600, 300, 32, 32);
    const [card] = cards(page.body);
    if (!card) throw new Error("no card");
    const place = card.style.transform;
    expect(place).toMatch(/^translate\(/);
    page.put.length = 0;
    for (let i = 1; i <= 8; i++) {
      said.n = i;
      refresh();
      // Nothing put on the page is a card without its place.
      expect(page.put.filter((p) => isCard(p.part) && p.transform === "").length).toBe(0);
      expect(cards(page.body)).toEqual([card]);
      expect(card.style.transform).toBe(place);
      expect(words(card)).toContain(`Holds ${i}`);
    }
  });
  test("as a sheet, after it passed by as a floating card, keeps no floating place on its node", () => {
    const page = shown.page;
    if (!page) throw new Error("no page");
    // A screen where a finger's card is a sheet.
    Object.defineProperty(globalThis, "window", { value: { ...WINDOW, matchMedia: () => ({ matches: true }) } });
    register("gauge", () => ({ name: "Gauge" }));
    // A mouse rests on a thing: its passing card, placed beside it.
    const at = { x: 600, y: 300, w: 32, h: 32 };
    const from = {};
    deck.rest("gauge:1", at, "mouse", from);
    const [card] = cards(page.body);
    if (!card) throw new Error("no card");
    expect(card.style.transform).toMatch(/^translate\(/);
    // Then the same thing is tapped: the same card, drawn again into its node, now a sheet along an edge.
    deck.pin("gauge:1", at, "touch", from);
    expect(cards(page.body)[0]).toBe(card);
    expect(card.className.split(" ")).toContain("sheet");
    expect(card.style.transform).toBe("");
  });
  test("for a thing that has left the page, with no place kept, is put away, not shown at the page's corner", () => {
    const page = shown.page;
    if (!page) throw new Error("no page");
    register("gauge", () => ({ name: "Gauge" }));
    // A button drawn again before its card came: what the card was for is no longer on the page.
    const gone = el("button");
    deck.pin("gauge:1", gone, "mouse", gone);
    expect(page.put.filter((p) => isCard(p.part) && p.transform === "" && p.part.isConnected).length).toBe(0);
    expect(cards(page.body)).toEqual([]);
    expect(deck.open).toBeNull();
  });
});
