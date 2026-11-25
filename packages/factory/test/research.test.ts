/**
 * Research: one piece studied and up to three waiting; a Study holding a folio the research still
 * wants puts one toward it every 50 ticks at grade 1, and what the research does not want stays in
 * the Study; a Study's work belongs to the research it was begun for, and is kept with the yard;
 * known, research unlocks, the next begins, and the yard has news of it. It goes on while the owner
 * is away.
 *
 * Which research and which folios are read from the tables: the research of the first tier that has
 * any, those that need nothing first, the folio each wants. No test names a piece of research or a
 * count from the tables.
 */
import { describe, expect, test } from "bun:test";

import type { Ctx } from "@sequoia-leaf/core";

import * as F from "../src/index.ts";
import { folioOf, freeResearch, idOf, researchOf } from "./goals.ts";
import { bareLand } from "./land.ts";
import { give, must } from "./yards.ts";

const tier = Math.min(...F.GOALS.filter((g) => g.kind === "research").map((g) => g.tier));
const free = freeResearch(tier);
/** The research of the tier with nothing needed that wants the most folios, its folio, and another that wants that folio. */
const big = free.toSorted((a, b) => folioOf(b).n - folioOf(a).n)[0] ?? F.goal("oilpress");
const { folio } = folioOf(big);
const next = free.find((g) => g !== big && folioOf(g).folio === folio) ?? big;
/** A folio the big research does not want. */
const stray = F.FOLIOS.find((f) => (F.GOALS[big]?.want[f] ?? 0) === 0);
/** Research of the tier that needs another first. */
const blocked = researchOf(tier).find((g) => (F.GOALS[g]?.needs.length ?? 0) > 0);

/** What a piece of research has been given of the folio: all it wants once it is known. */
const given = (y: F.Yard, g: F.Goal): number =>
  y.open.done[g] === 1 ? (F.GOALS[g]?.want[folio] ?? 0) : (y.got[g]?.[folio] ?? 0);
const wants = (g: F.Goal): number => F.GOALS[g]?.want[folio] ?? 0;
/** The line of research, by id. */
const ids = (y: F.Yard): string[] => y.line.map(idOf);

/** A yard with the research's tier open (every node below done, no research) on a bare land, with Studies by the depot holding what is asked. */
function studies(...hold: readonly (readonly [F.Item, number])[][]): { y: F.Yard; rows: number[] } {
  const y = F.create({ land: bareLand(13, 9, [], [9, 4]), tier, seed: 1 });
  const rows = hold.map((things, k) => {
    must(y, { do: "build", kind: "study", x: 5 + k, y: 7, dir: 0 });
    const r = y.row[F.at(y, 5 + k, 7)] ?? -1;
    for (const [n, c] of things) for (let m = 0; m < c; m++) F.put(y.holders, r, n);
    return r;
  });
  return { y, rows };
}
const run = (y: F.Yard, ticks: number): void => {
  for (let k = 0; k < ticks; k++) F.step(y);
};

describe("the line", () => {
  test("research can be studied once its tier is open and what it needs is known; one is studied and the rest of the line waits", () => {
    const early = F.create({ tier: tier - 1 });
    expect(give(early, { do: "study", research: idOf(big) })).toMatchObject({ refused: "cannot_study" });
    const y = F.create({ tier });
    if (blocked !== undefined)
      expect(give(y, { do: "study", research: idOf(blocked) })).toMatchObject({
        refused: "cannot_study",
        why: `${F.GOALS[blocked]?.title} cannot be studied yet`,
      });
    const line = free.slice(0, F.LINE);
    for (const g of line) must(y, { do: "study", research: idOf(g) });
    const more = free[F.LINE];
    if (more !== undefined)
      expect(give(y, { do: "study", research: idOf(more) })).toMatchObject({ refused: "cannot_study" });
    // Studied already, it cannot be put in the line again.
    expect(give(y, { do: "study", research: idOf(line.at(-1) ?? big) })).toMatchObject({ refused: "cannot_study" });
    const out = line.at(-1) ?? big;
    must(y, { do: "unstudy", research: idOf(out) });
    expect(give(y, { do: "unstudy", research: idOf(out) })).toMatchObject({ refused: "not_studied" });
    if (more !== undefined) must(y, { do: "study", research: idOf(more) });
    expect(ids(y)).toEqual([...line.slice(0, -1), ...(more === undefined ? [] : [more])].map(idOf));
    // Taken out while it is studied, the next begins.
    must(y, { do: "unstudy", research: idOf(line[0] ?? big) });
    expect(y.line[0]).toBe(line[1] ?? more);
  });
});

describe("a Study", () => {
  test("holding folios the research wants, puts one toward it every 50 ticks at grade 1, and every 100 / 3 at grade 2", () => {
    const { y, rows } = studies([[folio, 20]]);
    must(y, { do: "study", research: idOf(big) });
    run(y, 100);
    expect(given(y, big)).toBe(Math.min(2, wants(big)));
    expect(F.held(y.holders, rows[0] ?? -1, folio)).toBe(20 - Math.min(2, wants(big)));
    const faster = studies([[folio, 20]]);
    faster.y.grade[F.at(faster.y, 5, 7)] = 2;
    must(faster.y, { do: "study", research: idOf(big) });
    run(faster.y, 100);
    expect(given(faster.y, big)).toBe(Math.min(3, wants(big)));
  });

  test("part-way through a folio, keeps its work and the folio it works on when the yard is kept and read back", () => {
    const { y } = studies([[folio, 2]]);
    must(y, { do: "study", research: idOf(big) });
    run(y, 30);
    const back = F.decode(F.encode(y), y.land);
    if (!back) throw new Error("the yard does not read back");
    expect(F.check(back)).toBe(F.check(y));
    run(back, 20);
    expect(given(back, big)).toBe(1);
  });

  test("its work belongs to the research it was begun for: taking that out of the line drops it; tipping out another folio does not", () => {
    if (stray === undefined) throw new Error("every folio is wanted");
    expect(wants(big)).toBeGreaterThan(2);
    const { y } = studies([
      [folio, 3],
      [stray, 2],
    ]);
    must(y, { do: "study", research: idOf(big) });
    run(y, 30);
    must(y, { do: "tipOut", x: 5, y: 7, item: F.itemName(stray) });
    run(y, 20);
    expect(given(y, big)).toBe(1);
    run(y, 30);
    must(y, { do: "unstudy", research: idOf(big) });
    must(y, { do: "study", research: idOf(big) });
    run(y, 20);
    expect(given(y, big)).toBe(1);
    run(y, 30);
    expect(given(y, big)).toBe(2);
  });

  test("takes folios in from a belt, and keeps up to 20 of each kind", () => {
    const { y, rows } = studies([]);
    must(y, { do: "build", kind: "crate", x: 3, y: 7, dir: 0 });
    must(y, { do: "build", kind: "belt", x: 4, y: 7, dir: 0 });
    const crate = y.row[F.at(y, 3, 7)] ?? -1;
    for (let m = 0; m < 30; m++) F.put(y.holders, crate, folio);
    run(y, 300);
    expect(F.held(y.holders, rows[0] ?? -1, folio)).toBe(F.STUDY_HOLDS);
  });

  test("keeps a folio the research does not want, and says what it waits for", () => {
    if (stray === undefined) throw new Error("every folio is wanted");
    const { y, rows } = studies([[stray, 5]]);
    must(y, { do: "study", research: idOf(big) });
    run(y, 300);
    expect(F.held(y.holders, rows[0] ?? -1, stray)).toBe(5);
    expect(F.status(y, F.at(y, 5, 7))).toMatchObject({ state: "waiting", missing: [folio] });
  });

  test("known, research unlocks what it unlocks, the next in line begins, and the yard has news of it; no folio is lost on the way", () => {
    // The first given all it wants but one; a Study holding two, the second of which goes to the next.
    const first = free.find((g) => g !== next && folioOf(g).folio === folio) ?? big;
    const { y, rows } = studies([[folio, 2]]);
    must(y, { do: "study", research: idOf(first) });
    must(y, { do: "study", research: idOf(next) });
    F.giveGoal(y, first, folio, wants(first) - 1);
    const unlocks = F.GOALS[first]?.unlocks ?? {};
    const opened = (): number[] => [
      ...(unlocks.recipes ?? []).map((n) => y.open.recipes[F.item(n)] ?? 0),
      ...(unlocks.kinds ?? []).map((k) => y.open.kinds[F.kind(k)] ?? 0),
    ];
    expect(opened().every((n) => n === 0)).toBe(true);
    run(y, 200);
    expect(y.open.done[first]).toBe(1);
    expect(opened().every((n) => n > 0)).toBe(true);
    expect(y.line[0]).toBe(next);
    expect(given(y, next)).toBe(1);
    expect(rows.reduce((sum, r) => sum + F.held(y.holders, r, folio), 0)).toBe(0);
    expect(F.drain(y)).toContainEqual({ kind: "done", goal: idOf(first), title: F.GOALS[first]?.title ?? "", pay: 0 });
  });

  test("read back with a line play could not have made, keeps only what play could study, and its work and folio only while the research they were for is first: never lost to it, never given to another; read twice, the same yard", () => {
    const { y, rows } = studies([[folio, 3]]);
    must(y, { do: "study", research: idOf(big) });
    must(y, { do: "study", research: idOf(next) });
    run(y, 30);
    const rec: unknown = JSON.parse(F.encode(y));
    if (typeof rec !== "object" || rec === null || !("done" in rec) || !Array.isArray(rec.done))
      throw new Error("not a kept yard");
    const r = rows[0] ?? -1;
    expect([y.holders.work[r], y.holders.making[r]]).toEqual([60, folio]);
    // Research of the tier that needs nothing, other than these two: one read as known, the rest to fill a line with.
    const others = free.filter((g) => g !== big && g !== next);
    const known = others[0];
    const rest = others.slice(1);
    const done = known === undefined ? rec.done : [...rec.done, idOf(known)];
    // Research that needs one not known, even with that one read as known.
    const unmet = researchOf(tier).find((g) =>
      (F.GOALS[g]?.needs ?? []).some((n) => n !== known && y.open.done[n] !== 1),
    );
    /** The yard read back with a line (and some research known), the same both times and once more from itself. */
    const read = (line: readonly string[], more: Record<string, unknown> = {}): F.Yard => {
      const text = JSON.stringify({ ...rec, done, line, ...more });
      const back = F.decode(text, y.land);
      const again = F.decode(text, y.land);
      if (!back || !again) throw new Error("the yard does not read back");
      expect([F.encode(again), F.check(again)]).toEqual([F.encode(back), F.check(back)]);
      const itself = F.decode(F.encode(back), y.land);
      expect(itself && [F.encode(itself), F.check(itself)]).toEqual([F.encode(back), F.check(back)]);
      return back;
    };
    const study = (b: F.Yard): number[] => [b.holders.work[r] ?? 0, b.holders.making[r] ?? F.NONE];
    // Named twice, known, needing what is not known, and more than the line holds: left out, the first kept.
    const line = [
      big,
      big,
      ...(known === undefined ? [] : [known]),
      ...(unmet === undefined ? [] : [unmet]),
      next,
      ...rest,
    ];
    const kept = read(line.map(idOf));
    const may = [big, next, ...rest].slice(0, F.LINE);
    expect(ids(kept)).toEqual(may.map(idOf));
    expect(study(kept)).toEqual([60, folio]);
    run(kept, 20);
    expect(given(kept, big)).toBe(1);
    // The research the work was for not first: not studiable, known, nothing, or finished as it is read.
    const firsts: (readonly [string[], Record<string, unknown>])[] = [
      [["nothing", idOf(next)], {}],
      [[idOf(big), idOf(next)], { got: { [idOf(big)]: { [F.itemName(folio)]: wants(big) } } }],
    ];
    if (unmet !== undefined) firsts.push([[idOf(unmet), idOf(next)], {}]);
    if (known !== undefined) firsts.push([[idOf(known), idOf(next)], {}]);
    for (const [ls, more] of firsts) {
      const back = read(ls, more);
      expect(ids(back)).toEqual([idOf(next)]);
      expect(study(back)).toEqual([0, F.NONE]);
      run(back, 49);
      expect(given(back, next)).toBe(0);
      run(back, 1);
      expect([given(back, next), F.held(back.holders, r, folio)]).toEqual([1, 2]);
    }
    // Where research's tier is not open, none is studied.
    const early = F.create({ tier: tier - 1 });
    const text: unknown = JSON.parse(F.encode(early));
    expect(F.decode(JSON.stringify({ ...Object(text), line: [idOf(big), idOf(next)] }))?.line).toEqual([]);
  });

  test("research goes on while the owner is away, and the line is kept", () => {
    // Two Studies holding fewer than the research wants between them, so that it is still being studied.
    const n = Math.min(F.STUDY_HOLDS, Math.floor((wants(big) - 1) / 2));
    expect(n).toBeGreaterThan(0);
    const { y } = studies([[folio, n]], [[folio, n]]);
    must(y, { do: "study", research: idOf(big) });
    must(y, { do: "study", research: idOf(next) });
    const at = 1_800_000_000_000;
    y.at = at;
    y.seen = F.here(y);
    const ctx: Ctx = {
      now: at + 3600 * 1000,
      player: { id: "p", guest: false },
      seed: 1,
      room: 0,
      awards: [],
      postcards: {},
    };
    F.FACTORY.advance(y, ctx);
    expect(given(y, big)).toBe(2 * n);
    const back = F.decode(F.encode(y), y.land);
    expect(back && [back.line, given(back, big)]).toEqual([y.line, 2 * n]);
  });

  test("what became known while the owner was away is told with the yard, until their next command", () => {
    // The first one folio short of known and a Study holding two: it becomes known while they are away.
    const first = free.find((g) => g !== next && folioOf(g).folio === folio) ?? big;
    const { y } = studies([[folio, 2]]);
    must(y, { do: "study", research: idOf(first) });
    must(y, { do: "study", research: idOf(next) });
    F.giveGoal(y, first, folio, wants(first) - 1);
    expect(F.knownSince(y)).toEqual([]);
    const at = 1_800_000_000_000;
    y.at = at;
    y.seen = F.here(y);
    const ctx: Ctx = {
      now: at + 3600 * 1000,
      player: { id: "p", guest: false },
      seed: 1,
      room: 0,
      awards: [],
      postcards: {},
    };
    F.FACTORY.advance(y, ctx);
    expect(y.open.done[first]).toBe(1);
    expect(F.knownSince(y)).toEqual([first]);
    // The page is given it with the yard, and reads it back.
    const seen = F.decode(F.FACTORY.view(y, ctx).yard, y.land);
    expect(seen && F.knownSince(seen)).toEqual([first]);
    // Their next command is when Leaf logs what was done: nothing is told twice.
    must(y, { do: "collect" });
    expect(F.knownSince(y)).toEqual([]);
  });

  test("a node finished while the owner was away is told the same way, apart from research, until their next command", () => {
    const y = F.create({ seed: 3 });
    const planks = F.goal("planks");
    expect(y.hand).toBe(planks);
    F.giveGoal(y, planks, F.item("plank"), 12);
    expect([F.finishedSince(y), F.knownSince(y)]).toEqual([[planks], []]);
    must(y, { do: "collect" });
    expect(F.finishedSince(y)).toEqual([]);
  });

  test("a Study's pace is its grade's, at the share of power the yard has, and none in the dark", () => {
    const { y } = studies([[folio, 2]]);
    const i = F.at(y, 5, 7);
    expect(F.machineRate(y, i).effective).toBe(F.makes(F.STUDY, 1, null));
    y.grade[i] = 2;
    expect(F.machineRate(y, i).effective).toBe(F.makes(F.STUDY, 2, null));
    // A second Study past the depot's reach is in the dark.
    must(y, { do: "build", kind: "study", x: 0, y: 0, dir: 0 });
    expect(F.machineRate(y, F.at(y, 0, 0)).effective).toBe(0);
  });
});
