/**
 * Tiers, as nodes: lessons come into hand by themselves in their order; a project or a commission
 * is taken into hand once its tier is open and what it needs is done; what reaches the depot goes to
 * the node in hand first, then the board; what a node has been given stays given; a commission opens
 * the next tier, whose land is then for sale; a tool not unlocked refuses its commands with a code of
 * its own, and a run of belt is never a way round one.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { give, must } from "./yards.ts";

const id = (y: F.Yard): string | null => (y.hand === -1 ? null : (F.GOALS[y.hand]?.id ?? null));

/** Sends the depot everything the node in hand still wants. */
function fill(y: F.Yard): void {
  const g = y.hand;
  if (g === -1) throw new Error("nothing is in hand");
  const want = F.GOALS[g]?.want ?? F.counts();
  for (const n of F.ALL_ITEMS) F.deliver(y, n, (want[n] ?? 0) - (y.got[g]?.[n] ?? 0));
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
/** Puts a piece of research in the line and gives it every folio it wants, as Studies would. */
function learn(y: F.Yard, research: string): void {
  must(y, { do: "study", research });
  const g = F.goal(research);
  for (const n of F.FOLIOS) F.giveGoal(y, g, n, F.GOALS[g]?.want[n] ?? 0);
  expect(y.open.done[g]).toBe(1);
}
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
  test("a new yard has the first lesson in hand; each comes into hand by itself when the one before is done, pays as today's first orders did, and unlocks", () => {
    const y = F.create({ seed: 1 });
    expect(id(y)).toBe("planks");
    expect(y.open.kinds[F.BENCH]).toBe(0);
    fill(y);
    expect([id(y), y.till]).toEqual(["ingots", 80 * F.MILLI + 12 * (F.ARRIVAL[F.item("plank")] ?? 0)]);
    fill(y);
    expect([id(y), y.open.kinds[F.BENCH]]).toEqual(["tools", 1]);
    // A later lesson cannot be taken out of its order, nor a project of a tier not open.
    expect(refused(y, { do: "take", node: "gears" })).toBe("cannot_take");
    expect(refused(y, { do: "take", node: "crates" })).toBe("cannot_take");
    fill(y);
    expect(id(y)).toBe("gears");
    expect(y.board).toEqual([]);
  });

  test("the last lesson opens tier 1: the board goes up, Long Meadow is for sale, and the tier's commission comes into hand", () => {
    const y = F.create({ seed: 1 });
    for (let k = 0; k < 4; k++) fill(y);
    expect(y.open.tier).toBe(1);
    expect(id(y)).toBe("banners");
    expect(y.board.length).toBe(3);
    expect(F.plotState(y, F.plot("meadow")).state).toBe("for sale");
    expect(F.plotState(y, F.plot("bank")).state).toBe("not yet");
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
    must(y, { do: "take", node: "crates" });
    const plank = F.item("plank");
    const order = y.board.find((o) => (o.want[plank] ?? 0) > 0);
    F.deliver(y, plank, 59);
    expect(order?.filled[plank] ?? 0).toBe(0);
    F.deliver(y, plank, 3);
    expect(y.got[F.goal("crates")]?.[plank]).toBe(60);
    if (order) expect(order.filled[plank]).toBe(Math.min(2, order.want[plank] ?? 0));
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

  test("tier 3's commission needs the oil press and the workshop known: before, it cannot be taken and does not come into hand; it comes when they are, if nothing is in hand", () => {
    const y = F.create({ seed: 1, tier: 3 });
    expect(y.hand).toBe(-1);
    expect(give(y, { do: "take", node: "lanterns" })).toMatchObject({
      refused: "cannot_take",
      why: "Lanterns for the great tree is not open yet",
    });
    learn(y, "oilpress");
    expect(y.hand).toBe(-1);
    learn(y, "workshop");
    expect(id(y)).toBe("lanterns");
  });

  test("when the last commission is done, nothing is in hand", () => {
    const y = F.create({ seed: 1, tier: 3 });
    learn(y, "oilpress");
    learn(y, "workshop");
    fill(y);
    expect([y.open.tier, y.hand]).toEqual([4, -1]);
    F.deliver(y, F.item("lantern"), 5);
  });

  test("a finished node is logged with its pay, and the yard has news of it", () => {
    const y = F.create({ seed: 1 });
    const want = F.GOALS[F.goal("planks")]?.want ?? F.counts();
    F.deliver(y, F.item("plank"), (want[F.item("plank")] ?? 0) - 1);
    // The last plank arrives on a tick, then a command is answered with what was done.
    F.deliver(y, F.item("plank"), 1);
    const did = give(y, { do: "collect" });
    if ("refused" in did) throw new Error(did.why);
    expect(did.log).toEqual([
      { kind: "works_story", data: { node: "planks", title: "Planks for the Treasury", pay: 80 } },
    ]);
    expect(did.notes).toContainEqual({ kind: "done", goal: "planks", title: "Planks for the Treasury", pay: 80 });
    expect((did.coins ?? []).reduce((sum, c) => sum + c.amount, 0)).toBe(80);
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

  test("the tunnel's span and the blueprints' size come from what is unlocked", () => {
    const y = F.create({ seed: 1, tier: 1 });
    expect([y.open.kinds[F.TUNNEL], y.open.span]).toEqual([0, 0]);
    finish(y, "culvert");
    expect([y.open.kinds[F.TUNNEL], y.open.span]).toEqual([1, 3]);
    const z = F.create({ seed: 1, tier: 3 });
    expect([z.open.blueprints, z.open.pieces]).toEqual([1, 150]);
    expect(F.create({ tier: 4 }).open).toMatchObject({ blueprints: 3, pieces: 400, crate: 128, depot: 40 });
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
    const back = F.decode(JSON.stringify({ ...record(y), got: { planks: { plank: 50 } } }));
    if (!back) throw new Error("the yard does not read back");
    expect([back.open.done[F.goal("planks")], id(back), back.till, back.got[F.goal("planks")]]).toEqual([
      1,
      "ingots",
      80 * F.MILLI,
      null,
    ]);
    const did = give(back, { do: "collect" });
    expect("refused" in did ? [] : did.log).toEqual([
      { kind: "works_story", data: { node: "planks", title: "Planks for the Treasury", pay: 80 } },
    ]);
  });
});
