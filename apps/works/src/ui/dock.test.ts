/**
 * The line over the dock, by what it prints: with nothing in hand it says how to open a piece's card
 * until a card has been asked for from the yard on this device (`openCard`), and from then on
 * nothing; a tool's words still show, and so does what is said, for a few seconds.
 */
import { expect, test } from "bun:test";

import { net, opened, useFakeLeaf } from "../../test/fake-leaf.ts";
import { S } from "../state.ts";
import { setTool } from "../tools.ts";
import { openCard, refAt } from "./card.ts";
import { handPrint, say } from "./dock.ts";

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
