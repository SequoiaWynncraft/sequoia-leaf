/**
 * The page ships only what is in `src/`: nothing there reaches the review pages (`review/`) or the
 * tests' stand-ins (`test/`), not even by a dynamic import, which the image's build would leave out.
 */
import { expect, test } from "bun:test";

import { Glob } from "bun";

test("nothing the page ships imports from review/ or test/", async () => {
  const reaching: string[] = [];
  for await (const file of new Glob("**/*.ts").scan({ cwd: import.meta.dir })) {
    if (file.endsWith(".test.ts")) continue;
    const text = await Bun.file(`${import.meta.dir}/${file}`).text();
    for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g))
      if (/(^|\/)(review|test)\//.test(m[1] ?? "") && (m[1] ?? "").startsWith(".")) reaching.push(`${file}: ${m[1]}`);
  }
  expect(reaching).toEqual([]);
});
