import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const app = resolve(import.meta.dir, "..");

/** A page as markup only: no comments, its stylesheets as the files they are, and no script. */
function markup(file: string): string {
  const dir = join(app, file, "..");
  return readFileSync(join(app, file), "utf8")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[^>]*><\/script>/g, "")
    .replace(/href="([^"]+)"/g, (_, href: string) => `href="${resolve(dir, href)}"`)
    .replace(/\s+/g, " ")
    .trim();
}

test("the tours' page is the page that ships, with a script of its own", () => {
  expect(markup("review/index.html")).toBe(markup("index.html"));
  expect(readFileSync(join(app, "review/index.html"), "utf8")).toContain('src="./dev.ts"');
});
