import { describe, expect, test } from "bun:test";

import { setOpen } from "./build.ts";
import { AWAY_AFTER_MS, AWAY_MOST_MS, awayLine, boost, boosted, boostLeft, forward, runTo, TICK_MS } from "./clock.ts";
import { ITEMS, type Tally } from "./content/items.ts";
import { KINDS } from "./content/machines.ts";
import { PLANS } from "./content/plans.ts";
import { PLOTS } from "./content/plots.ts";
import { STORY } from "./content/story.ts";
import { create } from "./create.ts";
import { bare, lit, on, put, run, steps, workingYard } from "./fixtures.ts";
import { deliver, isFilled } from "./orders.ts";
import { load, save } from "./save.ts";
import { power, step } from "./step.ts";
import { put as add, reopen, type World } from "./world.ts";

const NOW = 1_800_000_000_000;
const HOUR = 3600 * 1000;
const copy = (w: World): World => {
  const back = load(save(w));
  if (!back) throw new Error("the yard did not come back from its save");
  return back;
};
/** How far apart two numbers are, as a share of the larger. */
const apart = (a: number, b: number): number => Math.abs(a - b) / Math.max(1, Math.abs(a), Math.abs(b));
const sum = (t: Tally): number => ITEMS.reduce((n, item) => n + (t[item] ?? 0), 0);

/**
 * A bare yard with bigger crates: a gatherer sending ore to the depot, `mills` mills standing idle
 * and drawing power, and for each number in `chains` a boiler fed by that many full crates of
 * deadfall in a row, and nothing else. A bare yard does not come back from a save, so a test
 * builds it twice.
 */
function fired(mills: number, chains: readonly number[]): World {
  const w = lit(bare({ "10,6": "ore" }));
  w.plans.push("bigcrates");
  reopen(w);
  w.open.kinds = new Set(KINDS);
  put(w, "gatherer", 10, 6, 0);
  for (let k = 0; k < mills; k++) put(w, "mill", k % 24, 1 + Math.floor(k / 24), 0);
  chains.forEach((n, row) => {
    const y = 9 + row * 2;
    put(w, "boiler", 20, y, 0);
    for (let x = 20 - n; x < 20; x++) {
      const crate = put(w, "crate", x, y, 0);
      for (let k = 0; k < w.rates.crate; k++) add(crate, "deadfall");
    }
  });
  return w;
}

/** One boiler behind one crate, left the moment the crate is empty, with the boiler still burning what it holds. */
function burntOut(): World {
  const w = fired(16, [1]);
  while (on(w, 19, 9).count > 0) step(w);
  return w;
}

describe("the clock", () => {
  test("the yard runs a tick for every tenth of a second that passes, and keeps the odd part for next time", () => {
    const w = create();
    expect(runTo(w, NOW)).toBeNull();
    expect(w.tick).toBe(0);
    expect(runTo(w, NOW + 1000)).toBeNull();
    expect(w.tick).toBe(10);
    runTo(w, NOW + 1250);
    expect(w.tick).toBe(12);
    runTo(w, NOW + 1300);
    expect(w.tick).toBe(13);
    expect(w.seen).toBe(NOW + 1300);
  });
  test("a clock that has gone backwards runs nothing and is taken as it is", () => {
    const w = create();
    runTo(w, NOW);
    expect(runTo(w, NOW - 5 * HOUR)).toBeNull();
    expect(w.tick).toBe(0);
    runTo(w, NOW - 5 * HOUR + 500);
    expect(w.tick).toBe(5);
  });
});

describe("a second shift", () => {
  test("doubles the yard's speed until it ends, and not a tick longer", () => {
    const plain = workingYard();
    const shift = workingYard();
    runTo(plain, NOW);
    runTo(shift, NOW);
    boost(shift, NOW, 4000);
    expect(boosted(shift, NOW + 3999)).toBe(true);
    expect(boosted(shift, NOW + 4000)).toBe(false);
    expect(boostLeft(shift, NOW + 1000)).toBe(3000);
    for (let t = 100; t <= 10_000; t += 100) {
      runTo(plain, NOW + t);
      runTo(shift, NOW + t);
    }
    expect(plain.tick).toBe(100);
    expect(shift.tick).toBe(140);
    // Everything in the yard is that much further on, not only the count of ticks.
    const same = workingYard();
    steps(same, 140);
    expect(save({ ...shift, seen: 0, boostUntil: 0 })).toBe(save(same));
  });
  test("is lengthened by another, and opens nothing that cannot be had without it", () => {
    const w = create({ story: 8 });
    const before = {
      kinds: [...w.open.kinds],
      plots: [...w.open.plots],
      plans: [...w.open.plans],
      rates: { ...w.rates },
    };
    boost(w, NOW, HOUR);
    boost(w, NOW + 1000, HOUR);
    expect(w.boostUntil).toBe(NOW + 2 * HOUR);
    boost(w, NOW + 9 * HOUR, HOUR);
    expect(w.boostUntil).toBe(NOW + 10 * HOUR);
    boost(w, NOW, -5);
    expect(w.boostUntil).toBe(NOW + 10 * HOUR);
    expect({ kinds: [...w.open.kinds], plots: [...w.open.plots], plans: [...w.open.plans], rates: w.rates }).toEqual(
      before,
    );
    // What can be opened at all is the tables, and they do not mention it.
    expect(JSON.stringify([KINDS, PLANS, PLOTS, STORY]).toLowerCase()).not.toContain("shift");
  });
});

describe("away", () => {
  test("a short gap is just run; a long one is caught up on and summed up", () => {
    const w = workingYard();
    runTo(w, NOW);
    expect(runTo(w, NOW + AWAY_AFTER_MS - 100)).toBeNull();
    const away = runTo(w, NOW + AWAY_AFTER_MS - 100 + HOUR);
    expect(away?.seconds).toBe(3600);
    expect(away?.ticks).toBe(36_000);
    expect(away?.capped).toBe(false);
    expect(w.seen).toBe(NOW + AWAY_AFTER_MS - 100 + HOUR);
  });
  test("the quick way comes out close to running every tick, for Coins and for every thing made", () => {
    const yard = workingYard();
    steps(yard, 1500);
    for (const ticks of [36_000, 288_000]) {
      const quick = copy(yard);
      const exact = copy(yard);
      const a = forward(quick, ticks);
      const b = forward(exact, ticks, true);
      expect(b.run).toBe(ticks);
      expect(a.run).toBeLessThan(ticks / 4);
      expect(apart(a.coins, b.coins)).toBeLessThan(0.02);
      for (const item of ITEMS)
        expect([item, apart(a.made[item] ?? 0, b.made[item] ?? 0) < 0.02]).toEqual([item, true]);
      expect(quick.tick).toBe(exact.tick);
      expect(quick.story).toBe(exact.story);
      expect(a.orders).toEqual(b.orders);
    }
  });
  test("it is close even when the yard was changed a moment before leaving", () => {
    const yard = workingYard();
    // A new line of bricks straight to the depot, and then out of the door.
    put(yard, "gatherer", 17, 22, 1);
    put(yard, "mill", 17, 23, 2);
    run(yard, [16, 23], [23, 19]);
    steps(yard, 20);
    const quick = copy(yard);
    const exact = copy(yard);
    const a = forward(quick, 288_000);
    const b = forward(exact, 288_000, true);
    expect(b.made.brick ?? 0).toBeGreaterThan(20_000);
    expect(apart(a.coins, b.coins)).toBeLessThan(0.03);
    expect(apart(a.made.brick ?? 0, b.made.brick ?? 0)).toBeLessThan(0.03);
  });
  test("however long the absence and however big the yard, only a few thousand ticks are run for real", () => {
    const w = workingYard();
    runTo(w, NOW);
    const away = runTo(w, NOW + 30 * 24 * HOUR);
    expect(away?.run ?? Infinity).toBeLessThanOrEqual(12_000 + 6000);
    // A yard with a building on every clear tile of its first plot is run for fewer.
    const big = create({ story: 20 });
    for (let y = 12; y < 24; y++)
      for (let x = 16; x < 32; x++) if (!big.cells[y * big.land.w + x]) put(big, "belt", x, y, 0);
    expect(forward(big, 288_000).run).toBeLessThanOrEqual(3 * 6000);
    expect(forward(big, 288_000).run).toBeGreaterThanOrEqual(900);
  });
  test("the yard works for eight hours unwatched and no longer", () => {
    const w = workingYard();
    const twin = copy(w);
    runTo(w, NOW);
    runTo(twin, NOW);
    const night = runTo(w, NOW + AWAY_MOST_MS);
    const week = runTo(twin, NOW + 7 * 24 * HOUR);
    expect(night?.capped).toBe(false);
    expect(week?.capped).toBe(true);
    expect(week?.seconds).toBe(8 * 3600);
    expect(week?.ticks).toBe(night?.ticks ?? -1);
    expect(week?.coins).toBe(night?.coins ?? -1);
    expect(twin.seen).toBe(NOW + 7 * 24 * HOUR);
  });
  test("a second shift counts double for as long as it lasted, and is over by the clock on the wall", () => {
    const w = workingYard();
    runTo(w, NOW);
    boost(w, NOW, 2 * HOUR);
    const away = runTo(w, NOW + 5 * HOUR);
    expect(away?.boosted).toBe(2 * 3600);
    expect(away?.ticks).toBe((5 + 2) * 36_000);
    expect(boosted(w, NOW + 5 * HOUR)).toBe(false);
    // A shift longer than the eight hours is not saved up for later.
    const long = workingYard();
    runTo(long, NOW);
    boost(long, NOW, 12 * HOUR);
    expect(runTo(long, NOW + 24 * HOUR)?.ticks).toBe(2 * 8 * 36_000);
    expect(boosted(long, NOW + 24 * HOUR)).toBe(false);
  });
  test("orders are filled while away: the story's are paid, and the board's wait to be handed over", () => {
    const w = workingYard();
    // The story wants shells, which this yard does not make; give the board something it does.
    const order = w.board[0];
    if (!order) throw new Error("no board");
    w.board[0] = { ...order, title: "Pots for the campfire", want: { pot: 300 }, pay: 90, filled: {} };
    w.board[1] = { ...order, id: 98, title: "Engines for Mossback", want: { engine: 100 }, pay: 300, filled: {} };
    w.board[2] = { ...order, id: 99, title: "Lanterns for the fox", want: { lantern: 5 }, pay: 8, filled: {} };
    runTo(w, NOW);
    const away = runTo(w, NOW + 8 * HOUR);
    expect(away?.orders).toEqual(["Engines for Mossback", "Pots for the campfire"]);
    expect(away?.waiting).toBe(390);
    expect(w.board.map((o) => isFilled(o.want, o.filled))).toEqual([true, true, false]);
    expect(away?.coins).toBeGreaterThan(300);
    expect(away?.coins).toBeLessThan(600);
    expect(awayLine(away ?? forward(w, 0))).toBe(
      `While you were away the Works made ${away?.coins} Coins and finished 2 orders, the last of them "Pots for the campfire".`,
    );
    // Story orders are paid as they are filled, one after another.
    const story = create({ story: 6 });
    runTo(story, NOW);
    for (const item of ITEMS) deliver(story, item, (STORY[6]?.want[item] ?? 0) - 1);
    const twin = copy(story);
    put(twin, "belt", 22, 18, 0);
    Object.assign(on(twin, 22, 18), { item: "pot", prog: 1 });
    const back = runTo(twin, NOW + HOUR);
    expect(back?.orders).toEqual(["Pots for the campfire stew"]);
    expect(back?.coins).toBe(STORY[6]?.pay ?? -1);
    expect(awayLine(back ?? forward(twin, 0))).toBe(
      `While you were away the Works made ${STORY[6]?.pay} Coins and finished "Pots for the campfire stew".`,
    );
    expect(awayLine(forward(create(), 36_000))).toBe("While you were away the Works stood quiet.");
  });
  test("a shut crate goes on filling while away, to the brim and no further", () => {
    const yard = workingYard();
    // The planks go into a crate instead of the depot.
    const end = on(yard, 23, 16);
    expect(end.kind).toBe("belt");
    yard.cells[16 * yard.land.w + 23] = null;
    put(yard, "crate", 23, 16, 1);
    setOpen(yard, 23, 16, false);
    steps(yard, 10);
    const quick = copy(yard);
    const exact = copy(yard);
    const a = forward(quick, 288_000);
    const b = forward(exact, 288_000, true);
    expect(on(exact, 23, 16).count).toBe(exact.rates.crate);
    expect(on(quick, 23, 16).count).toBe(quick.rates.crate);
    expect(on(quick, 23, 16).buf).toEqual(on(exact, 23, 16).buf);
    expect(a.made.plank ?? 0).toBe(0);
    expect(apart(a.coins, b.coins)).toBeLessThan(0.02);
  });
  test("a crate that is emptying runs dry while away, and the yard is paid at its new pace from then on", () => {
    const yard = workingYard();
    // Engines are held back in a crate for a while, then let go just before leaving.
    yard.cells[17 * yard.land.w + 26] = null;
    put(yard, "crate", 26, 17, 2);
    setOpen(yard, 26, 17, false);
    steps(yard, 2000);
    expect(on(yard, 26, 17).count).toBe(yard.rates.crate);
    setOpen(yard, 26, 17, true);
    const quick = copy(yard);
    const exact = copy(yard);
    const a = forward(quick, 288_000);
    const b = forward(exact, 288_000, true);
    expect(apart(a.made.engine ?? 0, b.made.engine ?? 0)).toBeLessThan(0.02);
    expect(apart(a.coins, b.coins)).toBeLessThan(0.02);
  });
  test("a boiler that has burnt its last crate goes out while away, and the yard is paid at its new pace from then on", () => {
    const quick = burntOut();
    const exact = burntOut();
    expect(power(quick).pace).toBe(1);
    const a = forward(quick, 288_000);
    const b = forward(exact, 288_000, true);
    // Without the boiler the yard runs at 20 / 49 of its pace.
    expect(power(exact).pace).toBeCloseTo(20 / 49);
    expect(power(quick)).toEqual(power(exact));
    expect(sum(b.made)).toBeGreaterThan(7000);
    expect(apart(sum(a.made), sum(b.made))).toBeLessThan(0.03);
    expect(apart(a.coins, b.coins)).toBeLessThan(0.03);
    expect(a.run).toBeLessThan(288_000 / 20);
  });
  test("boilers that go out one after another while away are each let go out, and the pace measured after", () => {
    // Both boilers lift the yard to its full pace, one to 50 / 79 of it, none to 20 / 79. The first,
    // behind two crates, goes out before a short run for real would be over; the second, behind
    // six, a good while after that.
    const quick = fired(26, [2, 6]);
    const exact = fired(26, [2, 6]);
    steps(quick, 500);
    steps(exact, 500);
    expect(power(quick).pace).toBe(1);
    const a = forward(quick, 288_000);
    const b = forward(exact, 288_000, true);
    expect(power(exact).pace).toBeCloseTo(20 / 79);
    expect(power(quick)).toEqual(power(exact));
    expect(sum(b.made)).toBeGreaterThan(5000);
    expect(apart(sum(a.made), sum(b.made))).toBeLessThan(0.03);
    // No more than a short run for real for each boiler and one after the last.
    expect(a.run).toBeLessThan(3 * 6000);
  });
  test("a yard whose boilers are fed by a gatherer is caught up on just as it was before boilers were looked at", () => {
    // What the quick way gave for this yard before it looked at boilers at all.
    const before = [
      { ticks: 36_000, coins: 54, run: 6000, made: { plank: 3000, pot: 3000, engine: 1200 } },
      { ticks: 288_000, coins: 432, run: 6000, made: { plank: 24_000, pot: 24_000, engine: 9600 } },
    ];
    for (const was of before) {
      const yard = workingYard();
      steps(yard, 1500);
      const a = forward(yard, was.ticks);
      expect({ ticks: was.ticks, coins: a.coins, run: a.run, made: a.made }).toEqual(was);
    }
  });
  test("catching up on a night away takes a small part of a second", () => {
    const w = workingYard();
    steps(w, 600);
    const started = performance.now();
    forward(w, 576_000);
    // Generous, so a busy machine running the tests does not fail it; it measures a few milliseconds.
    expect(performance.now() - started).toBeLessThan(150);
    expect(TICK_MS).toBe(100);
  });
});
