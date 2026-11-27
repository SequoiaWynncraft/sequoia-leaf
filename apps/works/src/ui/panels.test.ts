/**
 * The panels: the side orders keep their places in the list, and each panel is kept by what it
 * prints (`shows`), so a value it shows that changes alone, such as the minutes before an order may
 * be swapped again, changes what it is kept by. The tier's screen and research print how every goal
 * stands, and lead on: what a goal waits on is printed with what begins it.
 */
import { describe, expect, test } from "bun:test";

import {
  ALL_GOALS,
  ALL_ITEMS,
  at,
  BOILER,
  build,
  create,
  type Goal,
  goal,
  GOALS,
  holderOf,
  isNode,
  item,
  type Kind,
  LINE,
  litOf,
  MILL,
  NONE,
  ORDER_WAITS,
  play,
  power,
  put,
  reopen,
  step,
  STUDY,
  study,
  TIERS,
  type Yard,
} from "@sequoia-leaf/factory";
import { xy } from "@sequoia-leaf/factory/test/near.ts";

import { S } from "../state.ts";
import type { Need } from "./goal.ts";
import { bookNames, booksPrint, foldedPrint, plaquePrint, trackPrint } from "./hud.ts";
import { ordersPrint, placed, plural, powerPrint } from "./panels.ts";
import { researchPrint, stripPrint } from "./research.ts";
import { lockOf, nextUp, nextWords, researchOpen, studiable, takeable, tierOpen } from "./standing.ts";
import { tierPrint } from "./tier.ts";
import { shortRow } from "./views.ts";

const order = (id: number, planks: number): { id: number; full: boolean } => ({ id, full: planks >= 10 });
const ids = (list: readonly { id: number }[]): number[] => list.map((s) => s.id);
/** Why each order on the board cannot be swapped now, as the orders panel prints it. */
const why = (): (string | null)[] => ordersPrint().orders.map((o) => o.why);

test("filled orders are first when the list opens, and an order keeps its place until one leaves", () => {
  const open = ids(placed([], [order(1, 0), order(2, 10), order(3, 4), order(4, 10)]));
  expect(open).toEqual([2, 4, 1, 3]);
  // Order 3 fills while the list is open: it stays where it is.
  const board = [order(1, 0), order(2, 10), order(3, 10), order(4, 10)];
  expect(ids(placed(open, board))).toEqual(open);
  // Order 2 is handed over: the filled ones that stay are first, in the order they were in.
  const handed = ids(placed(open, board.slice(2).concat(order(1, 0))));
  expect(handed).toEqual([4, 3, 1]);
  // Leaf hangs a fresh order in the first slot of the board: the list shows it last.
  expect(ids(placed(handed, [order(5, 0), order(1, 0), order(3, 10), order(4, 10)]))).toEqual([4, 3, 1, 5]);
});

describe("a panel is kept by what it prints", () => {
  test("the orders: an order just swapped says how many minutes until the next, and the minutes count down", () => {
    const y = create({ seed: 5, tier: 1 });
    const first = y.board[0];
    if (!first) throw new Error("no board");
    const did = play(y, { do: "swap", order: first.id, tick: y.tick });
    if ("refused" in did) throw new Error(did.why);
    S.world = y;
    const now = JSON.stringify(ordersPrint());
    expect(why()[0]).toMatch(/^You can replace an order again in \d+ minutes$/);
    // A minute on, nothing else about the board changed.
    y.tick += 600;
    expect(why()[0]).not.toBe(JSON.parse(now).orders[0].why);
    expect(JSON.stringify(ordersPrint())).not.toBe(now);
  });

  test("the orders: how many side orders the yard has handed over, counted by the rules as each goes", () => {
    const y = create({ seed: 3, tier: 4 });
    S.world = y;
    expect(ordersPrint().handed).toBe(0);
    const first = y.board[0];
    if (!first) throw new Error("no board");
    for (const n of ALL_ITEMS) first.filled[n] = first.want[n] ?? 0;
    for (let k = 0; k < ORDER_WAITS; k++) step(y);
    const did = play(y, { do: "handOver", order: first.id, tick: y.tick });
    if ("refused" in did) throw new Error(did.why);
    expect(ordersPrint().handed).toBe(1);
  });

  test("power: more than one of a kind is spelt as it is said", () => {
    expect(["Mill", "Bench", "Workshop", "Study", "Gatherer"].map(plural)).toEqual([
      "Mills",
      "Benches",
      "Workshops",
      "Studies",
      "Gatherers",
    ]);
  });

  test("power: a yard a little short is never printed as at 100%", () => {
    const y = create({ seed: 5, tier: 1 });
    // Worked out once, then set a hair short: 200 power made, 201 drawn.
    power(y);
    y.supply = 400;
    y.demand = 402;
    S.world = y;
    expect([power(y).pace < 1, Math.round(power(y).pace * 100), powerPrint().speed]).toEqual([true, 100, 99]);
  });

  test("power: each kind's row says what one of it draws at its grade, as its total counts it", () => {
    const y = create({ seed: 5, tier: 4 });
    millsInReach(y, 1, 2);
    S.world = y;
    expect([powerPrint().demand, mills()]).toEqual([4.5, { kind: MILL, about: "1 in reach, 4.5 each", drawn: 4.5 }]);
    // A second mill, of the first grade: the row says both draws.
    millsInReach(y, 1, 1);
    expect([powerPrint().demand, mills()]).toEqual([
      7.5,
      { kind: MILL, about: "2 in reach, 3 to 4.5 each", drawn: 7.5 },
    ]);
  });

  test("power: a mill in the dark says nothing of what one draws, and none in reach says only how many are dark", () => {
    const y = create({ seed: 5, tier: 4 });
    millsInReach(y, 1, 1);
    millsInDark(y, 1, 2);
    S.world = y;
    expect(mills()).toEqual({ kind: MILL, about: "1 in reach, 1 in the dark, 3 each", drawn: 3 });
    const dark = create({ seed: 5, tier: 4 });
    millsInDark(dark, 2, 2);
    S.world = dark;
    expect(mills()).toEqual({ kind: MILL, about: "2 in the dark", drawn: 0 });
  });

  test("power: each kind that gives power is its own row, at its own power: one boiler burning and one cold", () => {
    const y = create({ seed: 5, tier: 4 });
    const [hot] = piecesAt(y, BOILER, 2, null, true);
    if (!hot) throw new Error("no boiler");
    put(y.holders, holderOf(y, at(y, hot.x, hot.y)), item("deadfall"));
    step(y);
    S.world = y;
    expect(powerPrint().gives).toEqual([{ kind: BOILER, about: "1 burning, 1 cold", n: 30 }]);
    expect(powerPrint().supply).toBe(y.open.depot + 30);
  });

  test("power: the book, the bar over the yard and the trouble view say the same speed, rounded down", () => {
    const y = create({ seed: 5, tier: 4 });
    // Nine mills of grade II in reach draw 40.5 of the 40 made: 98.77%.
    millsInReach(y, 9, 2);
    S.world = y;
    expect([power(y).supply, power(y).demand]).toEqual([40, 40.5]);
    expect([powerPrint().speed, plaquePrint().speed, shortRow(y)]).toEqual([98, 98, ["40.5", "40", "98%"]]);
  });
});

/** The power book's row for mills. */
const mills = (): unknown => powerPrint().draws.find((d) => d.kind === MILL);

/** Builds `n` mills of a grade where power reaches, each on the first tile that takes one; where they stand. */
/** Builds `n` pieces of a kind (at a grade, where it has grades) on clear tiles in reach of power, or out of it. */
function piecesAt(y: Yard, kind: Kind, n: number, grade: number | null, reached: boolean): { x: number; y: number }[] {
  const lit = litOf(y);
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < y.kind.length && out.length < n; i++) {
    const tile = { x: i % y.land.w, y: Math.floor(i / y.land.w) };
    const as = grade === null ? {} : { grade };
    if (y.kind[i] === NONE && (lit[i] === 1) === reached && build(y, kind, tile.x, tile.y, 0, Infinity, as).ok)
      out.push(tile);
  }
  if (out.length < n) throw new Error("no room for the pieces");
  return out;
}
const millsInReach = (y: Yard, n: number, grade: number): unknown => piecesAt(y, MILL, n, grade, true);
const millsInDark = (y: Yard, n: number, grade: number): unknown => piecesAt(y, MILL, n, grade, false);

/** What the books' buttons are called now, each titled by its id. */
const names = (): Map<string, string> => bookNames(booksPrint(), (id) => id);

/** A yard of a tier, as the page's own (not a visit). */
function yardAt(tier: number): Yard {
  const y = create({ seed: 5, tier });
  S.world = y;
  S.visiting = null;
  return y;
}
/** Goals by their names in the tables. */
const named = (goals: readonly Goal[]): string[] => goals.map((g) => GOALS[g]?.id ?? "");
/** What a goal waits on, each by its name, how it stands, and what begins it. */
const waits = (needs: readonly Need[]): string[] =>
  needs.map((n) => [GOALS[n.goal]?.id, n.stands, ...(n.begin ? [n.begin] : [])].join(": "));

/** The research as the tier's screen prints it, each goal by its name. */
function section() {
  const r = tierPrint().research;
  const ready = r?.ready ? `${GOALS[r.ready.goal]?.id}: ${r.ready.begin}` : null;
  return r && { known: r.known, all: r.all, studied: GOALS[r.studied?.goal ?? -1]?.id ?? null, ready };
}

describe("the tier's screen", () => {
  test("is there from tier 1 and research from the tier that has a Study, and neither in a visit", () => {
    yardAt(0);
    expect([tierOpen(), researchOpen()]).toEqual([false, false]);
    yardAt(1);
    expect([tierOpen(), researchOpen()]).toEqual([true, false]);
    expect(tierPrint().research).toBeNull();
    yardAt(3);
    expect([tierOpen(), researchOpen()]).toEqual([true, true]);
    S.visiting = { id: "q", name: "Somebody" };
    expect([tierOpen(), researchOpen()]).toEqual([false, false]);
    S.visiting = null;
  });

  test("prints the tier's commission, its projects with the one in hand, and those done", () => {
    const y = yardAt(2);
    const p = tierPrint();
    // A tier opens with its commission in hand.
    expect([p.tier, GOALS[p.hand]?.id, GOALS[p.commission?.goal ?? -1]?.id, p.commission?.take]).toEqual([
      2,
      "hall",
      "hall",
      true,
    ]);
    expect(named(p.projects.map((g) => g.goal))).toEqual([
      "stew",
      "chain",
      "drawing",
      "wax",
      "rakes",
      "windows",
      "shells",
    ]);
    // A drawing board waits on the surveyor's chain, which may be taken: the rest may be taken as they are.
    for (const g of p.projects) {
      const drawing = g.goal === goal("drawing");
      expect([GOALS[g.goal]?.id, g.take, waits(g.needs)]).toEqual([
        GOALS[g.goal]?.id,
        !drawing,
        drawing ? ["chain: not begun: take"] : [],
      ]);
    }
    expect(named(p.done)).toEqual(["boiler", "crates", "culvert", "signs", "banners"]);
    expect(named(takeable())).toContain("wax");
    // One taken in hand, then done: it is among those done, and no longer a project.
    const before = JSON.stringify(p);
    y.hand = goal("wax");
    expect(tierPrint().hand).toBe(goal("wax"));
    expect(JSON.stringify(tierPrint())).not.toBe(before);
    y.hand = -1;
    y.done = [...y.done, goal("wax")];
    reopen(y);
    expect(named(tierPrint().projects.map((g) => g.goal))).not.toContain("wax");
    expect(named(tierPrint().done)).toContain("wax");
  });

  test("prints the nodes in line after the one in hand, in their order", () => {
    const y = yardAt(1);
    for (const [act, node] of [
      ["take", "boiler"],
      ["queue", "signs"],
      ["queue", "crates"],
    ] as const)
      play(y, { do: act, node: goal(node), tick: y.tick });
    expect([tierPrint().hand, named(tierPrint().queue)]).toEqual([goal("boiler"), ["signs", "crates"]]);
  });

  test("leads on: what the commission waits on is each a thing with how it stands, and the first that can be begun says how", () => {
    const y = yardAt(3);
    // No Study stands: nothing is studied without one, so the first piece of research leads to building one.
    expect(waits(tierPrint().commission?.needs ?? [])).toEqual([
      "oilpress: not begun: build",
      "workshop: not begun",
      "flywheel: not begun",
      "tooling: not begun",
      "sorter: not begun",
      "planchest: not begun",
      "carttrack: not begun",
      "nightshift: not begun",
      "upgrading: not begun",
      "brassfolio: not begun",
    ]);
    expect(tierPrint().research).toMatchObject({ known: 0, all: 10 });
    build(y, STUDY, ...xy(-4, -3), 0, Infinity);
    expect(waits(tierPrint().commission?.needs ?? [])[0]).toBe("oilpress: not begun: study");
    study(y, goal("oilpress"));
    study(y, goal("workshop"));
    // Both under way: the next that can be begun says how; the rest wait on research before them, or
    // on a place in the line (the Brass folio waits on research itself).
    expect(waits(tierPrint().commission?.needs ?? [])).toEqual([
      "oilpress: being studied",
      "workshop: in the line",
      "flywheel: not begun: study",
      "tooling: not begun",
      "sorter: not begun",
      "planchest: not begun",
      "carttrack: not begun",
      "nightshift: not begun",
      "upgrading: not begun",
      "brassfolio: not begun",
    ]);
    // A folio studied moves a bar, and builds nothing again: the screen prints the same.
    const before = JSON.stringify(tierPrint());
    const got = y.got[goal("oilpress")];
    if (!got) throw new Error("nothing is being studied");
    got[item("timber")] = 10;
    expect(JSON.stringify(tierPrint())).toBe(before);
    // Known: it says so, and the count of what is known goes up.
    y.line = y.line.filter((g) => g !== goal("oilpress"));
    y.done = [...y.done, goal("oilpress")];
    reopen(y);
    expect(waits(tierPrint().commission?.needs ?? [])[0]).toBe("oilpress: known");
    expect(tierPrint().research).toMatchObject({ known: 1, all: 10 });
  });

  test("with nothing in hand, says what comes next: projects to take, the goal waited on and what opens it, or everything done", () => {
    const y = yardAt(2);
    expect(nextWords(nextUp())).toEqual({
      label: "Tier 2",
      title: "Take a project",
      line: `${takeable().length} ready`,
    });
    yardAt(3);
    // Tier 3 has only its commission, which waits on all ten of the tier's research.
    expect(nextUp()).toEqual({ is: "locked", goal: goal("lanterns"), lock: "10 research left" });
    expect(nextWords(nextUp())).toEqual({
      label: "Next: Tier 3 commission",
      title: "Lanterns for the great tree",
      line: "10 research left",
    });
    // Every goal of the slice done: the tier after the last is open, with nothing in it yet.
    y.done = [...ALL_GOALS];
    reopen(y);
    S.world = y;
    expect([y.open.tier, nextWords(nextUp())]).toEqual([
      TIERS.length,
      { label: "", title: "Every project is done", line: "More tiers are coming." },
    ]);
  });

  test("a goal that waits on another is locked, and says what is left as a count; one open or done is not", () => {
    const y = yardAt(3);
    expect(tierPrint().commission).toMatchObject({ take: false, lock: "10 research left" });
    y.done = [...y.done, goal("oilpress"), goal("workshop")];
    reopen(y);
    expect(lockOf(goal("lanterns"))).toBe("8 research left");
    // A project that waits on a project says so: the drawing board waits on the surveyor's chain.
    const two = yardAt(2);
    expect(lockOf(goal("drawing"))).toBe("1 project left");
    two.done = [...two.done, goal("chain")];
    reopen(two);
    expect(lockOf(goal("drawing"))).toBeNull();
    // Research that waits on research.
    yardAt(3);
    expect(lockOf(goal("tooling"))).toBe("1 research left");
  });

  test("folded, the box in the corner shows its goal, and on its corner the orders to hand over, else ! while a commission may be taken", () => {
    const y = yardAt(3);
    const lanterns = { goal: goal("lanterns"), title: "Lanterns for the great tree" };
    // The tier's commission waits on its ten research: nothing to do, nothing on the corner.
    expect(foldedPrint(trackPrint())).toEqual({ ...lanterns, todo: "", badge: null });
    // Its research known, the commission may be taken.
    y.done = [...y.done, ...ALL_GOALS.filter((g) => !isNode(g) && (GOALS[g]?.tier ?? 0) <= 3)];
    reopen(y);
    expect(foldedPrint(trackPrint())).toEqual({ ...lanterns, todo: "ready to take", badge: "!" });
    // An order filled as well: the count is on the corner, and the name says both.
    const first = y.board[0];
    if (!first) throw new Error("no board");
    for (const n of ALL_ITEMS) first.filled[n] = first.want[n] ?? 0;
    expect(foldedPrint(trackPrint())).toEqual({ ...lanterns, todo: "1 to hand over, ready to take", badge: "1" });
  });

  test("shows research beside the projects: what is being studied, else the first that can be begun and how", () => {
    const y = yardAt(3);
    // Nothing is being studied and no Study stands: the first that can be begun leads to building one.
    expect(section()).toEqual({ known: 0, all: 10, studied: null, ready: "oilpress: build" });
    build(y, STUDY, ...xy(-4, -3), 0, Infinity);
    expect(section()).toEqual({ known: 0, all: 10, studied: null, ready: "oilpress: study" });
    // Being studied: what it wants is printed as the research screen prints it, and a folio studied
    // moves a bar and prints the same.
    study(y, goal("workshop"));
    study(y, goal("oilpress"));
    expect(section()).toEqual({ known: 0, all: 10, studied: "workshop", ready: null });
    expect(tierPrint().research?.studied).toEqual(researchPrint().first);
    const before = JSON.stringify(tierPrint());
    const got = y.got[goal("workshop")];
    if (!got) throw new Error("nothing is being studied");
    got[item("timber")] = 30;
    expect(JSON.stringify(tierPrint())).toBe(before);
    // Every piece known: the count, and nothing being studied or to begin.
    y.line = [];
    y.done = [...y.done, ...ALL_GOALS.filter((g) => !isNode(g) && (GOALS[g]?.tier ?? 0) <= 3)];
    reopen(y);
    expect(section()).toEqual({ known: 10, all: 10, studied: null, ready: null });
  });

  test("the Research button counts the research that may be put in the line now", () => {
    const y = yardAt(3);
    // Those that wait on no other research, for the line is empty.
    const free = ["oilpress", "workshop", "flywheel", "sorter", "planchest", "carttrack", "nightshift"];
    expect([named(studiable()), booksPrint().study]).toEqual([free, 7]);
    // One known lets on what waits on it; one in the line is not counted again.
    y.done = [...y.done, goal("workshop")];
    reopen(y);
    study(y, goal("oilpress"));
    expect(named(studiable())).toEqual(["flywheel", "tooling", "sorter", "planchest", "carttrack", "nightshift"]);
    // The line full: none may be put in it, and the button has no count.
    for (const g of ["flywheel", "sorter", "planchest"] as const) study(y, goal(g));
    expect(y.line.length).toBe(LINE);
    expect([studiable(), booksPrint().study]).toEqual([[], 0]);
  });

  test("a button's count is in its name, for whoever cannot see the corner", () => {
    const y = yardAt(3);
    expect(names().get("research")).toBe("research, 7 to study");
    for (const g of ["oilpress", "flywheel", "sorter", "planchest"] as const) study(y, goal(g));
    // The line full: no count, so the name alone.
    expect(names().get("research")).toBe("research");
    expect(names().get("board")).toBe("board");
  });

  test("the node in hand in Orders prints what it waits on the same way", () => {
    const y = yardAt(3);
    // Nothing in hand, and tier 3 has no projects: Orders says what comes next, as the corner does.
    expect(ordersPrint()).toMatchObject({
      hand: -1,
      needs: [],
      next: { is: "locked", goal: goal("lanterns"), lock: "10 research left" },
    });
    y.hand = goal("lanterns");
    expect(waits(ordersPrint().needs)[0]).toBe("oilpress: not begun: build");
  });
});

describe("research", () => {
  test("prints what is being studied, the rest of the line, what may be studied and what waits, and what is known", () => {
    const y = yardAt(3);
    build(y, STUDY, ...xy(-4, -3), 0, Infinity);
    let p = researchPrint();
    expect([p.first, p.next, p.full, p.left, p.known]).toEqual([null, [], false, true, []]);
    expect(p.todo.length).toBe(10);
    // Second-tier machines waits on the workshop: it may not be studied yet, and says what it waits on.
    const tooling = p.todo.find((o) => o.goal === goal("tooling"));
    expect([tooling?.may, tooling?.lock, waits(tooling?.needs ?? [])]).toEqual([
      false,
      "1 research left",
      ["workshop: not begun"],
    ]);
    for (const g of ["workshop", "oilpress", "flywheel", "sorter"] as const) study(y, goal(g));
    p = researchPrint();
    expect([GOALS[p.first?.goal ?? -1]?.id, named(p.next), p.full]).toEqual([
      "workshop",
      ["oilpress", "flywheel", "sorter"],
      true,
    ]);
    expect(y.line.length).toBe(LINE);
    // The line is full: nothing more may be put in it, and what is in it is not listed to study.
    expect(p.todo.some((o) => o.may)).toBe(false);
    expect(named(p.todo.map((o) => o.goal))).not.toContain("workshop");
    // A folio studied moves a bar on the screen, and builds nothing again.
    const before = JSON.stringify(p);
    const got = y.got[goal("workshop")];
    if (!got) throw new Error("nothing is being studied");
    got[item("timber")] = 30;
    expect(JSON.stringify(researchPrint())).toBe(before);
  });

  test("the slim bar is there once a Study stands with something to study, and says how far the research has come", () => {
    const y = yardAt(3);
    expect(stripPrint()).toEqual({ hidden: true, goal: null, have: 0, of: 0 });
    build(y, STUDY, ...xy(-4, -3), 0, Infinity);
    // Something could be studied: the bar is there, and says nothing is.
    expect(stripPrint()).toEqual({ hidden: false, goal: null, have: 0, of: 0 });
    study(y, goal("workshop"));
    expect(stripPrint()).toEqual({ hidden: false, goal: goal("workshop"), have: 0, of: 225 });
    const got = y.got[goal("workshop")];
    if (!got) throw new Error("nothing is being studied");
    got[item("timber")] = 30;
    expect(stripPrint()).toMatchObject({ have: 30, of: 225 });
    S.visiting = { id: "q", name: "Somebody" };
    expect(stripPrint().hidden).toBe(true);
    S.visiting = null;
  });
});
