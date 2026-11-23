import { describe, expect, test } from "bun:test";

import { buyPlan, buyPlot } from "../build.ts";
import { create } from "../create.ts";
import { LAND, touching } from "../land.ts";
import { makeable } from "../orders.ts";
import { repower } from "../power.ts";
import type { World } from "../world.ts";
import { ASKS } from "./asks.ts";
import { ITEM, type Item, ITEMS, RAW } from "./items.ts";
import { KIND, KINDS, START_KINDS } from "./machines.ts";
import { type PlanId, PLANS } from "./plans.ts";
import { PLOT_H, PLOT_W, type PlotId, PLOTS } from "./plots.ts";
import { MADE_BY, partsOf, RECIPES } from "./recipes.ts";
import { STORY } from "./story.ts";

/** The plots a thing from the ground lies in. */
const where = (item: string): Set<string> =>
  new Set(LAND.deposit.flatMap((d, i) => (d === item ? [LAND.plots[LAND.plot[i] ?? -1]?.id ?? ""] : [])));
const wet = (x: number, y: number): boolean => LAND.water[y * LAND.w + x] === 1;
/** Which story order opens a plan. */
const opened = (id: string): number => STORY.findIndex((o) => (o.opens.plans ?? []).some((p) => p === id));
/** How many different things from the ground go into a thing. */
const raws = (item: Item): number => new Set(partsOf(item).filter((k) => ITEM[k].step === 0)).size;
/** How many things a yard could make, or less than none if there is no such yard. */
const can = (w: World | null): number => (w ? makeable(w).length : -1);

describe("things and recipes", () => {
  test("everything that is not from the ground has exactly one recipe, and nothing from the ground has any", () => {
    for (const item of ITEMS) {
      const made = RECIPES.filter((r) => r.out === item).length;
      expect([item, made]).toEqual([item, ITEM[item].step === 0 ? 0 : 1]);
    }
    expect(RAW.every((r) => ITEM[r].step === 0)).toBe(true);
  });
  test("a recipe takes one each of different things, and makes something one step deeper than the deepest of them", () => {
    for (const r of RECIPES) {
      expect(new Set(r.from).size).toBe(r.from.length);
      expect(r.from.length).toBe(r.by === "mill" ? 1 : r.by === "bench" ? 2 : 3);
      const deepest = Math.max(...r.from.map((k) => ITEM[k].step));
      expect(`${r.out} at step ${ITEM[r.out].step}`).toBe(`${r.out} at step ${deepest + 1}`);
    }
  });
  test("no machine has two recipes for the same things, so what arrives always settles what is made", () => {
    for (const recipes of Object.values(MADE_BY)) {
      const keys = recipes.map((r) => r.from.toSorted().join("+"));
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
  test("a thing is worth more than what went into it", () => {
    for (const r of RECIPES)
      expect(ITEM[r.out].worth).toBeGreaterThan(r.from.reduce((sum, k) => sum + ITEM[k].worth, 0));
  });
  test("the two deepest goods take all six things from the ground between them, and the crab takes all six alone", () => {
    expect(raws("crab")).toBe(6);
    expect(raws("beacon")).toBe(5);
  });
  test("somebody on the board has a reason to ask for everything", () => {
    for (const item of ITEMS) {
      expect(ASKS[item].length).toBeGreaterThan(0);
      for (const ask of ASKS[item]) expect(ask.from.length * ask.line.length).toBeGreaterThan(0);
    }
  });
});

describe("the land", () => {
  test("every plot is twelve rows of sixteen letters from the legend", () => {
    expect(PLOTS.length).toBe(9);
    for (const p of PLOTS) {
      expect(p.rows.length).toBe(PLOT_H);
      for (const row of p.rows) expect([p.id, row, /^[.dsocar~TD]{16}$/.test(row)]).toEqual([p.id, row, true]);
      expect(p.rows[0]?.length).toBe(PLOT_W);
    }
    expect(LAND.w).toBe(48);
    expect(LAND.h).toBe(36);
  });
  test("the depot is three tiles square in the middle of the yard, and only there", () => {
    const marked = PLOTS.flatMap((p) =>
      p.rows.flatMap((row) =>
        row
          .split("")
          .filter((c) => c === "D")
          .map(() => p.id),
      ),
    );
    expect(marked).toEqual(Array.from({ length: 9 }, () => "yard" as const));
    const w = create();
    const [cx, cy] = LAND.depot;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) expect(w.cells[(cy + dy) * LAND.w + cx + dx]?.kind).toBe("depot");
    expect(w.cells.filter((b) => b).length).toBe(9);
  });
  test("the yard has deadfall within the depot's power, and its ore and stone beyond it", () => {
    const power = repower(create());
    const yard = LAND.plots.findIndex((p) => p.id === "yard");
    const within = (item: string, lit: number): number =>
      LAND.deposit.filter((d, i) => d === item && LAND.plot[i] === yard && power[i] === lit).length;
    expect(within("deadfall", 1)).toBeGreaterThanOrEqual(6);
    expect(within("ore", 1)).toBe(0);
    expect(within("stone", 1)).toBe(0);
    expect(within("ore", 0)).toBeGreaterThanOrEqual(6);
    expect(within("stone", 0)).toBeGreaterThanOrEqual(6);
  });
  test("everything from the ground lies somewhere, and clay, sand and resin only beyond the yard", () => {
    for (const raw of RAW) expect(where(raw).size).toBeGreaterThan(0);
    for (const raw of ["clay", "sand", "resin"]) expect(where(raw).has("yard")).toBe(false);
    expect(where("clay").has("bank")).toBe(true);
    expect(where("sand").has("stream")).toBe(true);
    expect(where("resin").has("grove")).toBe(true);
  });
  test("the stream runs unbroken from the top of the map to the bottom", () => {
    let reach = new Set<number>();
    for (let x = 0; x < LAND.w; x++) if (wet(x, 0)) reach.add(x);
    for (let y = 1; y < LAND.h; y++) {
      const next = new Set<number>();
      for (let x = 0; x < LAND.w; x++)
        if (wet(x, y) && (reach.has(x) || (next.has(x - 1) && wet(x - 1, y)))) next.add(x);
      for (let x = LAND.w - 2; x >= 0; x--) if (wet(x, y) && next.has(x + 1)) next.add(x);
      reach = next;
      expect([y, reach.size > 0]).toEqual([y, true]);
    }
  });
});

describe("the story", () => {
  test("is twenty orders, and the first is small", () => {
    expect(STORY.length).toBe(20);
    expect(STORY[0]?.want).toEqual({ plank: 12 });
  });
  test("every machine, plot and plan is opened by an order or a plan, and none twice", () => {
    const kinds = [
      ...START_KINDS,
      ...STORY.flatMap((o) => o.opens.kinds ?? []),
      ...PLANS.flatMap((p) => p.effect.opens ?? []),
    ];
    expect(kinds.toSorted()).toEqual(KINDS.filter((k) => k !== "depot").toSorted());
    expect(STORY.flatMap((o) => o.opens.plots ?? []).toSorted()).toEqual(
      PLOTS.map((p) => p.id)
        .filter((id) => id !== "yard")
        .toSorted(),
    );
    expect(STORY.flatMap((o) => o.opens.plans ?? []).toSorted()).toEqual(PLANS.map((p) => p.id).toSorted());
    expect(STORY.filter((o) => o.opens.board).length).toBe(1);
  });
  test("a plan's earlier plans exist and are opened no later than it is", () => {
    for (const plan of PLANS) for (const need of plan.needs) expect(opened(need)).toBeLessThanOrEqual(opened(plan.id));
  });
  test("a plot touches land the yard could already own when it goes on sale", () => {
    const owned = LAND.plots.filter((p) => p.id === "yard");
    for (const order of STORY)
      for (const id of order.opens.plots ?? []) {
        const plot = LAND.plots.find((p) => p.id === id);
        if (!plot) throw new Error(`no plot ${id}`);
        expect([id, owned.some((p) => touching(p, plot))]).toEqual([id, true]);
        owned.push(plot);
      }
  });
  test("each order asks only for what can be made with what the orders before it opened, and the Coins to open it have been paid", () => {
    // Played through buying only what is needed: the cheapest plots and plans that make the next order possible.
    const plots: PlotId[] = [];
    const plans: PlanId[] = [];
    let paid = 0;
    let spent = 0;
    STORY.forEach((order, n) => {
      const before = spent;
      const yard = (morePlots: readonly PlotId[], morePlans: readonly PlanId[]): World | null => {
        const w = create({ story: n });
        for (const id of morePlots) if (!buyPlot(w, id, Infinity).ok) return null;
        for (const id of morePlans) if (!buyPlan(w, id, Infinity).ok) return null;
        return w;
      };
      const short = (): boolean => {
        const made = makeable(yard(plots, plans) ?? create());
        return ITEMS.some((k) => (order.want[k] ?? 0) > 0 && !made.includes(k));
      };
      for (let tries = 0; short() && tries < 20; tries++) {
        const now = can(yard(plots, plans));
        const plot = PLOTS.toSorted((a, b) => a.price - b.price).find((p) => can(yard([...plots, p.id], plans)) > now);
        const plan = PLANS.toSorted((a, b) => a.price - b.price).find((p) => can(yard(plots, [...plans, p.id])) > now);
        if (plot && (!plan || plot.price <= plan.price)) {
          plots.push(plot.id);
          spent += plot.price;
        } else if (plan) {
          plans.push(plan.id);
          spent += plan.price;
        } else break;
      }
      expect([order.title, short()]).toEqual([order.title, false]);
      expect([order.title, spent, paid >= spent]).toEqual([order.title, spent, true]);
      // And whatever this order newly needed, the order before it paid for on its own.
      expect([order.title, spent - before <= (STORY[n - 1]?.pay ?? 0)]).toEqual([order.title, true]);
      paid += order.pay;
    });
    expect(plots.toSorted()).toEqual(["bank", "grove", "stream"]);
    expect(plans.toSorted()).toEqual(["workshop"]);
  });
  test("costs are whole Coins, and nothing is free but the depot and the yard", () => {
    for (const k of KINDS) expect(KIND[k].cost > 0 || k === "depot").toBe(true);
    for (const k of KINDS) expect(Number.isInteger(KIND[k].cost)).toBe(true);
    for (const p of PLOTS) expect(p.price > 0 || p.id === "yard").toBe(true);
    for (const p of PLANS) expect(p.price).toBeGreaterThan(0);
  });
});
