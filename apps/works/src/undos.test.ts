/**
 * What may be undone, moved by its one function: Undo pressed for the last thing not yet pressed for,
 * undone once Leaf has done all of it, the last first; let go when Leaf turned it down or it changed
 * when Leaf's yard was taken, with a line if it was pressed for; kept, with no Undo waiting, when what
 * was due could not be undone now.
 */
import { describe, expect, test } from "bun:test";

import { CHANGED, due, type Entry, KEPT, NOT_DONE, NOTHING, type UndoEvent, type Undos, undoStep } from "./undos.ts";

const kept = (id: number) => ({ done: `did ${id}`, id, tiles: [id], after: [] });
/** The value after each event in turn, and every line said on the way. */
function after(
  events: readonly UndoEvent<string>[],
  from: Undos<string> = [],
): { undos: Undos<string>; said: string[] } {
  const said: string[] = [];
  const undos = events.reduce((s, e) => {
    const next = undoStep(s, e);
    if (next.said !== null) said.push(next.said);
    return next.undos;
  }, from);
  return { undos, said };
}
const ids = (s: Undos<string>): number[] => s.map((u) => u.id);
const keep = (id: number): UndoEvent<string> => ({ do: "keep", entry: kept(id) });
const press: UndoEvent<string> = { do: "press" };
/** Leaf's yard as taken has changed what the second thing done touched. */
const holds = (u: Entry<string>): boolean => u.id !== 2;
const heard = (id: number, yes = true): UndoEvent<string> => ({ do: "heard", id, yes });

describe("what may be undone", () => {
  test("pressed for what Leaf has done, it is due at once; pressed with nothing kept, says so", () => {
    const { undos, said } = after([keep(1), heard(1), press]);
    expect(due(undos)?.id).toBe(1);
    expect(said).toEqual([]);
    expect(after([press]).said).toEqual([NOTHING]);
  });

  test("pressed before Leaf has answered, waits for Leaf, and is due once Leaf has done all of it", () => {
    const pressed = after([keep(1), press]).undos;
    expect(due(pressed)).toBeUndefined();
    expect(due(after([heard(1)], pressed).undos)?.id).toBe(1);
    // A stroke of the brush grew by a line: Leaf must answer for both.
    const stroke = after([keep(2), { do: "grow", entry: kept(2) }, press, heard(2)]).undos;
    expect(due(stroke)).toBeUndefined();
    expect(due(after([heard(2)], stroke).undos)?.id).toBe(2);
  });

  test("pressed twice, is for the last two, the last first, and the last waits for Leaf before the one under it", () => {
    const twice = after([keep(1), keep(2), press, press, heard(1)]).undos;
    expect(twice.map((u) => u.asked)).toEqual([true, true]);
    // The one under is answered, the last is not: nothing yet, so they go the last first.
    expect(due(twice)).toBeUndefined();
    const answered = after([heard(2)], twice).undos;
    expect(due(answered)?.id).toBe(2);
    expect(due(after([{ do: "undone", id: 2 }], answered).undos)?.id).toBe(1);
    // A third press finds nothing more.
    expect(after([press], twice).said).toEqual([NOTHING]);
  });

  test("done again after the press, the press is still for what it was pressed for", () => {
    const { undos } = after([keep(1), press, keep(2), heard(1)]);
    expect(due(undos)?.id).toBe(1);
    expect(undos.find((u) => u.id === 2)?.asked).toBe(false);
  });

  test("turned down by Leaf, is let go: said so if it was pressed for, and nothing older is pressed for instead", () => {
    const pressed = after([keep(1), heard(1), keep(2), press, heard(2, false)]);
    expect([ids(pressed.undos), pressed.said, due(pressed.undos)]).toEqual([[1], [NOT_DONE], undefined]);
    const unpressed = after([keep(1), keep(2), heard(2, false)]);
    expect([ids(unpressed.undos), unpressed.said]).toEqual([[1], []]);
  });

  test("changed when Leaf's yard is taken, is let go: said so if it was pressed for", () => {
    const pressed = after([keep(1), keep(2), press, { do: "took", holds }]);
    expect([ids(pressed.undos), pressed.said]).toEqual([[1], [CHANGED]]);
    const unpressed = after([keep(1), keep(2), { do: "took", holds }]);
    expect([ids(unpressed.undos), unpressed.said]).toEqual([[1], []]);
    // Nothing changed: the value is the same one.
    const s = after([keep(1)]).undos;
    expect(undoStep(s, { do: "took", holds: () => true }).undos).toBe(s);
  });

  test(`keeps the last ${KEPT} things done`, () => {
    const many = after(Array.from({ length: KEPT + 5 }, (_, k) => keep(k + 1))).undos;
    expect([many.length, many[0]?.id, many.at(-1)?.id]).toEqual([KEPT, 6, KEPT + 5]);
  });

  test("what could not be undone now stays to be undone, and no Undo waits, for it or for what came before it", () => {
    const pressed = after([keep(1), heard(1), keep(2), heard(2), press, press]).undos;
    expect(due(pressed)?.id).toBe(2);
    const stuck = after([{ do: "stuck" }], pressed);
    expect([ids(stuck.undos), due(stuck.undos), stuck.said]).toEqual([[1, 2], undefined, []]);
    // Pressed again, it is the one due.
    expect(due(after([press], stuck.undos).undos)?.id).toBe(2);
  });
});
