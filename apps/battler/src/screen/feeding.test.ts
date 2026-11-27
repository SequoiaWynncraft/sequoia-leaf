import { describe, expect, test } from "bun:test";

import {
  choose,
  type FigureId,
  newAlmanac,
  newLooks,
  type Piece,
  predict,
  refusalText,
  type RunView,
  startRun,
  type TableView,
} from "@sequoia-leaf/raid";

import { feedOffer, feedWords, gregOf } from "./feeding.ts";

/** A run in its first room, planning, with these on the board from seat 0 and these on the bench from hollow 0. */
function planning(board: FigureId[], bench: FigureId[], fed = 0): RunView {
  const run = startRun(5);
  choose(run, 0);
  run.board.fill(null);
  run.bench.fill(null);
  const piece = (kind: FigureId): Piece => ({
    id: run.nextId++,
    kind,
    stars: 1,
    items: [],
    fed: kind === "greg" ? fed : 0,
  });
  board.forEach((kind, seat) => (run.board[seat] = piece(kind)));
  bench.forEach((kind, slot) => (run.bench[slot] = piece(kind)));
  return run;
}
const bench = (at: number) => ({ on: "bench", at }) as const;
const board = (at: number) => ({ on: "board", at }) as const;

describe("the feed target", () => {
  test("says what this figure would add before it is let go: 2% for each acorn it cost", () => {
    const run = planning(["greg"], ["worm", "chickaree", "badger"]);
    expect(gregOf(run)).toEqual(board(0));
    expect([0, 1, 2].map((at) => feedWords(feedOffer(run, bench(at)) ?? { full: true }))).toEqual([
      "Feed Greg +2%",
      "Feed Greg +4%",
      "Feed Greg +8%",
    ]);
  });

  test("shows no more than he can still eat, and says he is full, with no target, at 40%", () => {
    expect(feedOffer(planning(["greg"], ["badger"], 36), bench(0))).toEqual({ to: board(0), gained: 4 });
    const full = feedOffer(planning(["greg"], ["badger"], 40), bench(0));
    expect(full).toEqual({ full: true });
    expect(feedWords({ full: true })).toBe("Greg is full");
  });

  test("is there only for a figure from the bench, in a party with a Greg, that is not a Greg", () => {
    expect(feedOffer(planning(["worm"], ["badger"]), bench(0))).toBeNull();
    expect(feedOffer(planning(["greg", "worm"], ["badger"]), board(1))).toBeNull();
    expect(feedOffer(planning(["greg"], ["greg"]), bench(0))).toBeNull();
    // A Greg on the bench is fed too; one on the board first, the most stars first.
    expect(gregOf(planning(["worm"], ["badger", "greg"]))).toEqual(bench(1));
  });

  test("letting go does as the rules do, and what they turn down reads as their sentence", () => {
    const run = planning(["greg"], ["badger"]);
    const view: TableView = {
      runs: 1,
      run,
      endless: null,
      ventures: 0,
      week: { at: 0, deepest: { wilds: 0, deep: 0 } },
      almanac: newAlmanac(),
      trail: 0,
      looks: newLooks(),
      roster: {},
    };
    const offer = feedOffer(run, bench(0));
    if (!offer || !("to" in offer)) throw new Error("no feed target");
    const done = predict(view, { do: "feed", from: bench(0), to: offer.to });
    if (!done || !("view" in done)) throw new Error("not fed");
    expect(done.notes[0]).toMatchObject({ t: "fed", gained: offer.gained, fed: 8 });
    expect(done.view.run?.bench[0]).toBeNull();
    expect(refusalText("greg_full")).toBe("Greg is full.");
    expect(refusalText("not_from_bench")).toBe("Greg only eats from the bench.");
  });
});
