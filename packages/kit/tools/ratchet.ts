/**
 * A ratchet: counts that may only go down. A check counts what it finds by group and key, such as a
 * rule's hits by file, and holds the counts one of two ways:
 *
 * - **To the base branch's tree** (`holdToBase`, the lint): the same counter counts the base's tree
 *   too. A key the base does not have, or a count above the base's, fails; a count below it passes
 *   and is written down nowhere, as the next change is held to the base it lands on. Counts by
 *   file add up across changes only within the file, so two changes that each pass cannot
 *   together raise one beyond what both were held to.
 * - **To a committed baseline** (`holdToBaseline`, the imports and the copies), `baseline/<name>.json`:
 *   their counts are across files (a loop of imports, a pair of files sharing code), so two changes
 *   that each pass could together make a new one, which the next change's run against the base
 *   would take as already there. A baseline names every one there may be. A key it does not have,
 *   or a count above it, fails; a count below it fails too, until the baseline is lowered in the
 *   same change (`--lower`, which never adds a key or raises a count). With no baseline file the
 *   check fails; `--start` writes one. The baseline is held to the base branch's: a change cannot
 *   raise its own.
 *
 * A file moved or renamed since the base keeps its counts: git's rename detection between the base
 * and the working tree (`git diff -M`, of what git tracks, so `git add` a moved file) gives each
 * old path its new one, and the base's counts, or the baseline's, are read with the new paths. A
 * baseline that names a moved file by its old path asks for `--lower`, which writes the new one.
 *
 * The base is where HEAD left origin/main, and on main itself HEAD. In a pull request's run on
 * GitHub, where HEAD is the merge commit, it is the merge's first parent (the checkout fetches two
 * commits deep for it). With no base to read, a check fails and says how to fetch it.
 */
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The repository's root, the working tree the checks count. */
const ROOT = join(import.meta.dir, "..", "..", "..");

/** Counts by group and key: a rule's hits by file, say. */
export type Counts = Record<string, Record<string, number>>;

/** One count that is not what it is held to. */
export interface Change {
  readonly group: string;
  readonly key: string;
  readonly was: number;
  readonly now: number;
}

/** A count's group and key read with a moved file's new path in place of its old one (`moved`). */
export type Rekey = (group: string, key: string, moved: (path: string) => string) => readonly [string, string];
/** Each word of the key a path, the group not. */
export const byWord: Rekey = (group, key, moved) => [group, key.split(" ").map(moved).join(" ")];

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

/** What differs from what counts are held to: what is new or more (`worse`), and what is less (`better`). */
export function compare(held: Counts, now: Counts): { worse: Change[]; better: Change[] } {
  const worse: Change[] = [];
  const better: Change[] = [];
  for (const [group, key] of keysOf(held, now)) {
    const was = held[group]?.[key] ?? 0;
    const is = now[group]?.[key] ?? 0;
    if (is > was) worse.push({ group, key, was, now: is });
    else if (is < was) better.push({ group, key, was, now: is });
  }
  return { worse, better };
}

/** Counts read with moved files' new paths; two keys that come to one add up. */
export function withMoves(counts: Counts, renamed: ReadonlyMap<string, string>, rekey: Rekey = byWord): Counts {
  const to = (path: string): string => renamed.get(path) ?? path;
  const out: Counts = {};
  for (const [group, keys] of Object.entries(counts))
    for (const [key, n] of Object.entries(keys)) {
      const [g, k] = rekey(group, key, to);
      count(out, g, k, n);
    }
  return out;
}

/** A baseline lowered to what is so now: never a new key, never a higher count. */
export function lowered(baseline: Counts, now: Counts): Counts {
  const out: Counts = {};
  for (const [group, keys] of Object.entries(baseline))
    for (const [key, was] of Object.entries(keys)) {
      const is = Math.min(was, now[group]?.[key] ?? 0);
      if (is > 0) (out[group] ??= {})[key] = is;
    }
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
  const pull = process.env.GITHUB_ACTIONS === "true" && process.env.ACT === undefined && process.env.GITHUB_BASE_REF;
  const base = git("merge-base", "HEAD", pull ? "HEAD^1" : "origin/main");
  const sha = base.stdout.toString().trim();
  return base.exitCode === 0 && git("cat-file", "-e", `${sha}^{tree}`).exitCode === 0 ? sha : null;
}

/** The base's commit, saying how to fetch it where there is none. */
function baseOr(name: string): string | null {
  const sha = baseCommit();
  if (sha === null)
    console.error(
      `The ${name} check holds its counts to origin/main, and cannot read it: \`git fetch origin main\`, then run it again.`,
    );
  return sha;
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

/** The files that say what is installed, from a root: the lockfile and every workspace's manifest. */
const MANIFESTS = ["bun.lock", "package.json", "apps/*/package.json", "packages/*/package.json"];
const manifestsAt = (at: string): string =>
  MANIFESTS.flatMap((pattern) => [...new Bun.Glob(pattern).scanSync({ cwd: at })].toSorted())
    .map((f) => `${f}\0${readFileSync(join(at, f), "utf8")}`)
    .join("\0");

/**
 * The base's tree in a folder of its own, ready to count: the files of the commit and what they
 * have installed. Where the base installs what the working tree does (the same lockfile and
 * manifests), the working tree's `node_modules` (the root's linked, each workspace's copied, as its
 * links are relative to where they are); else its own, `bun install --frozen-lockfile`, so a
 * workspace moved or removed since resolves as the base had it. Given to `use`, then removed.
 */
async function inTree<T>(sha: string, use: (at: string) => T | Promise<T>): Promise<T> {
  const at = mkdtempSync(join(tmpdir(), "leaf-base-"));
  try {
    const archive = Bun.spawn(["git", "archive", "--format=tar", sha], { cwd: ROOT, stdout: "pipe" });
    const tar = Bun.spawn(["tar", "-x", "-C", at], { stdin: archive.stdout, stderr: "pipe" });
    if ((await archive.exited) !== 0 || (await tar.exited) !== 0) throw new Error(`could not read the tree of ${sha}`);
    if (manifestsAt(at) === manifestsAt(ROOT)) {
      symlinkSync(join(ROOT, "node_modules"), join(at, "node_modules"));
      for (const folder of ["apps", "packages"])
        for (const w of existsSync(join(ROOT, folder)) ? readdirSync(join(ROOT, folder)) : []) {
          const from = join(ROOT, folder, w, "node_modules");
          if (existsSync(from) && existsSync(join(at, folder, w)))
            cpSync(from, join(at, folder, w, "node_modules"), { recursive: true, verbatimSymlinks: true });
        }
    } else {
      const install = Bun.spawn([process.execPath, "install", "--frozen-lockfile"], {
        cwd: at,
        stdout: "ignore",
        stderr: "pipe",
      });
      if ((await install.exited) !== 0)
        throw new Error(`could not install the base's packages: ${await new Response(install.stderr).text()}`);
    }
    return await use(at);
  } finally {
    rmSync(at, { recursive: true, force: true });
  }
}

/** Prints what is new or more. */
function sayWorse(worse: readonly Change[]): void {
  for (const c of worse)
    console.error(
      c.was === 0 ? `new: ${c.group} ${c.key} (${c.now})` : `more: ${c.group} ${c.key}, ${c.now} (was ${c.was})`,
    );
}

/**
 * Holds `now`, what a check counts in the working tree, to what `counter` counts in the base's tree,
 * printing what is new or more. `rekey` reads a count with moved files' new paths. Says whether it passed.
 */
export async function holdToBase(
  name: string,
  now: Counts,
  counter: (at: string) => Counts | Promise<Counts>,
  rekey: Rekey = byWord,
): Promise<boolean> {
  const sha = baseOr(name);
  if (sha === null) return false;
  const { worse } = compare(withMoves(await inTree(sha, counter), renamesSince(sha), rekey), now);
  sayWorse(worse);
  if (worse.length > 0)
    console.error(`Fix what is new or more above: the ${name} counts only go down from the base branch's (${sha}).`);
  return worse.length === 0;
}

/** Counts in a stable order, so a baseline changes by the lines that changed. */
const sorted = (counts: Counts): Counts =>
  Object.fromEntries(
    Object.keys(counts)
      .toSorted()
      .map((group) => [
        group,
        Object.fromEntries(Object.entries(counts[group] ?? {}).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
      ]),
  );

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCounts = (x: unknown): x is Counts =>
  isRecord(x) && Object.values(x).every((keys) => isRecord(keys) && Object.values(keys).every(Number.isInteger));

/** Counts from a baseline's text; `where` names it, should it not be counts. */
function countsIn(text: string, where: string): Counts {
  const parsed: unknown = JSON.parse(text);
  if (!isCounts(parsed)) throw new Error(`${where} is not counts by group and key`);
  return parsed;
}

/**
 * Holds `now` to the baseline `baseline/<name>.json`, read with moved files' new paths (`rekey`),
 * printing what differs; with `--lower` on the command line, lowers the baseline first, and with
 * `--start` and no baseline, writes one. `command` is how to run the check. Says whether it passed.
 */
export function holdToBaseline(name: string, now: Counts, command: string, rekey: Rekey = byWord): boolean {
  const path = join(import.meta.dir, "baseline", `${name}.json`);
  const write = (counts: Counts): void => writeFileSync(path, `${JSON.stringify(sorted(counts), null, 2)}\n`);
  if (!existsSync(path)) {
    if (!process.argv.includes("--start")) {
      console.error(`No ${name} baseline at ${path}: start one with \`${command} --start\` and commit it.`);
      return false;
    }
    write(now);
    console.log(`Started the ${name} baseline with what there is now: ${path}`);
    return true;
  }
  const sha = baseOr(name);
  if (sha === null) return false;
  const renamed = renamesSince(sha);
  const committed = countsIn(readFileSync(path, "utf8"), path);
  const baseline = withMoves(committed, renamed, rekey);
  // The baseline cannot raise its own: held to the base branch's, both read with the new paths.
  const atBase = git("show", `${sha}:packages/kit/tools/baseline/${name}.json`);
  if (atBase.exitCode === 0) {
    const before = withMoves(countsIn(atBase.stdout.toString(), `${sha}'s ${name} baseline`), renamed, rekey);
    const raised = compare(before, baseline).worse;
    for (const c of raised)
      console.error(`raised in the baseline: ${c.group} ${c.key}, ${c.now} (the base branch has ${c.was})`);
    if (raised.length > 0) {
      console.error(`The ${name} baseline only goes down: put back the base branch's counts and fix what is new.`);
      return false;
    }
  }
  const lowering = process.argv.includes("--lower");
  if (lowering) write(lowered(baseline, now));
  const held = lowering ? lowered(baseline, now) : baseline;
  const { worse, better } = compare(held, now);
  const oldPaths = !lowering && JSON.stringify(sorted(baseline)) !== JSON.stringify(sorted(committed));
  sayWorse(worse);
  for (const c of better) console.error(`fewer: ${c.group} ${c.key}, ${c.now} (was ${c.was})`);
  if (worse.length > 0)
    console.error(`Fix what is new or more above: ${path} only goes down, and \`${command} --lower\` never raises it.`);
  if (better.length > 0) console.error(`Fewer than the baseline: lower it with \`${command} --lower\` and commit it.`);
  if (oldPaths)
    console.error(`The baseline names moved files by their old paths: \`${command} --lower\` writes the new ones.`);
  return worse.length === 0 && better.length === 0 && !oldPaths;
}
