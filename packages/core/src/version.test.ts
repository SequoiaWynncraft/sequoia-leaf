import { describe, expect, test } from "bun:test";

import { RULES_ENTRY, rulesVersion } from "./version.ts";

/** A repository of a few files: the raid's rules, the core they import, and a page that is not the rules'. */
function repository(changes: Record<string, string> = {}): (path: string) => string | null {
  const files: Record<string, string> = {
    [RULES_ENTRY.raid]:
      'import { run } from "./run.ts";\nimport type { Ctx } from "@sequoia-leaf/core";\nimport { RNG } from "node:crypto";\n',
    "packages/raid/src/run.ts": 'export { table } from "./content/table.ts";\nexport const run = 1;\n',
    "packages/raid/src/content/table.ts": "export const table = [1, 2, 3];\n",
    "packages/raid/src/page.ts": 'import { run } from "./run.ts";\n',
    "packages/core/package.json": JSON.stringify({ exports: { ".": "./src/index.ts" } }),
    "packages/core/src/index.ts": 'export * from "./play.ts";\n',
    "packages/core/src/play.ts": "export interface Ctx {}\n",
    ...changes,
  };
  return (path) => files[path] ?? null;
}

describe("the version of a game's rules", () => {
  test("is the same for the same files, whoever works it out", () => {
    expect(rulesVersion("raid", repository())).toBe(rulesVersion("raid", repository()));
    expect(rulesVersion("raid", repository())).toMatch(/^[0-9a-f]{14}$/);
  });

  test("changes with any file the rules import, through relative paths and the workspace's packages", () => {
    const before = rulesVersion("raid", repository());
    for (const path of ["packages/raid/src/content/table.ts", "packages/core/src/play.ts", RULES_ENTRY.raid]) {
      expect(rulesVersion("raid", repository({ [path]: "export const changed = true;\n" }))).not.toBe(before);
    }
  });

  test("does not change with a file the rules do not import", () => {
    const before = rulesVersion("raid", repository());
    expect(rulesVersion("raid", repository({ "packages/raid/src/page.ts": "// the page, drawn anew\n" }))).toBe(before);
  });
});
