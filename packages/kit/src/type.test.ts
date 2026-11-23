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

/**
 * Gold is for dark panels. On paper (a letter, a note, what a character says) it cannot be read, so
 * one rule in `kit.css` writes those things in ink there. A style that writes in gold and is not
 * named in that rule would be pale yellow on cream the first time it is put on a letter, as a
 * thing's count was. A card and a chip are dark themselves wherever they stand.
 */
test("nothing written on paper is in the gold of a dark panel", async () => {
  const css = (await Bun.file(`${import.meta.dir}/kit.css`).text()).replace(/\/\*[\s\S]*?\*\//g, "");
  const inked = /:is\(\.k-paper, \.k-say\) :is\(([^)]*)\):not\(\.k-chip \*, \.k-btn \*\)\s*\{\s*color: #96560a/
    .exec(css)?.[1]
    ?.split(",")
    .map((one) => one.trim());
  expect(inked?.length ?? 0).toBeGreaterThan(0);
  const stray: string[] = [];
  for (const [, selectors = "", body = ""] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(?:^|[;\s])color:\s*var\(--k-gold(?:-lt)?\)/.test(body)) continue;
    for (const one of selectors.split(",").map((part) => part.trim()))
      if (!/^\.k-(?:info|chip)\b/.test(one) && !inked?.includes(one)) stray.push(one);
  }
  expect(stray).toEqual([]);
});
