/**
 * What has changed in the game, for the "News" tab on the quest board, newest first: the notes are
 * data, in `notes.json`. A change a player can see adds a note at the top of it, in the words of
 * someone telling a friend, and nothing is ever taken out of the middle. A note is out from its
 * `at` (`notesAt`), so one for a release merged ahead of its day waits for that moment, here and on
 * Discord (`.github/workflows/news.yml`).
 *
 * A note's one or two lines are what everyone reads on the board. A bigger change also has its full
 * notes (`more`), which open under the lines: a few parts, each a heading and what changed under it.
 */

import listed from "./notes.json" with { type: "json" };

export interface Note {
  id: string;
  /** When it went live, by the world's clock: `2026-11-22T19:09Z`. An old note has only its day, `2026-11-22`. */
  at: string;
  title: string;
  lines: readonly string[];
  more?: readonly Part[];
}

/** A part of a note's full notes: its heading, and each thing that changed, one sentence or two. */
export interface Part {
  head: string;
  points: readonly string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isWords = (v: unknown): v is string[] => Array.isArray(v) && v.every((w) => typeof w === "string");

function readPart(v: unknown): Part {
  if (!isRecord(v) || typeof v.head !== "string" || !isWords(v.points))
    throw new Error(`notes.json: a part that does not read: ${JSON.stringify(v)}`);
  return { head: v.head, points: v.points };
}

/** A note from `notes.json`; one that does not read is a mistake in the file, and the board's tests say so. */
function readNote(v: unknown): Note {
  if (!isRecord(v) || typeof v.id !== "string" || typeof v.at !== "string" || typeof v.title !== "string")
    throw new Error(`notes.json: a note that does not read: ${JSON.stringify(v)}`);
  if (!isWords(v.lines)) throw new Error(`notes.json: the lines of ${v.id} do not read`);
  const note: Note = { id: v.id, at: v.at, title: v.title, lines: v.lines };
  if (v.more === undefined) return note;
  if (!Array.isArray(v.more)) throw new Error(`notes.json: the full notes of ${v.id} do not read`);
  return { ...note, more: v.more.map(readPart) };
}

/** Every note in `notes.json`, newest first, out or waiting for its moment. */
export const NOTES: readonly Note[] = listed.map(readNote);

/** The moment a note goes out, by the world's clock: its `at`; a note with only its day, at that day's start. */
export const noteAt = (n: Pick<Note, "at">): number => Date.parse(n.at);
/**
 * The notes out at a moment of Leaf's clock (`leafNow`), newest first. A note whose `at` is still
 * to come waits for it: one merged ahead of a release (a banner's) shows only as it opens.
 */
export const notesAt = (now: number): readonly Note[] => NOTES.filter((n) => noteAt(n) <= now);
/** The newest notes out at a moment of Leaf's clock, as many as the News tab shows. */
export const newestAt = (now: number, count = 10): readonly Note[] => notesAt(now).slice(0, count);

// ---------- posting to Discord ----------

/**
 * A run of the poster (`.github/workflows/news.yml`): on a merge to main, with the note ids main had
 * before it and the merge's own moment; or by the clock, with the moment of its last run, its own,
 * and when each note was merged to main (`merged`, from the history).
 */
export type Posting =
  | { readonly by: "merge"; readonly had: readonly string[]; readonly at: number }
  | { readonly by: "clock"; readonly since: number; readonly now: number; readonly merged: (id: string) => number };

/**
 * The notes one run posts, oldest first. A merge posts what it added that is out at its moment. By
 * the clock, a run posts each note whose `at` came since the last run and that was merged before
 * its `at`, so it waited and no merge posted it. Each note is posted once, and never before its `at`.
 */
export function toPost(notes: readonly Note[], run: Posting): Note[] {
  const posted = notes.filter((n) =>
    run.by === "merge"
      ? !run.had.includes(n.id) && noteAt(n) <= run.at
      : run.since < noteAt(n) && noteAt(n) <= run.now && run.merged(n.id) < noteAt(n),
  );
  return posted.toReversed();
}

/** A note as a Discord message: its title, its lines and full notes, linked to the town, at its moment. */
export const messageOf = (n: Note): unknown => ({
  embeds: [
    {
      title: n.title,
      url: "https://leaf.seqwawa.com/play/town/",
      description: [
        ...n.lines,
        ...(n.more ?? []).map((p) => `**${p.head}**\n${p.points.map((t) => `- ${t}`).join("\n")}`),
      ]
        .join("\n\n")
        .slice(0, 4000),
      color: 16101685,
      timestamp: new Date(noteAt(n)).toISOString(),
    },
  ],
});
