import { describe, expect, test } from "bun:test";

import { pieces, type Tone } from "./rich.ts";

const tones = (text: string): [Tone, string][] =>
  pieces(text)
    .filter((p) => p.tone !== "plain")
    .map((p) => [p.tone, p.text]);

describe("the words on a card, sorted for colouring", () => {
  test("numbers, with their units, are numbers", () => {
    expect(tones("Takes 40% less for 4s. Melee attackers take 45.")).toEqual([
      ["number", "40%"],
      ["number", "4s"],
      ["number", "45"],
    ]);
    expect(tones("Ember hits burn, 2% health/s for 4s.")).toEqual([
      ["number", "2%"],
      ["number", "4s"],
    ]);
    expect(tones("Whole party's hits burn, 4%/s.")).toEqual([["number", "4%/s"]]);
    expect(tones("Stuns 1.5s. Every 3rd attack hits twice. +25% speed.")).toEqual([
      ["number", "1.5s"],
      ["number", "3rd"],
      ["number", "+25%"],
    ]);
  });
  test("the kinds of damage have their own colour", () => {
    expect(tones("75 magic to target and the enemy behind it.")).toEqual([
      ["number", "75"],
      ["magic", "magic"],
    ]);
    expect(tones("160 true to target. 70 physical.")).toEqual([
      ["number", "160"],
      ["true", "true"],
      ["number", "70"],
      ["physical", "physical"],
    ]);
  });
  test("a heal or a shield amount is the next number after the word, in the same fragment", () => {
    expect(tones("Shield 210 for 4s. 70 physical to adjacent enemies.")).toEqual([
      ["mend", "210"],
      ["number", "4s"],
      ["number", "70"],
      ["physical", "physical"],
    ]);
    expect(tones("Heals most hurt ally for 150.")).toEqual([["mend", "150"]]);
    expect(tones("3 most hurt allies: heal 430 each.")).toEqual([
      ["number", "3"],
      ["mend", "430"],
    ]);
    expect(tones("Mender heals and shields. 20 more.")).toEqual([["number", "20"]]);
  });
  test("nothing is lost: the pieces spell the text", () => {
    const text = "Shield 940 for 4s. Taunts enemies in 2 hexes for 4s.";
    expect(
      pieces(text)
        .map((p) => p.text)
        .join(""),
    ).toBe(text);
  });
  test("a digit inside a name is not a number", () => {
    expect(tones("Crab #12 waits.")).toEqual([["number", "12"]]);
    expect(tones("1- and 2-acorn figures")).toEqual([
      ["number", "1"],
      ["number", "2"],
    ]);
  });
});
