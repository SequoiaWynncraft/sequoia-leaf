/**
 * A goal's head and its lists are laid out in one place (`goal.ts`, and one marked block of the
 * page's styles), and what a goal unlocks is read from the rules' one list of it. These hold the
 * rest of the page to that: no row laid out by hand, no label of a list written anywhere else, and
 * nothing that reads a field of an `Unlocks`.
 */
import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";

const ROOT = new URL("../../", import.meta.url).pathname;

/** The page's own source: every module of it and of its review pages, but the tests. */
async function sources(): Promise<{ file: string; text: string }[]> {
  const files = (
    await Promise.all(
      ["src", "src/ui", "src/art", "review"].map(async (dir) =>
        (await readdir(`${ROOT}${dir}`))
          .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
          .map((f) => `${dir}/${f}`),
      ),
    )
  ).flat();
  return Promise.all(files.map(async (file) => ({ file, text: await Bun.file(`${ROOT}${file}`).text() })));
}

/** Source with its comments taken out: what is said about a thing is not a use of it. */
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** The files, of those given, whose code matches. */
const using = (all: readonly { file: string; text: string }[], what: RegExp): string[] =>
  all.filter(({ text }) => what.test(code(text))).map(({ file }) => file);

/** A class of a goal's head or of a list: `gl`, `gh`, and their parts. */
const CLASS = /\b(?:gl|gh)-[a-z]+\b|["'`\s.](?:gl|gh)(?=["'`\s.{:,])/;

describe("a goal's head and lists", () => {
  test("are built by `goal.ts` alone: no other module names their classes or writes a list's label", async () => {
    const all = await sources();
    expect(using(all, CLASS)).toEqual(["src/ui/goal.ts"]);
    // The yard's sheet heads a column of numbers "Needs" (what its machines need a minute): a table's
    // column, not a goal's list.
    const labels = using(all, /["'`](?:Wants|Unlocks|Needs|Leaves in town)["'`]/);
    expect(labels.filter((f) => f !== "src/ui/views.ts")).toEqual(["src/ui/goal.ts"]);
    // The rows a panel once laid out itself, and the helper that made them, are gone.
    expect(using(all, /\bwantRows\b|["'`]want["'`]|\bopensThings\b|\bunlockWords\b/)).toEqual([]);
  });

  test("are styled in one marked block of the page's styles, and nowhere else", async () => {
    const html = await Bun.file(`${ROOT}index.html`).text();
    const begin = html.indexOf("/* goal lists: begin */");
    const end = html.indexOf("/* goal lists: end */");
    expect(begin).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(begin);
    const rest = html.slice(0, begin) + html.slice(end);
    const SELECTOR = /\.(?:gl|gh)(?![a-z])(?:-[a-z]+)?/g;
    const styled = new Set(html.slice(begin, end).match(SELECTOR));
    // Every part `goal.ts` builds has its rule in the block.
    const built = await Bun.file(`${ROOT}src/ui/goal.ts`).text();
    const parts = new Set([...code(built).matchAll(/\b(?:gl|gh)(?:-[a-z]+)?\b(?=[ "`'])/g)].map((m) => m[0]));
    expect(parts.size).toBeGreaterThan(8);
    for (const part of parts) expect([part, styled.has(`.${part}`)]).toEqual([part, true]);
    expect(rest.match(SELECTOR) ?? []).toEqual([]);
    // And no rule is left for rows laid out by hand.
    expect(html.match(/\.want\b|\.opens\b/g) ?? []).toEqual([]);
  });
});

describe("what a goal unlocks", () => {
  test("is the rules' list of it: nothing on the page reads a field of an `Unlocks`, or names the type", async () => {
    const all = await sources();
    // A goal's `unlocks` reached for, or the type taken in: the rules' `unlockedBy` is what a screen asks.
    expect(using(all, /[.?\]]\s*unlocks\b(?!\s*\()|\bUnlocks\b(?!["'`])/)).toEqual([]);
    expect(using(all, /\bunlockedBy\(/).length).toBeGreaterThan(3);
  });
});
