import { describe, expect, test } from "bun:test";

import { PHONE, SIDEWAYS, SMALL } from "./screens.ts";

const PAGE = new URL("../../index.html", import.meta.url).pathname;

/** The queries the page's `@media` rules may ask: the one measure, either way up, and two that are not about layout. */
const ALLOWED = new Set([
  PHONE,
  SMALL,
  `${PHONE} and (min-height: 501px)`,
  SIDEWAYS,
  // Where the news stands clear of a wide dock, not which layout the page has.
  "(max-width: 1100px)",
  "(prefers-reduced-motion: reduce)",
]);

describe("the page's one measure of a screen", () => {
  test("every @media rule of the page asks only the measure in screens.ts", async () => {
    const css = await Bun.file(PAGE).text();
    const asked = [...css.matchAll(/@media\s+([^{]+?)\s*\{/g)].map((m) => m[1] ?? "");
    expect(asked.length).toBeGreaterThan(4);
    expect(asked.filter((q) => !ALLOWED.has(q))).toEqual([]);
  });

  test("a card at its own width (440 pixels) takes at most two thirds of a screen past the line", () => {
    const line = Number(/max-width: (\d+)px/.exec(PHONE)?.[1]) + 1;
    expect(440 / line).toBeLessThanOrEqual(2 / 3);
    expect(440 / (line - 1)).toBeGreaterThan(2 / 3);
  });
});
