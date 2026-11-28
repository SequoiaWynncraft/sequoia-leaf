/**
 * The patch notes as written, one file each in `apps/town/notes/`, read as the page is built (and
 * as a test runs): a Bun macro, so that what it gives is written into what imports it,
 * `import { notesListed } from "../build/notes.ts" with { type: "macro" }`. Each comes with its
 * file's name, which `notes.ts` holds to the note's id; the order is `notes.ts`'s to give.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The folder of notes, beside this one. */
const FOLDER = join(import.meta.dir, "..", "notes");
/** The one file all the notes were in before, which a branch cut before the move may bring back. */
const BEFORE = join(import.meta.dir, "..", "src", "notes.json");

/** A note's file: its name without `.json`, and what it says. */
export interface Listed {
  readonly file: string;
  readonly note: unknown;
}

/**
 * Every note's file, by name. With the one file of notes back, every build of the town and every
 * test of its notes stops, saying how to move them: Bun says of a macro that throws only that it
 * could not use what it gave, so the macro says why first.
 */
export function notesListed(): Listed[] {
  if (existsSync(BEFORE))
    stop(
      "apps/town/src/notes.json is back. Move your note into apps/town/notes/<id>.json: `bun apps/town/review/notes-move.ts` does it.",
    );
  return readdirSync(FOLDER)
    .filter((f) => f.endsWith(".json"))
    .toSorted()
    .map((f) => listed(f.slice(0, -".json".length), JSON.parse(readFileSync(join(FOLDER, f), "utf8"))));
}

/**
 * What a note's id may be: lower-case letters and digits in words joined by single dashes. Git
 * quotes any other name in its history (which the poster reads), and the workflow's glob skips one
 * that starts with a dot, so such a note would never be posted.
 */
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A note's file, held to its name here, so a build stops rather than shipping a town that throws. */
function listed(file: string, note: unknown): Listed {
  if (!ID.test(file)) stop(`apps/town/notes/${file}.json: a note's id is lower-case words joined by dashes.`);
  const id = typeof note === "object" && note !== null && "id" in note ? note.id : undefined;
  if (id !== file) stop(`apps/town/notes/${file}.json has the note ${String(id)}; name the file for its id.`);
  return { file, note };
}

/** Stops the build, saying why first: Bun says of a macro that throws only that it could not use what it gave. */
function stop(why: string): never {
  console.error(why);
  throw new Error(why);
}
