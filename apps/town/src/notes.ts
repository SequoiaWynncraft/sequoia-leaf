/**
 * What has changed in the game, for the "News" tab on the quest board, newest first: the notes are
 * data, in `notes.json`. A change a player can see adds a note at the top of it, in the words of
 * someone telling a friend, and nothing is ever taken out of the middle.
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

export const NOTES: readonly Note[] = listed.map(readNote);
