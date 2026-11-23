/**
 * Research: one piece studied and up to three waiting; a Study holding a folio the research still
 * wants puts one toward it every 50 ticks at grade 1, and what the research does not want stays in
 * the Study; known, it unlocks, the next begins, and the yard has news of it. It goes on while the
 * owner is away.
 */
import { describe, expect, test } from "bun:test";

import type { Ctx } from "@sequoia-leaf/core";

import * as F from "../src/index.ts";
import { bareLand } from "./land.ts";
import { give, must } from "./yards.ts";

const timber = F.item("timber");
const brass = F.item("brass");
const got = (y: F.Yard, id: string): number => y.got[F.goal(id)]?.[timber] ?? 0;

/** A yard at tier 3 (every node below done, no research) on a bare land, with Studies by the depot holding what is asked. */
function studies(...hold: readonly (readonly [F.Item, number])[][]): { y: F.Yard; rows: number[] } {
  const y = F.create({ land: bareLand(13, 9, [], [9, 4]), tier: 3, seed: 1 });
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
  test("research can be studied once its tier is open and what it needs is known; one is studied and up to 3 wait", () => {
    const early = F.create({ tier: 2 });
    expect(give(early, { do: "study", research: "oilpress" })).toMatchObject({ refused: "cannot_study" });
    const y = F.create({ tier: 3 });
    expect(give(y, { do: "study", research: "tooling" })).toMatchObject({
      refused: "cannot_study",
      why: "Second-tier machines cannot be studied yet",
    });
    for (const research of ["oilpress", "workshop", "bigcrates", "tallpylons"]) must(y, { do: "study", research });
    expect(give(y, { do: "study", research: "flywheel" })).toMatchObject({ refused: "cannot_study" });
    expect(give(y, { do: "study", research: "workshop" })).toMatchObject({ refused: "cannot_study" });
    must(y, { do: "unstudy", research: "bigcrates" });
    must(y, { do: "study", research: "flywheel" });
    expect(y.line.map((g) => F.GOALS[g]?.id)).toEqual(["oilpress", "workshop", "tallpylons", "flywheel"]);
    expect(give(y, { do: "unstudy", research: "sorter" })).toMatchObject({ refused: "not_studied" });
    // Taken out while it is studied, the next begins, and what it was given stays given.
    must(y, { do: "unstudy", research: "oilpress" });
    expect(F.GOALS[y.line[0] ?? 0]?.id).toBe("workshop");
  });
});

describe("a Study", () => {
  test("holding folios the research wants, puts one toward it every 50 ticks at grade 1, and every 100 / 3 at grade 2", () => {
    const { y, rows } = studies([[timber, 20]]);
    must(y, { do: "study", research: "workshop" });
    run(y, 500);
    expect(got(y, "workshop")).toBe(10);
    expect(F.held(y.holders, rows[0] ?? -1, timber)).toBe(10);
    const faster = studies([[timber, 20]]);
    faster.y.grade[F.at(faster.y, 5, 7)] = 2;
    must(faster.y, { do: "study", research: "workshop" });
    run(faster.y, 500);
    expect(got(faster.y, "workshop")).toBe(15);
  });

  test("takes folios in from a belt, and keeps up to 20 of each kind", () => {
    const { y, rows } = studies([]);
    must(y, { do: "build", kind: "crate", x: 3, y: 7, dir: 0 });
    must(y, { do: "build", kind: "belt", x: 4, y: 7, dir: 0 });
    const crate = y.row[F.at(y, 3, 7)] ?? -1;
    for (let m = 0; m < 30; m++) F.put(y.holders, crate, timber);
    run(y, 300);
    expect(F.held(y.holders, rows[0] ?? -1, timber)).toBe(F.STUDY_HOLDS);
  });

  test("keeps a folio the research does not want, and says what it waits for", () => {
    const { y, rows } = studies([[brass, 5]]);
    must(y, { do: "study", research: "workshop" });
    run(y, 300);
    expect(F.held(y.holders, rows[0] ?? -1, brass)).toBe(5);
    expect(F.status(y, F.at(y, 5, 7))).toMatchObject({ state: "waiting", missing: [timber] });
  });

  test("known, research unlocks what it unlocks, the next in line begins, and the yard has news of it; no folio is lost on the way", () => {
    // Two Studies holding 31 folios between them, toward 30 and then 60.
    const { y, rows } = studies([[timber, 16]], [[timber, 15]]);
    must(y, { do: "study", research: "oilpress" });
    must(y, { do: "study", research: "workshop" });
    expect(y.open.recipes[F.item("oil")]).toBe(0);
    run(y, 1000);
    expect(y.open.done[F.goal("oilpress")]).toBe(1);
    expect(y.open.recipes[F.item("oil")]).toBe(1);
    expect(F.GOALS[y.line[0] ?? 0]?.id).toBe("workshop");
    expect(got(y, "workshop")).toBe(1);
    expect(rows.reduce((sum, r) => sum + F.held(y.holders, r, timber), 0)).toBe(0);
    expect(F.drain(y)).toContainEqual({ kind: "done", goal: "oilpress", title: "The oil press", pay: 0 });
  });

  test("research goes on while the owner is away, and the line is kept", () => {
    const { y } = studies([[timber, 20]], [[timber, 20]]);
    must(y, { do: "study", research: "workshop" });
    must(y, { do: "study", research: "bigcrates" });
    const at = 1_800_000_000_000;
    y.at = at;
    y.seen = F.here(y);
    const ctx: Ctx = { now: at + 3600 * 1000, player: { id: "p", guest: false }, seed: 1, room: 0, awards: [] };
    F.FACTORY.advance(y, ctx);
    expect(got(y, "workshop")).toBe(40);
    const back = F.decode(F.encode(y), y.land);
    expect(back && [back.line, got(back, "workshop")]).toEqual([y.line, 40]);
  });
});
