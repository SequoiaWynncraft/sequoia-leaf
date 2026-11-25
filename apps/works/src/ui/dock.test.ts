/**
 * The line over the dock, by what it prints: with nothing in hand it says how to open a piece's card
 * until one has been opened on this device, and from then on nothing; a tool's words still show, and
 * so does what is said, for a few seconds.
 */
import { expect, test } from "bun:test";

import { net, opened, useFakeLeaf } from "../../test/fake-leaf.ts";
import { S } from "../state.ts";
import { setTool } from "../tools.ts";
import { learnCard } from "./card.ts";
import { handPrint, say } from "./dock.ts";

useFakeLeaf();

const line = (): string => handPrint().line.text;

test("with nothing in hand the line says how to open a piece's card until one has been opened here; then nothing", async () => {
  await opened();
  setTool(null);
  S.finger = true;
  expect(line()).toBe("Tap a piece for its card.");
  S.finger = false;
  expect(line()).toBe("Pick a tool, or click a piece for its card.");
  learnCard();
  expect(line()).toBe("");
  S.finger = true;
  expect(line()).toBe("");
  // Kept on the device: a page opened again says nothing either.
  expect(net.world?.store.getItem("works.card.v1")).toBe("1");
});

test("once the card is learnt, a tool's words still show, and what is said shows for a few seconds", async () => {
  await opened();
  learnCard();
  S.finger = true;
  S.hover = null;
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
