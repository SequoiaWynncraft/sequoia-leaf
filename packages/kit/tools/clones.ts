/**
 * The clone check (`bun run clones`, in `bun run verify` and CI): code copied from one app or
 * package into another, where a fix to one copy misses the other. The TypeScript is read as tokens,
 * comments, spacing and import declarations dropped (two files that import the same modules by the
 * same names, as the rules' list of kinds and the page's do, copy no logic), and every run of `RUN`
 * tokens is hashed; a run found in two files of different workspaces is copied between them. (Nothing generated is TypeScript: the frames the kit
 * draws are CSS.)
 *
 * The copies there are now are held to `baseline/clones.json` (`ratchet.ts`): for each pair of
 * files, the first of them the group and the other the key, how many runs they share, which may only
 * go down as the copies go. A new pair, or more shared between a pair, fails. A pair is across files,
 * so it is held to a baseline, not to the base branch's tree: two changes that each copy half could
 * make a pair together.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { root } from "./graph.ts";
import { count, type Counts, holdToBaseline, type Rekey } from "./ratchet.ts";

/** How many tokens a copied run has at least. */
export const RUN = 70;

const TOKEN =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|\s+)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[$A-Za-z_][$\w]*|\d+(?:\.\d+)?|>>>=|(?:\*\*|<<|>>|&&|\|\||\?\?)=|===|!==|>>>|\.\.\.|=>|[-+*/%&|^<>=!]=|\+\+|--|\*\*|<<|>>|&&|\|\||\?\?|\?\.|.)/g;

/** A source's tokens, without its comments and spacing: an operator of more than one sign is one; a template literal, `${}` and all, is one too. */
export function tokens(text: string): string[] {
  return [...text.matchAll(TOKEN)].flatMap((m) => (m[2] === undefined ? [] : [m[2]]));
}

/** A name as a token: a word that is not a string or a number. */
const NAME = /^[$A-Za-z_][$\w]*$/;

/**
 * Whether the token at `i` begins a static import declaration: `import` where a statement begins,
 * followed by `{`, `*`, `type`, a string, or a name and then `from` or `,`. Not `import(`, not
 * `import.meta`, and not a class field or a key named `import` (`import = run();`).
 */
function importAt(all: readonly string[], i: number): boolean {
  const before = all[i - 1];
  const next = all[i + 1] ?? "";
  if (all[i] !== "import" || (before !== undefined && before !== ";" && before !== "}")) return false;
  if (next === "{" || next === "*" || next === "type" || /^["'`]/.test(next)) return true;
  const after = all[i + 2];
  return NAME.test(next) && (after === "from" || after === ",");
}

/**
 * A source's tokens as the check reads them (`tokens`), without its static import declarations: from
 * the `import` that begins one (`importAt`) to its semicolon.
 */
export function code(text: string): string[] {
  const all = tokens(text);
  const out: string[] = [];
  for (let i = 0; i < all.length; i++) {
    if (importAt(all, i)) {
      while (i < all.length && all[i] !== ";") i++;
      continue;
    }
    out.push(all[i] ?? "");
  }
  return out;
}

/** Every tracked file still on disk, from the root: one deleted or renamed but not yet staged is gone. */
function tracked(): string[] {
  const out = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: root, stdout: "pipe" });
  return out.stdout
    .toString()
    .split("\0")
    .filter((f) => f !== "" && existsSync(join(root, f)));
}

/** The workspace a file is in: `apps/town`, `packages/kit`. */
const home = (f: string): string => f.split("/").slice(0, 2).join("/");

/** For each pair of files in different workspaces, how many runs of `RUN` tokens they share: by the first of the two, then the other. */
export function shared(sources: ReadonlyMap<string, string>): Counts {
  const ids = new Map<string, number>();
  const runs = new Map<string, Set<bigint>>();
  for (const [file, text] of sources) {
    const t = Uint32Array.from(code(text), (tok) => ids.get(tok) ?? ids.set(tok, ids.size).size - 1);
    const mine = new Set<bigint>();
    for (let i = 0; i + RUN <= t.length; i++) mine.add(Bun.hash.wyhash(t.subarray(i, i + RUN)));
    runs.set(file, mine);
  }
  /** Each run, and the files it is in, kept only once it is in two workspaces. */
  const where = new Map<bigint, string[]>();
  const firstHome = new Map<bigint, string>();
  for (const [file, mine] of runs)
    for (const run of mine) {
      const first = firstHome.get(run);
      if (first === undefined) firstHome.set(run, home(file));
      const files = where.get(run);
      if (files) files.push(file);
      else where.set(run, [file]);
    }
  const out: Counts = {};
  for (const [run, files] of where) {
    if (files.every((f) => home(f) === firstHome.get(run))) continue;
    for (const [i, a] of files.entries()) for (const b of files.slice(i + 1)) if (home(a) !== home(b)) pair(out, a, b);
  }
  return out;
}

/** The two files of a pair, in order: the first the group, the other the key. */
const ordered = (a: string, b: string): readonly [string, string] => (a < b ? [a, b] : [b, a]);
/** Adds one to a pair's count. */
const pair = (out: Counts, a: string, b: string): void => count(out, ...ordered(a, b));

/**
 * A pair with moved files' new paths, in order again. A baseline from before a pair was its two
 * files has one group, `copied`, and the pair as one key: main's, until this form lands there.
 */
export const rekey: Rekey = (a, b, moved) => {
  if (a !== "copied") return ordered(moved(a), moved(b));
  const [first = "", other = ""] = b.split(" ");
  return ordered(moved(first), moved(other));
};

if (import.meta.main) {
  const files = tracked().filter((f) => /^(apps|packages)\/.*\.ts$/.test(f));
  const found = shared(new Map(files.map((f) => [f, readFileSync(join(root, f), "utf8")])));
  if (!holdToBaseline("clones", found, "bun run clones", rekey)) process.exit(1);
  const pairs = Object.values(found).reduce((sum, keys) => sum + Object.keys(keys).length, 0);
  console.log(`Clones: nothing new copied between workspaces; ${pairs} pairs held to the baseline.`);
}
