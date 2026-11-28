/**
 * A ratchet: counts that may only go down. A check (`lint.ts`, `imports.ts`, `clones.ts`) counts
 * what it finds by group and key, such as a rule's hits by file, in the working tree and, with the
 * same counter, in the base branch's tree, and holds the one to the other:
 *
 * - a key the base does not have, or a count above the base's, fails;
 * - a count below the base's passes, and says nothing: the next change is held to the lower count,
 *   as the base it is held to has it.
 *
 * A file moved or renamed since the base keeps its counts: git's rename detection between the base
 * and the working tree (`git diff -M`, of what git tracks, so `git add` a moved file) gives each
 * old path its new one, and the base's keys are read with the new paths.
 *
 * The base is where HEAD left origin/main, and on main itself HEAD. In a pull request's run on
 * GitHub, where HEAD is the merge commit, it is the merge's first parent (the checkout fetches two
 * commits deep for it), and in a run on a push to main, HEAD's first parent. Its tree is read with
 * `git archive` into a folder of its own under the temporary folder, with the working tree's
 * `node_modules`, and counted there. With no base to read, the check fails and says how to fetch it.
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The repository's root, the working tree the checks count. */
const ROOT = join(import.meta.dir, "..", "..", "..");

/** Counts by group and key: a rule's hits by file, say. */
export type Counts = Record<string, Record<string, number>>;

/** One count that is not what the base has. */
export interface Change {
  readonly group: string;
  readonly key: string;
  readonly was: number;
  readonly now: number;
}

/** A key read with a moved file's new path in place of its old one (`moved`): each path in it, by default. */
export type Rekey = (group: string, key: string, moved: (path: string) => string) => string;
const byWord: Rekey = (_group, key, moved) => key.split(" ").map(moved).join(" ");

const keysOf = (a: Counts, b: Counts): [string, string][] => {
  const all = new Set<string>();
  for (const counts of [a, b])
    for (const [group, keys] of Object.entries(counts))
      for (const key of Object.keys(keys)) all.add(`${group}\0${key}`);
  return [...all].toSorted().map((both) => {
    const [group = "", key = ""] = both.split("\0");
    return [group, key];
  });
};

/** What differs from the base: what is new or more (`worse`), and what is less (`better`). */
export function compare(base: Counts, now: Counts): { worse: Change[]; better: Change[] } {
  const worse: Change[] = [];
  const better: Change[] = [];
  for (const [group, key] of keysOf(base, now)) {
    const was = base[group]?.[key] ?? 0;
    const is = now[group]?.[key] ?? 0;
    if (is > was) worse.push({ group, key, was, now: is });
    else if (is < was) better.push({ group, key, was, now: is });
  }
  return { worse, better };
}

/** The base's counts read with moved files' new paths; two keys that come to one add up. */
export function withMoves(base: Counts, renamed: ReadonlyMap<string, string>, rekey: Rekey = byWord): Counts {
  const to = (path: string): string => renamed.get(path) ?? path;
  const out: Counts = {};
  for (const [group, keys] of Object.entries(base))
    for (const [key, n] of Object.entries(keys)) count(out, group, rekey(group, key, to), n);
  return out;
}

/** Adds one to a count. */
export function count(counts: Counts, group: string, key: string, by = 1): void {
  const keys = (counts[group] ??= {});
  keys[key] = (keys[key] ?? 0) + by;
}

/** Runs git in the repository. */
const git = (...args: string[]) => Bun.spawnSync(["git", ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });

/** The base's commit, or null where there is none to read. */
function baseCommit(): string | null {
  const onGitHub = process.env.GITHUB_ACTIONS === "true" && process.env.ACT === undefined;
  const pushed = onGitHub && process.env.GITHUB_EVENT_NAME === "push";
  const against = (onGitHub && process.env.GITHUB_BASE_REF) || pushed ? "HEAD^1" : "origin/main";
  const base = git("merge-base", "HEAD", against);
  const sha = base.stdout.toString().trim();
  return base.exitCode === 0 && git("cat-file", "-e", `${sha}^{tree}`).exitCode === 0 ? sha : null;
}

/** Each file renamed or moved between the base and the working tree, by its old path. */
export function renamesSince(base: string): Map<string, string> {
  const out = git("diff", "-M", "--name-status", "-z", base);
  if (out.exitCode !== 0) throw new Error(`git diff -M ${base}: ${out.stderr.toString()}`);
  const words = out.stdout.toString().split("\0");
  const renamed = new Map<string, string>();
  for (let i = 0; i < words.length; i++) {
    const status = words[i] ?? "";
    if (status.startsWith("R")) {
      renamed.set(words[i + 1] ?? "", words[i + 2] ?? "");
      i += 2;
    } else if (status.startsWith("C")) i += 2;
    else i += 1;
  }
  return renamed;
}

/**
 * The base's tree in a folder of its own, ready to count: the files of the commit, and the working
 * tree's `node_modules` (the root's linked, each workspace's copied, as its links are relative to
 * where they are). Given to `use`, then removed.
 */
async function inTree<T>(sha: string, use: (at: string) => T | Promise<T>): Promise<T> {
  const at = mkdtempSync(join(tmpdir(), "leaf-base-"));
  try {
    const archive = Bun.spawn(["git", "archive", "--format=tar", sha], { cwd: ROOT, stdout: "pipe" });
    const tar = Bun.spawn(["tar", "-x", "-C", at], { stdin: archive.stdout, stderr: "pipe" });
    if ((await archive.exited) !== 0 || (await tar.exited) !== 0) throw new Error(`could not read the tree of ${sha}`);
    symlinkSync(join(ROOT, "node_modules"), join(at, "node_modules"));
    for (const folder of ["apps", "packages"])
      for (const w of existsSync(join(ROOT, folder)) ? readdirSync(join(ROOT, folder)) : []) {
        const from = join(ROOT, folder, w, "node_modules");
        if (existsSync(from) && existsSync(join(at, folder, w)))
          cpSync(from, join(at, folder, w, "node_modules"), { recursive: true, verbatimSymlinks: true });
      }
    return await use(at);
  } finally {
    rmSync(at, { recursive: true, force: true });
  }
}

/**
 * Holds `now`, what a check counts in the working tree, to what `counter` counts in the base's tree,
 * printing what is new or more. `rekey` reads a key with moved files' new paths. Says whether it passed.
 */
export async function hold(
  name: string,
  now: Counts,
  counter: (at: string) => Counts | Promise<Counts>,
  rekey: Rekey = byWord,
): Promise<boolean> {
  const sha = baseCommit();
  if (sha === null) {
    console.error(
      `The ${name} check holds its counts to origin/main's, and cannot read it: \`git fetch origin main\`, then run it again.`,
    );
    return false;
  }
  const base = withMoves(await inTree(sha, counter), renamesSince(sha), rekey);
  const { worse } = compare(base, now);
  for (const c of worse)
    console.error(
      c.was === 0 ? `new: ${c.group} ${c.key} (${c.now})` : `more: ${c.group} ${c.key}, ${c.now} (was ${c.was})`,
    );
  if (worse.length > 0)
    console.error(`Fix what is new or more above: the ${name} counts only go down from the base branch's (${sha}).`);
  return worse.length === 0;
}
