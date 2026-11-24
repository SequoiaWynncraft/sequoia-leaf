import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
