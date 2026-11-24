/**
 * The folds of the tier's and the research screens, as kept on the device: the lists of those done
 * and of research known shut and every card open until the player says otherwise; a choice made
 * wins; kept text that does not read is no choice; and a card's choice is that card's alone.
 */
import { afterEach, expect, test } from "bun:test";

import { ALL_GOALS, goal } from "@sequoia-leaf/factory";
import { type Standin, standin } from "@sequoia-leaf/kit/standin.ts";

import { FOLDS, keepFold, opened } from "./folds.ts";

let world: Standin | null = null;
afterEach(() => {
  world?.done();
  world = null;
});

const BOILER = goal("boiler");
const CRATES = goal("crates");
/** How the lists and two cards stand: Done, Known, the boiler's card, the crates' card. */
const standing = (): boolean[] => [opened("done"), opened("known"), opened(BOILER), opened(CRATES)];

test("with nothing kept, Done and Known are shut, Projects is open and every card is open", () => {
  world = standin({});
  expect(opened("done")).toBe(false);
  expect(opened("known")).toBe(false);
  expect(opened("projects")).toBe(true);
  expect(ALL_GOALS.filter((g) => !opened(g))).toEqual([]);
});

test("a choice kept wins over the first look, and only choices made are kept", () => {
  world = standin({});
  keepFold("done", true);
  keepFold(BOILER, false);
  expect(standing()).toEqual([true, false, false, true]);
  expect(JSON.parse(world.store.getItem(FOLDS) ?? "null")).toEqual({ done: true, goals: { boiler: false } });
  keepFold("done", false);
  keepFold(BOILER, true);
  expect(standing()).toEqual([false, false, true, true]);
});

test("kept text that does not read gives the first look; a choice that reads beside it is kept", () => {
  for (const text of [
    "nonsense",
    "null",
    "[]",
    '"done"',
    '{"done":"yes","known":1,"goals":[]}',
    '{"goals":{"boiler":0}}',
  ]) {
    world = standin({});
    world.store.setItem(FOLDS, text);
    expect(standing()).toEqual([false, false, true, true]);
    world.done();
  }
  world = standin({});
  world.store.setItem(FOLDS, '{"done":"yes","known":true,"goals":{"boiler":false,"crates":"no"}}');
  expect(standing()).toEqual([false, true, false, true]);
  // A choice made over text that did not read keeps only what reads, and the new choice.
  keepFold(CRATES, false);
  expect(JSON.parse(world.store.getItem(FOLDS) ?? "null")).toEqual({
    known: true,
    goals: { boiler: false, crates: false },
  });
});

test("Projects folds as a whole and stays so, kept beside the other lists' choices", () => {
  world = standin({});
  keepFold("projects", false);
  keepFold("done", true);
  expect([opened("projects"), ...standing()]).toEqual([false, true, false, true, true]);
  expect(JSON.parse(world.store.getItem(FOLDS) ?? "null")).toEqual({ projects: false, done: true, goals: {} });
});

test("a card's choice folds that card alone", () => {
  world = standin({});
  keepFold(CRATES, false);
  expect(standing()).toEqual([false, false, true, false]);
  expect(ALL_GOALS.filter((g) => !opened(g))).toEqual([CRATES]);
});
