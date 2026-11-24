import { beforeEach, expect, test } from "bun:test";

import { PURR_TIME } from "./campsfx.ts";
import { clearFx, floaters } from "./fx.ts";
import { makeGround } from "./grid.ts";
import { makePet, pleased, stepPet } from "./pets.ts";

const NO_ART = { sit: [], walk: [], walkR: [], sleep: null, glad: null };
const world = { ground: makeGround(20, 20, () => 99), member: null, fire: null };
const said = (line: string): number => floaters.filter((f) => f.text === line).length;

beforeEach(clearFx);

test("a pet touched again while it is still answering is pleased, but does not answer over itself", () => {
  const cat = makePet("cat", "Erm", NO_ART, { x: 40, y: 40 });
  cat.wait = 99;
  pleased(cat);
  pleased(cat);
  pleased(cat);
  expect(said("Erm purrs.")).toBe(1);
  expect(floaters.filter((f) => f.text === "♥")).toHaveLength(3);

  // Once its purr is over, a touch is answered again.
  stepPet(cat, PURR_TIME - 0.5, world);
  pleased(cat);
  expect(said("Erm purrs.")).toBe(1);
  stepPet(cat, 0.5, world);
  pleased(cat);
  expect(said("Erm purrs.")).toBe(2);
});
