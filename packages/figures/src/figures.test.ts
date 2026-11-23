import { expect, test } from "bun:test";

import * as kit from "@sequoia-leaf/kit/palette.ts";
import { FIGURE_IDS } from "@sequoia-leaf/raid/content/figures.ts";

import { ART } from "./figures.ts";
import { FIGURE_PAL, TOWNS_OWN } from "./pal.ts";

test("every figure a member can own has its pictures, standing and casting", () => {
  const missing = FIGURE_IDS.filter((id) => ART[id].rows.length === 0 || (ART[id].cast ?? []).length === 0);
  expect(missing).toEqual([]);
});

test("everything on the board is drawn in the town's colours: the kit's palette, and what the town's own creatures have", () => {
  const strays = Object.entries(ART).flatMap(([id, { rows, cast = [], alt = [] }]) => {
    const letters = new Set([...rows, ...cast, ...alt].join("").replaceAll(".", ""));
    const unknown = [...letters].filter((l) => !(l in FIGURE_PAL));
    return unknown.length > 0 ? [`${id} ${unknown.join("")}`] : [];
  });
  expect(strays).toEqual([]);

  const allowed = new Set<string>([...Object.values(kit).flat(), ...Object.values(TOWNS_OWN)]);
  expect(Object.values(FIGURE_PAL).filter((colour) => !allowed.has(colour))).toEqual([]);
});
