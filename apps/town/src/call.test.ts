import { afterEach, describe, expect, test } from "bun:test";

import { el } from "@sequoia-leaf/kit/dom.ts";
import { aPage, Part } from "@sequoia-leaf/kit/standin.ts";

import { whereLine } from "./callline.ts";
import { pullsAway, pullsRow } from "./groveui.ts";

describe("the town in Discord's small picture of a call", () => {
  test("says where the member is, in a line", () => {
    expect(whereLine("town", null)).toBe("In town");
    expect(whereLine("grove", null)).toBe("In the Grove");
    expect(whereLine("camp", null)).toBe("In your camp");
    expect(whereLine("camp", "Glacade")).toBe("In Glacade's camp");
  });
});

/** A pull button, as the Grove draws one. */
const pull = (n: 1 | 10): HTMLElement => el("button", "k-btn grove-pull", { text: `Pull ${n}` });

describe("the Grove in a Discord call", () => {
  const page = { done: (): void => undefined };
  afterEach(() => page.done());

  test("says in one line that the pulls are on Leaf's website, and offers none", () => {
    page.done = aPage().done;

    const row = pullsRow("Next free pull: Thursday 09:00", null, false, pull, true);

    expect(row.map((e) => e.className)).toEqual(["k-read k-over grove-elsewhere"]);
    expect(row.flatMap((e) => Array.from(e.querySelectorAll(".grove-pull")))).toEqual([]);
  });

  test("links Leaf's website by its name, to be opened outside Discord", () => {
    page.done = aPage().done;

    const line = pullsAway("https://leaf.seqwawa.com");
    const words = line instanceof Part ? line.kids.map((kid) => kid.textContent) : [];
    const link = line.querySelectorAll(".grove-away")[0];

    expect(words).toEqual(["Pulls are on ", "leaf.seqwawa.com", "."]);
    expect(link?.getAttribute("href")).toBe("https://leaf.seqwawa.com");
  });

  test("offers the pulls out of a call, as ever", () => {
    page.done = aPage().done;

    const row = pullsRow(null, null, false, pull, false);

    expect(row.map((e) => e.className)).toEqual(["k-row grove-pulls"]);
  });
});
