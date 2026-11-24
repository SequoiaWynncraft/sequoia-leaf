/**
 * The clone check (`bun run clones`, in `bun run verify` and CI): code copied from one app or
 * package into another, where a fix to one copy misses the other. The TypeScript is read as tokens,
 * comments and spacing dropped, and every run of `RUN` tokens is hashed; a run found in two files of
 * different workspaces is copied between them. (Nothing generated is TypeScript: the frames the kit
 * draws are CSS.)
 *
 * The copies there are now are held to `baseline/clones.json` (`ratchet.ts`): for each pair of
 * files, how many runs they share, which may only go down as the copies go. A new pair, or more
 * shared between a pair, fails.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { root } from "./graph.ts";
import { count, type Counts, hold } from "./ratchet.ts";

/** How many tokens a copied run has at least. */
export const RUN = 70;

const TOKEN =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|\s+)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[$A-Za-z_][$\w]*|\d+(?:\.\d+)?|>>>=|(?:\*\*|<<|>>|&&|\|\||\?\?)=|===|!==|>>>|\.\.\.|=>|[-+*/%&|^<>=!]=|\+\+|--|\*\*|<<|>>|&&|\|\||\?\?|\?\.|.)/g;

/** A source's tokens, without its comments and spacing: an operator of more than one sign is one; a template literal, `${}` and all, is one too. */
export function tokens(text: string): string[] {
  return [...text.matchAll(TOKEN)].flatMap((m) => (m[2] === undefined ? [] : [m[2]]));
}

/** Every tracked file, from the root. */
function tracked(): string[] {
  const out = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: root, stdout: "pipe" });
  return out.stdout.toString().split("\0").filter(Boolean);
}

/** The workspace a file is in: `apps/town`, `packages/kit`. */
const home = (f: string): string => f.split("/").slice(0, 2).join("/");

/** For each pair of files in different workspaces, how many runs of `RUN` tokens they share. */
export function shared(sources: ReadonlyMap<string, string>): Counts {
  const ids = new Map<string, number>();
  const runs = new Map<string, Set<bigint>>();
  for (const [file, text] of sources) {
    const t = Uint32Array.from(tokens(text), (tok) => ids.get(tok) ?? ids.set(tok, ids.size).size - 1);
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

if (import.meta.main) {
  const files = tracked().filter((f) => /^(apps|packages)\/.*\.ts$/.test(f));
  const found = shared(new Map(files.map((f) => [f, readFileSync(join(root, f), "utf8")])));
  if (!hold("clones", found, "bun run clones")) process.exit(1);
  console.log(
    `Clones: nothing new copied between workspaces; ${Object.keys(found.copied ?? {}).length} pairs held to the baseline.`,
  );
}
