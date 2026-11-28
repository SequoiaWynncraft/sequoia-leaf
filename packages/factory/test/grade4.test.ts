/**
 * Grade 4, for lines and gatherers, played through the commands a player gives: a line of grade 4
 * belts carries 600 a minute into the depot, and so do grade 4 splitters, joiners, sorters and
 * tunnels in it; a line of mixed grades runs at its slowest; a grade 4 gatherer on star crystal gives
 * one every 600 ticks; Upgrade takes a line from grade 3 to 4 for the difference in price; and a yard
 * with grade 4 pieces, kept and read back mid-run, goes on as the one that was kept.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { bare4, CRYSTAL_AT } from "./grade4.ts";
import { flatOut, give, must } from "./yards.ts";

const CRYSTAL = F.item("crystal");

/** A line's pieces west of the depot, along row 4: the kind and grade of each from x = 2 to 34 (a belt at `grade` where it names none), and a tunnel's way-in mouth at x where it says. */
interface Line {
  readonly grade: number;
  readonly at?: Readonly<Record<number, { readonly kind: F.KindName; readonly grade?: number }>>;
  readonly tunnel?: { readonly x: number; readonly span: number; readonly grade: number };
}

/**
 * A bare yard with grade 4 known and a line built by commands from a crate at (1, 4) east into the
 * depot's west side at (35, 4): the planks a minute it delivers, kept full.
 */
function delivered(line: Line): number {
  const y = bare4();
  must(y, { do: "build", kind: "crate", x: 1, y: 4, dir: 0 });
  const t = line.tunnel;
  if (t)
    must(y, F.writeAct({ do: "lay", legs: [{ tunnel: true, x: t.x, y: 4, dir: 0, span: t.span, grade: t.grade }] }));
  const under = (x: number): boolean => t !== undefined && x >= t.x && x <= t.x + t.span + 1;
  for (let x = 2; x <= 34; x++) {
    if (under(x)) continue;
    const own = line.at?.[x];
    must(y, { do: "build", kind: own?.kind ?? "belt", x, y: 4, dir: 0, grade: own?.grade ?? line.grade });
  }
  return flatOut(y, 1, 4);
}

describe("a grade 4 line", () => {
  test("of belts carries 600 a minute into the depot, as the planner says: a thing crosses a tile a tick", () => {
    expect([F.CARRY[4], F.carried(4)]).toEqual([F.ACROSS, 600]);
    expect(delivered({ grade: 4 })).toBe(600);
  });

  test("keeps that pace through a splitter, a joiner, a sorter and a tunnel of grade 4, wherever it stands in the line", () => {
    for (const kind of ["splitter", "joiner", "sorter"] as const)
      for (const x of [2, 18])
        expect([kind, x, delivered({ grade: 4, at: { [x]: { kind } } })]).toEqual([kind, x, 600]);
    for (const x of [2, 18])
      expect(["tunnel", x, delivered({ grade: 4, tunnel: { x, span: 3, grade: 4 } })]).toEqual(["tunnel", x, 600]);
  });

  test("of mixed grades runs at its slowest: one belt, splitter, sorter or tunnel of a lower grade holds the whole line to its pace", () => {
    for (const grade of [1, 2, 3]) {
      const slow = F.carried(grade);
      expect([grade, delivered({ grade: 4, at: { 20: { kind: "belt", grade } } })]).toEqual([grade, slow]);
      expect([grade, delivered({ grade: 4, at: { 2: { kind: "splitter", grade } } })]).toEqual([grade, slow]);
      expect([grade, delivered({ grade: 4, at: { 34: { kind: "sorter", grade } } })]).toEqual([grade, slow]);
      expect([grade, delivered({ grade: 4, tunnel: { x: 10, span: 3, grade } })]).toEqual([grade, slow]);
      // And a line of that grade with one grade 4 piece in it goes no faster.
      expect([grade, delivered({ grade, at: { 20: { kind: "belt", grade: 4 } } })]).toEqual([grade, slow]);
    }
  });
});

/** Tick by tick, the ticks at which star crystal reaches the depot from a gatherer of a grade on the yard's star crystal, until `count` have. */
function crystalTicks(grade: number, count: number): number[] {
  const y = bare4();
  const [x, z] = CRYSTAL_AT;
  must(y, { do: "build", kind: "gatherer", x, y: z, dir: 0, grade });
  must(y, { do: "build", kind: "belt", x: x + 1, y: z, dir: 0, grade: Math.min(grade, 4) });
  must(y, { do: "build", kind: "belt", x: x + 2, y: z, dir: 0, grade: Math.min(grade, 4) });
  const out: number[] = [];
  while (out.length < count && y.tick < 100_000) {
    const before = y.depot[CRYSTAL] ?? 0;
    F.step(y);
    if ((y.depot[CRYSTAL] ?? 0) > before) out.push(y.tick);
  }
  return out;
}
const gaps = (ticks: readonly number[]): number[] => ticks.slice(1).map((t, k) => t - (ticks[k] ?? 0));

describe("a grade 4 gatherer", () => {
  test("on star crystal gives 1 every 600 ticks, 2.5 times as fast as grade 1's 1,500, and says so on its card", () => {
    expect(gaps(crystalTicks(4, 6))).toEqual([600, 600, 600, 600, 600]);
    expect(gaps(crystalTicks(1, 3))).toEqual([1500, 1500]);
    expect([F.PACE[4], F.gathers(CRYSTAL, 4), F.makes(F.GATHERER, 4, null) / F.makes(F.GATHERER, 1, null)]).toEqual([
      5, 1, 2.5,
    ]);
    const y = bare4();
    must(y, { do: "build", kind: "gatherer", x: CRYSTAL_AT[0], y: CRYSTAL_AT[1], dir: 0, grade: 4 });
    expect(F.status(y, F.at(y, ...CRYSTAL_AT))?.line).toBe("Gathering star crystals: 1 every 60 seconds.");
  });

  test("draws 3 times a grade 1 gatherer's power, and no machine has a grade 4", () => {
    expect(F.drawnAt(F.GATHERER, 4) / F.drawnAt(F.GATHERER, 1)).toBe(3);
    const y = bare4();
    const fourths = F.ALL_KINDS.filter((k) => y.open.kinds[k] === 4).map(F.kindName);
    expect(fourths.toSorted()).toEqual(["belt", "gatherer", "joiner", "sorter", "splitter", "tunnel"]);
  });
});

/** The Coins a command took from the purse. */
function spent(y: F.Yard, c: Record<string, unknown>, purse = Infinity): number | string {
  const read = F.readCommand({ tick: y.tick, ...c });
  if (!read) throw new Error(`${JSON.stringify(c)} does not read`);
  const did = F.play(y, read, purse);
  if ("refused" in did) return did.why;
  return (did.coins ?? []).reduce((sum, ch) => sum + (ch.reason === "Earned in the Works" ? 0 : -ch.amount), 0);
}

describe("Upgrade", () => {
  test("takes a line from grade 3 to 4 for the difference in price, a line piece at 40 times grade 1's and a gatherer at 20", () => {
    const y = bare4(["gatherer4", "lines4", "upgrading"]);
    y.spare.fill(0);
    for (let x = 3; x <= 7; x++) must(y, { do: "build", kind: "belt", x, y: 8, dir: 0, grade: 3 });
    must(y, { do: "build", kind: "splitter", x: 8, y: 8, dir: 0, grade: 3 });
    must(y, { do: "build", kind: "gatherer", x: CRYSTAL_AT[0], y: CRYSTAL_AT[1], dir: 0, grade: 3 });
    const line = F.within(y, 3, 8, 8, 8);
    const belt = F.price(F.BELT, 4) - F.price(F.BELT, 3);
    const splitter = F.price(F.SPLITTER, 4) - F.price(F.SPLITTER, 3);
    expect([F.price(F.BELT, 4) / F.price(F.BELT, 1), F.price(F.GATHERER, 4) / F.price(F.GATHERER, 1)]).toEqual([
      40, 20,
    ]);
    expect(F.upgradePrice(y, line)).toBe(5 * belt + splitter);
    // A Coin short is refused, with nothing changed; the price itself raises every piece to 4.
    expect(spent(y, { do: "upgrade", tiles: line }, 5 * belt + splitter - 1)).toBe("Not enough Coins: 1 short");
    expect(line.map((i) => y.grade[i])).toEqual([3, 3, 3, 3, 3, 3]);
    expect(spent(y, { do: "upgrade", tiles: line }, 5 * belt + splitter)).toBe(5 * belt + splitter);
    expect(line.map((i) => y.grade[i])).toEqual([4, 4, 4, 4, 4, 4]);
    const gatherer = [F.at(y, ...CRYSTAL_AT)];
    expect(spent(y, { do: "upgrade", tiles: gatherer })).toBe(F.price(F.GATHERER, 4) - F.price(F.GATHERER, 3));
    expect(y.grade[F.at(y, ...CRYSTAL_AT)]).toBe(4);
    // Undo takes it back to grade 3, and gives the Coins back.
    const did = give(y, { do: "undo", entry: y.history.at(-1)?.id ?? "" });
    expect("refused" in did ? did.why : y.grade[F.at(y, ...CRYSTAL_AT)]).toBe(3);
  });

  test("without the research, raises to grade 3 at most, and a grade 4 piece is refused by name", () => {
    const y = bare4(["upgrading", "starfolio"], 7);
    expect([F.highest(y.open, F.BELT), F.highest(y.open, F.GATHERER)]).toEqual([3, 3]);
    const did = give(y, { do: "build", kind: "belt", x: 3, y: 8, dir: 0, grade: 4 });
    expect("refused" in did ? did.why : null).toBe("A grade 4 belt is not unlocked yet");
  });
});

describe("a grade 4 piece in hand", () => {
  test("is raised from its card, alone, for the difference, and only while it is the piece the card was of", () => {
    const y = bare4();
    must(y, { do: "build", kind: "belt", x: 3, y: 8, dir: 0, grade: 3 });
    const tiles = [F.at(y, 3, 8)];
    const raise = { do: "upgrade", tiles, grade: 4, kind: "belt", from: 3 };
    expect(spent(y, raise)).toBe(F.price(F.BELT, 4) - F.price(F.BELT, 3));
    expect(y.grade[F.at(y, 3, 8)]).toBe(4);
    expect(typeof spent(y, raise)).toBe("string");
  });

  test("kept in a blueprint goes into its code at grade 4, and pasted elsewhere is set down at grade 4", () => {
    const y = bare4();
    for (const [x, kind] of [
      [3, "belt"],
      [4, "splitter"],
      [5, "joiner"],
      [6, "sorter"],
    ] as const)
      must(y, { do: "build", kind, x, y: 8, dir: 0, grade: 4 });
    must(y, { do: "saveBlueprint", slot: 0, tiles: F.within(y, 3, 8, 6, 8) });
    const print = y.blueprints[0];
    const code = print ? F.blueprintCode(print) : null;
    if (code === null) throw new Error("no code");
    const b = bare4();
    must(b, { do: "pasteBlueprint", slot: 2, code });
    must(b, { do: "placeBlueprint", slot: 2, turns: 0, x: 3, y: 2 });
    expect([3, 4, 5, 6].map((x) => b.grade[F.at(b, x, 2)])).toEqual([4, 4, 4, 4]);
    // In a yard without the research, pasted it keeps, and set down it is refused by name.
    const early = bare4(["planchest"], 7);
    must(early, { do: "pasteBlueprint", slot: 0, code });
    const did = give(early, { do: "placeBlueprint", slot: 0, turns: 0, x: 3, y: 2 });
    expect("refused" in did ? did.why : null).toContain("A grade 4 belt is not unlocked yet");
  });

  test("laid as a run is undone whole, its Coins given back", () => {
    const y = bare4();
    const legs = [3, 4, 5, 6, 7].map((x): F.Leg => ({ tunnel: false, x, y: 8, dir: 0, grade: 4 }));
    const read = F.readCommand({ tick: y.tick, ...F.writeAct({ do: "lay", legs }), id: "run-1" });
    if (!read) throw new Error("the run does not read");
    const did = F.play(y, read);
    if ("refused" in did) throw new Error(did.why);
    expect([3, 4, 5, 6, 7].map((x) => y.grade[F.at(y, x, 8)])).toEqual([4, 4, 4, 4, 4]);
    expect(spent(y, { do: "undo", entry: "run-1" })).toBeLessThan(0);
    expect([3, 4, 5, 6, 7].map((x) => y.kind[F.at(y, x, 8)])).toEqual([F.NONE, F.NONE, F.NONE, F.NONE, F.NONE]);
  });
});

describe("a yard with grade 4 pieces", () => {
  test("kept mid-run as version 13 and read back goes on as the one kept, tick for tick", () => {
    const y = bare4();
    const [x, z] = CRYSTAL_AT;
    must(y, { do: "build", kind: "gatherer", x, y: z, dir: 0, grade: 4 });
    must(y, { do: "build", kind: "belt", x: x + 1, y: z, dir: 0, grade: 4 });
    must(y, { do: "build", kind: "splitter", x: x + 2, y: z, dir: 0, grade: 4 });
    must(y, { do: "build", kind: "crate", x: 1, y: 4, dir: 0 });
    for (let k = 2; k <= 34; k++) must(y, { do: "build", kind: "belt", x: k, y: 4, dir: 0, grade: 4 });
    for (let k = 0; k < 40; k++) F.put(y.holders, F.holderOf(y, F.at(y, 1, 4)), F.item("plank"));
    for (let k = 0; k < 457; k++) F.step(y);
    const text = F.encode(y);
    const back = F.decode(text, y.land);
    if (!back) throw new Error("the yard does not read back");
    expect([JSON.parse(text).v, F.check(back)]).toEqual([F.FOURTH, F.check(y)]);
    for (let k = 0; k < 1800; k++) {
      F.step(y);
      F.step(back);
    }
    expect([F.check(back), back.depot[CRYSTAL], back.depot[F.item("plank")]]).toEqual([
      F.check(y),
      y.depot[CRYSTAL],
      y.depot[F.item("plank")],
    ]);
  });
});
