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
 * Every note's file, by name (`listed`); and, with the one file of notes back, what to do about it
 * (`back`), which `notes.ts` stops on. A macro that throws only says it could not, so it says.
 */
export function notesListed(): { back: string | null; listed: Listed[] } {
  const back = existsSync(BEFORE)
    ? "apps/town/src/notes.json is back. Move your note into apps/town/notes/<id>.json: `bun apps/town/review/notes-move.ts` does it."
    : null;
  const listed = readdirSync(FOLDER)
    .filter((f) => f.endsWith(".json"))
    .toSorted()
    .map((f) => ({ file: f.slice(0, -".json".length), note: JSON.parse(readFileSync(join(FOLDER, f), "utf8")) }));
  return { back, listed };
}
