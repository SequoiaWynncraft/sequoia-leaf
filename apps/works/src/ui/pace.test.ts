/**
 * A piece's card says first what it does a minute, flat out, as factory players count it: what a
 * gatherer gathers, a machine makes, a Study takes in, a boiler burns, and a belt carries.
 */
import { expect, test } from "bun:test";

import {
  BELT,
  BOILER,
  carried,
  GATHERER,
  item,
  makes,
  MILL,
  PYLON,
  RECIPE,
  SPLITTER,
  STUDY,
} from "@sequoia-leaf/factory";

import { paceOf } from "./cards.ts";

test("a piece's pace is said a minute, from the rules' planner, at each grade", () => {
  const plank = RECIPE[item("plank")] ?? null;
  expect(paceOf(MILL, 1)).toEqual({ label: "Makes", value: `${Math.round(makes(MILL, 1, plank))} /min` });
  expect(paceOf(GATHERER, 1)).toEqual({ label: "Gathers", value: `${makes(GATHERER, 1, null)} /min` });
  expect(paceOf(STUDY, 1)?.label).toBe("Takes in");
  expect(paceOf(BOILER, 1)).toEqual({ label: "Burns", value: "30 /min" });
  // A belt, and what stands in a line of belt, carry as the planner says: 150, 200 and 300 a minute.
  expect([1, 2, 3].map((g) => paceOf(BELT, g)?.value)).toEqual(["150 /min", "200 /min", "300 /min"]);
  expect(paceOf(SPLITTER, 2)).toEqual({ label: "Carries", value: `${carried(2)} /min` });
  // A higher grade does more a minute.
  expect(Number.parseFloat(paceOf(GATHERER, 3)?.value ?? "")).toBeGreaterThan(
    Number.parseFloat(paceOf(GATHERER, 1)?.value ?? ""),
  );
  // A piece that does nothing a minute says nothing of it.
  expect(paceOf(PYLON, 1)).toBeNull();
});
