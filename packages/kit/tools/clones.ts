/**
 * The clone check (`bun run clones`, in `bun run verify` and CI): code copied from one app or
 * package into another, where a fix to one copy misses the other. The TypeScript is read as tokens,
 * comments, spacing and import declarations dropped (two files that import the same modules by the
 * same names, as the rules' list of kinds and the page's do, copy no logic), and every run of `RUN`
 * tokens is hashed; a run found in two files of different workspaces is copied between them. (Nothing generated is TypeScript: the frames the kit
 * draws are CSS.)
 *
 * The copies there are now are held to the base branch's (`ratchet.ts`): for each pair of files,
 * how many runs they share, which may only go down as the copies go. A new pair, or more shared
 * between a pair, fails.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { root } from "./graph.ts";
import { count, type Counts, hold, type Rekey } from "./ratchet.ts";

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

/**
 * Every tracked file still on disk at `at`, from there: one deleted or renamed but not yet staged
 * is gone. The base's tree (`ratchet.ts`) is a folder of git's files, `node_modules` aside.
 */
function tracked(at: string): string[] {
  if (at !== root)
    return [...new Bun.Glob("**").scanSync({ cwd: at })].filter((f) => !f.split("/").includes("node_modules"));
  const out = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: root, stdout: "pipe" });
  return out.stdout
    .toString()
    .split("\0")
    .filter((f) => f !== "" && existsSync(join(root, f)));
}

/** The workspace a file is in: `apps/town`, `packages/kit`. */
const home = (f: string): string => f.split("/").slice(0, 2).join("/");

/** For each pair of files in different workspaces, how many runs of `RUN` tokens they share. */
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
    for (const [i, a] of files.entries())
      for (const b of files.slice(i + 1)) if (home(a) !== home(b)) count(out, "copied", [a, b].toSorted().join(" "));
  }
  return out;
}

/** For each pair of files in different workspaces at `at`, how many runs they share. */
function copiedIn(at: string): Counts {
  const files = tracked(at).filter((f) => /^(apps|packages)\/.*\.ts$/.test(f));
  return shared(new Map(files.map((f) => [f, readFileSync(join(at, f), "utf8")])));
}

/** A pair with moved files' new paths, in order again. */
const rekey: Rekey = (_group, key, moved) => key.split(" ").map(moved).toSorted().join(" ");

if (import.meta.main) {
  const found = copiedIn(root);
  if (!(await hold("clones", found, copiedIn, rekey))) process.exit(1);
  console.log(
    `Clones: nothing new copied between workspaces; ${Object.keys(found.copied ?? {}).length} pairs held to the base branch's.`,
  );
}
