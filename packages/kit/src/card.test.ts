import { describe, expect, test } from "bun:test";

import { Deck, type Description, type Open, partsOf, type View } from "./card.ts";

/** A deck with a view that only writes down what it was asked to draw. */
function table(): { deck: Deck; drawn: (string | null)[]; last: () => Open | null } {
  const drawn: (string | null)[] = [];
  let last: Open | null = null;
  const view: View = {
    render(open, d) {
      last = open;
      drawn.push(
        open && d ? `${open.pinned ? "pinned" : "passing"} ${d.name}${open.stack.length > 1 ? " <" : ""}` : null,
      );
    },
  };
  const deck = new Deck(view);
  const items: Record<string, Description> = {
    gear: { name: "Gear", tag: "Put together", rows: [{ label: "Made from", things: [{ ref: "item:ingot" }] }] },
    ingot: { name: "Ingot" },
  };
  deck.register("item", (id) => items[id] ?? null);
  deck.register("trait", (id) => (id === "ember" ? { name: "Ember" } : null));
  return { deck, drawn, last: () => last };
}

const A = { a: 1 };
const B = { b: 1 };
const spot = { x: 0, y: 0, w: 10, h: 10 };

describe("registering and describing", () => {
  test("a reference names a registered kind and an id", () => {
    const { deck } = table();
    expect(deck.describe("item:gear")?.name).toBe("Gear");
    expect(deck.describe("trait:ember")?.name).toBe("Ember");
  });
  test("an unknown kind or id has no description, and opens nothing", () => {
    const { deck, drawn } = table();
    expect(deck.describe("item:nothing")).toBeNull();
    expect(deck.describe("crab:7")).toBeNull();
    expect(deck.describe("gear")).toBeNull();
    expect(deck.press("crab:7", spot, "mouse", A)).toBe(false);
    expect(drawn).toEqual([]);
  });
  test("an id may hold a colon of its own", () => {
    const { deck } = table();
    deck.register("order", (id) => ({ name: id }));
    expect(deck.describe("order:board:2")?.name).toBe("board:2");
  });
  test("a description with only a name is a whole card: a head and nothing else", () => {
    expect(partsOf({ name: "Rock" }, false)).toEqual(["head"]);
    expect(partsOf({ name: "Rock" }, true)).toEqual(["head"]);
    expect(partsOf({ name: "Rock", chips: [], rows: [{ label: "Used in", things: [] }] }, true)).toEqual(["head"]);
  });
  test("the parts come in their order, and actions only on a pinned card", () => {
    const full: Description = {
      name: "Mill",
      actions: [{ label: "Take away", on: () => {} }],
      rows: [{ label: "Makes", things: [{ ref: "item:plank" }] }],
      blocks: [{ title: "Saws", body: "One in, one out." }],
      stats: [{ label: "Draws", value: "3" }],
      chips: [{ text: "Machine" }],
    };
    expect(partsOf(full, true)).toEqual(["head", "chips", "stats", "blocks", "rows", "actions"]);
    expect(partsOf(full, false)).toEqual(["head", "chips", "stats", "blocks", "rows"]);
  });
});

describe("one card at a time", () => {
  test("resting shows a passing card, and leaving puts it away", () => {
    const { deck, drawn } = table();
    deck.rest("item:gear", spot, "mouse", A);
    deck.leave(A);
    expect(drawn).toEqual(["passing Gear", null]);
  });
  test("resting on another thing replaces the card", () => {
    const { deck, drawn } = table();
    deck.rest("item:gear", spot, "mouse", A);
    deck.rest("item:ingot", spot, "mouse", B);
    deck.leave(A);
    expect(drawn).toEqual(["passing Gear", "passing Ingot"]);
    expect(deck.shown()).toBe("item:ingot");
  });
  test("a click pins the card; clicking the same thing again puts it away", () => {
    const { deck, drawn } = table();
    deck.rest("item:gear", spot, "mouse", A);
    deck.press("item:gear", spot, "mouse", A);
    expect(deck.pinned()).toBe("item:gear");
    deck.press("item:gear", spot, "mouse", A);
    expect(deck.open).toBeNull();
    expect(drawn).toEqual(["passing Gear", "pinned Gear", null]);
  });
  test("while a card is pinned, pointing elsewhere opens nothing and leaving does not close it", () => {
    const { deck, drawn } = table();
    deck.press("item:gear", spot, "mouse", A);
    expect(deck.rest("item:ingot", spot, "mouse", B)).toBe(false);
    deck.leave(A);
    expect(drawn).toEqual(["pinned Gear"]);
  });
  test("pressing something else pins its card in place of the first", () => {
    const { deck, drawn } = table();
    deck.press("item:gear", spot, "mouse", A);
    deck.press("item:ingot", spot, "touch", B);
    expect(drawn).toEqual(["pinned Gear", "pinned Ingot"]);
    expect(deck.open?.via).toBe("touch");
  });
});

describe("following and going back", () => {
  test("a thing followed inside a card takes its place, with a way back", () => {
    const { deck, drawn } = table();
    deck.rest("item:gear", spot, "mouse", A);
    deck.press("item:gear", spot, "mouse", A);
    deck.follow("item:ingot");
    expect(deck.open?.stack).toEqual(["item:gear", "item:ingot"]);
    expect(deck.back()).toBe(true);
    expect(deck.back()).toBe(false);
    expect(drawn).toEqual(["passing Gear", "pinned Gear", "pinned Ingot <", "pinned Gear"]);
  });
  test("a followed card is pinned, and stays where the first one was", () => {
    const { deck, last } = table();
    deck.press("item:gear", spot, "mouse", A);
    deck.follow("trait:ember");
    expect(last()?.pinned).toBe(true);
    expect(last()?.from).toBe(A);
    expect(last()?.at).toBe(spot);
  });
  test("pressing the first thing again after following opens it afresh rather than closing", () => {
    const { deck } = table();
    deck.press("item:gear", spot, "mouse", A);
    deck.follow("item:ingot");
    deck.press("item:gear", spot, "mouse", A);
    expect(deck.open?.stack).toEqual(["item:gear"]);
  });
  test("nothing to follow from, or to, does nothing", () => {
    const { deck } = table();
    expect(deck.follow("item:gear")).toBe(false);
    deck.press("item:gear", spot, "mouse", A);
    expect(deck.follow("item:nothing")).toBe(false);
    expect(deck.follow("item:gear")).toBe(false);
    expect(deck.open?.stack).toEqual(["item:gear"]);
  });
});

describe("holding cards shut", () => {
  test("while held, nothing opens", () => {
    const { deck, drawn } = table();
    deck.hold(true);
    expect(deck.rest("item:gear", spot, "mouse", A)).toBe(false);
    expect(deck.press("item:gear", spot, "mouse", A)).toBe(false);
    deck.hold(false);
    expect(deck.rest("item:gear", spot, "mouse", A)).toBe(true);
    expect(drawn).toEqual(["passing Gear"]);
  });
  test("holding puts a passing card away, and leaves a pinned one", () => {
    const { deck } = table();
    deck.rest("item:gear", spot, "mouse", A);
    deck.hold(true);
    expect(deck.open).toBeNull();
    deck.hold(false);
    deck.press("item:gear", spot, "mouse", A);
    deck.hold(true);
    expect(deck.pinned()).toBe("item:gear");
  });
  test("what letting go would do may still be shown while held, and goes when the hold ends", () => {
    const { deck, drawn } = table();
    deck.hold(true);
    deck.preview("item:gear", spot, A);
    expect(deck.open?.preview).toBe(true);
    deck.hold(false);
    expect(deck.open).toBeNull();
    expect(drawn).toEqual(["passing Gear", null]);
  });
});

describe("watching", () => {
  test("watchers hear what is pointed at and what is pinned, once for each change", () => {
    const { deck } = table();
    const heard: string[] = [];
    deck.watch((p, k) => heard.push(`${p ?? "-"} ${k ?? "-"}`));
    deck.point("trait:ember");
    deck.point("trait:ember");
    deck.rest("trait:ember", spot, "mouse", A);
    deck.press("trait:ember", spot, "mouse", A);
    deck.point(null);
    deck.close();
    expect(heard).toEqual(["- -", "trait:ember -", "trait:ember trait:ember", "- trait:ember", "- -"]);
  });
  test("a thing that is gone when the card is refreshed takes the card with it", () => {
    const { deck } = table();
    let there = true;
    deck.register("crab", () => (there ? { name: "Crab #7" } : null));
    deck.press("crab:7", spot, "mouse", A);
    there = false;
    deck.refresh();
    expect(deck.open).toBeNull();
  });
  test("closing for one opener leaves another's card alone", () => {
    const { deck } = table();
    deck.press("item:gear", spot, "mouse", A);
    deck.close(B);
    expect(deck.pinned()).toBe("item:gear");
    deck.close(A);
    expect(deck.open).toBeNull();
  });
});
