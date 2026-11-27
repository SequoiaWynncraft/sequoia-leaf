/**
 * Ace's cards on the page: a card only where Leaf says one was thrown, with its suit all the way to
 * where it flies, and landing on whoever it is for where they stand as it lands.
 */
import { describe, expect, test } from "bun:test";

import type { FightEvent } from "@sequoia-leaf/raid";
import { cellAt } from "@sequoia-leaf/raid/hex.ts";

import { dealing, flying, type Stands } from "./dealt.ts";
import { shotLook } from "./looks.ts";

type Shot = Extract<FightEvent, { t: "shot" }>;

/** One of Ace's shots, as Leaf says it. */
const shot = (extra: Partial<Shot>): Shot => ({
  t: "shot",
  id: 0,
  target: 1,
  from: cellAt(3, 4),
  to: cellAt(3, 1),
  ticks: 6,
  what: "attack",
  ...extra,
});

/** Draws nothing. */
const NO_DRAWING = { pip: () => undefined, stick: () => undefined };

describe("Ace's cards on the page", () => {
  test("a card flies only when Leaf's shot names its suit; never one the page made up", () => {
    expect(shotLook({ what: "attack" }, "ace")).toBeNull();
    expect(shotLook({ what: "ability" }, "ace")).toBeNull();
    expect(shotLook({ what: "attack", card: "clubs" }, "ace")).toBe("card");
  });
  test("a thrown card keeps its suit as it flies, and a plain shot has none", () => {
    expect(flying(dealing(shot({ card: "diamonds" }), () => null, null, NO_DRAWING)).card).toBe("diamonds");
    expect(flying(dealing(shot({}), () => null, null, NO_DRAWING))).not.toHaveProperty("card");
  });
  test("a card lands on whoever it is for where they stand as it lands, not where they stood at the throw", () => {
    let stands: Stands = { x: 10, y: 20, tall: 12 };
    const drawn: [string, number, number][] = [];
    const { land } = dealing(shot({ card: "spades", what: "ability" }), () => stands, null, {
      pip: (suit, on) => drawn.push([suit, on.x, on.y]),
      stick: (suit, on) => drawn.push([`${suit} stuck`, on.x, on.y]),
    });
    stands = { x: 40, y: 26, tall: 12 };
    land?.();
    expect(drawn).toEqual([
      ["spades", 40, 26],
      ["spades stuck", 40, 26],
    ]);
  });
});
