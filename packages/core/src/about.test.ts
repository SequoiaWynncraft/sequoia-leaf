import { describe, expect, test } from "bun:test";

import {
  aboutChange,
  applyAbout,
  applyList,
  listChange,
  readAboutChange,
  readWho,
  type Row,
  type Who,
} from "./about.ts";
import { below, chance, shuffled, type Stream } from "./rng.ts";

const row = (id: string, fields: Record<string, string | number | boolean | null> = {}): Row => ({
  id,
  username: id.toUpperCase(),
  place: "town",
  guest: false,
  seen_at: "2026-11-24T12:00:00.000Z",
  ...fields,
});

const who = (at: string, present: Row[], resting: Row[] = [], gone: Row[] = []): Who => ({
  at,
  present,
  resting,
  gone,
});

/** The lists a change says, from the ones before it, by the wire: as Leaf sends it and a page reads it. */
const sent = (before: Who, after: Who): Who | null => {
  const change = readAboutChange(JSON.parse(JSON.stringify(aboutChange(before, after))));
  return change === null ? null : applyAbout(before, change);
};

describe("a change to who is about", () => {
  test("says who came, who went and what changed, and makes the lists exactly as they are now", () => {
    const before = who("t1", [row("a"), row("b"), row("c")], [row("r")]);
    const after = who("t2", [row("a", { acted_at: "x" }), row("c"), row("d")], [row("b"), row("r")]);

    expect(aboutChange(before, after)).toEqual({
      at: "t2",
      lists: {
        present: { drop: ["b"], add: [[2, row("d")]], put: [{ acted_at: "x", id: "a" }] },
        resting: { add: [[0, row("b")]] },
      },
    });
    expect(sent(before, after)).toEqual(after);
  });

  test("says only when the lists were made when nothing else changed", () => {
    const before = who("t1", [row("a")]);
    expect(aboutChange(before, { ...before, at: "t2" })).toEqual({ at: "t2", lists: {} });
    expect(sent(before, { ...before, at: "t2" })).toEqual({ ...before, at: "t2" });
  });

  test("drops and adds again somebody who moved in a list, or lost a field, and keeps the rest in their order", () => {
    const before = who("t1", [], [row("a"), row("b"), row("c")]);
    const after = who("t2", [], [row("c"), row("a"), { id: "b", username: "B", place: "town", guest: false }]);

    expect(aboutChange(before, after).lists.resting).toEqual({
      drop: ["c", "b"],
      add: [
        [0, row("c")],
        [2, { id: "b", username: "B", place: "town", guest: false }],
      ],
    });
    expect(sent(before, after)).toEqual(after);
  });

  test("makes any lists into any others exactly, through any number of changes in a row", () => {
    const stream: Stream = { rng: 20261124 };
    const people = Array.from({ length: 70 }, (_, i) => `p${i}`);
    const list = (most: number): Row[] =>
      shuffled(stream, people)
        .slice(0, below(stream, most + 1))
        .map((id) =>
          row(id, {
            place: chance(stream) < 0.8 ? "town" : "works",
            acted_at: chance(stream) < 0.5 ? null : `t${below(stream, 4)}`,
          }),
        );
    // Each next set of lists is mostly the last, with some people come, gone, moved or changed.
    const nudged = (rows: readonly Row[]): Row[] => {
      const out: Row[] = [];
      for (const r of rows) if (chance(stream) > 0.1) out.push(chance(stream) < 0.2 ? { ...r, acted_at: "now" } : r);
      for (const r of list(3)) if (!out.some((o) => o.id === r.id)) out.splice(below(stream, out.length + 1), 0, r);
      if (out.length > 1 && chance(stream) < 0.3) out.push(...out.splice(below(stream, out.length), 1));
      return out;
    };
    let lists = who("t0", list(50), list(24), list(24));
    for (let n = 1; n <= 300; n++) {
      const next =
        n % 50 === 0
          ? who(`t${n}`, list(50), list(24), list(24))
          : who(`t${n}`, nudged(lists.present), nudged(lists.resting), nudged(lists.gone));
      expect(sent(lists, next)).toEqual(next);
      lists = next;
    }
  });
});

describe("a change made from other lists", () => {
  const base = [row("a"), row("b")];

  test("does not fit, and is refused rather than made into lists Leaf never made", () => {
    expect(applyList(base, { drop: ["z"] })).toBeNull();
    expect(applyList(base, { put: [{ id: "z", place: "works" }] })).toBeNull();
    expect(applyList(base, { drop: ["a"], put: [{ id: "a", place: "works" }] })).toBeNull();
    expect(applyList(base, { add: [[3, row("c")]] })).toBeNull();
    expect(applyList(base, { add: [[-1, row("c")]] })).toBeNull();
    expect(applyList(base, { add: [[0, row("a")]] })).toBeNull();
    expect(applyList(base, listChange(base, [row("b"), row("c")]))).toEqual([row("b"), row("c")]);
  });
});

describe("reading who is about", () => {
  test("reads Leaf's lists and changes, and nothing else", () => {
    const lists = who("t1", [row("a", { acted_at: null })], [], [row("g")]);
    expect(readWho(JSON.parse(JSON.stringify(lists)))).toEqual(lists);
    expect(readWho({ at: "t1", present: [{ id: 1 }], resting: [], gone: [] })).toBeNull();
    expect(readWho({ at: "t1", present: [{ id: "a", nested: {} }], resting: [], gone: [] })).toBeNull();
    expect(readWho({ present: [], resting: [], gone: [] })).toBeNull();
    expect(readAboutChange({ at: "t2", lists: { present: { drop: ["a"] } } })).toEqual({
      at: "t2",
      lists: { present: { drop: ["a"], add: [], put: [] } },
    });
    expect(readAboutChange({ at: "t2", lists: { present: { add: [["0", row("a")]] } } })).toBeNull();
    expect(readAboutChange({ at: "t2", lists: { present: { drop: [1] } } })).toBeNull();
    expect(readAboutChange({ at: "t2" })).toBeNull();
  });
});
