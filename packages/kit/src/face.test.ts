import { describe, expect, test } from "bun:test";

import { type Action, actionName, chipName, namedIn, tableLines } from "./face.ts";

const MOTH = { ref: "figure:moth", name: "Moth" };
const LANTERN = { ref: "item:moth-lantern", name: "Moth Lantern" };
const GEAR = { ref: "item:gear", name: "Gear" };
const INGOT = { ref: "item:ingot", name: "Ingot" };

/** A sentence as its parts say it: a thing in brackets with what it links to. */
const said = (text: string, named: Parameters<typeof namedIn>[1]): string => {
  const { parts, after } = namedIn(text, named);
  const words = parts.map((p) => (typeof p === "string" ? p : `[${p.text}=${p.ref}]`)).join("");
  return after.length > 0 ? `${words} +${after.join(",")}` : words;
};

describe("the things a sentence names", () => {
  test("are linked where their names are said whole, never inside a longer word", () => {
    expect(said("Gearbox needs Gear.", [GEAR])).toBe("Gearbox needs [Gear=item:gear].");
    expect(said("Gear, then more gear.", [GEAR])).toBe("[Gear=item:gear], then more gear.");
  });
  test("never inside a longer name, which is linked first where it is named too", () => {
    expect(said("Moth Lantern suits a Moth.", [MOTH])).toBe("Moth Lantern suits a [Moth=figure:moth].");
    expect(said("Moth Lantern suits a Moth.", [MOTH, LANTERN])).toBe(
      "[Moth Lantern=item:moth-lantern] suits a [Moth=figure:moth].",
    );
  });
  test("come in the sentence's order, whatever order they were named in", () => {
    expect(said("Gear needs Ingot.", [INGOT, GEAR])).toBe("[Gear=item:gear] needs [Ingot=item:ingot].");
  });
  test("one not said in it comes after it, in the order named", () => {
    expect(said("Kin strike first.", [GEAR, INGOT])).toBe("Kin strike first. +item:gear,item:ingot");
    expect(said("Gear first.", [{ ref: "item:nothing", name: "" }, GEAR])).toBe(
      "[Gear=item:gear] first. +item:nothing",
    );
  });
});

describe("a table's lines", () => {
  test("are as wide as the widest, so a short row keeps every value under its heading", () => {
    expect(
      tableLines(
        ["Item", "Cost", "Yield"],
        [
          ["Gear", "3"],
          ["Ingot", "2", "4"],
        ],
      ),
    ).toEqual([
      ["Item", "Cost", "Yield"],
      ["Gear", "3", ""],
      ["Ingot", "2", "4"],
    ]);
  });
  test("a row longer than its headings keeps its values, under empty headings", () => {
    expect(tableLines(["Stars"], [["1", "2"]])).toEqual([
      ["Stars", ""],
      ["1", "2"],
    ]);
  });
});

/** What an action does, in these tests: nothing. */
const on = (): void => undefined;

describe("what a screen reader calls a card's buttons", () => {
  test("a chip is called by its words, its count as it shows, and what it is", () => {
    expect(chipName({ text: "Gnome", count: "1/2", label: "Kin" })).toBe("Gnome 1/2, kin");
    expect(chipName({ text: "Draws eyes" })).toBe("Draws eyes");
  });
  test("a button with only a picture is called by its label, else its hint; words on a button name it", () => {
    const hollow: Action = { look: "slot", hint: "Decorate", on };
    expect(actionName(hollow, null)).toBe("Decorate");
    expect(actionName({ ...hollow, label: "Rotate" }, null)).toBe("Rotate");
    expect(actionName({ ...hollow, label: "Remove" }, "Press again to remove")).toBe("Press again to remove");
    expect(actionName({ hint: "Undo", on }, null)).toBe("Undo");
    expect(actionName({ label: "Take away", hint: "Takes it away", on }, null)).toBeNull();
  });
});
