/**
 * A card's head with no room for its name's longest word (`fitHead`): its picture goes first, then a
 * way back moves to a row of its own above; a head with room is left as it is.
 */
import { describe, expect, test } from "bun:test";

import { fitHead } from "./measure.ts";

/** A card whose close button's right edge is at `need` (less what each class takes out of the row), in a head whose right edge is at `room`. */
function cardOf(
  need: number,
  room: number,
  back: boolean,
  saves: Readonly<Record<string, number>>,
): [HTMLElement, Set<string>] {
  const classes = new Set<string>();
  const right = (): number => need - [...classes].reduce((n, c) => n + (saves[c] ?? 0), 0);
  const close = { getBoundingClientRect: () => ({ right: right() }) };
  const head = {
    lastElementChild: close,
    getBoundingClientRect: () => ({ right: room }),
    classList: { add: (c: string) => classes.add(c) },
    querySelector: (q: string) => (q === ".k-info-back" && back ? {} : null),
  };
  const card: HTMLElement = Object.assign(Object.create(null), {
    querySelector: (q: string) => (q === ".k-info-head" ? head : null),
  });
  return [card, classes];
}

describe("a card's head", () => {
  test("with room is left as it is", () => {
    const [card, classes] = cardOf(300, 340, true, {});
    expect([fitHead(card), [...classes]]).toEqual([false, []]);
  });
  test("short of room drops its picture first; still short, its way back goes above; Close stays", () => {
    const [enough, a] = cardOf(380, 340, true, { tight: 60 });
    expect([fitHead(enough), [...a]]).toEqual([true, ["tight"]]);
    const [more, b] = cardOf(420, 340, true, { tight: 60, tighter: 50 });
    expect([fitHead(more), [...b]]).toEqual([true, ["tight", "tighter"]]);
    // With no way back, the picture is all that can go.
    const [alone, c] = cardOf(420, 340, false, { tight: 60 });
    expect([fitHead(alone), [...c]]).toEqual([true, ["tight"]]);
  });
});
