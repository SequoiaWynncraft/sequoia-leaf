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

/** Somebody's row at `owner`'s camp, with whose it is as Leaf names it; or in town, with nothing of a camp. */
const atCamp = (r: Row, owner: string | null): Row => {
  const { camp_owner: _owner, camp_owner_name: _name, ...rest } = r;
  return owner === null
    ? { ...rest, place: "town" }
    : { ...rest, place: "camp", camp_owner: owner, camp_owner_name: owner.toUpperCase() };
};

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
      drop: ["b", "c"],
      add: [
        [0, row("c")],
        [2, { id: "b", username: "B", place: "town", guest: false }],
      ],
    });
    expect(sent(before, after)).toEqual(after);
  });

  test("keeps in their order only those with every field they had, the rest dropped and added again anyway", () => {
    // Alice lost a field and moved; Bob only moved: keeping Bob in his place, Alice alone is said again.
    const before = [row("a", { acted_at: "x" }), row("b")];
    const after = [row("b"), row("a")];

    expect(listChange(before, after)).toEqual({ drop: ["a"], add: [[1, row("a")]] });
    expect(applyList(before, listChange(before, after))).toEqual(after);
  });

  test("says a change of camp as the camp's fields, and somebody leaving a camp as dropped and added again", () => {
    const before = who("t1", [atCamp(row("a"), "b"), row("c"), atCamp(row("d"), "d")]);
    const after = who("t2", [atCamp(row("a"), "c"), atCamp(row("c"), "c"), atCamp(row("d"), null)]);

    expect(aboutChange(before, after).lists.present).toEqual({
      drop: ["d"],
      add: [[2, atCamp(row("d"), null)]],
      put: [
        { camp_owner: "c", camp_owner_name: "C", id: "a" },
        { place: "camp", camp_owner: "c", camp_owner_name: "C", id: "c" },
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
        .map((id) => {
          const r = row(id, {
            place: chance(stream) < 0.8 ? "town" : "works",
            acted_at: chance(stream) < 0.5 ? null : `t${below(stream, 4)}`,
          });
          return chance(stream) < 0.2 ? atCamp(r, `p${below(stream, 5)}`) : r;
        });
    // Each next set of lists is mostly the last, with some people come, gone, moved or changed.
    const nudged = (rows: readonly Row[]): Row[] => {
      const out: Row[] = [];
      // Some do something, and some go to another camp, or leave theirs for town.
      for (const r of rows) {
        if (chance(stream) <= 0.1) continue;
        const roll = chance(stream);
        out.push(
          roll < 0.2
            ? { ...r, acted_at: "now" }
            : roll < 0.3
              ? atCamp(r, roll < 0.25 ? `p${below(stream, 5)}` : null)
              : r,
        );
      }
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

/** Whether `after` is the same person as `before` with every field `before` had. */
const sameWithAll = (before: Row | undefined, after: Row | undefined): boolean =>
  before !== undefined && before.id === after?.id && Object.keys(before).every((key) => Object.hasOwn(after, key));

/**
 * The most of `before`'s people, each with every field they had, `after` can keep in their order,
 * by the table `listChange` once filled whole (the longest sequence common to both): what its
 * changes are held to.
 */
function mostKept(before: readonly Row[], after: readonly Row[]): number {
  let next = Array.from({ length: after.length + 1 }, () => 0);
  for (let i = before.length - 1; i >= 0; i--) {
    const here = Array.from({ length: after.length + 1 }, () => 0);
    for (let j = after.length - 1; j >= 0; j--)
      here[j] = sameWithAll(before[i], after[j]) ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, here[j + 1] ?? 0);
    next = here;
  }
  return next[0] ?? 0;
}

describe("how one list became the next", () => {
  test("keeps as many in their order as the whole table did, and makes the new list exactly", () => {
    const stream: Stream = { rng: 20261125 };
    const people = Array.from({ length: 40 }, (_, i) => `p${i}`);
    // Half of them have a field the rest lack, which they may lose.
    const list = (): Row[] =>
      shuffled(stream, people)
        .slice(0, below(stream, people.length + 1))
        .map((id) => (chance(stream) < 0.5 ? row(id, { acted_at: "t0" }) : row(id)));
    // People come, go, change, lose a field and move, a few or many at once.
    const changedFrom = (rows: readonly Row[]): Row[] => {
      const out = rows
        .filter(() => chance(stream) > 0.2)
        .map((r) => {
          const roll = chance(stream);
          return roll < 0.2 ? row(r.id, { acted_at: `t${below(stream, 3)}` }) : roll < 0.3 ? row(r.id) : r;
        });
      for (const r of list())
        if (chance(stream) < 0.1 && !out.some((o) => o.id === r.id)) out.splice(below(stream, out.length + 1), 0, r);
      for (let moves = below(stream, 4); moves > 0 && out.length > 1; moves--)
        out.splice(below(stream, out.length), 0, ...out.splice(below(stream, out.length), 1));
      return out;
    };
    for (let n = 0; n < 500; n++) {
      const before = list();
      const after = n % 5 === 0 ? list() : changedFrom(before);
      const change = listChange(before, after);
      const added = change?.add?.length ?? 0;

      expect(applyList(before, change)).toEqual(after);
      expect([after.length - added, before.length - (change?.drop?.length ?? 0) + added]).toEqual([
        mostKept(before, after),
        after.length,
      ]);
    }
  });

  test("of 20,000 people, takes a step or a few a person, however the list changed", () => {
    const people = Array.from({ length: 20_000 }, (_, i) => row(`p${i}`));
    const first = people[0] ?? row("p0");
    const lists = [
      people.map((r, i) => (i === 10_000 ? row(r.id, { acted_at: "now" }) : r)),
      [...people.slice(1, 15_000), first, ...people.slice(15_000)],
      people.toReversed(),
      shuffled({ rng: 7 }, people),
    ];
    const began = performance.now();
    const changes = lists.map((after) => listChange(people, after));
    // About 40 ms on a quiet machine. The whole table this replaced would fill 400 million cells for each.
    expect(performance.now() - began).toBeLessThan(4000);
    expect(changes[0]).toEqual({ put: [{ acted_at: "now", id: "p10000" }] });
    expect(changes[1]).toEqual({ drop: ["p0"], add: [[14_999, first]] });
    expect(changes.map((change) => applyList(people, change))).toEqual(lists);
  }, 20_000);
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
    // A list with somebody in it twice is none of Leaf's: nothing fits it, not even no change.
    expect(applyList([row("a"), row("a")], undefined)).toBeNull();
    expect(applyList([row("a"), row("a")], { drop: ["a"] })).toBeNull();
  });
});

describe("reading who is about", () => {
  test("reads Leaf's lists and changes, and nothing else", () => {
    const lists = who("t1", [row("a", { acted_at: null })], [], [row("g")]);
    expect(readWho(JSON.parse(JSON.stringify(lists)))).toEqual(lists);
    expect(readWho({ at: "t1", present: [{ id: 1 }], resting: [], gone: [] })).toBeNull();
    expect(readWho({ at: "t1", present: [{ id: "a", nested: {} }], resting: [], gone: [] })).toBeNull();
    expect(readWho({ present: [], resting: [], gone: [] })).toBeNull();
    // Nobody is in a list twice: lists that have somebody so are none of Leaf's.
    expect(readWho({ at: "t1", present: [row("a"), row("a")], resting: [], gone: [] })).toBeNull();
    expect(readWho({ at: "t1", present: [row("a")], resting: [row("a")], gone: [] })).not.toBeNull();
    expect(readAboutChange({ at: "t2", lists: { present: { drop: ["a"] } } })).toEqual({
      at: "t2",
      lists: { present: { drop: ["a"], add: [], put: [] } },
    });
    expect(readAboutChange({ at: "t2", lists: { present: { add: [["0", row("a")]] } } })).toBeNull();
    expect(readAboutChange({ at: "t2", lists: { present: { drop: [1] } } })).toBeNull();
    expect(readAboutChange({ at: "t2" })).toBeNull();
  });
});
