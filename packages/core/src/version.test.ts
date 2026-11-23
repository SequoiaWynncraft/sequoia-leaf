import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { GAME_IDS, type GameId } from "./play.ts";
import { RULES_ENTRY, rulesModules, rulesVersion, rulesVersions } from "./version.ts";

/**
 * A repository of a few files: the raid's rules, which take names from core's index (one made in a
 * module of its own, one passed on from everything of another, one only a type), and pass on a name
 * of a page's; core's index, passing on names of modules the raid's rules do not use too.
 */
function repository(changes: Record<string, string> = {}): (path: string) => string | null {
  const files: Record<string, string> = {
    [RULES_ENTRY.raid.path]: [
      'import { draw, utcDay } from "@sequoia-leaf/core";',
      'import type { Ctx } from "@sequoia-leaf/core";',
      'import { run } from "./run.ts";',
      'export { readView } from "./wire.ts";',
      "export const RAID = { draw, utcDay, run };",
    ].join("\n"),
    "packages/raid/src/run.ts":
      'import { table } from "./content/table.ts";\nimport { RAID } from "./game.ts";\nexport const run = table;\n',
    "packages/raid/src/content/table.ts": "export const table = [1, 2, 3];\n",
    "packages/raid/src/wire.ts": "export const readView = (v: unknown) => v;\n",
    "packages/core/package.json": JSON.stringify({ exports: { ".": "./src/index.ts" } }),
    "packages/core/src/index.ts": [
      'export { draw } from "./rng.ts";',
      'export * from "./days.ts";',
      'export { encodeMove } from "./live.ts";',
      'export type { Ctx } from "./play.ts";',
    ].join("\n"),
    "packages/core/src/rng.ts": "export function draw(): number {\n  return 4;\n}\n",
    "packages/core/src/days.ts": "export const utcDay = (at: number) => Math.floor(at / 86_400_000);\n",
    "packages/core/src/live.ts": "export const encodeMove = () => new Uint8Array();\n",
    "packages/core/src/play.ts": "export interface Ctx {}\n",
    ...changes,
  };
  return (path) => files[path] ?? null;
}

const changed = "export const changed = true;\n";

describe("the version of a game's rules", () => {
  test("is the same for the same files, whoever works it out", () => {
    expect(rulesVersion("raid", repository())).toBe(rulesVersion("raid", repository()));
    expect(rulesVersion("raid", repository())).toMatch(/^[0-9a-f]{14}$/);
  });

  test("runs the modules that make the names the game's rules need, and what those import, however they are passed on", () => {
    expect([...rulesModules("raid", repository()).keys()].toSorted()).toEqual([
      "packages/core/src/days.ts",
      "packages/core/src/rng.ts",
      "packages/raid/src/content/table.ts",
      "packages/raid/src/game.ts",
      "packages/raid/src/run.ts",
    ]);
  });

  test.each([
    ["a module that makes a name the rules need", "packages/core/src/rng.ts"],
    ["one passing everything on (`export *`) is followed to", "packages/core/src/days.ts"],
    ["one of the game's own", "packages/raid/src/content/table.ts"],
    ["the game's module", RULES_ENTRY.raid.path],
  ])("changes with %s", (_what, path) => {
    expect(rulesVersion("raid", repository({ [path]: changed }))).not.toBe(rulesVersion("raid", repository()));
  });

  test.each([
    ["a module the rules use none of (the live wire)", "packages/core/src/live.ts"],
    ["a module the rules take only a type of", "packages/core/src/play.ts"],
    ["core's index, which only passes names on", "packages/core/src/index.ts"],
    ["a page's module the game's module passes on", "packages/raid/src/wire.ts"],
  ])("does not change with %s", (_what, path) => {
    const before = rulesVersion("raid", repository());
    const edited = (repository()(path) ?? "") + "\nexport const more = 1;\n";
    expect(rulesVersion("raid", repository({ [path]: edited }))).toBe(before);
  });
});

/** The repository as it is, from its root. */
const ROOT = join(import.meta.dir, "..", "..", "..");
const asItIs = (path: string): string | null => {
  try {
    return readFileSync(join(ROOT, path), "utf8");
  } catch {
    return null;
  }
};
/** The repository with one file changed: a line added to it. */
const withChange =
  (changedPath: string) =>
  (path: string): string | null => {
    const text = asItIs(path);
    return path === changedPath && text !== null ? `${text}\nexport const changedForTheTest = 1;\n` : text;
  };
/** The games whose version a change to a file changes. */
const moved = (path: string): GameId[] => {
  const before = rulesVersions(asItIs);
  const after = rulesVersions(withChange(path));
  return GAME_IDS.filter((game) => before[game] !== after[game]);
};

describe("the games' rules as they are", () => {
  test.each([
    ["the live wire", "packages/core/src/live.ts"],
    ["the quests", "packages/core/src/quests.ts"],
    ["the staff's report of who played", "packages/core/src/visits.ts"],
    ["the ledger", "packages/core/src/ledger.ts"],
    ["the purse's wire type", "packages/core/src/balances.ts"],
    ["the Tally", "packages/core/src/tally.ts"],
    ["core's index", "packages/core/src/index.ts"],
    ["the play service's types and routes", "packages/core/src/play.ts"],
  ])("are as they were whatever the change to %s", (_what, path) => {
    expect(asItIs(path)).not.toBeNull();
    expect(moved(path)).toEqual([]);
  });

  test.each<[string, string, GameId[]]>([
    ["the Works' codec", "packages/factory/src/codec.ts", ["works"]],
    ["the raid's run", "packages/raid/src/run.ts", ["raid"]],
    ["the pulls' rules", "packages/pulls/src/game.ts", ["pulls"]],
    ["the town's camp", "packages/town/src/camp.ts", ["town"]],
    ["the Coins' limits, which only the town's daily chest uses", "packages/core/src/coins.ts", ["town"]],
    ["Leaf's dice, which the raid, the town and the pulls draw", "packages/core/src/rng.ts", ["raid", "town", "pulls"]],
  ])("change with %s: only the versions of the games that run it", (_what, path, games) => {
    expect(asItIs(path)).not.toBeNull();
    expect(moved(path)).toEqual(games);
  });
});
