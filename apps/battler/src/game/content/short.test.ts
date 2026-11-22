import { describe, expect, test } from "bun:test";

import { drawName, drawTip, GOOD_WITH, roleLine, ROLES } from "./advice.ts";
import { BOON_IDS, boonShort, boonText } from "./boons.ts";
import {
  abilityShort,
  abilityText,
  FIGURE_IDS,
  specOf,
  type Stars,
  SUMMON_IDS,
  TROUBLE_IDS,
  type UnitKind,
} from "./figures.ts";
import { FINISHED_IDS, isFinishedId, ITEM_IDS, itemShort, itemText } from "./items.ts";
import { CALLINGS, TRAIT_IDS, TRAITS, traitShort, traitText } from "./traits.ts";

/** The longest a fragment may be and still fit one line of a card. */
const FRAGMENT = 48;
const WORDS: Readonly<Record<string, string>> = { one: "1", two: "2", three: "3", four: "4", five: "5" };

/** A short form's fragments: each ends in a full stop, and a full stop ends one only before a space or the end. */
const fragments = (short: string): string[] => short.split(/(?<=\.)\s+/);
/** Every number written in a text in figures; with `words`, the small number words too, as a long sentence may spell them. */
function numbers(text: string, words = false): Set<string> {
  const found = new Set<string>(text.match(/\d+(?:\.\d+)?/g) ?? []);
  if (!words) return found;
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    const n = WORDS[word];
    if (n) found.add(n);
  }
  return found;
}

/** The checks every short form answers to, against the long sentence it shortens. */
function checkShort(what: string, short: string, long: string, most: number): void {
  expect(short.length, `${what} has a short form`).toBeGreaterThan(0);
  expect(short, `${what} has every gap filled`).not.toContain("{");
  const parts = fragments(short);
  expect(parts.length, `${what}: "${short}" is at most ${most} fragment${most > 1 ? "s" : ""}`).toBeLessThanOrEqual(
    most,
  );
  for (const part of parts) {
    expect(part.endsWith("."), `${what}: "${part}" ends in a full stop`).toBe(true);
    expect(part.length, `${what}: "${part}" fits a line`).toBeLessThanOrEqual(FRAGMENT);
  }
  const inLong = numbers(long, true);
  for (const n of numbers(short)) expect(inLong.has(n), `${what}: ${n} in "${short}" is in "${long}"`).toBe(true);
}

const STARS: readonly Stars[] = [1, 2, 3];
const EVERYONE: readonly UnitKind[] = [...FIGURE_IDS, ...SUMMON_IDS, ...TROUBLE_IDS];

describe("short forms", () => {
  test("every ability has one, at every number of stars", () => {
    for (const kind of EVERYONE) {
      if (!specOf(kind).ability) continue;
      for (const stars of STARS)
        checkShort(`${kind} at ${stars}`, abilityShort(kind, stars), abilityText(kind, stars), 2);
    }
  });
  test("every trait step has one, of one fragment", () => {
    for (const id of TRAIT_IDS) {
      expect(TRAITS[id].short.length).toBe(TRAITS[id].steps.length);
      for (let step = 1; step <= TRAITS[id].steps.length; step++)
        checkShort(`${id} step ${step}`, traitShort(id, step), traitText(id, step), 1);
    }
  });
  test("every item has one", () => {
    for (const id of ITEM_IDS) checkShort(id, itemShort(id), itemText(id), 2);
  });
  test("every boon has one", () => {
    for (const id of BOON_IDS) checkShort(id, boonShort(id), boonText(id), 2);
  });
  test("the numbers are the ones for the stars asked for", () => {
    expect(abilityShort("barrowgnome", 2)).toBe("Shield 210 for 4s. 70 physical to adjacent enemies.");
    expect(abilityShort("kettle", 1)).toBe("Heals most hurt ally for 150.");
    expect(abilityShort("rock", 1)).toBe("Takes 40% less for 4s. Melee attackers take 45.");
    expect(traitShort("ember", 1)).toBe("Ember hits burn, 2% health/s for 4s.");
    expect(traitShort("ember", 2)).toBe("Whole party's hits burn, 4%/s.");
  });
});

describe("advice for the cards", () => {
  test("every calling has a role and a place", () => {
    for (const calling of CALLINGS)
      expect(roleLine(calling)).toStartWith(`${ROLES[calling].role} · ${ROLES[calling].place}`);
    expect(roleLine("fang")).toBe("Fighter · front row");
    expect(roleLine("bulwark")).toBe("Tank · front row · draws fire");
    expect(roleLine("sneak")).toBe("Assassin · leaps to their back row · slips notice");
  });
  test("a draw has a name and a tip", () => {
    expect(drawName(0)).toBeNull();
    expect(drawName(1)).toBe("Draws fire");
    expect(drawName(2)).toBe("Draws fire ×2");
    expect(drawName(-1)).toBe("Slips notice");
    expect(drawTip(1)).toBe("Enemies pick their target as if this figure stood one hex nearer.");
    expect(drawTip(2)).toBe("Enemies pick their target as if this figure stood two hexes nearer.");
    expect(drawTip(-1)).toBe("Enemies pick their target as if this figure stood one hex further.");
  });
  test("every figure is good with three different finished items", () => {
    for (const id of FIGURE_IDS) {
      const three = GOOD_WITH[id];
      expect(three.length).toBe(3);
      expect(new Set(three).size, id).toBe(3);
      for (const item of three) expect(isFinishedId(item) && FINISHED_IDS.includes(item), `${id}: ${item}`).toBe(true);
    }
  });
});
