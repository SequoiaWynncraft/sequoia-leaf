import { afterEach, describe, expect, test } from "bun:test";

import { keepText, keptText } from "./keep.ts";
import { type Standin, standin } from "./standin.ts";

let world: Standin | null = null;
afterEach(() => {
  world?.done();
  world = null;
});

describe("keeping in the browser", () => {
  test("a text is kept, read back and forgotten", () => {
    world = standin({});
    expect(keepText("works.screen.v1", "zoomed")).toBe(true);
    expect(keptText("works.screen.v1")).toBe("zoomed");
    expect(keepText("works.screen.v1", null)).toBe(true);
    expect(world.store.getItem("works.screen.v1")).toBeNull();
  });
});
