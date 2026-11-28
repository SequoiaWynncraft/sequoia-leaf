/**
 * Reach research and a card's Upgrade. Long reach and Longer reach raise how many plots out from the
 * one you stand on you build (`Open.range`: 1, then 2, then 3), and sit on no goal's way: on every
 * staged yard and save the tier and what every goal waits on are as they were. A card's Upgrade is
 * the grade command for its one piece, raised one grade (`{ do: "upgrade", tiles, grade, kind, from }`, naming the piece as the card saw it): it
 * needs no tool, and charges, and its Undo gives back, exactly what a build over the piece did.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { REASON } from "../src/reasons.ts";
import { beforeReach, learn } from "./goals.ts";
import { bareLand } from "./land.ts";
import { tunnel } from "./tier5.ts";
import { give, saved, SAVES, staged, STAGES, upgrading } from "./yards.ts";

const LONG = F.goal("longreach");
const LONGER = F.goal("longerreach");
const NEW: ReadonlySet<F.Goal> = new Set([LONG, LONGER]);
const info = (id: string): F.ResearchInfo | undefined => F.RESEARCH.find((r) => r.id === id);

describe("reach research", () => {
  test("each unlocks its number of plots out, from 1, at its tier and cost, and says so", () => {
    expect([F.openOf([]).range, F.openOf([LONG]).range, F.openOf([LONG, LONGER]).range]).toEqual([1, 2, 3]);
    expect(info("longreach")).toMatchObject({
      tier: 3,
      name: "Long reach",
      cost: { timber: 150 },
      unlocks: { range: 2 },
    });
    expect(info("longerreach")).toMatchObject({
      tier: 5,
      name: "Longer reach",
      cost: { timber: 6000, brass: 4000 },
      needs: ["longreach"],
      unlocks: { range: 3 },
    });
    // What each research says it does is what its unlock says.
    for (const id of ["longreach", "longerreach"] as const)
      expect(F.unlockedBy(F.goal(id)).map((u) => u.says)).toEqual([info(id)?.what ?? ""]);
    expect(F.unlocked({ range: F.ANYWHERE }).map((u) => u.says)).toEqual(["You can build anywhere on your land."]);
  });

  test("Longer reach waits on Long reach, and is studied only once tier 5 is open", () => {
    const below5 = F.goalsBelow(5).filter((g) => g !== LONG);
    expect(F.ready(F.openOf(below5), LONGER)).toBe(false);
    expect(F.ready(F.openOf([...below5, LONG]), LONGER)).toBe(true);
    expect(F.ready(F.openOf(F.goalsBelow(4)), LONGER)).toBe(false);
    expect(F.ready(F.openOf(F.goalsBelow(3)), LONG)).toBe(true);
  });

  test("nothing waits on either but Longer reach on Long reach", () => {
    for (const goal of F.GOALS)
      for (const n of goal.needs)
        if (NEW.has(n)) expect([goal.id, F.GOALS[n]?.id]).toEqual(["longerreach", "longreach"]);
  });

  test("on every staged yard and save, the tier and what each goal waits on are as without them", () => {
    const yards = [...STAGES.map((s) => [s, staged(s)] as const), ...SAVES.map((s) => [s, saved(s)] as const)];
    for (const [name, y] of yards) {
      const without = F.openOf(y.done.filter((g) => !NEW.has(g)));
      expect([name, y.open.tier]).toEqual([name, without.tier]);
      for (const g of F.ALL_GOALS)
        if (g !== LONGER)
          expect([name, F.GOALS[g]?.id, F.ready(y.open, g)]).toEqual([name, F.GOALS[g]?.id, F.ready(without, g)]);
      // Saves were kept before reach was research: none knows it, and each reads at the reach it had.
      if (SAVES.some((s) => s === name)) expect([name, y.open.range]).toEqual([name, 1]);
    }
  });
});

/** A yard on a bare land of 20 by 9 with every goal below a tier done (and from tier 5, the deep culvert known), Coins enough, and nothing to hand. */
function yard(tier: number): F.Yard {
  const y = F.create({ land: bareLand(20, 9, [], [17, 4]), tier, seed: 1 });
  if (tier >= 5) learn(y, F.goal("deepculvert"));
  y.spare.fill(0);
  y.till = 1_000_000 * F.MILLI;
  y.history = [];
  return y;
}

/** The Coins a command took from the purse (or gave back, below 0), but for the till paid in; or its refusal. */
function spent(y: F.Yard, c: Record<string, unknown>): number | string {
  const did = give(y, c);
  if ("refused" in did) return did.why;
  return (did.coins ?? []).reduce((sum, ch) => sum + (ch.reason === REASON.till ? 0 : -ch.amount), 0);
}

/** The yard as the check has it, but for what Undo would undo. */
const sum = (y: F.Yard): number => F.check({ ...y, history: [] });

/** Some pieces of graded kinds, each at grade 1: a belt, a splitter, a mill, a tunnel under 2 tiles and, from tier 5, one under 12. */
function laid(y: F.Yard): { kind: string; x: number; y: number }[] {
  const at: [string, number, number][] = [
    ["belt", 1, 1],
    ["splitter", 3, 1],
    ["mill", 5, 1],
  ];
  for (const [kind, x, z] of at) {
    const did = give(y, { do: "build", kind, x, y: z, dir: 0 });
    if ("refused" in did) throw new Error(`${kind} at ${x}, ${z}: ${did.why}`);
  }
  const tunnels: [number, number][] =
    y.open.span >= 12
      ? [
          [5, 2],
          [7, 12],
        ]
      : [[5, 2]];
  for (const [z, span] of tunnels) {
    const did = give(y, tunnel(1, z, span));
    if ("refused" in did) throw new Error(`a tunnel under ${span}: ${did.why}`);
  }
  return [...at, ...tunnels.map(([z]): [string, number, number] => ["tunnel", 1, z])].map(([kind, x, z]) => ({
    kind,
    x,
    y: z,
  }));
}

describe("a card's Upgrade: the grade command for one piece, one grade up", () => {
  test("charges what a build over the piece did, leaves the same yard, and its Undo gives back the same", () => {
    const by = { build: yard(5), grade: yard(5) };
    const pieces = laid(by.build);
    laid(by.grade);
    expect(sum(by.grade)).toBe(sum(by.build));
    for (const grade of [2, 3])
      for (const p of pieces) {
        const i = F.at(by.build, p.x, p.y);
        const built = spent(by.build, { do: "build", ...p, dir: by.build.dir[i], grade });
        const graded = spent(by.grade, upgrading(by.grade, [i], { grade, kind: p.kind, from: grade - 1 }));
        expect([p.kind, grade, graded]).toEqual([p.kind, grade, built]);
        expect(typeof built).toBe("number");
        expect(sum(by.grade)).toBe(sum(by.build));
        // Undone straight away, each gives back what it took; done again, the next grade is the same.
        const back = (y: F.Yard): number | string => spent(y, { do: "undo", entry: y.history.at(-1)?.id ?? "" });
        const undone = { build: back(by.build), grade: back(by.grade) };
        expect(undone.grade).toBe(undone.build);
        expect(undone.build).toBe(-Number(built));
        expect(sum(by.grade)).toBe(sum(by.build));
        spent(by.build, { do: "build", ...p, dir: by.build.dir[i], grade });
        spent(by.grade, upgrading(by.grade, [i], { grade, kind: p.kind, from: grade - 1 }));
      }
    // Taken away at grade 3, each gives back the same.
    for (const { x, y } of pieces)
      expect(spent(by.grade, { do: "remove", x, y })).toBe(spent(by.build, { do: "remove", x, y }));
  });

  test("a tunnel under 12 tiles is charged by its span: 52 Coins to grade II (78 less 26), as a build over it, and given back alike", () => {
    const by = { build: yard(5), grade: yard(5) };
    laid(by.build);
    laid(by.grade);
    const i = F.at(by.grade, 1, 7);
    const raise = { grade: 2, kind: "tunnel", from: 1 };
    expect([by.grade.span[i], F.price(F.TUNNEL, 1, 12), F.price(F.TUNNEL, 2, 12)]).toEqual([12, 26, 78]);
    expect(spent(by.grade, upgrading(by.grade, [i], raise))).toBe(52);
    expect(spent(by.build, { do: "build", kind: "tunnel", x: 1, y: 7, dir: 0, grade: 2 })).toBe(52);
    expect(sum(by.grade)).toBe(sum(by.build));
    // Raised from its far mouth, the card's tile there, it is the same tunnel.
    expect(by.grade.grade[F.at(by.grade, 14, 7)]).toBe(2);
    const back = (y: F.Yard): number | string => spent(y, { do: "undo", entry: y.history.at(-1)?.id ?? "" });
    expect([back(by.grade), back(by.build)]).toEqual([-52, -52]);
    spent(by.build, { do: "build", kind: "tunnel", x: 1, y: 7, dir: 0, grade: 2 });
    spent(by.grade, upgrading(by.grade, [F.at(by.grade, 14, 7)], raise));
    expect(sum(by.grade)).toBe(sum(by.build));
    expect([spent(by.grade, { do: "remove", x: 1, y: 7 }), spent(by.build, { do: "remove", x: 1, y: 7 })]).toEqual([
      -78, -78,
    ]);
  });

  test("needs no tool for one piece, as a build over it did not; an area, and a grade past the highest, as before", () => {
    // Tier 3 open: grades 2 known, Upgrading an area not yet.
    const y = yard(3);
    expect(F.locked(y.open, { use: "upgrade" })).not.toBeNull();
    const [belt, splitter] = laid(y);
    if (!belt || !splitter) throw new Error("nothing laid");
    const one = F.at(y, belt.x, belt.y);
    const belt2 = { grade: 2, kind: "belt", from: 1 };
    expect(F.highest(y.open, F.BELT)).toBe(2);
    expect(give(y, upgrading(y, [one, F.at(y, splitter.x, splitter.y)], belt2))).toMatchObject({
      refused: F.LOCKED,
    });
    expect(give(y, upgrading(y, [one]))).toMatchObject({ refused: F.LOCKED });
    expect(give(y, upgrading(y, [one], { ...belt2, grade: 3 }))).toMatchObject({
      why: "Nothing here can be raised",
    });
    const seen = upgrading(y, [one], belt2);
    expect(typeof spent(y, seen)).toBe("number");
    expect(y.grade[one]).toBe(2);
    // Asked again as the card saw it before, it is no longer that piece.
    expect(give(y, seen)).toMatchObject({
      why: "It has changed since: it is now at grade II.",
    });
  });

  test("names the piece its card was of: one batch that sets a Study where the belt stood refuses the belt's Raise, and charges nothing", () => {
    const y = yard(5);
    laid(y);
    const at = F.at(y, 1, 1);
    // The belt's card quotes its grade II: 2 Coins.
    expect(F.priceAt(y, F.BELT, 1, 1, 2)).toBe(2);
    const raise = upgrading(y, [at], { grade: 2, kind: "belt", from: 1 });
    // Another tab's two commands land first, in the same batch as the Raise.
    const batch = [{ do: "remove", x: 1, y: 1 }, { do: "build", kind: "study", x: 1, y: 1, dir: 0 }, raise];
    const did = batch.map((c) => give(y, c));
    expect(did.slice(0, 2).every((d) => !("refused" in d))).toBe(true);
    const till = y.till;
    expect(did[2]).toEqual({ refused: "cannot_upgrade", why: "It has changed since: it is now a Study." });
    expect([y.kind[at], y.grade[at], y.till]).toEqual([F.STUDY, 1, till]);
    // A Study at grade II would have cost 400 had the Raise gone through as the build it replaced did not.
    expect(F.priceAt(y, F.STUDY, 1, 1, 2)).toBe(400);
    // Seen at another grade, or with nothing there any more, it says so too.
    expect(give(y, { ...raise, kind: "study", from: 2, grade: 3 })).toMatchObject({
      why: "It has changed since: it is now at grade I.",
    });
    give(y, { do: "remove", x: 1, y: 1 });
    expect(give(y, raise)).toMatchObject({ why: "It has changed since: nothing stands there now." });
  });

  test("on the wire: the grade only when it is said, and every Upgrade with the price the player was shown", () => {
    const area: F.Act = { do: "upgrade", tiles: [4, 5], price: 6 };
    const one: F.Act = { do: "upgrade", tiles: [4], raise: { kind: F.BELT, from: 1, grade: 2 }, price: 2 };
    expect(F.writeAct(area)).toEqual({ do: "upgrade", tiles: [4, 5], price: 6 });
    expect(F.writeAct(one)).toEqual({ do: "upgrade", tiles: [4], grade: 2, kind: "belt", from: 1, price: 2 });
    expect(F.readCommand({ tick: 0, ...F.writeAct(one) })).toMatchObject(one);
    expect(F.readCommand({ tick: 0, do: "upgrade", tiles: [4], grade: 0, kind: "belt", from: 1, price: 2 })).toBeNull();
    // With no price, or one that is not a whole number of Coins, none reads.
    for (const price of [undefined, -1, 1.5, "2"]) {
      expect(F.readCommand({ tick: 0, do: "upgrade", tiles: [4, 5], price })).toBeNull();
      expect(F.readCommand({ tick: 0, do: "upgrade", tiles: [4], grade: 2, kind: "belt", from: 1, price })).toBeNull();
    }
    // A grade with no kind or grade it was seen at does not read.
    expect(F.readCommand({ tick: 0, do: "upgrade", tiles: [4], grade: 2, price: 2 })).toBeNull();
    expect(F.readCommand({ tick: 0, do: "upgrade", tiles: [4], grade: 2, kind: "belt", price: 2 })).toBeNull();
  });
});

/** A kept yard's version. */
const versionOf = (text: string): unknown => {
  const v: unknown = JSON.parse(text);
  return typeof v === "object" && v !== null && "v" in v ? v.v : null;
};

/** Yards holding reach research, each in one way, as play leaves them. */
const HOLDING: Readonly<Record<string, () => F.Yard>> = {
  "Long reach known": () => {
    const y = F.create({ seed: 2, tier: 3 });
    learn(y, LONG);
    return y;
  },
  "Long reach in the line": () => {
    const y = F.create({ seed: 2, tier: 3 });
    give(y, { do: "study", research: "longreach" });
    return y;
  },
  "Long reach given folios": () => {
    const y = F.create({ seed: 2, tier: 3 });
    give(y, { do: "study", research: "longreach" });
    F.giveGoal(y, LONG, F.item("timber"), 10);
    return y;
  },
  "Longer reach known": () => {
    const y = F.create({ seed: 2, tier: 5 });
    learn(y, LONGER);
    return y;
  },
};

describe("saves holding reach research", () => {
  for (const [name, make] of Object.entries(HOLDING))
    test(`one with ${name} is kept as version ${F.VERSION}, which the Leaf of version 10 leaves as a newer Leaf's, and reads back here as itself`, () => {
      const y = make();
      const text = F.encode(y);
      expect([F.pastTen(y), versionOf(text)]).toEqual([true, F.VERSION]);
      const back = F.decode(text, y.land);
      if (!back) throw new Error("it does not read back");
      expect([F.keptLater(text, y.land), back.done, back.line, back.open.range]).toEqual([
        false,
        y.done,
        y.line,
        y.open.range,
      ]);
    });

  test("one of tier 4 without it is kept as version 9, as before; the range is worked out, never kept", () => {
    const y = beforeReach(F.create({ seed: 2, tier: 4 }));
    const text = F.encode(y);
    expect([F.pastTen(y), versionOf(text), text.includes("range")]).toEqual([false, F.PLACED, false]);
  });
});
