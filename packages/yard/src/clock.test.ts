import { describe, expect, test } from "bun:test";

import { setOpen } from "./build.ts";
import { forward, TICK_MS } from "./clock.ts";
import { ITEMS, type Tally } from "./content/items.ts";
import { KINDS } from "./content/machines.ts";
import { STORY } from "./content/story.ts";
import { create } from "./create.ts";
import { bare, lit, on, put, run, steps, workingYard } from "./fixtures.ts";
import { deliver, isFilled } from "./orders.ts";
import { load, save } from "./save.ts";
import { power, step } from "./step.ts";
import { put as add, reopen, type World } from "./world.ts";
import largeYard from "./yards/large.json";

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

/**
 * A line that has run dry: a full crate of deadfall feeding a mill that hands its planks to the
 * depot, run until the crate is long empty. Its pace up to then says planks; it makes none now.
 */
function ranDry(w: World): World {
  if (!w.plans.includes("bigcrates")) w.plans.push("bigcrates");
  reopen(w);
  w.open.kinds = new Set(KINDS);
  const crate = put(w, "crate", 8, 5, 0);
  for (let k = 0; k < w.rates.crate; k++) add(crate, "deadfall");
  put(w, "mill", 9, 5, 0);
  put(w, "belt", 10, 5, 0);
  steps(w, 2500);
  return w;
}

/** One boiler behind one crate, left the moment the crate is empty, with the boiler still burning what it holds. */
function burntOut(): World {
  const w = fired(16, [1]);
  while (on(w, 19, 9).count > 0) step(w);
  return w;
}

describe("away", () => {
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
    const away = forward(workingYard(), 288_000);
    expect(away.run).toBeLessThanOrEqual(12_000 + 6000);
    // A yard with a building on every clear tile of its first plot is run for fewer.
    const big = create({ story: 20 });
    for (let y = 12; y < 24; y++)
      for (let x = 16; x < 32; x++) if (!big.cells[y * big.land.w + x]) put(big, "belt", x, y, 0);
    expect(forward(big, 288_000).run).toBeLessThanOrEqual(3 * 6000);
    expect(forward(big, 288_000).run).toBeGreaterThanOrEqual(900);
  });
  test("orders are filled while away: the story's are paid, and the board's wait to be handed over", () => {
    const w = workingYard();
    // The story wants shells, which this yard does not make; give the board something it does.
    const order = w.board[0];
    if (!order) throw new Error("no board");
    w.board[0] = { ...order, title: "Pots for the campfire", want: { pot: 300 }, pay: 90, filled: {} };
    w.board[1] = { ...order, id: 98, title: "Engines for the Treasury", want: { engine: 100 }, pay: 300, filled: {} };
    w.board[2] = { ...order, id: 99, title: "Lanterns for the fox", want: { lantern: 5 }, pay: 8, filled: {} };
    const away = forward(w, 288_000);
    expect(away.orders).toEqual(["Engines for the Treasury", "Pots for the campfire"]);
    expect(away.waiting).toBe(390);
    expect(w.board.map((o) => isFilled(o.want, o.filled))).toEqual([true, true, false]);
    expect(away.coins).toBeGreaterThan(300);
    expect(away.coins).toBeLessThan(600);
    // Story orders are paid as they are filled, one after another.
    const story = create({ story: 6 });
    for (const item of ITEMS) deliver(story, item, (STORY[6]?.want[item] ?? 0) - 1);
    const twin = copy(story);
    put(twin, "belt", 22, 18, 0);
    Object.assign(on(twin, 22, 18), { item: "pot", prog: 1 });
    const back = forward(twin, 36_000);
    expect(back.orders).toEqual(["Pots for the campfire stew"]);
    expect(back.coins).toBe(STORY[6]?.pay ?? -1);
    expect(forward(create(), 36_000).coins).toBe(0);
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
  test("a line that ran dry before the member left is paid nothing while away", () => {
    const quick = ranDry(lit(bare()));
    const exact = ranDry(lit(bare()));
    expect(on(quick, 8, 5).count).toBe(0);
    expect(quick.depot.plank).toBe(quick.rates.crate);
    // What the depot took in before leaving still says planks.
    expect(quick.pace.made.plank ?? 0).toBeGreaterThan(0);
    const a = forward(quick, 288_000);
    const b = forward(exact, 288_000, true);
    expect(b.made).toEqual({});
    expect(a.made).toEqual({});
    expect(a.coins).toBe(0);
  });
  test("a line that ran dry is paid nothing in any of the short runs, before a boiler goes out or after", () => {
    // A boiler behind six crates goes out a good while into the absence, and the yard is measured
    // afresh: the planks from before leaving are in neither measure.
    const quick = ranDry(fired(16, [6]));
    const exact = ranDry(fired(16, [6]));
    const a = forward(quick, 288_000);
    const b = forward(exact, 288_000, true);
    expect(power(quick)).toEqual(power(exact));
    expect(b.made.plank ?? 0).toBe(0);
    expect(a.made.plank ?? 0).toBe(0);
    expect(b.made.ore ?? 0).toBeGreaterThan(5000);
    expect(apart(a.made.ore ?? 0, b.made.ore ?? 0)).toBeLessThan(0.03);
    expect(apart(a.coins, b.coins)).toBeLessThan(0.03);
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
    expect(performance.now() - started).toBeLessThan(1000);
    expect(TICK_MS).toBe(100);
  });
  test("eight hours away on the largest kept yard is caught up on well inside a frame or three", () => {
    const yard = load(JSON.stringify(largeYard));
    if (!yard) throw new Error("the large yard did not load");
    const started = performance.now();
    const away = forward(yard, 288_000);
    // What keeps it quick is how few ticks are really run. The clock is only a loose guard: it
    // measures under 20 milliseconds here and several times that on a shared test machine.
    expect(away.run).toBeLessThan(288_000 / 20);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(away.coins).toBeGreaterThan(0);
  });
});
