import { describe, expect, test } from "bun:test";

import { type Action, Deck, type Description, type Open, partsOf, said, type View } from "./card.ts";
import { press } from "./standin.ts";

/** A deck with a view that only writes down what it was asked to draw. */
function table(): { deck: Deck; drawn: (string | null)[]; last: () => Open | null } {
  const drawn: (string | null)[] = [];
  let last: Open | null = null;
  const view: View = {
    render(open, d) {
      last = open;
      drawn.push(
        open && d
          ? `${open.pinned ? "pinned" : open.glance ? "glance" : "passing"} ${d.name}${open.stack.length > 1 ? " <" : ""}`
          : null,
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
  test("the parts come in their order, the glance first, and actions only on a pinned card", () => {
    const full: Description = {
      name: "Mill",
      glance: "Saws a log into two planks",
      actions: [{ label: "Take away", on: () => {} }],
      rows: [{ label: "Makes", things: [{ ref: "item:plank" }] }],
      blocks: [{ title: "Saws", body: "One in, one out." }],
      sections: [{ s: "sum", label: "Speed", rows: [{ label: "Mill", value: "1" }], total: "1" }],
      stats: [{ label: "Draws", value: "3" }],
      chips: [{ text: "Machine" }],
    };
    expect(partsOf(full, true)).toEqual(["head", "glance", "chips", "stats", "sections", "blocks", "rows", "actions"]);
    expect(partsOf(full, false)).toEqual(["head", "glance", "chips", "stats", "sections", "blocks", "rows"]);
    expect(partsOf(full, true, true)).toEqual(["head", "glance"]);
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

describe("a glance, then the card", () => {
  test("coming onto a thing shows its glance; resting there grows it into the card, in the same place", () => {
    const { deck, drawn, last } = table();
    deck.glance("item:gear", spot, "mouse", A);
    deck.rest("item:gear", spot, "mouse", A);
    expect(drawn).toEqual(["glance Gear", "passing Gear"]);
    expect(last()?.at).toBe(spot);
  });
  test("a thing with no more than its glance shows whole at once, and a whole card is never shrunk back to a glance", () => {
    const { deck, drawn } = table();
    deck.glance("item:ingot", spot, "mouse", A);
    deck.rest("item:gear", spot, "mouse", B);
    deck.glance("item:gear", spot, "mouse", B);
    expect(drawn).toEqual(["passing Ingot", "passing Gear", "passing Gear"]);
  });
  test("a click on a glance pins the whole card; a pinned card takes no glance", () => {
    const { deck, drawn } = table();
    deck.glance("item:gear", spot, "mouse", A);
    deck.press("item:gear", spot, "mouse", A);
    expect(deck.glance("item:ingot", spot, "mouse", B)).toBe(false);
    expect(drawn).toEqual(["glance Gear", "pinned Gear"]);
  });
  test("held shut, no glance opens either", () => {
    const { deck, drawn } = table();
    deck.hold(true);
    expect(deck.glance("item:gear", spot, "mouse", A)).toBe(false);
    expect(drawn).toEqual([]);
  });
});

describe("a tip's words", () => {
  test("describe themselves: the name, and the line as the glance", () => {
    const { deck } = table();
    expect(deck.describe(said("Reroll", "New figures on the stall."))).toEqual({
      name: "Reroll",
      glance: "New figures on the stall.",
    });
    expect(deck.describe(said("Decorate"))).toEqual({ name: "Decorate" });
    expect(deck.describe("said:not words")).toBeNull();
  });
  test("pinned and pressed again from the same place are put away, even when what they say has changed", () => {
    const { deck } = table();
    deck.press(said("Power", "12 of 20 used"), spot, "touch", A);
    deck.press(said("Power", "13 of 20 used"), spot, "touch", A);
    expect(deck.open).toBeNull();
  });
  test("pinned by the game itself, they stay pinned whatever was up, and say the new words", () => {
    const { deck, drawn } = table();
    deck.pin(said("Lamp", "Lights the square."), spot, "touch", A);
    deck.pin(said("Bench", "Somewhere to sit."), spot, "touch", A);
    deck.pin(said("Bench", "Somewhere to sit."), spot, "touch", A);
    expect(drawn).toEqual(["pinned Lamp", "pinned Bench", "pinned Bench"]);
  });
  test("say new words in the card that is up, which stays as it was in every other way", () => {
    const { deck, last } = table();
    deck.rest(said("Settings (Esc)"), spot, "key", A);
    deck.swap(said("Settings (F1)"));
    expect(deck.describe(deck.shown() ?? "")?.name).toBe("Settings (F1)");
    expect(last()?.via).toBe("key");
  });
  test("move with whoever showed them, and no one else's", () => {
    const { deck } = table();
    const moved = { x: 40, y: 40, w: 10, h: 10 };
    deck.glance(said("Wrenly"), spot, "mouse", A);
    expect(deck.moveTo(B, moved)).toBe(false);
    expect(deck.moveTo(A, moved)).toBe(true);
    expect(deck.open?.at).toBe(moved);
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

/** A deck with somebody whose numbers have not come from Leaf until `come()`. */
function waiting(): { deck: Deck; drawn: (string | null)[]; come: () => Promise<void> } {
  const { deck, drawn } = table();
  const leaf = Promise.withResolvers<void>();
  let answered = false;
  deck.register("person", () => ({ name: "Wrenly", ...(answered ? {} : { coming: leaf.promise }) }));
  const come = async (): Promise<void> => {
    answered = true;
    leaf.resolve();
    await leaf.promise;
  };
  return { deck, drawn, come };
}

describe("a description still on its way", () => {
  test("its card is drawn once, when the description has come", async () => {
    const { deck, drawn, come } = waiting();
    expect(deck.rest("person:w", spot, "mouse", A)).toBe(false);
    expect(drawn).toEqual([]);
    await come();
    expect(drawn).toEqual(["passing Wrenly"]);
  });
  test("a click meanwhile pins it when it comes, and a pointer that has left gets no card", async () => {
    const pinned = waiting();
    pinned.deck.rest("person:w", spot, "mouse", A);
    expect(pinned.deck.press("person:w", spot, "mouse", A)).toBe(true);
    pinned.deck.leave(A);
    await pinned.come();
    expect(pinned.drawn).toEqual(["pinned Wrenly"]);
    const left = waiting();
    left.deck.rest("person:w", spot, "mouse", A);
    left.deck.leave(A);
    await left.come();
    expect(left.drawn).toEqual([]);
  });
  test("put away before it has come, it does not come", async () => {
    const { deck, drawn, come } = waiting();
    deck.press("person:w", spot, "mouse", A);
    expect(deck.waiting()).toBe(true);
    deck.close();
    expect(deck.waiting()).toBe(false);
    await come();
    expect(drawn).toEqual([]);
  });
  test("a click still waiting is not lost to the pointer resting on something else", async () => {
    const { deck, drawn, come } = waiting();
    deck.register("item", () => ({ name: "Gear" }));
    deck.press("person:w", spot, "mouse", A);
    deck.leave(A);
    expect(deck.rest("item:gear", spot, "mouse", B)).toBe(false);
    await come();
    expect(drawn).toEqual(["pinned Wrenly"]);
  });
});

/** A plot for sale, bought from its card, with what lies in its ground to follow. */
const BUY: Action = { label: "Buy for 300", ask: { again: "Press again to buy", price: 300 }, on: () => {} };
function plotTable(): ReturnType<typeof table> {
  const t = table();
  t.deck.register("plot", (id) =>
    id === "meadow" ? { name: "Meadow", rows: [{ label: "In the ground", things: [{ ref: "item:ingot" }] }] } : null,
  );
  return t;
}
const redraw = (): void => undefined;
/** A press on an action of the card on show: whether it goes ahead (`Deck.confirms`). */
const confirmed = (deck: Deck, a: Action, again: () => void): boolean => {
  press();
  return deck.confirms(a, again);
};

describe("an action that asks to be pressed again", () => {
  test("goes ahead on its second press while its card stays up, drawn again or not", () => {
    const { deck } = plotTable();
    deck.press("plot:meadow", spot, "mouse", A);
    expect(confirmed(deck, BUY, redraw)).toBe(false);
    deck.refresh();
    expect(confirmed(deck, BUY, redraw)).toBe(true);
    // One that does not ask goes at once; on a passing card, one that asks never does.
    expect(confirmed(deck, { label: "Take away", on: () => {} }, redraw)).toBe(true);
    deck.close();
    deck.rest("plot:meadow", spot, "mouse", A);
    expect([confirmed(deck, BUY, redraw), confirmed(deck, BUY, redraw)]).toEqual([false, false]);
  });

  test("asks again once its card has followed something in it and come back", () => {
    const { deck } = plotTable();
    deck.press("plot:meadow", spot, "mouse", A);
    expect(confirmed(deck, BUY, redraw)).toBe(false);
    expect(deck.follow("item:ingot")).toBe(true);
    expect(deck.back()).toBe(true);
    expect(confirmed(deck, BUY, redraw)).toBe(false);
    expect(confirmed(deck, BUY, redraw)).toBe(true);
  });

  test("asks again once its card has been put away and pinned again, or its price has changed", () => {
    const { deck } = plotTable();
    deck.press("plot:meadow", spot, "mouse", A);
    expect(confirmed(deck, BUY, redraw)).toBe(false);
    deck.close();
    deck.press("plot:meadow", spot, "mouse", A);
    expect(confirmed(deck, BUY, redraw)).toBe(false);
    expect(confirmed(deck, { ...BUY, ask: { again: "Press again to buy", price: 320 } }, redraw)).toBe(false);
    expect(confirmed(deck, BUY, redraw)).toBe(false);
    expect(confirmed(deck, BUY, redraw)).toBe(true);
  });
});
