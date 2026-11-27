import { expect, test } from "bun:test";

import * as kit from "@sequoia-leaf/kit/palette.ts";
import { everyShared } from "@sequoia-leaf/raid/content/catalog.ts";
import { SUMMON_IDS, TROUBLE_IDS } from "@sequoia-leaf/raid/content/figures.ts";
import { TRUE_FORM_IDS } from "@sequoia-leaf/raid/content/groot.ts";

import { artOf } from "./figures.ts";
import { FIGURE_PAL, TOWNS_OWN } from "./pal.ts";
import { readRows } from "./rows.ts";

test("every figure a member can own has its pictures, standing and casting", () => {
  const missing = everyShared().filter((id) => artOf(id).rows.length === 0 || (artOf(id).cast ?? []).length === 0);
  expect(missing).toEqual([]);
});

test("everything on the board is drawn in the town's colours: the kit's palette, and what the town's own creatures have", () => {
  const kinds = [...everyShared(), ...SUMMON_IDS, ...TROUBLE_IDS];
  const arts = [
    ...kinds.map((id) => [id, artOf(id)] as const),
    ...TRUE_FORM_IDS.map((id) => [`${id} true`, artOf(id, "true")] as const),
  ];
  const strays = arts.flatMap(([id, { rows, cast = [], alt = [] }]) => {
    const letters = new Set([...rows, ...cast, ...alt].join("").replaceAll(".", ""));
    const unknown = [...letters].filter((l) => !(l in FIGURE_PAL));
    return unknown.length > 0 ? [`${id} ${unknown.join("")}`] : [];
  });
  expect(strays).toEqual([]);

  const allowed = new Set<string>([...Object.values(kit).flat(), ...Object.values(TOWNS_OWN)]);
  expect(Object.values(FIGURE_PAL).filter((colour) => !allowed.has(colour))).toEqual([]);
});

test("figures.txt names only the stump's figures and their other pictures, and every figure stands", async () => {
  const kinds: readonly string[] = [...everyShared(), ...SUMMON_IDS, ...TROUBLE_IDS];
  const named = [...readRows(await Bun.file(new URL("figures.txt", import.meta.url)).text()).keys()];
  const forms: readonly string[] = TRUE_FORM_IDS;
  const stray = (name: string): boolean => {
    const [kind = "", second] = name.replace(/ (cast|alt)$/, "").split(" ");
    return second === undefined ? !kinds.includes(kind) : second !== "true" || !forms.includes(kind);
  };
  expect(named.filter(stray)).toEqual([]);
  expect(kinds.filter((kind) => !named.includes(kind))).toEqual([]);
});

test("each of Groot's five has a true form, standing and casting, every row of a picture as wide as the rest", () => {
  for (const id of TRUE_FORM_IDS) {
    const { rows, cast = [] } = artOf(id, "true");
    expect([id, rows.length > 0, cast.length > 0]).toEqual([id, true, true]);
    expect([id, new Set(rows.map((r) => r.length)).size, new Set(cast.map((r) => r.length)).size]).toEqual([id, 1, 1]);
    // A true form is not the figure as it was.
    expect(rows).not.toEqual(artOf(id).rows);
  }
});

test("Seqwawa stands a hex and a half tall, and its small picture keeps the room the stall had", () => {
  const before = everyShared()
    .filter((id) => id !== "seqwawa")
    .map((id) => artOf(id).rows.length);
  const tallest = Math.max(...before);
  const art = artOf("seqwawa");
  expect(art.rows.length).toBeGreaterThan(tallest);
  expect(art.room ?? art.rows.length).toBeLessThanOrEqual(tallest);
  // Its breath and its wind-up are pictures of their own, all typed to one width and height.
  expect([art.alt?.length, art.cast?.length]).toEqual([art.rows.length, art.rows.length]);
});
