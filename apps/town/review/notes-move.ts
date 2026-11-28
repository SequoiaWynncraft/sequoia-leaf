/**
 * Moves the notes of a leftover `apps/town/src/notes.json` into files of their own: a branch cut
 * before each note had its file brings the one file back on a rebase or a merge, and the town's
 * build stops on it. Run it then, and add what it writes:
 *
 *     bun apps/town/review/notes-move.ts [--base <commit>]
 *
 * Each note in it is held to the note as the branch found it, in the one file at the commit the
 * branch was cut from (`--base`, by default where the branch being rebased or merged left
 * origin/main), and to its file now:
 *
 * - a note with no file yet becomes `apps/town/notes/<id>.json`;
 * - a note the branch changed and main did not takes the branch's change;
 * - a note main changed and the branch did not keeps main's;
 * - a note both changed, differently, is a conflict: nothing is written, the one file stays, and
 *   the run fails, naming each, to be put right by hand in its file and taken out of the one file.
 *
 * With nothing in conflict, the one file goes.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BEFORE = "apps/town/src/notes.json";
const FOLDER = "apps/town/notes";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** The notes of the one file's text, by id; `where` names it, should it not read. */
export function notesById(text: string, where: string): Map<string, unknown> {
  const listed: unknown = JSON.parse(text);
  if (!Array.isArray(listed)) throw new Error(`${where} is not a list of notes`);
  const out = new Map<string, unknown>();
  for (const note of listed) {
    const id = isRecord(note) ? note.id : undefined;
    if (typeof id !== "string" || !/^[a-z0-9-]+$/.test(id))
      throw new Error(
        `${where}: a note without an id of lower-case letters, digits and dashes: ${JSON.stringify(note)}`,
      );
    out.set(id, note);
  }
  return out;
}

/** What a move wrote, as paths from the root, and the ids in conflict, for which it wrote nothing. */
export interface Moved {
  readonly written: readonly string[];
  readonly conflicts: readonly string[];
}

/**
 * Moves the notes of the one file at `root` into files, each held to the note as the branch found
 * it (`base`, by id; null where that is not known, and then every note changed is a conflict).
 */
export function moveNotes(root: string, base: ReadonlyMap<string, unknown> | null): Moved {
  const incoming = notesById(readFileSync(join(root, BEFORE), "utf8"), BEFORE);
  const writes: [string, unknown][] = [];
  const conflicts: string[] = [];
  for (const [id, note] of incoming) {
    const path = `${FOLDER}/${id}.json`;
    if (!existsSync(join(root, path))) {
      writes.push([path, note]);
      continue;
    }
    const now: unknown = JSON.parse(readFileSync(join(root, path), "utf8"));
    const was = base?.get(id);
    if (Bun.deepEquals(note, now) || (was !== undefined && Bun.deepEquals(note, was))) continue;
    if (was !== undefined && Bun.deepEquals(now, was)) writes.push([path, note]);
    else conflicts.push(id);
  }
  if (conflicts.length > 0) return { written: [], conflicts };
  for (const [path, note] of writes) writeFileSync(join(root, path), `${JSON.stringify(note, null, 2)}\n`);
  rmSync(join(root, BEFORE));
  // In the repository's own format, as `bun fmt --check` holds it.
  const written = writes.map(([path]) => path);
  if (written.length > 0) Bun.spawnSync([process.execPath, "fmt", ...written], { cwd: root, stdout: "ignore" });
  return { written, conflicts };
}

/** Runs git at `root`: what it printed, or null where it failed. */
function git(root: string, ...args: string[]): string | null {
  const out = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  return out.success ? out.stdout.toString().trim() : null;
}

/** The commit the branch was cut from: `--base`, or where the branch being rebased (else HEAD) left origin/main. */
function baseCommit(root: string): string | null {
  const given = process.argv.indexOf("--base");
  if (given >= 0) return process.argv[given + 1] ?? null;
  const branch = git(root, "rev-parse", "-q", "--verify", "REBASE_HEAD") ?? "HEAD";
  return git(root, "merge-base", branch, "origin/main");
}

if (import.meta.main) {
  const root = join(import.meta.dir, "..", "..", "..");
  if (!existsSync(join(root, BEFORE))) {
    console.log(`No ${BEFORE}: nothing to move.`);
    process.exit(0);
  }
  const sha = baseCommit(root);
  const text = sha === null ? null : git(root, "show", `${sha}:${BEFORE}`);
  const base = text === null ? null : notesById(text, `${sha}'s ${BEFORE}`);
  const { written, conflicts } = moveNotes(root, base);
  if (conflicts.length > 0) {
    console.error(
      [
        `Changed on main and on this branch, differently: ${conflicts.join(", ")}.`,
        `Put each right in ${FOLDER}/<id>.json and take it out of ${BEFORE}, then run this again. Nothing was written.`,
        base === null ? `(Where the branch was cut is not known: give it with --base <commit>.)` : "",
      ]
        .filter((line) => line !== "")
        .join("\n"),
    );
    process.exit(1);
  }
  console.log(
    written.length === 0
      ? `Every note in ${BEFORE} already had its file as it should be; the file is gone.`
      : `Wrote ${written.join(", ")}. ${BEFORE} is gone; git add the files.`,
  );
}
