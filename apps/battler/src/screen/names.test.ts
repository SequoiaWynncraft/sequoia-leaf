import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { abilityText, refusalText, TRAIT_IDS } from "@sequoia-leaf/raid";
import { catalogAt, everyShared } from "@sequoia-leaf/raid/content/catalog.ts";
import { BOSS_IDS, specOf, SUMMON_IDS } from "@sequoia-leaf/raid/content/figures.ts";
import { TRUE_FORM_IDS, TRUE_FORMS } from "@sequoia-leaf/raid/content/graid.ts";
import { LORE } from "@sequoia-leaf/raid/content/lore.ts";
import { LAST_ERA, RELEASES } from "@sequoia-leaf/raid/content/releases.ts";
import { HANDLES, nowCalled, regularOf } from "@sequoia-leaf/raid/content/rooms.ts";
import { CAT } from "@sequoia-leaf/raid/testkit.ts";

import { acrossName } from "./logic.ts";
import { fedLine, sortWord } from "./ui/words.ts";

/** The names list (`RAID-NAMES.md`, section 1), for everyone in the game today, the crabs by their numbers. Ids never change. */
const NAMES: Readonly<Record<string, string>> = {
  emberkit: "Flint",
  mossmote: "Velvet",
  moth: "Moth",
  worm: "Worm",
  finch: "Twig",
  crab7: "Crab #7",
  barrowgnome: "Hodge",
  kettle: "Brew",
  slug: "Mosey",
  glorp: "Glorp",
  chickaree: "Chuck",
  jay: "Huff",
  crab12: "Crab #12",
  lanterngnome: "Wick",
  leafling: "Bud",
  cindernewt: "Toast",
  drizzlefrog: "Drizzle",
  rock: "Rock",
  bushgnome: "Shrub",
  crab23: "Crab #23",
  badger: "Grudge",
  fogowl: "Eaves",
  heron: "Reed",
  crab40: "Crab #40",
  apothecary: "Dose",
  greg: "Greg",
  whitefox: "Orphion",
  hearthcat: "Vesta",
  seqwawa: "Seqwawa",
  // Groot Night's (RAID-BANNERS.md, section 1); the crabs by their numbers.
  peep: "Peep",
  crab31: "Crab #31",
  munch: "Munch",
  clutch: "Clutch",
  crab8: "Crab #8",
  // Penguin Month's (RAID-BANNERS.md, section 2).
  dibs: "Dibs",
  jet: "Jet",
  larp: "Larp",
  flurry: "Flurry",
  pomp: "Pomp",
  yule: "Yule",
  // Up The Tree's (RAID-BANNERS.md, section 3).
  vi: "Vi",
  flop: "Flop",
  bhlue: "Bhlue",
  ace: "Ace",
  unc: "Unc",
  leetanns: "Leetanns",
  hatchling: "Hatchling",
  grooter1: "Grooter",
  grooter2: "Grooter",
  grooter3: "Grooter",
  grooter4: "Grooter",
  glorplet: "Glorplet",
  uncounted: "Crab #??",
  biguncounted: "Big Crab #??",
  sprout: "Runner",
  oldbramble: "Snag",
  hoardmagpie: "Swipe",
  bigcrab: "The Crab Nobody Counted",
};

/** The catalogue with every release open: everyone in the game, today's and those staged for a release. */
const EVERY = catalogAt(LAST_ERA);

/** What they were called before, none of which a player reads any more. */
const OLD = [
  "Emberkit",
  "Mossmote",
  "Twig Finch",
  "Barrow Gnome",
  "Kettle",
  "Chickaree",
  "Dusk Jay",
  "Lantern Gnome",
  "Leafling",
  "Cinder Newt",
  "Drizzle Frog",
  "Gnome In A Bush",
  "Badger",
  "Fog Owl",
  "Reed Heron",
  "Apothecary Gnome",
  "Hearth Cat",
  "Whole Worm",
  "Wings Open",
  "The Rock, Standing",
  "Greg, Unnamed",
  "Orphion, Alight",
  "Bramble Runner",
  "Old Bramble",
  "Magpie With The Hoard",
  "Hold The Line",
  // The crabs' names of release 1's first days: they have their numbers back.
  "Nipper",
  "Fuss",
  "Barge",
  "Miscount",
];

const ROOT = join(import.meta.dir, "..", "..", "..", "..");
/** Every file under a folder that the page's words come from: its code, not its tests. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesUnder(path);
    return /\.(ts|html|txt|css)$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
  });
}
/** Where what a player reads is written: the page, the rules' words, the town's things. */
const PAGE_TEXT = [
  ...filesUnder(join(ROOT, "apps/battler/src")),
  join(ROOT, "apps/battler/index.html"),
  ...filesUnder(join(ROOT, "packages/raid/src/content")),
  join(ROOT, "packages/raid/src/run.ts"),
  join(ROOT, "packages/town/src/things.ts"),
];
/** A file's text, without the one table that reads old names in stored runs (`RENAMED` in `rooms.ts`). */
const textOf = (path: string): string => readFileSync(path, "utf8").replace(/const RENAMED[\s\S]*?\n\};/, "");

/** The strings in a file of code, comments left out, a template's `${...}` parts left out of it. */
function stringsIn(code: string): string[] {
  const out: string[] = [];
  let i = 0;
  const next = (): string => code[i++] ?? "";
  while (i < code.length) {
    const ch = next();
    if (ch === "/" && code[i] === "/") i = code.indexOf("\n", i) < 0 ? code.length : code.indexOf("\n", i);
    else if (ch === "/" && code[i] === "*") i = code.indexOf("*/", i) < 0 ? code.length : code.indexOf("*/", i) + 2;
    else if (ch === '"' || ch === "'" || ch === "`") {
      let s = "";
      let depth = 0;
      for (let c = next(); i <= code.length && (c !== ch || depth > 0); c = next()) {
        if (c === "\\") next();
        else if (ch === "`" && c === "$" && code[i] === "{") depth++;
        else if (depth > 0 && c === "}") depth--;
        else if (depth === 0 && c !== "\n") s += c;
        if (c === "\n" && ch !== "`") break;
      }
      out.push(s);
    }
  }
  return out;
}

describe("the names", () => {
  test("every figure, summon and boss in the game today has its name from the list, ids unchanged", () => {
    const ids = [...everyShared(), ...SUMMON_IDS, ...BOSS_IDS];
    expect(ids.filter((id) => NAMES[id] === undefined)).toEqual([]);
    expect(ids.filter((id) => specOf(EVERY, id).name !== NAMES[id])).toEqual([]);
  });

  test("each true form is Real and its figure's name, and two abilities are renamed", () => {
    expect(TRUE_FORM_IDS.map((id) => TRUE_FORMS[id].name)).toEqual([
      "Real Worm",
      "Real Moth",
      "Real Rock",
      "Real Greg",
      "Real Orphion",
    ]);
    expect([specOf(CAT, "jay").ability?.name, specOf(CAT, "crab40").ability?.name]).toEqual([
      "That Does It",
      "In The Way",
    ]);
  });

  test("the regulars sign with the new names, no article, and parties stored under the old ones still read", () => {
    expect(HANDLES).toEqual(["Greg", "Vesta", "Hodge", "Crab #7", "Orphion", "Moth"]);
    expect(regularOf({ who: "the Hearth Cat" })?.kind).toBe("hearthcat");
    expect(regularOf({ who: "Crab #7" })?.kind).toBe("crab7");
    expect(acrossName({ who: "a Barrow Gnome" })).toBe("Hodge");
    expect(nowCalled("The Crab Nobody Counted")).toBe("The Crab Nobody Counted");
    // A member who happens to be called by an old name is still a member.
    expect(regularOf({ who: "the Hearth Cat", by: "10000000-0000-0000-0000-000000000002" })).toBeNull();
  });

  test("the crabs go by their numbers, and what was stored under their release 1 names reads as the numbers", () => {
    const crabs = ["crab7", "crab12", "crab23", "crab40", "uncounted", "biguncounted", "bigcrab"] as const;
    const numbers = [
      "Crab #7",
      "Crab #12",
      "Crab #23",
      "Crab #40",
      "Crab #??",
      "Big Crab #??",
      "The Crab Nobody Counted",
    ];
    expect(crabs.map((id) => specOf(CAT, id).name)).toEqual(numbers);
    // Stored since release 1: a regular's signature, a sitting's crab across the table, a boss's title.
    const stored = ["Nipper", "Skip", "Fuss", "Barge", "Miscount", "Big Miscount", "Zero"];
    expect(stored.map(nowCalled)).toEqual(numbers);
    expect(regularOf({ who: "Nipper" })?.kind).toBe("crab7");
    expect(acrossName({ who: "Nipper" })).toBe("Crab #7");
    expect(acrossName({ who: "Skip" })).toBe("Crab #12");
    // Stored before it: as they are.
    expect(numbers.map(nowCalled)).toEqual(numbers);
    // A member called Skip is still Skip.
    expect(acrossName({ who: "Skip", by: "10000000-0000-0000-0000-000000000002" })).toBe("Skip");
  });

  test("a crab's number is the tag on its shell, said in its lore line", () => {
    expect([LORE.crab7, LORE.crab12, LORE.crab23, LORE.crab40].map((line) => /tag says \d+/.test(line ?? ""))).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  test("no old name is left in what a player reads", () => {
    const left = PAGE_TEXT.flatMap((path) => {
      const text = textOf(path);
      return OLD.filter((old) => new RegExp(`\\b${old.replace(/[#,]/g, (c) => `\\${c}`)}`).test(text)).map(
        (old) => `${path.slice(ROOT.length + 1)}: ${old}`,
      );
    });
    expect(left).toEqual([]);
    expect(everyShared().filter((id) => OLD.some((old) => abilityText(EVERY, id, 1).includes(old)))).toEqual([]);
  });
});

describe("the words", () => {
  test("the page says origin and class, never kin or calling", () => {
    // A sentence in the page's code (a string with a space in it) that says kin or calling.
    const stale = PAGE_TEXT.flatMap((path) =>
      stringsIn(textOf(path))
        .filter((s) => s.includes(" ") && /\b(kins?|callings?)\b/i.test(s))
        .map((s) => `${path.slice(ROOT.length + 1)}: ${s}`),
    );
    expect(stale).toEqual([]);
    expect(TRAIT_IDS.map(sortWord).filter((w) => !["Origin", "Class", "Its own"].includes(w))).toEqual([]);
    expect([sortWord("graid"), sortWord("bulwark"), sortWord("rooted")]).toEqual(["Origin", "Class", "Its own"]);
    expect(refusalText("already_kin")).toBe("It is of that origin already.");
  });

  test("the five named after the guild's raids are Graid: the page says Groot only for the Groot Night banner", () => {
    // Groot is the Nest of the Grootslangs, and a grooter one who raids it; a graid is any guild raid. Old names kept in `RENAMED`, and
    // the releases' own ids (`groot`, `groot-night`, never shown) and the files of their patches, are let be.
    const groot = [...PAGE_TEXT, ...filesUnder(join(ROOT, "packages/figures/src"))].flatMap((path) =>
      stringsIn(textOf(path))
        .filter(
          (s) =>
            /groot(?!slang)(?! night)(?!er)/i.test(s) &&
            !RELEASES.some((r) => [r.id, `./releases/${r.id}.ts`].includes(s)),
        )
        .map((s) => `${path.slice(ROOT.length + 1)}: ${s}`),
    );
    expect(groot).toEqual([]);
    expect(TRUE_FORM_IDS.map((id) => TRUE_FORMS[id].name)).toEqual([
      "Real Worm",
      "Real Moth",
      "Real Rock",
      "Real Greg",
      "Real Orphion",
    ]);
  });

  test("Greg's card says what he has gained, and the most", () => {
    expect(fedLine(CAT, 18)).toBe("Fed: +18% health (40% at most)");
  });
});
