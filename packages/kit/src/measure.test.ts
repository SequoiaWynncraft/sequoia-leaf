/**
 * A card's head with no room for its name's longest word (`fitHead`): its picture goes first, then a
 * way back moves to a row of its own above; a head with room is left as it is.
 */
import { describe, expect, test } from "bun:test";

import { fitHead } from "./measure.ts";

/** A card whose head is `need` wide as laid out, `room` wide to lay it out in, less what each class takes out of it. */
function cardOf(need: number, room: number, back: boolean, saves: Readonly<Record<string, number>>): HTMLElement {
  const classes = new Set<string>();
  const head = {
    get scrollWidth() {
      return need - [...classes].reduce((n, c) => n + (saves[c] ?? 0), 0);
    },
    clientWidth: room,
    classList: { add: (c: string) => classes.add(c), contains: (c: string) => classes.has(c) },
    querySelector: (q: string) => (q === ".k-info-back" && back ? {} : null),
  };
  return Object.assign(Object.create(null), {
    querySelector: (q: string) => (q === ".k-info-head" ? head : null),
    head,
    classes,
  });
}
const classesOf = (card: HTMLElement): string[] => [...(Reflect.get(card, "classes") as Set<string>)];

describe("a card's head", () => {
  test("with room is left as it is", () => {
    const card = cardOf(300, 340, true, {});
    expect([fitHead(card), classesOf(card)]).toEqual([false, []]);
  });
  test("short of room drops its picture first; still short, its way back goes above; Close stays", () => {
    const enough = cardOf(380, 340, true, { tight: 60 });
    expect([fitHead(enough), classesOf(enough)]).toEqual([true, ["tight"]]);
    const more = cardOf(420, 340, true, { tight: 60, tighter: 50 });
    expect([fitHead(more), classesOf(more)]).toEqual([true, ["tight", "tighter"]]);
    // With no way back, the picture is all that can go.
    const alone = cardOf(420, 340, false, { tight: 60 });
    expect([fitHead(alone), classesOf(alone)]).toEqual([true, ["tight"]]);
  });
});
