/**
 * Moves the notes of a leftover `apps/town/src/notes.json` into files of their own: a branch cut
 * before each note had its file brings the one file back on a rebase, and the town's build stops on
 * it. Each note in it that has no file yet becomes `apps/town/notes/<id>.json`, and the one file
 * goes. Run it after rebasing, then add the new file:
 *
 *     bun apps/town/review/notes-move.ts
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TOWN = join(import.meta.dir, "..");
const BEFORE = join(TOWN, "src", "notes.json");
const FOLDER = join(TOWN, "notes");

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

if (!existsSync(BEFORE)) {
  console.log("No apps/town/src/notes.json: nothing to move.");
  process.exit(0);
}
const listed: unknown = JSON.parse(readFileSync(BEFORE, "utf8"));
if (!Array.isArray(listed)) throw new Error("apps/town/src/notes.json is not a list of notes");
const moved: string[] = [];
for (const note of listed) {
  const id = isRecord(note) ? note.id : undefined;
  if (typeof id !== "string" || !/^[a-z0-9-]+$/.test(id))
    throw new Error(`A note without an id of lower-case letters, digits and dashes: ${JSON.stringify(note)}`);
  const file = join(FOLDER, `${id}.json`);
  if (existsSync(file)) continue;
  writeFileSync(file, `${JSON.stringify(note, null, 2)}\n`);
  moved.push(`apps/town/notes/${id}.json`);
}
rmSync(BEFORE);
// In the repository's own format, as `bun fmt --check` holds it.
if (moved.length > 0)
  Bun.spawnSync([process.execPath, "fmt", ...moved], { cwd: join(TOWN, "..", ".."), stdout: "ignore" });
console.log(
  moved.length === 0
    ? "Every note in apps/town/src/notes.json already had its file; the file is gone."
    : `Moved into files: ${moved.join(", ")}. apps/town/src/notes.json is gone; git add the new files.`,
);
