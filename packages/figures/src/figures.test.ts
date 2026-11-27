import { expect, test } from "bun:test";

import * as kit from "@sequoia-leaf/kit/palette.ts";
import { everySetDrawn, everyShared } from "@sequoia-leaf/raid/content/catalog.ts";
import { SUMMON_IDS, TROUBLE_IDS } from "@sequoia-leaf/raid/content/figures.ts";
import { TRUE_FORM_IDS } from "@sequoia-leaf/raid/content/graid.ts";

import { artOf, carrying } from "./figures.ts";
import { FIGURE_PAL, TOWNS_OWN } from "./pal.ts";
import { readRows } from "./rows.ts";
import { isPersonId } from "./sprites.ts";

/** Everyone on the board typed as rows: all but the people, who are drawn from a member's skin. */
const TYPED = [...everySetDrawn(), ...SUMMON_IDS, ...TROUBLE_IDS].filter((id) => !isPersonId(id));

test("every figure a member can own that the set draws has its pictures, standing and casting", () => {
  const missing = everySetDrawn().filter((id) => artOf(id).rows.length === 0 || (artOf(id).cast ?? []).length === 0);
  expect(missing).toEqual([]);
});

test("everything on the board is drawn in the town's colours: the kit's palette, and what the town's own creatures have", () => {
  const arts = [
    ...TYPED.map((id) => [id, artOf(id)] as const),
    ...TRUE_FORM_IDS.map((id) => [`${id} true`, artOf(id, "true")] as const),
  ];
  const strays = arts.flatMap(([id, { rows, cast = [], alt = [], prop }]) => {
    const letters = new Set([...rows, ...cast, ...alt, ...(prop?.rows ?? [])].join("").replaceAll(".", ""));
    const unknown = [...letters].filter((l) => !(l in FIGURE_PAL));
    return unknown.length > 0 ? [`${id} ${unknown.join("")}`] : [];
  });
  expect(strays).toEqual([]);

  const allowed = new Set<string>([...Object.values(kit).flat(), ...Object.values(TOWNS_OWN)]);
  expect(Object.values(FIGURE_PAL).filter((colour) => !allowed.has(colour))).toEqual([]);
});

test("figures.txt names only the stump's figures and their other pictures, and every figure stands", async () => {
  const kinds: readonly string[] = TYPED;
  const named = [...readRows(await Bun.file(new URL("figures.txt", import.meta.url)).text()).keys()];
  const forms: readonly string[] = TRUE_FORM_IDS;
  const stray = (name: string): boolean => {
    const [kind = "", second] = name.replace(/ (cast|alt|fall|peck|draw|top|down|prop)$/, "").split(" ");
    return second === undefined ? !kinds.includes(kind) : second !== "true" || !forms.includes(kind);
  };
  expect(named.filter(stray)).toEqual([]);
  expect(kinds.filter((kind) => !named.includes(kind))).toEqual([]);
});

test("each of Graid's five has a true form, standing and casting, every row of a picture as wide as the rest", () => {
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

test("what a figure carries sits inside its pictures, standing and casting, and is laid over them a letter at a time", () => {
  for (const id of TYPED) {
    const { rows, cast = rows, prop } = artOf(id);
    if (!prop) continue;
    const inside = (pic: readonly string[], [x, y]: readonly [number, number]): boolean =>
      y >= 0 &&
      x >= 0 &&
      y + prop.rows.length <= pic.length &&
      x + 1 + (prop.rows[0]?.length ?? 0) <= (pic[0]?.length ?? 0);
    expect([id, prop.at.every((at) => inside(rows, at)), prop.castAt.every((at) => inside(cast, at))]).toEqual([
      id,
      true,
      true,
    ]);
  }
  // Two of three, the second rocked a pixel aside; the third place left as it was.
  const laid = carrying(
    ["....", "....", "...."],
    ["ab"],
    [
      [0, 0],
      [1, 1],
      [2, 2],
    ],
    { n: 2, rock: 1 },
  );
  expect(laid).toEqual(["ab..", "..ab", "...."]);
});

test("Jet lies flat, so it falls belly up where it lies; everyone else tips onto its side", () => {
  expect(TYPED.filter((id) => artOf(id).flat === true)).toEqual(["jet"]);
  // Its standing picture is wider than it is tall, as one lying on its belly is.
  const { rows } = artOf("jet");
  expect((rows[0]?.length ?? 0) > rows.length).toBe(true);
});
