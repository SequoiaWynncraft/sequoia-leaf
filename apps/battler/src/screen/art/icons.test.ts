import { expect, test } from "bun:test";

import { readRows } from "@sequoia-leaf/figures/rows.ts";
import { BOON_IDS } from "@sequoia-leaf/raid/content/boons.ts";
import { COMPONENT_IDS, FINISHED_IDS, isEmblemId } from "@sequoia-leaf/raid/content/items.ts";
import { TRAIT_IDS } from "@sequoia-leaf/raid/content/traits.ts";

import { GLYPHS } from "./icons.ts";

test("icons.txt has a picture for every trait, item, kind of room and sign, a boon's own for each that is not a charm, a number for each level, and nothing else", async () => {
  const named = [...readRows(await Bun.file(new URL("icons.txt", import.meta.url)).text()).keys()];
  const wanted = [
    ...TRAIT_IDS.map((id) => `trait ${id}`),
    ...[...COMPONENT_IDS, ...FINISHED_IDS].map((id) => `item ${id}`),
    ...BOON_IDS.filter((id) => !isEmblemId(id)).map((id) => `boon ${id}`),
    ...["trouble", "spar", "boss"].map((kind) => `room ${kind}`),
    ...GLYPHS.map((id) => `glyph ${id}`),
    ...[1, 2, 3, 4, 5, 6].map((level) => `level ${level}`),
  ];
  expect(named.toSorted()).toEqual(wanted.toSorted());
});
