/**
 * Every button that is only a picture has a name, for whoever cannot see the picture: each is made
 * by `iconButton`, which cannot make one without. This holds the page's source to that: no button of
 * the kit's icon look is made any other way.
 */
import { expect, test } from "bun:test";
import { readdir } from "node:fs/promises";

const ROOT = new URL("../../", import.meta.url).pathname;

test("a button that is only a picture is made by `iconButton`, and so has a name", async () => {
  const files = (
    await Promise.all(
      ["src", "src/ui", "review"].map(async (dir) =>
        (await readdir(`${ROOT}${dir}`))
          .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
          .map((f) => `${dir}/${f}`),
      ),
    )
  ).flat();
  const made = await Promise.all(files.map(async (file) => ({ file, text: await Bun.file(`${ROOT}${file}`).text() })));
  // The kit's icon look named in a button's classes anywhere but in `iconButton` itself.
  const byHand = /(?:\bbutton\(\s*`?["'`][^"'`]*\bicon\b|el\(\s*["'`]button["'`],\s*["'`][^"'`]*\bicon\b)/;
  expect(made.filter(({ file, text }) => file !== "src/ui/parts.ts" && byHand.test(text)).map((m) => m.file)).toEqual(
    [],
  );
  expect(made.filter(({ text }) => /\biconButton\(/.test(text)).length).toBeGreaterThan(4);
});
