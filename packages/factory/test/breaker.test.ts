/**
 * The breaker (tier 5, SPEC-2 section 3.2): it breaks salvage into the 20 things of its mix in order,
 * round and round, one at a time out of one way out, and holds one finished thing and breaks nothing
 * more until that has left. Slag is a thing the town does not buy: the depot and cart stops refuse it,
 * a crate and a mill take it, and the board never asks for it.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { beforeReach } from "./goals.ts";
import { bareLand } from "./land.ts";
import { bought, must } from "./yards.ts";

const SALVAGE = F.item("salvage");
const SLAG = F.item("slag");
const MIX = F.MIX_OF[F.BREAKER];
if (!MIX) throw new Error("the breaker has no mix");
const GIVES = MIX.gives;

/** A bare yard with all of tier 5 known (breakers to grade III), the depot's middle at (25, 5), power along row 10. */
function yard(): F.Yard {
  const y = F.create({ land: bareLand(30, 12, [], [25, 5]), tier: 6, seed: 1 });
  for (const x of [22, 18, 14, 10, 6]) must(y, { do: "build", kind: "pylon", x, y: 10, dir: 0 });
  return y;
}
/** Builds a breaker on (x, z), facing east, at a grade: its tile, which is the top left of its four. */
function breaker(y: F.Yard, x: number, z: number, grade = 1): number {
  must(y, { do: "build", kind: "breaker", x, y: z, dir: 0, grade });
  return F.at(y, x, z);
}
/** The holder's row of the piece on a tile. */
const rowOf = (y: F.Yard, i: number): number => F.holderOf(y, i);

describe("the breaker", () => {
  test("is two tiles by two, takes salvage on its back and sides only, and holds up to 8", () => {
    const y = yard();
    const i = breaker(y, 4, 4);
    for (const [x, z] of [
      [4, 4],
      [5, 4],
      [4, 5],
      [5, 5],
    ] as const)
      expect(y.kind[F.at(y, x, z)]).toBe(F.BREAKER);
    expect([F.wants(y, i, SALVAGE), F.wants(y, i, F.item("ore"))]).toEqual([true, false]);
    const r = rowOf(y, i);
    for (let k = 0; k < 8; k++) F.put(y.holders, r, SALVAGE);
    // From its back (west), as the rules hand it things.
    const room = (): boolean => F.RULES[F.BREAKER]?.room(F.KIT, y, i, SALVAGE, 2, y.wire ?? F.rewire(y)) ?? false;
    expect(room()).toBe(false);
    F.take(y.holders, r, SALVAGE);
    expect(room()).toBe(true);
  });

  test("gives the 20 things of its mix in the table's order, one a run of 6 ticks at grade I, and starts again", () => {
    const y = yard();
    const i = breaker(y, 4, 4);
    const r = rowOf(y, i);
    const h = y.holders;
    const given: F.Item[] = [];
    let ticks = 0;
    for (; ticks < 1000 && given.length < 40; ticks++) {
      if (F.held(h, r, SALVAGE) === 0) F.put(h, r, SALVAGE);
      F.step(y);
      // As if something ahead took each finished thing at once.
      const out = h.out[r] ?? F.NONE;
      if (F.isItem(out)) {
        given.push(out);
        h.out[r] = F.NONE;
      }
    }
    expect(given).toEqual([...GIVES, ...GIVES]);
    expect(GIVES.map(F.itemName).join(" ")).toBe(
      "copper ingot copper glass copper slag ingot copper glass copper ingot slag copper ingot copper glass copper slag ingot gear",
    );
    // 6 ticks a run at grade I, with no power short: the depot gives 150, the breaker draws 20.
    expect(ticks).toBe(40 * 6);
  });

  test("with its way out blocked it holds 1 and breaks nothing more, and says why", () => {
    const y = yard();
    const i = breaker(y, 4, 4);
    const r = rowOf(y, i);
    for (let k = 0; k < 8; k++) F.put(y.holders, r, SALVAGE);
    for (let k = 0; k < 600; k++) F.step(y);
    expect([y.holders.out[r], F.held(y.holders, r, SALVAGE), y.holders.mix[r]]).toEqual([F.item("copper"), 7, 1]);
    expect(F.status(y, i)?.line).toBe("Nowhere to send its copper: nothing is on the tile it points at.");
    // A belt ahead, full and going nowhere, leaves it waiting.
    must(y, { do: "build", kind: "belt", x: 6, y: 4, dir: 0 });
    for (let k = 0; k < 60; k++) F.step(y);
    expect(F.status(y, i)?.line).toBe("Waiting: no room ahead for its ingots.");
    expect(y.holders.mix[r]).toBe(2);
  });

  test("on a line it breaks salvage by the rules: from a crate of salvage, by a belt into a crate, 8, 5, 3, 3 and 1 of every 20", () => {
    const y = yard();
    must(y, { do: "build", kind: "crate", x: 3, y: 4, dir: 0 });
    const from = F.holderOf(y, F.at(y, 3, 4));
    for (let k = 0; k < 40; k++) F.put(y.holders, from, SALVAGE);
    breaker(y, 4, 4);
    must(y, { do: "build", kind: "belt", x: 6, y: 4, dir: 0 });
    must(y, { do: "build", kind: "crate", x: 7, y: 4, dir: 0 });
    // Shut, so that it lets nothing out ahead and holds all it takes.
    must(y, { do: "crate", x: 7, y: 4, open: false });
    for (let k = 0; k < 3000; k++) F.step(y);
    const into = F.holderOf(y, F.at(y, 7, 4));
    const got = (["copper", "ingot", "glass", "slag", "gear"] as const).map((n) => F.held(y.holders, into, F.item(n)));
    expect(got).toEqual([16, 10, 6, 6, 2]);
    expect(F.status(y, F.at(y, 4, 4))?.line).toBe("Waiting for salvage.");
  });

  test("says what it is doing: breaking salvage, and at what pace when power is short", () => {
    const y = yard();
    const i = breaker(y, 4, 4, 3);
    const r = rowOf(y, i);
    for (let k = 0; k < 8; k++) F.put(y.holders, r, SALVAGE);
    F.step(y);
    expect(F.status(y, i)?.line).toBe("Breaking salvage.");
    const made = F.counts();
    const needed = F.counts();
    F.flow(y, made, needed);
    // A breaker III: 200 a minute, 80 copper, 50 ingots, 30 glass, 30 slag, 10 gears, from 200 salvage.
    expect(
      (["copper", "ingot", "glass", "slag", "gear", "salvage"] as const).map(
        (n) => (n === "salvage" ? needed : made)[F.item(n)],
      ),
    ).toEqual([80, 50, 30, 30, 10, 200]);
  });

  test("keeps its place in the mix: read back and moved, it goes on where it was; a copy starts at the first", () => {
    const y = yard();
    const i = breaker(y, 4, 4);
    const r = rowOf(y, i);
    y.holders.mix[r] = 7;
    const back = F.decode(F.encode(y), y.land);
    if (!back) throw new Error("does not read back");
    expect(back.holders.mix[F.holderOf(back, F.at(back, 4, 4))]).toBe(7);
    expect(F.check(back)).toBe(F.check(y));
    const first = F.decode(F.encode(y), y.land);
    if (!first) throw new Error("does not read back");
    first.holders.mix[F.holderOf(first, F.at(first, 4, 4))] = 0;
    expect(F.check(first)).not.toBe(F.check(y));
    must(y, { do: "move", tiles: [i], turns: 0, x: 10, y: 4 });
    expect(y.holders.mix[F.holderOf(y, F.at(y, 10, 4))]).toBe(7);
    must(y, { do: "copy", tiles: [F.at(y, 10, 4)], turns: 0, x: 14, y: 4 });
    expect(y.holders.mix[F.holderOf(y, F.at(y, 14, 4))]).toBe(0);
  });
});

describe("slag, which the town does not buy", () => {
  test("is refused by the depot and by a cart stop, and taken by a crate and a mill", () => {
    const y = yard();
    must(y, { do: "build", kind: "stop", x: 10, y: 8, dir: 0 });
    must(y, { do: "build", kind: "crate", x: 12, y: 8, dir: 0 });
    must(y, { do: "build", kind: "mill", x: 14, y: 8, dir: 0 });
    const at = (x: number, z: number): number => F.at(y, x, z);
    expect([at(25, 5), at(10, 8), at(12, 8), at(14, 8)].map((i) => F.wants(y, i, SLAG))).toEqual([
      false,
      false,
      true,
      true,
    ]);
    expect([F.wants(y, at(25, 5), F.item("copper")), F.ITEM_INFO[SLAG]?.worth, F.ARRIVAL[SLAG]]).toEqual([true, 0, 0]);
  });

  test("on a belt into the depot, stops it and says so; into a cart stop, the same", () => {
    const y = yard();
    must(y, { do: "build", kind: "belt", x: 23, y: 5, dir: 0 });
    const i = F.at(y, 23, 5);
    y.item[i] = SLAG;
    y.prog[i] = 8;
    for (let k = 0; k < 20; k++) F.step(y);
    expect([y.item[i], F.status(y, i)?.line]).toEqual([SLAG, "Slag has nowhere to go: the depot does not take it."]);
    must(y, { do: "build", kind: "stop", x: 11, y: 8, dir: 0 });
    must(y, { do: "build", kind: "belt", x: 10, y: 8, dir: 0 });
    const j = F.at(y, 10, 8);
    y.item[j] = SLAG;
    y.prog[j] = 8;
    for (let k = 0; k < 20; k++) F.step(y);
    expect(F.status(y, j)?.line).toBe("Slag has nowhere to go: the cart stop does not take it.");
  });

  test("its first slag at the depot stops the line, and both are in trouble: the belt at the depot, and the breaker behind it", () => {
    const y = yard();
    must(y, { do: "build", kind: "crate", x: 3, y: 4, dir: 0 });
    const from = F.holderOf(y, F.at(y, 3, 4));
    for (let k = 0; k < 40; k++) F.put(y.holders, from, SALVAGE);
    // A grade III breaker gives more than a grade I belt carries: it waits for room on the line.
    const i = breaker(y, 4, 4, 3);
    for (let x = 6; x <= 23; x++) must(y, { do: "build", kind: "belt", x, y: 4, dir: 0 });
    const head = F.at(y, 23, 4);
    // While the line moves, nothing is in trouble, though the breaker waits for room on it.
    let moving = 0;
    for (let k = 0; k < 3000 && y.item[head] !== SLAG; k++) {
      F.step(y);
      if (F.status(y, i)?.state === "waiting" && F.status(y, i)?.trouble === false) moving++;
      expect(F.status(y, i)?.trouble).toBe(false);
    }
    expect([y.item[head], moving > 0]).toEqual([SLAG, true]);
    for (let k = 0; k < 600; k++) F.step(y);
    expect([F.status(y, head)?.line, F.status(y, head)?.trouble]).toEqual([
      "Slag has nowhere to go: the depot does not take it.",
      true,
    ]);
    expect(F.status(y, i)).toMatchObject({ state: "waiting", trouble: true });
    expect(F.status(y, i)?.line).toMatch(/^Waiting: no room ahead for its [a-z]+\.$/);
    // A crate in place of the belt at the depot takes the slag: the line moves, and the breaker is out of trouble.
    must(y, { do: "remove", x: 23, y: 4 });
    must(y, { do: "build", kind: "crate", x: 23, y: 4, dir: 0 });
    for (let k = 0; k < 30; k++) F.step(y);
    expect(F.status(y, i)?.trouble).toBe(false);
  });

  test("is never asked for by the board, though copper is", () => {
    const y = F.create({ seed: 9, tier: 6 });
    for (const plot of ["meadow", "workings"]) bought(y, plot);
    y.hand = F.goal("firstcopper");
    const asked = F.askable(y);
    expect([asked.includes(F.item("copper")), asked.includes(SLAG)]).toEqual([true, false]);
    for (let n = 0; n < 200; n++) {
      const order = F.fresh(y, 1000 + n);
      expect(order.want[SLAG] ?? 0).toBe(0);
    }
  });
});

/** The version a yard is kept as. */
function v(y: F.Yard): unknown {
  const kept: unknown = JSON.parse(F.encode(y));
  return typeof kept === "object" && kept !== null ? Reflect.get(kept, "v") : null;
}

describe("a yard keeping tier 5's things", () => {
  test("is kept as the version a Leaf of version 10 leaves alone: a breaker, salvage in a crate", () => {
    const y = yard();
    breaker(y, 4, 4);
    expect(v(y)).toBe(F.VERSION);
    const crate = beforeReach(F.create({ land: bareLand(30, 12, [], [25, 5]), tier: 4, seed: 1 }));
    must(crate, { do: "build", kind: "crate", x: 4, y: 4, dir: 0 });
    expect(v(crate)).toBe(F.PLACED);
    F.put(crate.holders, F.holderOf(crate, F.at(crate, 4, 4)), SALVAGE);
    expect(v(crate)).toBe(F.VERSION);
  });
});
