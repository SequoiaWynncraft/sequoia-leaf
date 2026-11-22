import { expect, test } from "bun:test";

import { Glob } from "bun";

/**
 * The site's text is set in a few named styles (`--f-head`, `--f-name`, `--f-ui`, `--f-small`,
 * `--f-read`, and `--f-typed` for a field, in `kit.css`). A rule that names a face, a size or a weight of its own, or sets words
 * in capitals, is how the pages came to disagree with each other, so none may.
 */
test("no rule sets its own face, size or weight: every text is one of the kit's styles", async () => {
  const root = `${import.meta.dir}/../../..`;
  const files = [
    ...new Glob("packages/*/src/**/*.css").scanSync(root),
    ...new Glob("apps/*/src/**/*.css").scanSync(root),
    ...new Glob("apps/*/index.html").scanSync(root),
    ...new Glob("packages/kit/demo/*.html").scanSync(root),
  ];
  expect(files.length).toBeGreaterThan(4);
  const texts = await Promise.all(files.map((file) => Bun.file(`${root}/${file}`).text()));
  const stray: string[] = [];
  for (const [i, file] of files.entries()) {
    const text = texts[i] ?? "";
    // The faces themselves, and the styles, are named once: in `@font-face` and on `:root`.
    const rules = text.replace(/@font-face\s*\{[^}]*\}/g, "").replace(/--[\w-]+\s*:[^;]*;/g, "");
    for (const [said] of rules.matchAll(
      /\b(?:font(?:-family|-size|-weight)?|text-transform|letter-spacing)\s*:[^;}]*/g,
    )) {
      const value = said.slice(said.indexOf(":") + 1).trim();
      const allowed =
        /^font\s*:/.test(said) && /^(?:inherit|var\(--f-(?:head|name|ui|small|read|typed)\))$/.test(value);
      // `<b>` among words that are read is the one weight a rule may set.
      if (!allowed && !(said.startsWith("font-weight") && value === "700" && file.endsWith("kit.css")))
        stray.push(`${file}: ${said.trim()}`);
    }
  }
  expect(stray).toEqual([]);
});
