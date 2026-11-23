import { expect, test } from "bun:test";

import * as kit from "@sequoia-leaf/kit/palette.ts";
import { FIGURE_IDS, SUMMON_IDS, TROUBLE_IDS } from "@sequoia-leaf/raid/content/figures.ts";

import { artOf } from "./figures.ts";
import { FIGURE_PAL, TOWNS_OWN } from "./pal.ts";
import { readRows } from "./rows.ts";

test("every figure a member can own has its pictures, standing and casting", () => {
  const missing = FIGURE_IDS.filter((id) => artOf(id).rows.length === 0 || (artOf(id).cast ?? []).length === 0);
  expect(missing).toEqual([]);
});

test("everything on the board is drawn in the town's colours: the kit's palette, and what the town's own creatures have", () => {
  const kinds = [...FIGURE_IDS, ...SUMMON_IDS, ...TROUBLE_IDS];
  const strays = kinds.flatMap((id) => {
    const { rows, cast = [], alt = [] } = artOf(id);
    const letters = new Set([...rows, ...cast, ...alt].join("").replaceAll(".", ""));
    const unknown = [...letters].filter((l) => !(l in FIGURE_PAL));
    return unknown.length > 0 ? [`${id} ${unknown.join("")}`] : [];
  });
  expect(strays).toEqual([]);

  const allowed = new Set<string>([...Object.values(kit).flat(), ...Object.values(TOWNS_OWN)]);
  expect(Object.values(FIGURE_PAL).filter((colour) => !allowed.has(colour))).toEqual([]);
});

test("figures.txt names only the stump's figures and their other pictures, and every figure stands", async () => {
  const kinds: readonly string[] = [...FIGURE_IDS, ...SUMMON_IDS, ...TROUBLE_IDS];
  const named = [...readRows(await Bun.file(new URL("figures.txt", import.meta.url)).text()).keys()];
  expect(named.filter((name) => !kinds.includes(name.replace(/ (cast|alt)$/, "")))).toEqual([]);
  expect(kinds.filter((kind) => !named.includes(kind))).toEqual([]);
});
