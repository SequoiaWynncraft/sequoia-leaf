import { expect, test } from "bun:test";

import { drawFigure } from "@sequoia-leaf/figures/sprites.ts";

test("the town reaches the raid's figures' pictures", () => {
  expect(drawFigure).toBeFunction();
});
