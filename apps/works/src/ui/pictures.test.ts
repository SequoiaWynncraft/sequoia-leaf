/**
 * Whatever a screen shows as a thing has a picture. This walks the rules' tables: every item, every
 * kind of piece, every tool, every number a goal may raise, and so every thing any goal unlocks; and
 * every goal (a lesson, a project, a commission, a piece of research) has a thing whose picture
 * stands for it. A thing added to the tables without one fails here, by its name.
 *
 * Nothing is drawn (there is no canvas here): each picture is looked up in the table it is drawn
 * from, which is what the page itself does.
 */
import { describe, expect, test } from "bun:test";

import {
  ALL_GOALS,
  ALL_ITEMS,
  ALL_KINDS,
  GOALS,
  isNode,
  itemName,
  kindName,
  START,
  TOOLS,
  type Unlock,
  unlocked,
  unlockedBy,
} from "@sequoia-leaf/factory";

import { KIND_PIC } from "../art/index.ts";
import { ROWS } from "../art/items.ts";
import { PERK_ART, TOOL_ICON } from "./cards.ts";
import { pictureRef, unlockRef } from "./refs.ts";

/** Whether a thing's rows are a picture: some rows, of one width, with something drawn on them. */
const drawn = (rows: readonly string[] | undefined): boolean =>
  rows !== undefined &&
  rows.length > 0 &&
  rows.every((row) => row.length === rows[0]?.length) &&
  rows.some((row) => /[^.]/.test(row));

/** Whether a thing unlocked has a picture, in the table its kind of thing is drawn from. */
function pictured(u: Unlock): boolean {
  switch (u.is) {
    case "kind":
    case "grade":
      return typeof KIND_PIC[kindName(u.kind)] === "function";
    case "recipe":
      return drawn(ROWS[itemName(u.item)]);
    case "tool":
      return typeof TOOL_ICON[u.tool] === "string";
    case "number":
      return typeof PERK_ART[u.of] === "function";
    case "blueprints":
    case "board":
    case "first":
    case "ins":
      return typeof PERK_ART[u.is] === "function";
    // A plot's card has the one picture every plot has.
    case "plot":
      return true;
  }
}

describe("a picture for everything a screen shows", () => {
  test("every item in the tables", () => {
    expect(new Set(ALL_ITEMS.map(itemName)).size).toBe(ALL_ITEMS.length);
    for (const k of ALL_ITEMS) expect([itemName(k), drawn(ROWS[itemName(k)])]).toEqual([itemName(k), true]);
  });

  test("every kind of piece, the depot too", () => {
    expect(new Set(ALL_KINDS.map(kindName)).size).toBe(ALL_KINDS.length);
    for (const k of ALL_KINDS) expect([kindName(k), typeof KIND_PIC[kindName(k)]]).toEqual([kindName(k), "function"]);
  });

  test("every tool, and every number a goal may raise", () => {
    for (const tool of TOOLS) expect([tool, typeof TOOL_ICON[tool]]).toEqual([tool, "string"]);
    for (const of of [
      "stops",
      "crate",
      "reach",
      "depot",
      "span",
      "away",
      "hooks",
      "blueprints",
      "board",
      "first",
    ] as const)
      expect([of, typeof PERK_ART[of]]).toEqual([of, "function"]);
  });

  test("every thing a new yard has or a goal unlocks, each with a card to open", () => {
    const all = [...unlocked(START), ...ALL_GOALS.flatMap((g) => unlockedBy(g))];
    expect(all.length).toBeGreaterThan(30);
    for (const u of all) {
      expect([u.name, pictured(u)]).toEqual([u.name, true]);
      expect(unlockRef(u)).toMatch(/^(?:machine|item|plot|tool|perk):/);
    }
  });

  test("every goal: a lesson, a project, a commission and a piece of research each stand for a thing that has one", () => {
    for (const g of ALL_GOALS) {
      const id = GOALS[g]?.id ?? "";
      const ref = pictureRef(g);
      expect([id, ref !== null]).toEqual([id, true]);
      // Research is known by what it unlocks: a piece of it that unlocked nothing would have only a folio to show.
      if (!isNode(g)) expect([id, unlockedBy(g).length > 0]).toEqual([id, true]);
    }
  });
});
