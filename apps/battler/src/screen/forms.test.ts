import { describe, expect, test } from "bun:test";

import { formText } from "@sequoia-leaf/raid/content/graid.ts";
import { at, CAT, fightOf, unitOf } from "@sequoia-leaf/raid/testkit.ts";

import { attacks, formLines, formOf, shownName } from "./forms.ts";

describe("a figure's card in a fight", () => {
  test("in its true form says the form's name, that it attacks, and the change the form brings", () => {
    const f = fightOf([at("rock", 3, 0), at("moth", 2, 0)], [at("mud", 3, 3)]);
    const [rock, moth] = [unitOf(f, "rock"), unitOf(f, "moth")];
    // As itself, the Rock does not attack and has no line of its own.
    expect([shownName(CAT, "rock", rock), attacks(CAT, "rock", rock), formLines(CAT, "rock", rock)]).toEqual([
      "Rock",
      false,
      [],
    ]);
    // Got back up as Real Rock: it attacks 0.6 a second.
    rock.form = "true";
    rock.speed = 0.6;
    expect([shownName(CAT, "rock", rock), attacks(CAT, "rock", rock), formOf(rock)]).toEqual([
      "Real Rock",
      true,
      "true",
    ]);
    expect(formLines(CAT, "rock", rock)).toEqual([`Real Rock: ${formText("rock")}`]);
    moth.form = "true";
    expect(formLines(CAT, "moth", moth)).toEqual(["Real Moth: Wing Dust covers the hexes 2 away as well."]);
  });
  test("away from a fight is the figure as it is", () => {
    expect([shownName(CAT, "rock"), attacks(CAT, "rock"), formLines(CAT, "rock"), formOf(undefined)]).toEqual([
      "Rock",
      false,
      [],
      "plain",
    ]);
    expect(attacks(CAT, "badger")).toBe(true);
  });
});
