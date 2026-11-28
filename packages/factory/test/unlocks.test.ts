/**
 * What an unlock is, for a screen: every field of every `Unlocks` in the tables becomes a thing with
 * a name and a sentence made from its own numbers; a number says what it was before; a number that
 * comes with its own kind is said by the kind. Every count is read from the tables.
 */
import { describe, expect, test } from "bun:test";

import { coinsText, num } from "@sequoia-leaf/core";

import * as F from "../src/index.ts";

/** Every `Unlocks` in the tables, by whose it is. */
const ALL: [string, F.Unlocks][] = [
  ["a new yard", F.START],
  ...F.GOALS.map((g): [string, F.Unlocks] => [g.id, g.unlocks]),
];
const NUMBERED = ["stops", "crate", "reach", "depot", "span", "away", "hooks", "range"] as const;
/** The first goal whose unlocks hold a field. */
const withField = (has: (u: F.Unlocks) => boolean): F.Unlocks => ALL.find(([, u]) => has(u))?.[1] ?? {};

/** Whether a plot, by its name, rises in price. */
const rising = (name: F.PlotName): boolean => {
  const p = F.LAND.plots.find((q) => q.plot === F.plot(name));
  return p !== undefined && F.rises(p);
};
/** The rows plots put up for sale make: one each, but plots that rise in price, two or more of them, are one. */
const plotRows = (names: readonly F.PlotName[]): number => {
  const up = names.filter(rising).length;
  return names.length - up + Math.min(up, 1);
};

describe("what is unlocked", () => {
  test("every field of every unlock in the tables is one thing in the list, named and said, and nothing is listed twice", () => {
    for (const [id, u] of ALL) {
      const list = F.unlocked(u);
      const kinds = (u.kinds ?? []).map(F.kind);
      // A number that comes with its own kind, with nothing before it, is the kind's to say.
      const folded = NUMBERED.filter(
        (of) =>
          u[of] !== undefined &&
          ((of === "stops" && kinds.includes(F.STOP)) || (of === "span" && kinds.includes(F.TUNNEL))) &&
          !list.some((e) => e.is === "number" && e.of === of),
      );
      const fields =
        kinds.length +
        Object.keys(u.grades ?? {}).length +
        (u.recipes ?? []).length +
        plotRows(u.plots ?? []) +
        (u.tools ?? []).length +
        (u.blueprints ? 1 : 0) +
        NUMBERED.filter((of) => u[of] !== undefined).length -
        folded.length +
        (u.board ? 1 : 0) +
        (u.first ? 1 : 0) +
        (u.ins ? 1 : 0) +
        (u.felling ? 1 : 0) +
        (u.mouths ? 1 : 0);
      expect([id, list.length]).toEqual([id, fields]);
      for (const e of list) {
        // A sentence, begun with a capital or a number (numbers are written as numbers).
        expect([id, e.name.length > 0, /^[A-Z0-9].*\.$/.test(e.says)]).toEqual([id, true, true]);
        if (e.is === "number" || e.is === "blueprints") expect(e.amount.length).toBeGreaterThan(0);
      }
      expect(new Set(list.map((e) => `${e.is}:${e.name}`)).size).toBe(list.length);
    }
  });

  test("a kind is said by its own sentence; a grade by what it carries or makes a minute and costs, against the grade below", () => {
    const some = withField((u) => (u.kinds ?? []).length > 0);
    for (const e of F.unlocked({ kinds: some.kinds ?? [] }))
      if (e.is === "kind")
        expect([e.name, e.says, e.amount]).toEqual([
          F.KIND_INFO[e.kind]?.name ?? "",
          F.KIND_INFO[e.kind]?.what ?? "",
          undefined,
        ]);
    for (const [, u] of ALL)
      for (const e of F.unlocked({ grades: u.grades ?? {} })) {
        if (e.is !== "grade") continue;
        expect(e.name).toBe(`${F.KIND_INFO[e.kind]?.name} ${F.numeral(e.grade)}`);
        expect(e.says).toContain(`${coinsText(F.price(e.kind, e.grade))}.`);
        const more = F.carries(e.kind)
          ? [F.carried(e.grade), F.carried(e.grade - 1)]
          : e.kind === F.GATHERER || e.kind === F.STUDY
            ? [F.makes(e.kind, e.grade, null), F.makes(e.kind, e.grade - 1, null)]
            : [(F.PACE[e.grade] ?? 0) / (F.PACE[1] ?? 1)];
        for (const v of more) expect(e.says).toContain(num(v));
        // What it carries, gathers or studies is a rate, said so many /min.
        if (more.length > 1)
          expect(e.says).toContain(`${num(more[0] ?? 0)} ${F.STUDY === e.kind ? "folios" : "items"} /min`);
      }
    expect(F.gradeSays(F.BELT, 2)).toStartWith("Carries up to 200 items /min, up from 150. A tile costs ");
    expect([1, 2, 3].map(F.numeral)).toEqual(["I", "II", "III"]);
  });

  test("a recipe is said by its machine and its parts, with their counts unless it takes one of one part", () => {
    for (const r of F.RECIPES_N) {
      const says = F.recipeSays(r.out);
      expect(
        says.startsWith(`A ${(F.KIND_INFO[r.by]?.name ?? "").toLowerCase()} makes ${F.ITEM_INFO[r.out]?.many} from `),
      ).toBe(true);
      const counted = !(r.from.length === 1 && r.need[0] === 1);
      for (const [k, part] of r.from.entries()) {
        const c = r.need[k] ?? 1;
        const word =
          c === 1 && counted ? (F.ITEM_INFO[part]?.name ?? "").toLowerCase() : (F.ITEM_INFO[part]?.many ?? "");
        expect(says).toContain(counted ? `${c} ${word}` : word);
      }
    }
  });

  test("a number says what it is now and what it was before: the largest the tables give below it, or nothing where there was none", () => {
    for (const of of NUMBERED) {
      const given = ALL.flatMap(([, u]) => (u[of] === undefined ? [] : [u[of]])).toSorted((a, b) => a - b);
      for (const [k, to] of given.entries()) {
        const [e] = F.unlocked({ [of]: to });
        if (e?.is !== "number") throw new Error(`${of} is not a number`);
        const was = given.findLast((v) => v < to) ?? 0;
        expect([of, e.to, e.was]).toEqual([of, to, was]);
        expect([of, k, e.says.includes("up from")]).toEqual([of, k, was > 0]);
      }
    }
    // Blueprints, the same: how many and how large, against the ones before.
    const prints = ALL.flatMap(([, u]) => (u.blueprints ? [u.blueprints] : [])).toSorted((a, b) => a.count - b.count);
    for (const p of prints) {
      const [e] = F.unlocked({ blueprints: p });
      if (e?.is !== "blueprints") throw new Error("not blueprints");
      expect(e.was.count).toBe(prints.findLast((q) => q.count < p.count)?.count ?? 0);
      expect(e.says).toContain(p.pieces.toLocaleString("en-US"));
    }
  });

  test("a tunnel's first length and the first cart stop are the kind's: shown beside it and said after its own sentence; a later one is listed", () => {
    for (const [name, of] of [
      ["tunnel", "span"],
      ["stop", "stops"],
    ] as const) {
      const first = ALL.map(([, u]) => u).find((u) => (u.kinds ?? []).includes(name) && u[of] !== undefined);
      if (!first) continue;
      const list = F.unlocked(first);
      const [alone] = F.unlocked({ [of]: first[of] });
      const folded = list.find((e) => e.is === "kind" && e.kind === F.kind(name));
      if (alone?.is !== "number" || folded?.is !== "kind") throw new Error(`${name} is not unlocked with its ${of}`);
      expect(list.some((e) => e.is === "number" && e.of === of)).toBe(false);
      expect([folded.amount, folded.says]).toEqual([alone.amount, `${F.KIND_INFO[folded.kind]?.what} ${alone.says}`]);
    }
    expect(F.unlocked({ span: 99 }).map((e) => e.is)).toEqual(["number"]);
    expect(F.unlocked({ kinds: ["stop"], stops: 99 }).map((e) => e.is)).toEqual(["kind", "number"]);
  });

  test("a plot is said with its price, a tool by what it does, and the board by how many orders it holds", () => {
    for (const [, u] of ALL)
      for (const e of F.unlocked(u)) {
        if (e.is === "plot") {
          const plot = F.LAND.plots.find((p) => p.plot === e.plot);
          expect([e.name, e.price]).toEqual([plot?.name ?? "", plot?.price ?? -1]);
        }
        if (e.is === "tool") expect([e.name, e.says]).toEqual([F.TOOL_INFO[e.tool].name, F.TOOL_INFO[e.tool].says]);
        if (e.is === "board") expect(e.says).toContain(String(F.HOOKS_MOST));
      }
    for (const tool of F.TOOLS) expect(F.TOOL_INFO[tool].name.length).toBeGreaterThan(0);
  });

  test("plots that rise in price, put up for sale together, are one thing: how many, from the cheapest's price, and how they rise", () => {
    const kits = F.goal("kits");
    expect(F.unlockedBy(kits)).toEqual([
      {
        is: "land",
        plots: F.OUTER_IDS.map(F.plot),
        first: F.plot("workings"),
        price: 100_000,
        name: "40 plots",
        says: "40 plots are for sale, from 100,000 Coins. Each plot you buy raises the price of the rest by 15%.",
      },
    ]);
    // One alone is a plot, with the same sentence after its price; plots that do not rise are listed one by one.
    expect(F.unlocked({ plots: ["ridge", "meadow"] }).map((e) => [e.is, e.says])).toEqual([
      ["plot", "Copper Ridge is for sale, for 160,000 Coins. Each plot you buy raises the price of the rest by 15%."],
      ["plot", "Long Meadow is for sale, for 300 Coins."],
    ]);
  });

  test("by a goal is the list of that goal's unlocks, so a screen asks by the goal and holds no `Unlocks`", () => {
    for (const g of F.ALL_GOALS) expect(F.unlockedBy(g)).toEqual(F.unlocked(F.GOALS[g]?.unlocks ?? {}));
  });
});

describe("the tiers", () => {
  test("every tier a goal is of has a name, and a tier is called by its number and its name", () => {
    for (const g of F.GOALS) expect([g.id, F.TIERS[g.tier]?.name !== undefined]).toEqual([g.id, true]);
    expect(F.tierName(1)).toBe(`Tier 1: ${F.TIERS[1]?.name}`);
    expect(F.tierName(F.TIERS.length)).toBe(`Tier ${F.TIERS.length}`);
  });
});
