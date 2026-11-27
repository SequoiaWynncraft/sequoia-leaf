/**
 * Every read uses the catalogue of the thing it is about, never the newest: a run's its run's era, a
 * fight's its setup's, a banner's pool its opening era's, a price the era Leaf is in, a report row its
 * own. What a catalogue does not have is simply not there: no global list of ids is walked to draw,
 * count or show, and nothing throws on an id a catalogue lacks. The base's era is never a player's
 * (the base and the expansion's first open together), so it stands here for any older era.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { openFight } from "../fight/engine.ts";
import { type Party, traitSteps } from "../party.ts";
import { compOf } from "../rates.ts";
import { boonOptions, startRun } from "../run.ts";
import { sparParty } from "../spar.ts";
import { at, partyOfFigures } from "../testkit.ts";
import type { BoonId, BoonSpec } from "./boons.ts";
import { available, type Catalog, catalogAt, catalogsOf, rarityIn } from "./catalog.ts";
import { traitsOf } from "./figures.ts";
import { type Era, eraOf, LEGACY_ERA } from "./releases.ts";
import { BASE } from "./releases/base.ts";
import { GROOT } from "./releases/groot.ts";
import { stepFor, topStep, traitNumber } from "./traits.ts";

const BASE_ERA = eraOf("base");
const PENGUINS = eraOf("penguin-month");
/** The catalogue of an era in a made-up spread of releases. */
const of = (eras: readonly Catalog[], era: Era): Catalog => {
  const cat = eras[era - 1];
  if (!cat) throw new Error(`no era ${era}`);
  return cat;
};

describe("a run's things read its run's era", () => {
  test("a boon staged for a later release is not offered before it, and offering does not trip on it", () => {
    // Small Fry made up as Penguin Month's: the base brings every other boon.
    const boons: Partial<Record<BoonId, BoonSpec>> = { ...BASE.boons?.add };
    const fry = boons.smallfry;
    if (!fry) throw new Error("no Small Fry in the base");
    delete boons.smallfry;
    const eras = catalogsOf([
      { ...BASE, boons: { add: boons } },
      GROOT,
      { release: "penguin-month", boons: { add: { smallfry: fry } } },
    ]);
    const offered = (era: Era): BoonId[] =>
      Array.from({ length: 60 }, (_, seed) =>
        boonOptions(startRun(seed + 1, { era: LEGACY_ERA }), [], of(eras, era)),
      ).flat();
    expect(offered(LEGACY_ERA)).not.toContain("smallfry");
    expect(offered(PENGUINS)).toContain("smallfry");
  });

  test("a sparring room of an older era brings a regular of that era: no taste, figure or title from a later one", () => {
    const base = catalogAt(BASE_ERA);
    for (let seed = 1; seed <= 200; seed++) {
      const party = sparParty(base, seed, 4, 0);
      expect(party.title).not.toContain("Graid");
      expect(party.figures.every((p) => p.kind in base.figures)).toBe(true);
    }
  });
});

describe("a fight's things read its setup's era", () => {
  const party: Party = partyOfFigures([at("moth", 2, 3), at("worm", 3, 0), at("rock", 4, 0)]);
  test("a fight kept from an older era counts its party as that era did", () => {
    const old = openFight({ seed: 1, era: BASE_ERA, sides: [party, partyOfFigures([at("mud", 3, 0)])] });
    expect([old.cat.era, old.traits[0].graid, traitSteps(old.cat, party).graid]).toEqual([
      BASE_ERA,
      undefined,
      undefined,
    ]);
    const now = openFight({ seed: 1, era: LEGACY_ERA, sides: [party, partyOfFigures([at("mud", 3, 0)])] });
    expect([now.traits[0].graid, traitSteps(now.cat, party).graid]).toEqual([2, 2]);
  });
});

describe("a pool's things read its own era", () => {
  test("an open banner pays at the odds it opened with, though a later release changes a figure's rarity", () => {
    // Greg made up as a Druid from Penguin Month; the first banner opened with the base.
    const eras = catalogsOf([
      BASE,
      GROOT,
      { release: "penguin-month", figures: { change: { greg: { prize: "Druid" } } } },
    ]);
    const later = of(eras, PENGUINS);
    expect(available(later, { for: "pull", pool: "banner-1", rarity: "Treant" })).toContain("greg");
    expect(available(later, { for: "pull", pool: "banner-1", rarity: "Druid" })).not.toContain("greg");
    // The grove is the era's own: there Greg is a Druid now.
    expect(available(later, { for: "pull", pool: "grove", rarity: "Druid" })).toContain("greg");
  });

  test("a price reads the era it is paid in: a rarity staged for a later release is not charged before it", () => {
    const eras = catalogsOf([
      BASE,
      GROOT,
      { release: "penguin-month", figures: { change: { heron: { prize: "Druid" } } } },
    ]);
    expect(rarityIn(of(eras, eraOf("groot-night")), "figure:heron")).toBe("Dryad");
    expect(rarityIn(of(eras, PENGUINS), "figure:heron")).toBe("Druid");
    expect([rarityIn(catalogAt(BASE_ERA), "figure:seqwawa"), rarityIn(catalogAt(BASE_ERA), "look:plum")]).toEqual([
      undefined,
      undefined,
    ]);
  });
});

describe("a report row reads its own era", () => {
  test("a comp is named by the counts its fight's era had: two Moss figures were Moss 4's first step in the base", () => {
    expect(compOf(catalogAt(BASE_ERA), { moss: 1, graid: 2 })).toBe("Moss 2");
    expect(compOf(catalogAt(LEGACY_ERA), { moss: 2, graid: 2 })).toBe("Graid 3 + Moss 3");
  });
});

describe("what a catalogue does not have is not there", () => {
  test("a trait it lacks has no step and no numbers; nothing throws", () => {
    const base = catalogAt(BASE_ERA);
    expect([stepFor(base, "graid", 5), topStep(base, "graid"), traitNumber(base, "graid", "health", 1)]).toEqual([
      0, 0, 0,
    ]);
    expect(base.ids.traits).not.toContain("graid");
    expect(traitsOf(base, "moth")).not.toContain("graid");
  });
});

// ---------- no list of ids is walked but a catalogue's ----------

/** The repository's own TypeScript files under some folders, skipping what is installed and tests. */
function sources(dir: string, from: string): string[] {
  return readdirSync(join(from, dir)).flatMap((name) => {
    if (name === "node_modules" || name.startsWith(".")) return [];
    const path = join(dir, name);
    if (statSync(join(from, path)).isDirectory()) return sources(path, from);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : [];
  });
}

test("no global list of trait, item or boon ids is walked to draw, count or show: only the catalogue's (`ids`)", () => {
  const root = join(import.meta.dir, "../../../..");
  const LISTS = "TRAIT_IDS|BOON_IDS|KINS|CALLINGS|OWN_TRAITS|COMPONENT_IDS|FINISHED_IDS|EMBLEM_IDS|ITEM_IDS";
  const walked = new RegExp(
    `(\\bof|\\.\\.\\.)\\s*(${LISTS})\\b|\\b(${LISTS})\\.(filter|map|flatMap|forEach|find|reduce)\\(|\\b(pick|shuffled)\\([^)]*\\b(${LISTS})\\b`,
  );
  const dirs = [
    "packages/raid/src",
    "packages/pulls/src",
    "packages/town/src",
    "packages/figures/src",
    "apps/battler/src",
    "apps/town/src",
    "apps/api/src",
    "apps/api/scripts",
  ];
  const found = dirs
    .flatMap((dir) => sources(dir, root))
    // The content's own files make the lists and the catalogues from them.
    .filter((path) => !path.startsWith(join("packages", "raid", "src", "content")))
    .flatMap((path) =>
      readFileSync(join(root, path), "utf8")
        .split("\n")
        .flatMap((line, i) => (walked.test(line) ? [`${path}:${i + 1}: ${line.trim()}`] : [])),
    );
  expect(found).toEqual([]);
});
