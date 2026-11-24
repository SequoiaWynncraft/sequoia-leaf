import { expect, test } from "bun:test";

import { Glob } from "bun";

/**
 * A button showing only a picture says nothing to a screen reader unless it is named. In the kit
 * such a button is made by `iconButton`, which cannot make one without a name; on the demo page each
 * has its `aria-label`.
 */
test("every button in the kit that shows only a picture is made with a name", async () => {
  const dir = import.meta.dir;
  const files = [...new Glob("*.ts").scanSync(dir)].filter((f) => !f.endsWith(".test.ts"));
  expect(files.length).toBeGreaterThan(10);
  const texts = await Promise.all(files.map((file) => Bun.file(`${dir}/${file}`).text()));
  const stray: string[] = [];
  for (const [i, text] of texts.entries())
    for (const made of text.matchAll(/el\(\s*"button",\s*[`"][^`"]*\bicon\b[^`"]*[`"]/g))
      if (!text.slice(made.index, made.index + 240).includes('"aria-label"')) stray.push(`${files[i]}: ${made[0]}`);
  const demo = await Bun.file(`${dir}/../demo/index.html`).text();
  for (const [button] of demo.matchAll(/<button\b[^>]*>/g))
    if (/class="[^"]*\b(icon|k-slot)\b/.test(button) && !/aria-label="[^"]+"/.test(button))
      stray.push(`demo: ${button}`);
  expect(stray).toEqual([]);
});
