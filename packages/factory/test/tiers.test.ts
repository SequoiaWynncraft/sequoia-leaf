/**
 * Tiers, as nodes: lessons come into hand by themselves in their order; a project or a commission
 * is taken into hand once its tier is open and what it needs is done; what reaches the depot goes to
 * the node in hand first, then the board; what a node has been given stays given; a commission opens
 * the next tier, whose land is then for sale; a tool not unlocked refuses its commands with a code of
 * its own, and a run of belt is never a way round one.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { fill, idOf, learn, needsFirst, paidFor } from "./goals.ts";
import { give, must } from "./yards.ts";

const id = (y: F.Yard): string | null => (y.hand === -1 ? null : (F.GOALS[y.hand]?.id ?? null));
/** The goals of a tier of a kind, in the order of the table. */
const goalsOf = (tier: number, kind: F.GoalInfo["kind"]): F.Goal[] =>
  F.ALL_GOALS.filter((g) => F.GOALS[g]?.tier === tier && F.GOALS[g]?.kind === kind);
const lessons = goalsOf(0, "lesson");
const commissionOf = (tier: number): F.Goal => {
  const c = goalsOf(tier, "commission")[0];
  if (c === undefined) throw new Error(`tier ${tier} has no commission`);
  return c;
};
/** The `k`th of some things, which must be there. */
function at<T>(gs: readonly T[], k: number): T {
  const g = gs[k];
  if (g === undefined) throw new Error(`no goal ${k}`);
  return g;
}
/** Takes a node into hand, by command, and fills it. */
function finish(y: F.Yard, node: string): void {
  if (id(y) !== node) must(y, { do: "take", node });
  fill(y);
  expect(y.open.done[F.goal(node)]).toBe(1);
}
const refused = (y: F.Yard, c: Record<string, unknown>): string | null => {
  const did = give(y, c);
  return "refused" in did ? did.refused : null;
};
/** A yard with every goal of the tiers below `tier` done but some. */
function without(tier: number, ...ids: string[]): F.Yard {
  const y = F.create({ seed: 1, tier });
  y.done = y.done.filter((g) => !ids.includes(F.GOALS[g]?.id ?? ""));
  F.reopen(y);
  return y;
}
/** A kept yard as a record. */
function record(y: F.Yard): Record<string, unknown> {
  const rec: unknown = JSON.parse(F.encode(y));
  if (typeof rec !== "object" || rec === null) throw new Error("not a record");
  return { ...rec };
}

describe("the lessons", () => {
  test("a new yard has the first lesson in hand; each comes into hand by itself when the one before is done, pays what its table says, and unlocks", () => {
    const y = F.create({ seed: 1 });
    expect(lessons.length).toBeGreaterThan(3);
    expect(id(y)).toBe(idOf(at(lessons, 0)));
    fill(y);
    expect([id(y), y.till]).toEqual([idOf(at(lessons, 1)), paidFor(at(lessons, 0))]);
    const kinds = (g: F.Goal): number[] => (F.GOALS[g]?.unlocks.kinds ?? []).map((k) => y.open.kinds[F.kind(k)] ?? 0);
    fill(y);
    expect([id(y), kinds(at(lessons, 1)).every((k) => k > 0)]).toEqual([idOf(at(lessons, 2)), true]);
    // A later lesson cannot be taken out of its order, nor a project of a tier not open.
    expect(refused(y, { do: "take", node: idOf(at(lessons, 3)) })).toBe("cannot_take");
    expect(refused(y, { do: "take", node: idOf(at(goalsOf(1, "project"), 0)) })).toBe("cannot_take");
    fill(y);
    expect(id(y)).toBe(idOf(at(lessons, 3)));
    expect(y.board).toEqual([]);
  });

  test("the last lesson opens tier 1: the board goes up as full as it may be, its land is for sale, and the tier's commission comes into hand", () => {
    const y = F.create({ seed: 1 });
    for (const _ of lessons) fill(y);
    expect(y.open.tier).toBe(1);
    expect(id(y)).toBe(idOf(commissionOf(1)));
    expect(y.board.length).toBe(y.open.hooks);
    const plots = (g: F.Goal): string[] =>
      (F.GOALS[g]?.unlocks.plots ?? []).map((p) => F.plotState(y, F.plot(p)).state);
    expect(plots(at(lessons, lessons.length - 1)).every((s) => s === "for sale")).toBe(true);
    expect(plots(commissionOf(1)).every((s) => s === "not yet")).toBe(true);
  });
});

describe("projects and commissions", () => {
  test("any open, unfinished node can be taken into hand at any time, and what it has been given stays given", () => {
    const y = F.create({ seed: 1, tier: 1 });
    must(y, { do: "take", node: "crates" });
    F.deliver(y, F.item("plank"), 10);
    must(y, { do: "take", node: "boiler" });
    F.deliver(y, F.item("plank"), 5);
    expect(y.got[F.goal("crates")]?.[F.item("plank")]).toBe(10);
    must(y, { do: "take", node: "crates" });
    expect(id(y)).toBe("crates");
    F.deliver(y, F.item("plank"), 50);
    expect(y.got[F.goal("crates")]?.[F.item("plank")]).toBe(60);
    expect(refused(y, { do: "take", node: "crates" })).toBe("cannot_take");
  });

  test("what reaches the depot goes to the node in hand first, then to the board", () => {
    const y = F.create({ seed: 1, tier: 1 });
    // A project of the tier that wants two things or more, so that it is not finished by one of them.
    const node = F.ALL_GOALS.find(
      (g) =>
        F.GOALS[g]?.tier === 1 &&
        F.GOALS[g]?.kind === "project" &&
        F.ALL_ITEMS.filter((n) => (F.GOALS[g]?.want[n] ?? 0) > 0).length > 1,
    );
    if (node === undefined) throw new Error("no project of tier 1 wants two things");
    must(y, { do: "take", node: idOf(node) });
    // The board's orders count once they have hung a while.
    for (let k = 0; k <= F.ORDER_WAITS; k++) F.step(y);
    const thing = F.ALL_ITEMS.find((n) => (F.GOALS[node]?.want[n] ?? 0) > 0) ?? F.item("plank");
    const wants = F.GOALS[node]?.want[thing] ?? 0;
    const order = y.board.find((o) => (o.want[thing] ?? 0) > 0);
    F.deliver(y, thing, wants - 1);
    expect(order?.filled[thing] ?? 0).toBe(0);
    F.deliver(y, thing, 3);
    expect(y.got[node]?.[thing]).toBe(wants);
    if (order) expect(order.filled[thing]).toBe(Math.min(2, order.want[thing] ?? 0));
  });

  test("a project finished with nothing chosen brings the tier's commission into hand; the commission opens the next tier and its land", () => {
    const y = F.create({ seed: 1, tier: 1 });
    finish(y, "signs");
    expect(id(y)).toBe("banners");
    fill(y);
    expect(y.open.tier).toBe(2);
    expect(id(y)).toBe("hall");
    expect((["bank", "stream", "grove"] as const).map((p) => F.plotState(y, F.plot(p)).state)).toEqual([
      "for sale",
      "for sale",
      "not yet",
    ]);
    expect(F.townGifts(y).map((g) => g.id)).toEqual(["banner-pole"]);
  });

  test("a project that needs another can be taken only once that is done; a node may be in hand before the yard can make what it wants", () => {
    const y = F.create({ seed: 1, tier: 2 });
    expect(id(y)).toBe("hall");
    expect(F.makeable(y)).not.toContain(F.item("glass"));
    expect(refused(y, { do: "take", node: "drawing" })).toBe("cannot_take");
    finish(y, "chain");
    must(y, { do: "take", node: "drawing" });
  });

  test("a commission that needs research known cannot be taken and does not come into hand before all of it is; it comes when it is, if nothing is in hand", () => {
    const tier = F.ALL_GOALS.map((g) => F.GOALS[g]).find((g) => g?.kind === "commission" && g.needs.length > 0)?.tier;
    if (tier === undefined) throw new Error("no commission needs anything");
    const c = commissionOf(tier);
    const y = F.create({ seed: 1, tier });
    expect(y.hand).toBe(-1);
    expect(give(y, { do: "take", node: idOf(c) })).toMatchObject({
      refused: "cannot_take",
      why: `${F.GOALS[c]?.title} is not open yet`,
    });
    const needs = needsFirst(c).filter((g) => g !== c);
    for (const g of needs.slice(0, -1)) learn(y, g);
    expect(y.hand).toBe(-1);
    learn(y, at(needs, needs.length - 1));
    expect(id(y)).toBe(idOf(c));
  });

  test("when the last commission is done, nothing is in hand", () => {
    const last = Math.max(...F.GOALS.filter((g) => g.kind === "commission").map((g) => g.tier));
    const c = commissionOf(last);
    const y = F.create({ seed: 1, tier: last });
    for (const g of needsFirst(c).filter((n) => n !== c)) learn(y, g);
    fill(y);
    expect([y.open.tier, y.hand]).toEqual([last + 1, -1]);
    F.deliver(y, F.ALL_ITEMS.find((n) => (F.GOALS[c]?.want[n] ?? 0) > 0) ?? F.item("plank"), 5);
  });

  test("a finished node is logged with its pay, and the yard has news of it", () => {
    const y = F.create({ seed: 1 });
    const g = at(lessons, 0);
    const { id: node, title, pay } = F.GOALS[g] ?? { id: "", title: "", pay: 0 };
    const want = F.GOALS[g]?.want ?? F.counts();
    const things = F.ALL_ITEMS.filter((n) => (want[n] ?? 0) > 0);
    const last = at(things, things.length - 1);
    for (const n of things) F.deliver(y, n, (want[n] ?? 0) - (n === last ? 1 : 0));
    // The last thing arrives on a tick, then a command is answered with what was done.
    F.deliver(y, last, 1);
    const did = give(y, { do: "collect" });
    if ("refused" in did) throw new Error(did.why);
    expect(did.log).toEqual([{ kind: "works_story", data: { node, title, pay } }]);
    expect(did.notes).toContainEqual({ kind: "done", goal: node, title, pay });
    expect((did.coins ?? []).reduce((sum, c) => sum + c.amount, 0)).toBe(pay);
  });
});

/** Two belts by the depot, a single piece and a run, and every command of a tool on or about them. */
function asks(y: F.Yard): (string | null)[] {
  const [cx, cy] = y.land.depot;
  must(y, { do: "build", kind: "belt", x: cx + 2, y: cy - 3, dir: 0 });
  must(y, { do: "lay", legs: [{ kind: "belt", x: cx + 3, y: cy - 3, dir: 0, span: 0 }] });
  const tiles = (): number[] => F.within(y, cx + 2, cy - 4, cx + 4, cy - 3);
  return [
    () => ({ do: "paint", x: cx + 2, y: cy - 3, tint: 1 }),
    () => ({ do: "saveBlueprint", slot: 0, tiles: tiles() }),
    () => ({
      do: "stand",
      pieces: [4, 5].map((dx) => ({ kind: "belt", x: cx + dx, y: cy - 3, dir: 0, span: 0 })),
    }),
    () => ({ do: "move", tiles: tiles(), turns: 0, x: cx + 2, y: cy - 4 }),
    () => ({ do: "clear", tiles: tiles() }),
  ].map((c) => refused(y, c()));
}

/** The largest of a number that a new yard has and that goals of the tiers below `tier` unlock. */
const most = (tier: number, f: (u: F.Unlocks) => number | undefined): number =>
  Math.max(0, f(F.START) ?? 0, ...F.GOALS.filter((g) => g.tier < tier).map((g) => f(g.unlocks) ?? 0));

describe("tools", () => {
  test("a tool not unlocked refuses its commands with a code of its own; a single piece and a run of belt never are", () => {
    expect(asks(F.create({ seed: 1 }))).toEqual([F.LOCKED, F.LOCKED, F.LOCKED, F.LOCKED, F.LOCKED]);
    // Paint, from the signs; Select, from the surveyor's chain; one blueprint, from the drawing board.
    expect(asks(F.create({ seed: 1, tier: 3 }))).toEqual([null, null, null, null, null]);
  });

  test("one piece stood again, as when a removal is undone, needs no tool; two need Select", () => {
    const y = F.create({ seed: 1 });
    const [cx, cy] = y.land.depot;
    const belt = { kind: "belt", x: cx + 2, y: cy - 3, dir: 0, span: 0 };
    must(y, { do: "stand", pieces: [belt] });
    expect(y.kind[F.at(y, belt.x, belt.y)]).toBe(F.BELT);
    expect(give(y, { do: "stand", pieces: [belt, { ...belt, x: belt.x + 1 }] })).toMatchObject({ refused: F.LOCKED });
  });

  test("a run of belt is belts and tunnels and nothing else: a mill does not read as a leg, and a leg's colour or setting is not laid", () => {
    const y = F.create({ seed: 1 });
    const [cx, cy] = y.land.depot;
    const leg = { x: cx + 2, y: cy - 3, dir: 0, span: 0 };
    expect(F.readCommand({ tick: 0, do: "lay", legs: [{ kind: "mill", ...leg }] })).toBeNull();
    must(y, { do: "lay", legs: [{ kind: "belt", ...leg, tint: 3, recipe: "plank", shut: 2 }] });
    expect([y.kind[F.at(y, leg.x, leg.y)], F.keptAt(y, F.at(y, leg.x, leg.y))]).toEqual([F.BELT, {}]);
  });

  test("a colour given in stand needs Paint, and raising an area needs Select as well as its own unlock", () => {
    const y = without(4, "signs");
    const [cx, cy] = y.land.depot;
    const belt = { kind: "belt", x: cx + 2, y: cy - 3, dir: 0, span: 0 };
    expect(give(y, { do: "stand", pieces: [{ ...belt, tint: 2 }] })).toMatchObject({
      refused: "cannot_stand",
      why: "Paint is not unlocked yet",
    });
    must(y, { do: "stand", pieces: [belt] });
    const z = without(4, "chain", "drawing");
    must(z, { do: "build", kind: "belt", x: cx + 2, y: cy - 3, dir: 0 });
    expect(give(z, { do: "upgrade", tiles: [F.at(z, cx + 2, cy - 3)] })).toMatchObject({
      refused: F.LOCKED,
      why: "Select is not unlocked yet",
    });
    expect(z.grade[F.at(z, cx + 2, cy - 3)]).toBe(1);
  });

  test("the tunnel's span, the blueprints' size, a crate's size and the depot's power come from what is unlocked: the most any goal done gives", () => {
    const culvert = F.ALL_GOALS.find((g) => (F.GOALS[g]?.unlocks.span ?? 0) > 0 && F.GOALS[g]?.tier === 1);
    if (culvert === undefined) throw new Error("no project of tier 1 unlocks a tunnel's span");
    const y = F.create({ seed: 1, tier: 1 });
    expect([y.open.kinds[F.TUNNEL], y.open.span]).toEqual([0, 0]);
    finish(y, idOf(culvert));
    expect([y.open.kinds[F.TUNNEL], y.open.span]).toEqual([1, F.GOALS[culvert]?.unlocks.span]);
    const z = F.create({ seed: 1, tier: 3 });
    expect([z.open.blueprints, z.open.pieces]).toEqual([
      most(3, (u) => u.blueprints?.count),
      most(3, (u) => u.blueprints?.pieces),
    ]);
    expect(F.create({ tier: 4 }).open).toMatchObject({
      blueprints: most(4, (u) => u.blueprints?.count),
      pieces: most(4, (u) => u.blueprints?.pieces),
      crate: most(4, (u) => u.crate),
      depot: most(4, (u) => u.depot),
    });
  });
});

describe("keeping goals", () => {
  test("a yard read back has the same goals done, the same node in hand and what each was given; a goal that could not have been done then is left out", () => {
    const y = F.create({ seed: 1, tier: 1 });
    must(y, { do: "take", node: "crates" });
    F.deliver(y, F.item("plank"), 7);
    const back = F.decode(F.encode(y));
    expect(back && [back.done, back.hand, back.got[F.goal("crates")]?.[F.item("plank")]]).toEqual([y.done, y.hand, 7]);
    const rec: unknown = JSON.parse(F.encode(y));
    if (typeof rec !== "object" || rec === null) throw new Error("not a record");
    // The hall before tier 2 opens, and a lesson out of its order, are left out.
    const bad = F.decode(JSON.stringify({ ...rec, done: ["hall", "gears", "planks"] }));
    expect(bad?.done.map((g) => F.GOALS[g]?.id)).toEqual(["planks"]);
    expect(bad && id(bad)).toBe("ingots");
  });

  test("a node read back given all it wants, or more, is finished by the rule that finishes one in play: done, paid, logged, and the next in hand", () => {
    const y = F.create({ seed: 1 });
    const g = at(lessons, 0);
    const { id: node, title, pay, want } = F.GOALS[g] ?? { id: "", title: "", pay: 0, want: F.counts() };
    const more = Object.fromEntries(
      F.ALL_ITEMS.filter((n) => (want[n] ?? 0) > 0).map((n) => [F.itemName(n), (want[n] ?? 0) + 7]),
    );
    const back = F.decode(JSON.stringify({ ...record(y), got: { [node]: more } }));
    if (!back) throw new Error("the yard does not read back");
    expect([back.open.done[g], id(back), back.till, back.got[g]]).toEqual([
      1,
      idOf(at(lessons, 1)),
      pay * F.MILLI,
      null,
    ]);
    const did = give(back, { do: "collect" });
    expect("refused" in did ? [] : did.log).toEqual([{ kind: "works_story", data: { node, title, pay } }]);
  });
});
