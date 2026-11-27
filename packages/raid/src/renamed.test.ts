import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import * as advice from "./content/advice.ts";
import * as banners from "./content/banners.ts";
import * as boons from "./content/boons.ts";
import * as catalog from "./content/catalog.ts";
import * as endless from "./content/endless.ts";
import * as figures from "./content/figures.ts";
import * as graid from "./content/graid.ts";
import { formText, TRUE_FORM_IDS } from "./content/graid.ts";
import * as items from "./content/items.ts";
import * as keepsakes from "./content/keepsakes.ts";
import * as looks from "./content/looks.ts";
import * as lore from "./content/lore.ts";
import * as members from "./content/members.ts";
import * as releases from "./content/releases.ts";
import { RELEASES } from "./content/releases.ts";
import * as rooms from "./content/rooms.ts";
import * as seqwawa from "./content/seqwawa.ts";
import * as traits from "./content/traits.ts";
import { topStep, TRAIT_IDS, traitShort, traitText } from "./content/traits.ts";
import * as wilds from "./content/wilds.ts";
import { readFight } from "./fought.ts";
import { decodeTable, encodeTable } from "./game.ts";
import { decodeSitting, encodeSitting } from "./sitting/keep.ts";

/**
 * Groot, renamed Graid (27 November 2026): in the guild Groot is the Nest of the Grootslangs only,
 * and a graid is any guild raid, which all five of Worm, Moth, Rock, Greg and Orphion are named
 * after. Nothing a player reads says Groot but the Groot Night banner, and what Leaf kept under the
 * old id reads as Graid and is written back so.
 */

/** "Groot" as a word of its own: not in Grootslang, and not the Groot Night banner, which is about the Nest. */
const SAYS_GROOT = /groot(?!slang)(?! night)/i;

/** A release's id is its own (`groot`, `groot-night`), never shown, and stays as it is. */
const RELEASE_IDS = new Set<string>(RELEASES.map((r) => r.id));

/** Every string in a value, however deep. */
function strings(v: unknown, seen = new Set<unknown>()): string[] {
  if (typeof v === "string") return [v];
  if (typeof v !== "object" || v === null || seen.has(v)) return [];
  seen.add(v);
  return Object.values(v).flatMap((x) => strings(x, seen));
}

const CONTENT = [
  advice,
  banners,
  boons,
  catalog,
  endless,
  figures,
  graid,
  items,
  keepsakes,
  looks,
  lore,
  members,
  releases,
  rooms,
  seqwawa,
  traits,
  wilds,
];

describe("Groot, renamed Graid", () => {
  test("no text a player reads says Groot, but the Groot Night banner", () => {
    const sentences = TRAIT_IDS.flatMap((id) =>
      Array.from({ length: topStep(id) }, (_, i) => [traitText(id, i + 1), traitShort(id, i + 1)]).flat(),
    );
    const said = [
      ...CONTENT.flatMap((m) => strings(m)),
      ...sentences,
      ...TRUE_FORM_IDS.map(formText),
      readFileSync(new URL("README.md", import.meta.url), "utf8"),
    ];
    expect(said.filter((s) => SAYS_GROOT.test(s) && !RELEASE_IDS.has(s))).toEqual([]);
    expect(traits.TRAITS.graid.name).toBe("Graid");
    expect(SAYS_GROOT.test("Groot Night") || SAYS_GROOT.test("Nest of the Grootslangs")).toBe(false);
    expect(SAYS_GROOT.test("Every Groot figure gets back up")).toBe(true);
  });

  test("the old id reads as the new, and anything else as it is", () => {
    expect(traits.renamedTrait("groot")).toBe("graid");
    expect([traits.renamedTrait("graid"), traits.renamedTrait("nope"), traits.renamedTrait(7)]).toEqual([
      "graid",
      "nope",
      7,
    ]);
    expect(traits.renamedTraits(["groot", "moss"])).toEqual(["graid", "moss"]);
    expect(traits.renamedTitle("brought Groot Sages")).toBe("brought Graid Sages");
    expect(traits.renamedTitle("their board at this room")).toBe("their board at this room");
  });
});

/** A row as the goldens keep it (`review/golden/stored`), as far as these tests change it. */
const stored = (name: string): string =>
  readFileSync(new URL(`../review/golden/stored/${name}`, import.meta.url), "utf8");
type KeptTable = { almanac: { topped: string[] }; run: { seen: { topped: string[] }; foe: { title: string } } };
type KeptSitting = { seats: { who: { figure?: string; habit?: string }; run: { seen: { topped: string[] } } }[] };
type KeptFight = { party: { traits: Record<string, number> } };

describe("what Leaf kept under the old id", () => {
  test.each([
    ["table-v5-main.json", "groot", "brought Groot Sages"],
    ["table-v6-main.json", "groot", "brought Groot Sages"],
    ["table-v6-main.json", "graid", "brought Graid Sages"],
  ])(
    "%s's almanac, run and sparring partner kept with %s read as Graid, and are written back so",
    (name, id, title) => {
      const raw: KeptTable = JSON.parse(stored(name));
      raw.almanac.topped = [id, "moss"];
      raw.run.seen.topped = [id];
      raw.run.foe.title = title;
      const table = decodeTable(JSON.stringify(raw));
      expect(table?.almanac.topped).toEqual(["graid", "moss"]);
      expect(table?.run?.seen.topped).toEqual(["graid"]);
      expect(table?.run?.foe.title).toBe("brought Graid Sages");
      const again = table ? encodeTable(table) : "";
      expect(again).not.toMatch(SAYS_GROOT);
      expect(decodeTable(again)).toEqual(table);
    },
  );

  test.each([
    ["sitting-v2-fight.json", "groot"],
    ["sitting-v3-fight.json", "groot"],
    ["sitting-v3-fight.json", "graid"],
  ])("%s's regular fond of %s, and its run, read as Graid, and are written back so", (name, id) => {
    const raw: KeptSitting = JSON.parse(stored(name));
    const seat = raw.seats.find((s) => s.who.figure === "rock");
    if (!seat) throw new Error("the Rock is not at the table");
    seat.who.habit = id;
    seat.run.seen.topped = [id];
    const sitting = decodeSitting(JSON.stringify(raw));
    const rock = sitting?.seats.find((s) => s.who.is === "regular" && s.who.figure === "rock");
    expect(rock?.who).toEqual({ is: "regular", figure: "rock", habit: "graid" });
    expect(rock?.run.seen.topped).toEqual(["graid"]);
    const again = sitting ? encodeSitting(sitting) : "";
    expect(again).not.toMatch(SAYS_GROOT);
    expect(decodeSitting(again)).toEqual(sitting);
  });

  test.each(["groot", "graid"])("a fight row with %s on reads as Graid", (id) => {
    const raw: KeptFight = JSON.parse(stored("fight-v1-main.json"));
    raw.party.traits = { [id]: 2, fang: 1 };
    const fight = readFight(raw);
    expect(fight?.party.traits).toEqual({ graid: 2, fang: 1 });
    expect(JSON.stringify(fight)).not.toMatch(SAYS_GROOT);
  });
});
