import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { choices, stepped } from "./choices.ts";

/** Which element has the keyboard. */
const page: { focused: Part | null } = { focused: null };

/** An element as `el` makes one: its attributes, its children, its listeners, and the keyboard. */
class Part extends EventTarget {
  readonly attrs = new Map<string, string>();
  readonly kids: Part[] = [];
  readonly tag: string;
  className = "";
  textContent = "";
  tabIndex = 0;
  constructor(tag: string) {
    super();
    this.tag = tag;
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  appendChild<T>(kid: T): T {
    if (kid instanceof Part) this.kids.push(kid);
    return kid;
  }
  focus(): void {
    page.focused = this;
  }
}

beforeEach(() => {
  page.focused = null;
  const doc = { createElement: (tag: string) => new Part(tag) };
  Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
});
afterEach(() => {
  Reflect.deleteProperty(globalThis, "document");
});

/** A key going down on the row, as the browser sends it from whatever has the keyboard. */
const key = (on: EventTarget, name: string): Event => {
  const e = Object.assign(new Event("keydown", { cancelable: true }), { key: name });
  on.dispatchEvent(e);
  return e;
};

/** A press on one of the row's controls, as the row hears it. */
const press = (row: EventTarget, control: Part | undefined): void => {
  const e = new Event("click");
  Object.defineProperty(e, "target", { value: control });
  row.dispatchEvent(e);
};

const TABS = [
  { id: "figures", name: "Figures" },
  { id: "traits", name: "Traits" },
  { id: "items", name: "Items" },
] as const;

const partsOf = (node: unknown): Part[] => (node instanceof Part ? node.kids : []);

/** The row's controls as a screen reader and the keyboard find them: name, chosen, Tab stop, keyboard. */
const seen = (node: unknown): string[] =>
  partsOf(node).map(
    (b) =>
      `${b.textContent} ${b.getAttribute("aria-selected") ?? b.getAttribute("aria-checked")} ${b.tabIndex}${page.focused === b ? " focused" : ""}`,
  );

describe("a row of choices", () => {
  test("an arrow chooses the one beside, round the ends, keeps the keyboard on it, and tells the owner", () => {
    const told: string[] = [];
    const row = choices(TABS, { kind: "tabs", name: "Almanac", chosen: "figures", choose: (id) => told.push(id) });
    expect(row.el instanceof Part && row.el.getAttribute("role")).toBe("tablist");
    expect(seen(row.el)).toEqual(["Figures true 0", "Traits false -1", "Items false -1"]);
    expect(key(row.el, "ArrowRight").defaultPrevented).toBe(true);
    expect(seen(row.el)).toEqual(["Figures false -1", "Traits true 0 focused", "Items false -1"]);
    key(row.el, "ArrowLeft");
    key(row.el, "ArrowLeft");
    expect(seen(row.el)).toEqual(["Figures false -1", "Traits false -1", "Items true 0 focused"]);
    expect(told).toEqual(["traits", "figures", "items"]);
    // Up and Down are the page's in a row of tabs: they scroll it.
    expect(key(row.el, "ArrowDown").defaultPrevented).toBe(false);
    expect(told).toEqual(["traits", "figures", "items"]);
  });

  test("a press chooses, the chosen one pressed again tells nobody, and `select` shows what the owner says", () => {
    const told: string[] = [];
    const book = new Part("div");
    const row = choices(TABS, {
      kind: "tabs",
      name: "Almanac",
      chosen: "figures",
      page: book,
      choose: (id) => told.push(id),
    });
    expect([book.getAttribute("role"), book.getAttribute("aria-labelledby")]).toEqual([
      "tabpanel",
      "k-almanac-figures",
    ]);
    const [figures, traits] = partsOf(row.el);
    press(row.el, traits);
    press(row.el, traits);
    press(row.el, row.el instanceof Part ? row.el : undefined);
    expect(told).toEqual(["traits"]);
    expect(book.getAttribute("aria-labelledby")).toBe("k-almanac-traits");
    expect(page.focused).toBe(traits ?? null);
    // Chosen by the owner, the keyboard stays where it was until the owner moves it.
    row.select("items");
    expect(seen(row.el)).toEqual(["Figures false -1", "Traits false -1 focused", "Items true 0"]);
    row.focus();
    expect(page.focused).toBe(partsOf(row.el)[2] ?? null);
    expect(figures?.getAttribute("id")).toBe("k-almanac-figures");
    expect(told).toEqual(["traits"]);
  });

  test("a radio group is checked, and goes up and down as well as across", () => {
    const told: string[] = [];
    const row = choices(TABS, { kind: "radio", name: "Pool", chosen: "items", choose: (id) => told.push(id) });
    expect(row.el instanceof Part && row.el.getAttribute("role")).toBe("radiogroup");
    key(row.el, "ArrowDown");
    key(row.el, "ArrowUp");
    key(row.el, "ArrowUp");
    expect(told).toEqual(["figures", "items", "traits"]);
    expect(seen(row.el)).toEqual(["Figures false -1", "Traits true 0 focused", "Items false -1"]);
  });
});

test("the choice an arrow goes to: none for any other key, nor in an empty row", () => {
  const ids = ["a", "b"] as const;
  expect(stepped(ids, "a", "ArrowLeft", "tabs")).toBe("b");
  expect(stepped(ids, "b", "ArrowRight", "tabs")).toBe("a");
  expect(stepped(ids, "a", "Enter", "tabs")).toBeNull();
  expect(stepped([], "a", "ArrowRight", "radio")).toBeNull();
});
