import { describe, expect, test } from "bun:test";

import { boonNumber } from "./content/boons.ts";
import { FIGURE_IDS, type FigureId, FIGURES, isFigureId, type Stars } from "./content/figures.ts";
import type { ItemId } from "./content/items.ts";
import { ECONOMY, MAX_LEVEL, ROOM_COUNT, ROOMS, STALL_ODDS } from "./content/rooms.ts";
import { traitNumber } from "./content/traits.ts";
import { resolveFight } from "./fight/engine.ts";
import { isParty, type Party, partyWorth } from "./party.ts";
import {
  abandon,
  beginFight,
  buy,
  buyXp,
  choose,
  fieldCap,
  fielded,
  fightSetup,
  giveItem,
  hold,
  interestNow,
  move,
  opposition,
  type Piece,
  pieceAt,
  pieces,
  priceOf,
  redraw,
  type Run,
  rustle,
  rustleCost,
  sell,
  sellValue,
  STALL_POOL,
  startRun,
  summariseRun,
  takeTakings,
  toBench,
  traitsNow,
  xpToNext,
} from "./run.ts";
import { sparParty } from "./spar.ts";
import { abc, at, partyOfFigures } from "./testkit.ts";

/** A run with its first figure picked. */
function started(seed = 1): Run {
  const run = startRun(seed);
  expect(choose(run, 0).ok).toBe(true);
  return run;
}
/** Puts a figure straight onto the board or bench, as if it had been bought and moved there. */
function put(run: Run, kind: FigureId, seat: number, stars: Stars = 1, items: ItemId[] = []): Piece {
  const piece: Piece = { id: run.nextId++, kind, stars, items, fed: 0 };
  run.board[seat] = piece;
  return piece;
}
function onBench(run: Run, kind: FigureId, slot: number, stars: Stars = 1, items: ItemId[] = []): Piece {
  const piece: Piece = { id: run.nextId++, kind, stars, items, fed: 0 };
  run.bench[slot] = piece;
  return piece;
}
/** Fills a place on the stall with a figure of our choosing. */
const stock = (run: Run, offer: number, kind: FigureId): void => {
  run.stall[offer] = kind;
};
const PUSHOVER: Party = partyOfFigures([at("gnat", 3, 0)], { who: "The forest", title: "One gnat" });
const WALL: Party = partyOfFigures(
  [
    at("mud", 1, 0, 3),
    at("mud", 3, 0, 3),
    at("mud", 5, 0, 3),
    at("wasp", 2, 1, 3),
    at("wasp", 4, 1, 3),
    at("wasp", 3, 2, 3),
  ],
  { who: "The forest", title: "Far too much mud", might: 300 },
);
/** A run whose party will win its next fight, or lose it. */
function winning(seed = 1): Run {
  const run = started(seed);
  run.level = 3;
  run.board[3] = null;
  put(run, "badger", 3, 3);
  put(run, "crab40", 2, 3);
  run.foe = structuredClone(PUSHOVER);
  return run;
}
function losing(seed = 1): Run {
  const run = started(seed);
  run.foe = structuredClone(WALL);
  return run;
}
/** Fights the room and takes the takings, which must both be allowed. */
function fight(run: Run) {
  const begun = beginFight(run);
  if (!begun.ok) throw new Error(begun.why);
  const taken = takeTakings(run);
  if (!taken.ok) throw new Error(taken.why);
  return taken;
}
/** Settles whatever is waiting to be chosen, taking the first option each time. */
function settle(run: Run): void {
  while (run.choices.length > 0) expect(choose(run, 0).ok).toBe(true);
}

describe("starting a run", () => {
  test("it opens on a pick of one from three one-acorn figures, and nothing else may happen first", () => {
    const run = startRun(42);
    const choice = run.choices[0];
    expect(choice?.kind).toBe("starter");
    if (choice?.kind !== "starter") return;
    expect(choice.options.length).toBe(3);
    expect(new Set(choice.options).size).toBe(3);
    for (const kind of choice.options) expect(FIGURES[kind].tier).toBe(1);
    expect(buy(run, 0)).toEqual({ ok: false, why: "Pick who sets out with you first." });
    expect(beginFight(run).ok).toBe(false);
    expect(choose(run, 7)).toEqual({ ok: false, why: "That is not one of the three." });
    const picked = choose(run, 1);
    expect(picked.ok).toBe(true);
    expect(run.board[3]?.kind).toBe(choice.options[1] ?? "worm");
    expect(run.choices.length).toBe(0);
  });
  test("it starts with a few acorns, twenty resolve, level one, and a stall of five cheap figures", () => {
    const run = started();
    expect(run.acorns).toBe(ECONOMY.startAcorns);
    expect(run.resolve).toBe(20);
    expect(run.level).toBe(1);
    expect(run.room).toBe(0);
    expect(run.phase).toBe("plan");
    expect(run.stall.length).toBe(5);
    for (const kind of run.stall) expect(kind && FIGURES[kind].tier).toBe(1);
    expect(run.board.length).toBe(28);
    expect(run.bench.length).toBe(9);
    expect(run.foe.who).toBe("The forest");
    expect(ROOMS[0]?.kind).toBe("trouble");
  });
  test("the same seed starts the same run", () => {
    expect(startRun(9)).toEqual(startRun(9));
    expect(startRun(9).stall).not.toEqual(startRun(10).stall);
  });
  test("every one of the twenty-eight can turn up at the stall, from the first run", () => {
    expect(abc(STALL_POOL)).toEqual(abc(FIGURE_IDS));
    const run = startRun(3);
    choose(run, 0);
    run.level = 8;
    run.acorns = 100_000;
    const seen = new Set<FigureId>();
    for (let i = 0; i < 400; i++) {
      rustle(run);
      for (const kind of run.stall) if (kind) seen.add(kind);
    }
    expect(seen.size).toBe(FIGURE_IDS.length);
  });
});

describe("the stall", () => {
  test("buying costs the figure's tier and puts it on the bench", () => {
    const run = started();
    run.acorns = 10;
    stock(run, 2, "slug");
    const done = buy(run, 2);
    expect(done.ok).toBe(true);
    expect(run.acorns).toBe(10 - FIGURES.slug.tier);
    expect(run.bench[0]?.kind).toBe("slug");
    expect(run.stall[2]).toBeNull();
    expect(done.ok && done.notes[0]).toMatchObject({ t: "bought", kind: "slug", cost: 2, to: { on: "bench", at: 0 } });
  });
  test("it refuses an empty place, an empty purse and a full bench, in plain words", () => {
    const run = started();
    run.acorns = 1;
    stock(run, 0, "badger");
    expect(buy(run, 0)).toEqual({ ok: false, why: "Not enough acorns." });
    run.stall[1] = null;
    expect(buy(run, 1)).toEqual({ ok: false, why: "That place on the stall is empty." });
    expect(buy(run, 99)).toEqual({ ok: false, why: "That place on the stall is empty." });
    run.acorns = 50;
    const kinds: FigureId[] = ["worm", "finch", "moth", "slug", "glorp", "jay", "rock", "kettle", "heron"];
    kinds.forEach((kind, slot) => onBench(run, kind, slot));
    expect(buy(run, 0)).toEqual({ ok: false, why: "The bench is full." });
    expect(run.acorns).toBe(50);
  });
  test("one rustle a room is free, the rest cost two acorns", () => {
    const run = started();
    run.acorns = 5;
    expect(rustleCost(run)).toBe(0);
    const before = run.stall.slice();
    expect(rustle(run).ok).toBe(true);
    expect(run.acorns).toBe(5);
    expect(run.stall).not.toEqual(before);
    expect(rustleCost(run)).toBe(ECONOMY.rustle);
    expect(rustle(run).ok).toBe(true);
    expect(run.acorns).toBe(3);
    run.acorns = 1;
    expect(rustle(run)).toEqual({ ok: false, why: "Not enough acorns." });
  });
  test("a held stall is still there next room, and then lets go", () => {
    const run = winning();
    stock(run, 0, "greg");
    expect(hold(run).ok).toBe(true);
    expect(run.held).toBe(true);
    const kept = run.stall.slice();
    fight(run);
    expect(run.stall).toEqual(kept);
    expect(run.held).toBe(false);
    settle(run);
    run.foe = structuredClone(PUSHOVER);
    fight(run);
    expect(run.stall).not.toEqual(kept);
  });
  test("what the stall offers depends on level: only the cheapest at first, the dearest late and seldom", () => {
    const run = started();
    run.acorns = 100_000;
    const seen = [0, 0, 0, 0, 0];
    const roll = (times: number): void => {
      for (let i = 0; i < times; i++) {
        rustle(run);
        for (const kind of run.stall) if (kind) seen[FIGURES[kind].tier - 1] = (seen[FIGURES[kind].tier - 1] ?? 0) + 1;
      }
    };
    roll(100);
    expect(seen).toEqual([500, 0, 0, 0, 0]);
    run.level = 5;
    seen.fill(0);
    roll(400);
    expect(seen[4]).toBe(0);
    expect(seen[3]).toBeGreaterThan(0);
    run.level = 8;
    seen.fill(0);
    roll(800);
    const total = seen.reduce((a, b) => a + b, 0);
    seen.forEach((count, i) => {
      const odds = (STALL_ODDS[7]?.[i] ?? 0) / 100;
      expect(count / total).toBeGreaterThan(odds - 0.03);
      expect(count / total).toBeLessThan(odds + 0.03);
    });
  });
});

describe("selling and moving", () => {
  test("selling returns the price at one star, a little less for merged figures, and hands the items back", () => {
    const run = started();
    const two = onBench(run, "slug", 0, 2, ["wasptail", "bark"]);
    const three = onBench(run, "badger", 1, 3);
    expect(sellValue(two)).toBe(2 * 3 - 1);
    expect(sellValue(three)).toBe(4 * 9 - 2);
    const acorns = run.acorns;
    const done = sell(run, { on: "bench", at: 0 });
    expect(done.ok).toBe(true);
    expect(run.acorns).toBe(acorns + 5);
    expect(run.items).toEqual(["wasptail", "bark"]);
    expect(run.bench[0]).toBeNull();
    onBench(run, "worm", 4);
    sell(run, { on: "bench", at: 4 });
    expect(run.acorns).toBe(acorns + 5 + 1);
  });
  test("nobody is nowhere, and the last figure stays", () => {
    const run = started();
    expect(sell(run, { on: "bench", at: 3 })).toEqual({ ok: false, why: "Nobody is there." });
    expect(sell(run, { on: "board", at: 3 })).toEqual({ ok: false, why: "Somebody has to go on the raid." });
  });
  test("the level is how many may be fielded", () => {
    const run = started();
    onBench(run, "worm", 0);
    onBench(run, "finch", 1);
    expect(fieldCap(run)).toBe(1);
    expect(move(run, { on: "bench", at: 0 }, { on: "board", at: 10 })).toEqual({
      ok: false,
      why: "You can field 1 figure for now.",
    });
    run.level = 2;
    expect(move(run, { on: "bench", at: 0 }, { on: "board", at: 10 }).ok).toBe(true);
    expect(fielded(run)).toBe(2);
    expect(move(run, { on: "bench", at: 1 }, { on: "board", at: 11 })).toEqual({
      ok: false,
      why: "You can field 2 figures for now.",
    });
    // Changing places with somebody already on the board is always allowed.
    const swapped = move(run, { on: "bench", at: 1 }, { on: "board", at: 10 });
    expect(swapped.ok).toBe(true);
    expect(run.board[10]?.kind).toBe("finch");
    expect(run.bench[1]?.kind).toBe("worm");
    expect(fielded(run)).toBe(2);
  });
  test("moving about the board, to the bench, and to places that are not places", () => {
    const run = started();
    const who = run.board[3];
    expect(move(run, { on: "board", at: 3 }, { on: "board", at: 27 }).ok).toBe(true);
    expect(run.board[27]?.id).toBe(who?.id ?? -1);
    expect(run.board[3]).toBeNull();
    expect(move(run, { on: "board", at: 27 }, { on: "board", at: 27 })).toEqual({
      ok: false,
      why: "It is already there.",
    });
    expect(move(run, { on: "board", at: 27 }, { on: "board", at: 28 })).toEqual({
      ok: false,
      why: "There is no such place.",
    });
    expect(move(run, { on: "board", at: 27 }, { on: "bench", at: 9 })).toEqual({
      ok: false,
      why: "There is no such place.",
    });
    expect(move(run, { on: "board", at: 5 }, { on: "board", at: 6 })).toEqual({ ok: false, why: "Nobody is there." });
    expect(toBench(run, 27).ok).toBe(true);
    expect(run.bench[0]?.id).toBe(who?.id ?? -1);
    expect(toBench(run, 27)).toEqual({ ok: false, why: "Nobody is there." });
    expect(pieceAt(run, { on: "bench", at: 0 })?.id).toBe(who?.id ?? -1);
    expect(beginFight(run)).toEqual({ ok: false, why: "Put somebody on the board first." });
  });
});

describe("three of a kind", () => {
  test("three of the same at one star become one at two stars at once, board and bench together", () => {
    const run = started();
    run.board[3] = null;
    const front = put(run, "worm", 3);
    onBench(run, "worm", 5);
    run.acorns = 5;
    stock(run, 0, "worm");
    const done = buy(run, 0);
    expect(done.ok).toBe(true);
    expect(pieces(run).length).toBe(1);
    // The one on the board is the one that stays.
    expect(pieces(run)[0]).toBe(front);
    expect(pieceAt(run, { on: "board", at: 3 })?.id).toBe(front.id);
    expect(front.stars).toBe(2);
    expect(run.bench.every((p) => p === null)).toBe(true);
    expect(done.ok && done.notes.map((n) => n.t)).toEqual(["bought", "merged"]);
  });
  test("three at two stars become one at three, straight away", () => {
    const run = started();
    run.board[3] = null;
    const keeper = put(run, "worm", 3, 2);
    onBench(run, "worm", 0, 2);
    onBench(run, "worm", 1);
    onBench(run, "worm", 2);
    run.acorns = 5;
    stock(run, 0, "worm");
    const done = buy(run, 0);
    expect(keeper.stars).toBe(3);
    expect(pieces(run)).toEqual([keeper]);
    expect(done.ok && done.notes.filter((n) => n.t === "merged").length).toBe(2);
    expect(run.seen.threeStars).toEqual(["worm"]);
    // Three stars is the top: more copies just sit there.
    onBench(run, "worm", 0, 3);
    onBench(run, "worm", 1, 3);
    stock(run, 1, "worm");
    buy(run, 1);
    expect(pieces(run).filter((p) => p.stars === 3).length).toBe(3);
  });
  test("different stars of the same figure do not merge, nor do different figures", () => {
    const run = started();
    run.board[3] = null;
    put(run, "worm", 3, 2);
    onBench(run, "worm", 0);
    onBench(run, "finch", 1);
    run.acorns = 5;
    stock(run, 0, "worm");
    buy(run, 0);
    expect(abc(pieces(run).map((p) => `${p.kind}${p.stars}`))).toEqual(["finch1", "worm1", "worm1", "worm2"]);
  });
  test("with a full bench, buying is allowed when it completes three", () => {
    const run = started();
    run.board[3] = null;
    const keeper = put(run, "worm", 3);
    const kinds: FigureId[] = ["worm", "finch", "moth", "slug", "glorp", "jay", "rock", "kettle", "heron"];
    kinds.forEach((kind, slot) => onBench(run, kind, slot));
    run.acorns = 5;
    stock(run, 0, "worm");
    stock(run, 1, "finch");
    expect(buy(run, 1)).toEqual({ ok: false, why: "The bench is full." });
    const done = buy(run, 0);
    expect(done.ok).toBe(true);
    expect(keeper.stars).toBe(2);
    expect(run.bench[0]).toBeNull();
    expect(done.ok && done.notes[0]).toMatchObject({ t: "bought", to: null });
  });
  test("items held by the merged copies are kept, and what does not fit goes back to the item bench", () => {
    const run = started();
    run.board[3] = null;
    const keeper = put(run, "worm", 3, 1, ["wasptail", "stump"]);
    onBench(run, "worm", 0, 1, ["hoard", "blackthorn"]);
    run.acorns = 5;
    stock(run, 0, "worm");
    const done = buy(run, 0);
    expect(keeper.items).toEqual(["wasptail", "stump", "hoard"]);
    expect(run.items).toEqual(["blackthorn"]);
    expect(done.ok && done.notes[1]).toMatchObject({ t: "merged", spilled: ["blackthorn"] });
  });
  test("loose components that meet in a merge forge, as they would if handed over", () => {
    const run = started();
    run.board[3] = null;
    const keeper = put(run, "worm", 3, 1, ["thorn"]);
    onBench(run, "worm", 0, 1, ["plume", "stump"]);
    run.acorns = 5;
    stock(run, 0, "worm");
    buy(run, 0);
    expect(keeper.stars).toBe(2);
    expect(keeper.items).toEqual(["wasptail", "stump"]);
    expect(run.seen.forged).toEqual(["wasptail"]);
    expect(run.items).toEqual([]);
  });
});

describe("levels", () => {
  test("four acorns buy four experience, and levels come at the thresholds in the table", () => {
    const run = started();
    run.acorns = 400;
    const needs = ECONOMY.levelXp;
    expect(xpToNext(run)).toBe(needs[0] ?? 0);
    let bought = 0;
    for (let level = 1; level < MAX_LEVEL; level++) {
      const total = needs.slice(0, level).reduce((a, b) => a + b, 0);
      while (bought < total) {
        expect(buyXp(run).ok).toBe(true);
        bought += ECONOMY.xpBought;
      }
      expect(run.level).toBeGreaterThanOrEqual(level + 1);
    }
    expect(run.level).toBe(MAX_LEVEL);
    expect(run.acorns).toBe(400 - bought);
    expect(bought % 4).toBe(0);
    expect(buyXp(run)).toEqual({ ok: false, why: "There is no level above this one." });
    expect(xpToNext(run)).toBe(0);
  });
  test("it is refused without the acorns", () => {
    const run = started();
    run.acorns = 3;
    expect(buyXp(run)).toEqual({ ok: false, why: "Not enough acorns." });
  });
  test("every room gives two experience for nothing", () => {
    const run = winning();
    run.level = 5;
    run.xp = 0;
    fight(run);
    expect(run.xp).toBe(ECONOMY.xpRoom);
  });
});

describe("items", () => {
  test("a component handed to a figure is held; a second one forges with it", () => {
    const run = started();
    run.items = ["thorn", "plume", "bark"];
    const first = giveItem(run, 0, { on: "board", at: 3 });
    expect(first.ok && first.notes[0]).toMatchObject({ t: "gave", item: "thorn", forged: null, holds: ["thorn"] });
    const second = giveItem(run, 0, { on: "board", at: 3 });
    expect(second.ok && second.notes[0]).toMatchObject({ t: "gave", item: "plume", forged: "wasptail" });
    expect(run.board[3]?.items).toEqual(["wasptail"]);
    expect(run.items).toEqual(["bark"]);
    expect(run.seen.forged).toEqual(["wasptail"]);
  });
  test("two of the same component forge too", () => {
    const run = started();
    run.items = ["bark", "bark"];
    giveItem(run, 0, { on: "board", at: 3 });
    giveItem(run, 0, { on: "board", at: 3 });
    expect(run.board[3]?.items).toEqual(["stump"]);
  });
  test("a figure holds three, and no more", () => {
    const run = started();
    const piece = run.board[3];
    if (piece) piece.items = ["stump", "hoard", "quilt"];
    run.items = ["thorn"];
    expect(giveItem(run, 0, { on: "board", at: 3 })).toEqual({ ok: false, why: "It is holding all it can." });
    expect(giveItem(run, 4, { on: "board", at: 3 })).toEqual({ ok: false, why: "There is no such item." });
    expect(giveItem(run, 0, { on: "board", at: 9 })).toEqual({ ok: false, why: "Nobody is there." });
    expect(run.items).toEqual(["thorn"]);
  });
});

describe("the takings", () => {
  test("a won room pays five, one for the win, and interest on what was held", () => {
    const run = winning();
    run.acorns = 37;
    const taken = fight(run);
    expect(taken.fight.result).toBe("win");
    expect(run.acorns).toBe(37 + 5 + 1 + 3);
    const paid = taken.notes.flatMap((n) => (n.t === "acorns" ? [[n.why, n.amount]] : []));
    expect(paid).toEqual([
      ["room", 5],
      ["win", 1],
      ["interest", 3],
    ]);
    expect(run.resolve).toBe(20);
  });
  test("interest is one for every ten held, and never more than five", () => {
    const run = winning();
    for (const [held, interest] of [
      [0, 0],
      [9, 0],
      [10, 1],
      [49, 4],
      [50, 5],
      [500, 5],
    ] as const) {
      run.acorns = held;
      expect(interestNow(run)).toBe(interest);
    }
    run.acorns = 500;
    fight(run);
    expect(run.acorns).toBe(500 + 5 + 1 + 5);
  });
  test("there is no bonus for winning, or losing, several in a row", () => {
    const run = winning();
    const gains: number[] = [];
    for (let i = 0; i < 4; i++) {
      settle(run);
      run.acorns = 0;
      run.foe = structuredClone(PUSHOVER);
      fight(run);
      gains.push(run.acorns);
    }
    expect(gains).toEqual([6, 6, 6, 6]);
  });
  test("a lost room still pays five and interest, but not the acorn for winning", () => {
    const run = losing();
    run.acorns = 20;
    const taken = fight(run);
    expect(taken.fight.result).toBe("loss");
    expect(run.acorns).toBe(20 + 5 + 2);
  });
  test("gnomes find acorns: more after a win, and at the second step even after a loss", () => {
    const two = winning();
    put(two, "barrowgnome", 10);
    put(two, "lanterngnome", 11);
    two.level = 8;
    two.acorns = 0;
    const taken = fight(two);
    expect(two.acorns).toBe(5 + 1 + traitNumber("gnome", "win", 1));
    expect(taken.notes.some((n) => n.t === "acorns" && n.why === "gnomes")).toBe(true);

    const four = losing();
    four.level = 8;
    for (const [kind, seat] of [
      ["barrowgnome", 10],
      ["lanterngnome", 11],
      ["bushgnome", 12],
      ["apothecary", 13],
    ] as const) {
      put(four, kind, seat);
    }
    four.acorns = 0;
    fight(four);
    expect(four.acorns).toBe(5 + traitNumber("gnome", "loss", 2));
    expect(traitNumber("gnome", "loss", 1)).toBe(0);
    expect(traitNumber("gnome", "loss", 2)).toBeGreaterThan(0);
  });
  test("two copies of one gnome are one gnome", () => {
    const run = winning();
    run.level = 8;
    put(run, "barrowgnome", 10);
    put(run, "barrowgnome", 11);
    expect(traitsNow(run).find((t) => t.trait === "gnome")).toEqual({ trait: "gnome", count: 1, step: 0 });
    run.acorns = 0;
    fight(run);
    expect(run.acorns).toBe(6);
  });
});

describe("resolve", () => {
  test("a lost room costs two and one for each enemy still standing, never more than seven", () => {
    const run = losing();
    const taken = fight(run);
    expect(taken.fight.standing[1]).toBe(6);
    expect(run.resolve).toBe(20 - 7);
    expect(taken.notes).toContainEqual({ t: "resolve", change: -7, left: 13 });

    const close = started();
    close.foe = partyOfFigures([at("mud", 3, 0, 3)], { might: 300 });
    const lost = fight(close);
    expect(lost.fight.result).toBe("loss");
    expect(lost.fight.standing[1]).toBe(1);
    expect(close.resolve).toBe(20 - 3);
  });
  test("a draw counts as a loss at the least it can cost", () => {
    const run = started();
    run.board[3] = null;
    put(run, "rock", 3);
    run.foe = partyOfFigures([at("rock", 3, 0)]);
    const taken = fight(run);
    expect(taken.fight.result).toBe("draw");
    expect(run.resolve).toBe(20 - ECONOMY.lossBase);
    expect(run.acorns).toBe(ECONOMY.startAcorns + 5);
  });
  test("at no resolve the party walks home: the run is over, and still summed up for what it cleared", () => {
    const run = winning();
    fight(run);
    settle(run);
    run.resolve = 3;
    run.foe = structuredClone(WALL);
    for (const p of pieces(run)) p.stars = 1;
    const taken = fight(run);
    expect(taken.fight.result).toBe("loss");
    expect(run.resolve).toBe(0);
    expect(run.phase).toBe("over");
    expect(run.won).toBe(false);
    expect(taken.notes.at(-1)).toEqual({ t: "over", won: false });
    expect(summariseRun(run)).toMatchObject({ cleared: 1, won: false, left: false, reached: 2 });
    expect(buy(run, 0)).toEqual({ ok: false, why: "The raid is over." });
    expect(takeTakings(run)).toEqual({ ok: false, why: "The raid is over." });
  });
});

describe("the rooms", () => {
  test("a room is planned, fought and paid for, in that order", () => {
    const run = winning();
    expect(takeTakings(run)).toEqual({ ok: false, why: "There has been no fight yet." });
    expect(fightSetup(run)).toBeNull();
    const begun = beginFight(run);
    expect(begun.ok).toBe(true);
    expect(run.phase).toBe("fight");
    for (const refused of [buy(run, 0), rustle(run), buyXp(run), sell(run, { on: "board", at: 3 }), hold(run)]) {
      expect(refused).toEqual({ ok: false, why: "The figures are busy fighting." });
    }
    expect(beginFight(run).ok).toBe(false);
    expect(takeTakings(run).ok).toBe(true);
    expect(run.phase).toBe("plan");
    expect(run.room).toBe(1);
  });
  test("the fight a screen is given is the fight the run pays out on", () => {
    const run = winning(5);
    const begun = beginFight(run);
    if (!begun.ok) throw new Error(begun.why);
    expect(fightSetup(run)).toEqual(begun.setup);
    const watched = resolveFight(begun.setup);
    const taken = takeTakings(run);
    expect(taken.ok && taken.fight).toEqual(watched);
    expect(abc(begun.setup.sides[0].figures.map((p) => p.kind))).toEqual(["badger", "crab40"]);
    expect(begun.setup.sides[1]).toEqual(PUSHOVER);
  });
  test("losing a room still moves on to the next; a run is fifteen rooms", () => {
    const run = losing();
    fight(run);
    expect(run.room).toBe(1);
    expect(run.record).toEqual([{ room: 0, kind: "trouble", result: "loss", standing: [0, 6], boss: null }]);
    expect(ROOM_COUNT).toBe(15);
  });
  test("clearing the fifteenth room wins the run", () => {
    const run = winning();
    run.room = ROOM_COUNT - 1;
    run.foe = opposition(run.seed, run.room, 0);
    for (const p of pieces(run)) p.stars = 3;
    run.level = 8;
    for (const [i, kind] of (["badger", "fogowl", "heron", "greg", "whitefox", "hearthcat"] as const).entries()) {
      put(run, kind, 7 + i, 3, ["blackthorn", "wasptail", "honeycake"]);
    }
    const taken = fight(run);
    expect(taken.fight.result).toBe("win");
    expect(run.phase).toBe("over");
    expect(run.won).toBe(true);
    expect(summariseRun(run)).toMatchObject({ won: true, bosses: ["bigcrab"], reached: 15 });
    expect(taken.notes.at(-1)).toEqual({ t: "over", won: true });
  });
  test("the last room is fought again until it is won or resolve runs out", () => {
    const run = losing();
    run.room = ROOM_COUNT - 1;
    run.foe = opposition(run.seed, run.room, 0);
    const first = fight(run);
    expect(first.fight.result).toBe("loss");
    expect(run.phase).toBe("plan");
    expect(run.room).toBe(ROOM_COUNT - 1);
    expect(run.foe.figures.some((p) => p.kind === "bigcrab")).toBe(true);
    settle(run);
    // The second go is its own fight, not a replay of the first.
    const again = beginFight(run);
    expect(again.ok && again.setup.seed).not.toBe(undefined);
    takeTakings(run);
    settle(run);
    fight(run);
    expect(run.phase).toBe("over");
    expect(run.won).toBe(false);
    expect(run.record.length).toBe(3);
  });
  test("walking home early ends the run", () => {
    const run = winning();
    fight(run);
    expect(abandon(run).ok).toBe(true);
    expect(run.phase).toBe("over");
    expect(summariseRun(run)).toMatchObject({ left: true, won: false, cleared: 1 });
    expect(abandon(run)).toEqual({ ok: false, why: "The raid is over." });
  });
  test("Greg eats after every fight he is in, up to a point", () => {
    const run = winning();
    const greg = put(run, "greg", 10);
    fight(run);
    expect(greg.fed).toBe(1);
    greg.fed = traitNumber("greg", "most", 1);
    settle(run);
    run.foe = structuredClone(PUSHOVER);
    fight(run);
    expect(greg.fed).toBe(traitNumber("greg", "most", 1));
  });
});

describe("choices after a room", () => {
  test("trouble gives a pick of one component from three when won, from two when lost", () => {
    const won = winning();
    fight(won);
    const pick = won.choices[0];
    expect(pick?.kind).toBe("component");
    expect(pick?.options.length).toBe(3);
    expect(new Set(pick?.options).size).toBe(3);
    expect(buy(won, 0)).toEqual({ ok: false, why: "Pick a component first." });
    const item = pick?.kind === "component" ? pick.options[2] : undefined;
    expect(choose(won, 2).ok).toBe(true);
    expect(won.items).toEqual(item ? [item] : []);

    const lost = losing();
    fight(lost);
    expect(lost.choices[0]?.options.length).toBe(2);
  });
  test("sparring gives none; a boss gives two picks when beaten", () => {
    const run = winning();
    run.room = 2;
    fight(run);
    expect(run.choices.length).toBe(0);
    run.room = 4;
    run.foe = structuredClone(PUSHOVER);
    fight(run);
    expect(run.choices.map((c) => c.kind)).toEqual(["component", "component", "boon"]);
  });
  test("a boon is offered after the second room and after the first two bosses: three to pick from, one redraw", () => {
    expect(ECONOMY.boonRooms).toEqual([1, 4, 9]);
    const run = winning();
    run.room = 1;
    fight(run);
    settleComponents(run);
    const offer = run.choices[0];
    expect(offer?.kind).toBe("boon");
    if (offer?.kind !== "boon") return;
    const first = offer.options.slice();
    expect(first.length).toBe(3);
    expect(new Set(first).size).toBe(3);
    expect(redraw(run).ok).toBe(true);
    expect(offer.options.length).toBe(3);
    for (const boon of offer.options) expect(first).not.toContain(boon);
    expect(redraw(run)).toEqual({ ok: false, why: "You have already asked for others." });
    const taking = offer.options[1];
    expect(choose(run, 1).ok).toBe(true);
    expect(run.boons).toEqual(taking ? [taking] : []);
    expect(redraw(run)).toEqual({ ok: false, why: "There are no boons on offer." });
  });
  test("boons already held are not offered again, and charms only for a kin the party has", () => {
    const run = winning();
    run.boons = ["secondwind", "extrachair", "windfall", "basket", "headstart"];
    run.room = 1;
    for (let i = 0; i < 30; i++) {
      run.choices = [];
      run.record = [];
      run.phase = "plan";
      run.room = 1;
      run.foe = structuredClone(PUSHOVER);
      fight(run);
      settleComponents(run);
      const offer = run.choices[0];
      if (offer?.kind !== "boon") throw new Error("no boon offered");
      for (const boon of offer.options) {
        expect(run.boons).not.toContain(boon);
        // The party is a Badger and a Crab #40: Burrow and Crab.
        if (boon.endsWith("charm")) expect(["burrowcharm", "crabcharm"]).toContain(boon);
      }
      expect(offer.options.filter((b) => b.endsWith("charm")).length).toBeLessThanOrEqual(1);
    }
  });
});
function settleComponents(run: Run): void {
  while (run.choices[0]?.kind === "component") choose(run, 0);
}

/** A winning run that has just been offered, and taken, one boon. */
const withBoon = (boon: Run["boons"][number], prepare: (run: Run) => void = () => {}): Run => {
  const run = winning();
  prepare(run);
  run.choices = [{ kind: "boon", options: [boon], redraws: 0 }];
  expect(choose(run, 0).ok).toBe(true);
  return run;
};
/** What sparring partners have spent on their figures in a room, on average. */
const spent = (room: number, trail: number): number => {
  let total = 0;
  for (let seed = 1; seed <= 40; seed++) total += partyWorth(sparParty(seed, room, trail));
  return total / 40;
};

describe("boons", () => {
  test("Windfall pays at once; A Basket On The Stump leaves two components; Warm Blanket gives resolve back", () => {
    const start = ECONOMY.startAcorns;
    expect(withBoon("windfall").acorns).toBe(start + boonNumber("windfall", "acorns"));
    expect(withBoon("basket").items.length).toBe(boonNumber("basket", "components"));
    expect(withBoon("blanket", (run) => (run.resolve = 10)).resolve).toBe(10 + boonNumber("blanket", "now"));
    expect(withBoon("blanket", (run) => (run.resolve = 19)).resolve).toBe(20);
  });
  test("Warm Blanket makes every lost room cost one less", () => {
    const run = withBoon("blanket");
    run.foe = structuredClone(WALL);
    for (const p of pieces(run)) p.stars = 1;
    fight(run);
    expect(run.resolve).toBe(20 - (ECONOMY.lossMost - boonNumber("blanket", "less")));
  });
  test("An Extra Chair fields one more than the level", () => {
    const run = withBoon("extrachair");
    expect(fieldCap(run)).toBe(run.level + 1);
  });
  test("A Wider Stall shows six, now and after", () => {
    const run = withBoon("widestall");
    expect(run.stall.length).toBe(6);
    rustle(run);
    expect(run.stall.length).toBe(6);
  });
  test("A Regular gets a second free rustle every room", () => {
    const run = withBoon("regular");
    run.acorns = 0;
    expect(rustle(run).ok).toBe(true);
    expect(rustle(run).ok).toBe(true);
    expect(rustle(run).ok).toBe(false);
    fight(run);
    expect(run.rustles).toBe(2);
  });
  test("Haggler takes acorns off the first figure bought each room", () => {
    const run = withBoon("haggler");
    run.acorns = 20;
    stock(run, 0, "badger");
    stock(run, 1, "badger");
    stock(run, 2, "worm");
    expect(priceOf(run, 0)).toBe(4 - boonNumber("haggler", "off"));
    expect(priceOf(run, 2)).toBe(0);
    buy(run, 0);
    expect(run.acorns).toBe(20 - 2);
    expect(priceOf(run, 1)).toBe(4);
  });
  test("Quick Study doubles what a room teaches; Deep Pockets pays interest on fives, up to six", () => {
    const study = withBoon("quickstudy");
    study.level = 6;
    study.xp = 0;
    fight(study);
    expect(study.xp).toBe(boonNumber("quickstudy", "xp"));
    const pockets = withBoon("deeppockets");
    pockets.acorns = 25;
    expect(interestNow(pockets)).toBe(5);
    pockets.acorns = 300;
    expect(interestNow(pockets)).toBe(boonNumber("deeppockets", "cap"));
  });
  test("a charm counts toward its kin on the board", () => {
    const run = withBoon("crabcharm");
    expect(traitsNow(run).find((t) => t.trait === "crab")).toEqual({ trait: "crab", count: 2, step: 1 });
    const begun = beginFight(run);
    expect(begun.ok && begun.setup.sides[0].charms).toEqual(["crab"]);
  });
  test("boons that matter in a fight travel with the party; the others stay home", () => {
    const run = winning();
    run.boons = ["secondwind", "windfall", "formation", "regular", "headstart", "smallfry"];
    const begun = beginFight(run);
    expect(begun.ok && begun.setup.sides[0].boons).toEqual(["secondwind", "formation", "headstart", "smallfry"]);
  });
});

describe("who is waiting", () => {
  test("the forest's trouble is the room's plan, the same every time for the same seed", () => {
    const a = opposition(77, 0, 0);
    expect(opposition(77, 0, 0)).toEqual(a);
    expect(a.who).toBe("The forest");
    expect(ROOMS[0]?.plans.map((p) => p.name)).toContain(a.title);
    expect(isParty(a)).toBe(true);
    const boss = opposition(77, 14, 0);
    expect(boss.title).toBe("The Crab Nobody Counted");
    expect(boss.figures[0]?.kind).toBe("bigcrab");
  });
  test("harder trails bring more of it, and stronger", () => {
    const easy = opposition(5, 9, 0);
    const hard = opposition(5, 9, 2);
    expect(hard.figures.length).toBeGreaterThan(easy.figures.length);
    expect(hard.might).toBeGreaterThan(easy.might);
  });
  test("a sparring partner is plain data: a handle, a taste, and a party that could be stored and sent", () => {
    const party = sparParty(123, 7, 0);
    expect(isParty(party)).toBe(true);
    expect(JSON.parse(JSON.stringify(party))).toEqual(party);
    expect(sparParty(123, 7, 0)).toEqual(party);
    expect(party.who.length).toBeGreaterThan(2);
    expect(party.title.startsWith("brought ")).toBe(true);
    expect(party.figures.length).toBe(ROOMS[7]?.spar?.level ?? 0);
    expect(new Set(party.figures.map((p) => p.seat)).size).toBe(party.figures.length);
    expect(new Set(party.figures.map((p) => p.kind)).size).toBe(party.figures.length);
  });
  test("partners spend what the room allows, more in later rooms and on harder trails", () => {
    for (const room of [2, 7, 13]) {
      const budget = ROOMS[room]?.spar?.spent ?? 0;
      expect(spent(room, 0)).toBeLessThanOrEqual(budget);
      expect(spent(room, 0)).toBeGreaterThan(budget * 0.8);
      expect(spent(room, 2)).toBeGreaterThan(spent(room, 0));
    }
    expect(spent(13, 0)).toBeGreaterThan(spent(7, 0));
    expect(spent(7, 0)).toBeGreaterThan(spent(2, 0));
  });
  test("a partner's party has a taste: its kin and calling turn up more than chance", () => {
    let matching = 0;
    let total = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const party = sparParty(seed, 10, 0);
      const [kin, calling] = party.title.replace("brought ", "").split(" ");
      for (const p of party.figures) {
        if (!isFigureId(p.kind)) throw new Error("a sparring partner brought trouble");
        const f = FIGURES[p.kind];
        total++;
        if (f.kin === kin?.toLowerCase() || `${f.calling}s` === calling?.toLowerCase()) matching++;
      }
    }
    // By chance about a quarter of the roster shares the kin or the calling.
    expect(matching / total).toBeGreaterThan(0.45);
  });
});
