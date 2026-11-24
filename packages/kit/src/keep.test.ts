import { afterEach, describe, expect, test } from "bun:test";

import { keepText, keptText } from "./keep.ts";
import { post, read } from "./postcard.ts";
import { type Standin, standin } from "./standin.ts";

let world: Standin | null = null;
afterEach(() => {
  world?.done();
  world = null;
});

const CARD = { waiting: "A raid under way", till: 12 };

describe("keeping in the browser", () => {
  test("a text is kept, read back and forgotten", () => {
    world = standin({});
    expect(keepText("works.screen.v1", "zoomed")).toBe(true);
    expect(keptText("works.screen.v1")).toBe("zoomed");
    expect(keepText("works.screen.v1", null)).toBe(true);
    expect(world.store.getItem("works.screen.v1")).toBeNull();
  });

  test("a postcard is left for the town, and nonsense in its place reads as none", () => {
    world = standin({});
    post("works", CARD);
    expect(read("works")).toEqual(CARD);
    world.store.setItem("town.postcard.raid.v1", "nonsense");
    expect(read("raid")).toBeNull();
  });

  test("a postcard still carries the empty trophies a town page opened before #172 asks for", () => {
    world = standin({});
    post("works", CARD);
    expect(JSON.parse(world.store.getItem("town.postcard.works.v1") ?? "null")).toEqual({ ...CARD, trophies: [] });
  });
});
