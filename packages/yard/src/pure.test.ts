import { describe, expect, test } from "bun:test";

/** What the rules may not reach for themselves: the clock, chance and the browser's storage. */
const IMPURE = /\b(Date\.now|performance\.now|Math\.random|localStorage|sessionStorage|indexedDB)\b|\bnew Date\(\)/;
const SRC = new URL(".", import.meta.url).pathname;

describe("the rules keep to themselves", () => {
  test("no source but the tests reads the clock, draws chance or touches storage", async () => {
    for (const bad of ["Date.now()", "performance.now()", "Math.random()", "localStorage", "indexedDB", "new Date()"])
      expect(IMPURE.test(bad)).toBe(true);
    const files = [...new Bun.Glob("**/*.ts").scanSync({ cwd: SRC })].filter((file) => !file.endsWith(".test.ts"));
    expect(files).toContain("power.ts");
    const texts = await Promise.all(files.map((file) => Bun.file(`${SRC}${file}`).text()));
    expect(files.filter((_, i) => IMPURE.test(texts[i] ?? ""))).toEqual([]);
  });
});
