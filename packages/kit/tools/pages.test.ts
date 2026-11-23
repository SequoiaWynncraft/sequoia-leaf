import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { ignoring, pageSources, repository } from "./pages.ts";

describe("reading .dockerignore as Docker does", () => {
  const out = ignoring(
    ["**/node_modules", ".git", "**/test", "**/*.test.ts", "*.md", "**/review", "!apps/x/review/keep.ts"].join("\n"),
  );
  test("a pattern leaves out a path, and everything in a folder it leaves out", () => {
    expect(
      ["node_modules/a/b.js", "apps/town/node_modules/x", ".git/HEAD", "apps/api/test/play.ts"].filter(out),
    ).toHaveLength(4);
    expect(["packages/raid/src/run.test.ts", "README.md", "apps/battler/review/handle.ts"].every(out)).toBe(true);
  });
  test("`*` stays within one folder, `**` crosses them, and `!` lets a path back in", () => {
    expect(out("apps/battler/README.md")).toBe(false);
    expect(out("packages/raid/src/run.ts")).toBe(false);
    expect(out("apps/x/review/keep.ts")).toBe(false);
    expect(out("apps/x/review/other.ts")).toBe(true);
  });
});

describe("the image's page stage", () => {
  test("is read from the Dockerfile's first stage: what it copies, and none of the second", () => {
    const sources = pageSources(readFileSync(join(repository, "Dockerfile"), "utf8"));
    expect(sources).toContain("apps/battler");
    expect(sources).toContain("packages/kit");
    expect(sources).not.toContain("apps/api");
  });
});

/** Every file under a folder, as paths from the repository's root. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules") return [];
    return statSync(path).isDirectory() ? files(path) : [relative(repository, path)];
  });
}
/** What a file imports, or a page loads: every specifier in it. */
const specifiers = (text: string): string[] =>
  [...text.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\bsrc=|\bhref=)["']([^"']+)["']/g)].flatMap((m) =>
    m[1] === undefined ? [] : [m[1]],
  );

test("what ships never imports from a review/ folder: no file of any app's or package's src, nor an app's page", () => {
  const roots = ["apps", "packages"].flatMap((top) =>
    readdirSync(join(repository, top)).map((name) => join(repository, top, name)),
  );
  const shipped: string[] = [];
  for (const dir of roots) {
    if (statSync(join(dir, "src"), { throwIfNoEntry: false })?.isDirectory()) shipped.push(...files(join(dir, "src")));
    if (statSync(join(dir, "index.html"), { throwIfNoEntry: false }))
      shipped.push(relative(repository, join(dir, "index.html")));
  }
  expect(shipped.length).toBeGreaterThan(100);
  const wrong = shipped.flatMap((path) =>
    /\.(ts|html|css)$/.test(path)
      ? specifiers(readFileSync(join(repository, path), "utf8"))
          .filter((spec) => /(^|\/)review\//.test(spec))
          .map((spec) => `${path}: ${spec}`)
      : [],
  );
  expect(wrong).toEqual([]);
});
