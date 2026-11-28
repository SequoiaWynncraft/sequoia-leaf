/**
 * The commit that added each patch note, and when, from the repository's history: the Discord
 * poster (`news.ts`) marks what a channel took on it, and reads when the note was merged from it.
 *
 * A note in a file of its own was added by the commit that added the file, `apps/town/notes/<id>.json`.
 * A note older than the files was added by the first commit that put its id in
 * `apps/town/src/notes.json`, the one file there was before them; that comes first, as the move
 * into files added a file for each of those notes again.
 */

/** Where notes are added: each in its own file; and before that, all in one. */
export const FOLDER = "apps/town/notes";
export const BEFORE = "apps/town/src/notes.json";

export interface Added {
  readonly sha: string;
  readonly at: number;
}

/** Runs git in `cwd`, giving what it printed. */
function git(cwd: string, ...args: string[]): string {
  const out = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (!out.success) throw new Error(`git ${args.join(" ")}: ${out.stderr.toString()}`);
  return out.stdout.toString();
}

/** Each commit of a log printed as `commit <sha> <seconds>` and what follows it, oldest first. */
function* commits(log: string): Generator<{ added: Added; lines: string[] }> {
  for (const part of log.split(/^(?=commit [0-9a-f]{40} \d+$)/m)) {
    const [head = "", ...lines] = part.split("\n");
    const at = /^commit ([0-9a-f]{40}) (\d+)$/.exec(head);
    if (at) yield { added: { sha: at[1] ?? "", at: Number(at[2]) * 1000 }, lines };
  }
}

/** The commit that added each note, by id, in the repository at `cwd`. */
export function addedBy(cwd: string): Map<string, Added> {
  const out = new Map<string, Added>();
  // The one file: any line it gained with an id in it, a note written on one line too. Its text
  // cannot hold `"id": "` but as a key, as JSON writes a quote in a string as `\"`.
  const before = git(cwd, "log", "--reverse", "--format=commit %H %ct", "-p", "--", BEFORE);
  for (const { added, lines } of commits(before))
    for (const line of lines) {
      const id = line.startsWith("+") ? /"id": "([^"]+)"/.exec(line)?.[1] : undefined;
      if (id !== undefined && !out.has(id)) out.set(id, added);
    }
  // A file each: the commit that added the file, a note's file renamed counting as added again.
  const files = git(
    cwd,
    "log",
    "--reverse",
    "--no-renames",
    "--diff-filter=A",
    "--format=commit %H %ct",
    "--name-only",
    "--",
    FOLDER,
  );
  for (const { added, lines } of commits(files))
    for (const line of lines) {
      const id =
        line.startsWith(`${FOLDER}/`) && line.endsWith(".json") ? line.slice(FOLDER.length + 1, -5) : undefined;
      if (id !== undefined && !out.has(id)) out.set(id, added);
    }
  return out;
}

/** The ids of the notes no commit is known to have added: the poster stops before posting any. */
export const unrecorded = (ids: readonly string[], added: ReadonlyMap<string, Added>): string[] =>
  ids.filter((id) => !added.has(id));
