/**
 * The hooks (`hooks.ts`, `effects.ts`): the engine and its verbs name nothing they call, `struck`
 * blocks an enemy's ability and changes nothing else, and the two moments whose order is not the
 * plain one keep the fight's.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { BOON_IDS } from "../content/boons.ts";
import { everyFigure } from "../content/catalog.ts";
import { SUMMON_IDS, TROUBLE_IDS, type UnitKind } from "../content/figures.ts";
import { ITEM_IDS } from "../content/items.ts";
import { LEGACY_ERA } from "../content/releases.ts";
import { TRAIT_IDS } from "../content/traits.ts";
import { cellAt } from "../hex.ts";
import { at, CAT, EVERYONES, onCell, partyOfFigures, ready, stepUntil, still, unitOf } from "../testkit.ts";
import { hurt } from "./core.ts";
import { HOOKS } from "./effects.ts";
import { openFight, stepFight } from "./engine.ts";
import { type Hooks, ORDER, type Tables } from "./hooks.ts";
import type { Fight, FightEvent, FightSetup } from "./types.ts";

/** Every id of a trait, an item, a boon or anyone who can stand on the board. */
const IDS: ReadonlySet<string> = new Set([
  ...TRAIT_IDS,
  ...ITEM_IDS,
  ...BOON_IDS,
  ...everyFigure(),
  ...SUMMON_IDS,
  ...TROUBLE_IDS,
]);
/**
 * The ids a source names: as a string, the way code picks one thing out; as a key of a table; or as
 * a trait's step read by name (`traits[side].crab`). Comments are not code. A number on a figure
 * that is called after what sets it (`Unit.ember`, `rooted`) is not a name.
 */
function named(file: string): string[] {
  const code = readFileSync(new URL(file, import.meta.url), "utf8")
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll(/\/\/.*$/gm, "");
  const quoted = [...code.matchAll(/(["'`])([\w-]+)\1/g)].map((m) => m[2] ?? "");
  const keys = [...code.matchAll(/(?:^\s*|\{\s*)(\w+): /gm)].map((m) => m[1] ?? "");
  const stepped = [...code.matchAll(/traits\[[^\]]*\]\??\.(\w+)/g)].map((m) => m[1] ?? "");
  return [...quoted, ...keys, ...stepped].filter((id) => IDS.has(id));
}

describe("the engine and the verbs", () => {
  test("name no trait, item, boon or figure", () => {
    expect(named("./engine.ts")).toEqual([]);
    expect(named("./core.ts")).toEqual([]);
  });
  test("the check finds a name where there is one", () => {
    expect(named("./effects.ts")).toContain("secondwind");
    expect(named("./effects.ts")).toContain("magpie");
  });
});

/** The fight's own hooks, with a `struck` on every figure of these kinds besides what each has. */
const struckOn = (kinds: readonly UnitKind[], struck: NonNullable<Hooks["struck"]>): Tables => ({
  ...HOOKS,
  kinds: { ...HOOKS.kinds, ...Object.fromEntries(kinds.map((kind) => [kind, { ...HOOKS.kinds[kind], struck }])) },
});
const isSting = (e: FightEvent): boolean => e.t === "hit" && e.source === "ability";
const isCast = (e: FightEvent): boolean => e.t === "cast";
/** Everything a fight set up so does, played to its end with these hooks. */
function played(setup: FightSetup, tables: Tables): FightEvent[] {
  const f = openFight(setup, CAT, tables);
  const out = [...f.opening];
  while (!f.over) out.push(...stepFight(f));
  return out;
}
/** Thirty fights of everyone's figures, four a side, holding nothing. */
const SETUPS: readonly FightSetup[] = Array.from({ length: 30 }, (_, n) => {
  const side = (k: number) =>
    partyOfFigures(
      [0, 1, 2, 3].map((i) => at(EVERYONES[(n * 7 + k * 13 + i * 5) % EVERYONES.length] ?? "rock", 1 + i, i % 2)),
    );
  return { seed: 1000 + n, era: LEGACY_ERA, sides: [side(0), side(1)] };
});

describe("struck", () => {
  test("a hook that never blocks changes nothing, and is asked of every enemy ability that lands", () => {
    let asked = 0;
    const never = struckOn(EVERYONES, () => {
      asked++;
      return false;
    });
    for (const setup of SETUPS) expect(played(setup, never)).toEqual(played(setup, HOOKS));
    expect(asked).toBeGreaterThan(100);
  });

  const HOME = cellAt(3, 4);
  const NEAR = cellAt(3, 3);
  const SETUP: FightSetup = {
    seed: 3,
    era: LEGACY_ERA,
    sides: [partyOfFigures([onCell("rock", 0, HOME)]), partyOfFigures([onCell("wasp", 1, NEAR)])],
  };
  /** A Rock that does nothing, and a Wasp across from it with its Sting ready. */
  function scene(tables: Tables): Fight {
    const f = openFight(SETUP, CAT, tables);
    still(unitOf(f, "rock"));
    ready(unitOf(f, "wasp", 1));
    return f;
  }

  test("a hook can block an enemy's ability: nothing of it lands, and nothing else changes", () => {
    let asked = 0;
    const once = struckOn(["rock"], () => ++asked === 1);
    const [plain, blocked] = [scene(HOOKS), scene(once)];
    const [was, now] = [stepUntil(plain, isCast), stepUntil(blocked, isCast)];
    const sting = was.find(isSting);
    expect(sting).toBeDefined();
    expect(now).toEqual(was.filter((e) => e !== sting));
    expect(unitOf(blocked, "rock").hp).toBe(100_000);
    // Its attacks are never asked; the next Sting is not blocked.
    expect(stepUntil(blocked, (e) => e.t === "hit" && e.source === "attack").some(isSting)).toBe(false);
    expect(asked).toBe(1);
    ready(unitOf(blocked, "wasp", 1));
    expect(stepUntil(blocked, isCast).some(isSting)).toBe(true);
    expect(asked).toBe(2);
  });
});

describe("the order a moment asks in", () => {
  test("is the plain one, but for a fall, for sitting down, and for a blow an ability armed against", () => {
    const plain = ["trait", "item", "boon", "kind"];
    const differ = Object.entries(ORDER).filter(([, order]) => order.join() !== plain.join());
    expect(Object.fromEntries(differ)).toEqual({
      // What an ability armed (a Firewall) is asked last.
      struck: ["trait", "item", "boon", "kind", "ability"],
      seated: ["kind", "trait", "item", "boon"],
      falls: ["boon", "trait", "item", "kind"],
    });
  });
  test("Second Wind takes a fall before Graid, which still has its getting back up to come", () => {
    const f = openFight(
      {
        seed: 5,
        era: LEGACY_ERA,
        sides: [
          partyOfFigures([at("moth", 2, 3), at("worm", 4, 3)], { boons: ["secondwind"] }),
          partyOfFigures([at("rock", 3, 3)]),
        ],
      },
      CAT,
    );
    const moth = unitOf(f, "moth");
    f.out = [];
    hurt(f, moth, moth.hp + 10_000, "true", "dusk", null);
    expect(f.out.filter((e) => e.t === "rise" || e.t === "fall")).toMatchObject([{ t: "rise", why: "wind" }]);
    expect(moth.rises).toBe(true);
    f.out = [];
    hurt(f, moth, moth.hp + 10_000, "true", "dusk", null);
    expect(f.out.filter((e) => e.t === "rise" || e.t === "fall")).toMatchObject([
      { t: "fall", back: expect.any(Number) },
    ]);
  });
  test("the crabs' shells go up before roll call", () => {
    const f = openFight(
      {
        seed: 9,
        era: LEGACY_ERA,
        sides: [partyOfFigures([at("crab7", 2, 0), at("crab12", 4, 0)]), partyOfFigures([at("crab", 3, 0)])],
      },
      CAT,
    );
    const shell = f.opening.findIndex((e) => e.t === "shield" && e.id === unitOf(f, "crab", 1).id);
    const roll = f.opening.findIndex((e) => e.t === "summon");
    expect(shell).toBeGreaterThanOrEqual(0);
    expect(roll).toBeGreaterThan(shell);
  });
});
