/**
 * The dock and the line over it. The tools' order: belt, splitter, joiner and tunnel first, then the
 * rest in the order the yard unlocked them, so that no tool moves once it is unlocked. The line, by
 * what it prints: with nothing in hand it says how to open a piece's card until a card has been
 * asked for from the yard on this device (`openCard`), and from then on nothing; a tool's words
 * still show, and so does what is said, for a few seconds.
 */
import { expect, test } from "bun:test";

import {
  BELT,
  create,
  type Goal,
  goal,
  goalsBelow,
  JOINER,
  type Kind,
  openOf,
  SPLITTER,
  TUNNEL,
} from "@sequoia-leaf/factory";

import { net, opened, useFakeLeaf } from "../../test/fake-leaf.ts";
import { dockOrder, DRAWN, S } from "../state.ts";
import { setTool } from "../tools.ts";
import { openCard, refAt } from "./card.ts";
import { handPrint, openTools, say } from "./dock.ts";

useFakeLeaf();

const line = (): string => handPrint().line.text;

/** The page opened on a new yard, with what a card asked for needs of the window. */
async function page(): Promise<void> {
  await opened();
  Object.assign(window, { clearTimeout: () => {} });
  setTool(null);
  S.hover = null;
}

/** The depot's tile: a thing in every yard with a card. */
const depot = (): { x: number; y: number } => ({ x: S.world.land.depot[0], y: S.world.land.depot[1] });
/** A tile of the yard's own land with nothing on it, and so no card. */
function bare(): { x: number; y: number } {
  const w = S.world;
  for (let i = 0; i < w.kind.length; i++) {
    const t = { x: i % w.land.w, y: Math.floor(i / w.land.w) };
    if (refAt(t.x, t.y) === null) return t;
  }
  throw new Error("no bare ground");
}

test("with nothing in hand the line says how to open a piece's card until one has been asked for here; then nothing", async () => {
  await page();
  S.finger = true;
  expect(line()).toBe("Tap a piece for its card.");
  S.finger = false;
  expect(line()).toBe("Pick a tool, or click a piece for its card.");
  // Bare ground has no card: asking there teaches nothing.
  openCard(bare().x, bare().y);
  expect(line()).toBe("Pick a tool, or click a piece for its card.");
  openCard(depot().x, depot().y);
  expect(line()).toBe("");
  S.finger = true;
  expect(line()).toBe("");
  // Kept on the device: a page opened again says nothing either.
  expect(net.world?.store.getItem("works.card.v1")).toBe("1");
});

test("idle, with a card learnt and nothing to undo, the line has no words and no buttons, so it is not drawn", async () => {
  await page();
  openCard(depot().x, depot().y);
  const idle = handPrint();
  expect([idle.line.text, idle.undo, idle.cancel, idle.go, idle.kind, idle.grades.length]).toEqual([
    "",
    false,
    false,
    null,
    null,
    0,
  ]);
  // A tool in hand has words and Cancel: drawn.
  setTool("remove");
  expect([line() !== "", handPrint().cancel]).toEqual([true, true]);
});

test("once a card has been asked for, a tool's words still show, and what is said shows for a few seconds", async () => {
  await page();
  openCard(depot().x, depot().y);
  S.finger = true;
  setTool("remove");
  expect(line()).toBe("Tap a piece to remove it.");
  setTool(null);
  say("Not enough Coins: 5 short.");
  expect(handPrint().line).toEqual({ text: "Not enough Coins: 5 short.", bad: true });
  performance.now = () => 3500;
  expect(line()).toBe("Not enough Coins: 5 short.");
  performance.now = () => 3700;
  expect(line()).toBe("");
});

/** The tools a yard that has done these goals has in its dock, in order: those unlocked, and drawn. */
const docked = (done: readonly Goal[]): Kind[] => {
  const open = openOf(done);
  return dockOrder(done).filter((k) => (open.kinds[k] ?? 0) > 0 && DRAWN.includes(k));
};
/** Belt, splitter, joiner and tunnel, of some tools, in their order; and the rest. */
const LINE: ReadonlySet<Kind> = new Set([BELT, SPLITTER, JOINER, TUNNEL]);
const ofLine = (ks: Kind[]): Kind[] => ks.filter((k) => LINE.has(k));
const notOfLine = (ks: Kind[]): Kind[] => ks.filter((k) => !LINE.has(k));

test("the first four slots are belt, splitter, joiner and tunnel, and the keys 1 to 4 with them", async () => {
  await opened(create({ seed: 5, tier: 2 }));
  expect(openTools().slice(0, 4)).toEqual([BELT, SPLITTER, JOINER, TUNNEL]);
  // Every kind the page draws has a slot, each once.
  expect(dockOrder(S.world.done).toSorted((a, b) => a - b)).toEqual(DRAWN.toSorted((a, b) => a - b));
});

test("a tool unlocked later goes after the others: none moves but to let the four take the first slots", () => {
  // Every goal in an order play could do them, and again with the projects of tier 1 the other way round.
  const all = goalsBelow(9);
  const one = ["boiler", "crates", "culvert", "signs"].map(goal);
  const swapped = all.map((g) => (one.includes(g) ? (one[one.length - 1 - one.indexOf(g)] ?? g) : g));
  expect(swapped).not.toEqual(all);
  for (const order of [all, swapped]) {
    // In the end, every kind the page draws.
    expect(docked(order).toSorted((a, b) => a - b)).toEqual(DRAWN.toSorted((a, b) => a - b));
    for (let n = 0; n < order.length; n++) {
      const before = docked(order.slice(0, n));
      const after = docked(order.slice(0, n + 1));
      // The four first, in their order, as each is unlocked.
      expect(after.slice(0, ofLine(after).length)).toEqual(ofLine(after));
      // The rest as they were, and anything new after them.
      expect(notOfLine(after).slice(0, notOfLine(before).length)).toEqual(notOfLine(before));
    }
  }
});
