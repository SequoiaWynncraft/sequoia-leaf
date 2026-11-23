import { expect, test } from "bun:test";

import { FIGURE_IDS } from "@sequoia-leaf/raid/content/figures.ts";

import { ART } from "./figures.ts";
import { PAL } from "./pal.ts";

test("every figure a member can own has its pictures, standing and casting, in colours that exist", () => {
  const missing = FIGURE_IDS.flatMap((id) => {
    const { rows, cast = [], alt = [] } = ART[id];
    const letters = new Set([...rows, ...cast, ...alt].join("").replaceAll(".", ""));
    const unknown = [...letters].filter((l) => !(l in PAL));
    return rows.length === 0 || cast.length === 0 || unknown.length > 0 ? [`${id} ${unknown.join("")}`] : [];
  });
  expect(missing).toEqual([]);
});
