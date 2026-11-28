/**
 * What has changed in the game, for the "News" tab on the quest board, newest first: the notes are
 * data, one file each, `apps/town/notes/<id>.json`, read as the page is built (`notesListed`, a
 * macro). A change a player can see adds a note file of its own, in the words of someone telling a
 * friend, and no note is ever taken out. The notes are in the order of their `at`, newest first, and
 * notes of one minute by id. A note is out from its `at` (`notesAt`), so one for a release merged
 * ahead of its day waits for that moment, here and on Discord (`.github/workflows/news.yml`, `toPost`).
 *
 * A note's one or two lines are what everyone reads on the board. A bigger change also has its full
 * notes (`more`), which open under the lines: a few parts, each a heading and what changed under it.
 */

import { type Listed, notesListed } from "../build/notes.ts" with { type: "macro" };

export interface Note {
  id: string;
  /** When it went live, by the world's clock, to the minute: `2026-11-22T19:09Z`. */
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
    throw new Error(`notes: a part that does not read: ${JSON.stringify(v)}`);
  return { head: v.head, points: v.points };
}

/** A note from its file; one that does not read is a mistake in the file, and the board's tests say so. */
function readNote(v: unknown): Note {
  if (!isRecord(v) || typeof v.id !== "string" || typeof v.at !== "string" || typeof v.title !== "string")
    throw new Error(`notes: a note that does not read: ${JSON.stringify(v)}`);
  if (!isWords(v.lines)) throw new Error(`notes: the lines of ${v.id} do not read`);
  const note: Note = { id: v.id, at: v.at, title: v.title, lines: v.lines };
  if (v.more === undefined) return note;
  if (!Array.isArray(v.more)) throw new Error(`notes: the full notes of ${v.id} do not read`);
  return { ...note, more: v.more.map(readPart) };
}

/** A note from its file, which is named for its id: `apps/town/notes/<id>.json`. */
function readFile({ file, note }: Listed): Note {
  const read = readNote(note);
  if (read.id !== file) throw new Error(`notes: ${file}.json has the note ${read.id}; name it ${read.id}.json`);
  return read;
}

/** The moment a note goes out, by the world's clock: its `at`. */
export const noteAt = (n: Pick<Note, "at">): number => Date.parse(n.at);

/** Newest first, and notes of one moment by id. */
const newestFirst = (a: Note, b: Note): number => noteAt(b) - noteAt(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Every note, newest first, out or waiting for its moment. */
export const NOTES: readonly Note[] = notesListed().map(readFile).toSorted(newestFirst);
/**
 * The notes out at a moment of Leaf's clock (`leafNow`), newest first. A note whose `at` is still
 * to come waits for it: one merged ahead of a release (a banner's) shows only as it opens.
 */
export const notesAt = (now: number): readonly Note[] => NOTES.filter((n) => noteAt(n) <= now);
/**
 * The moment the News tab shows notes at: Leaf's clock once the page has it (`known`, from a room's
 * first sample or an answer); until then the moment the page was built (`built`), so a note dated
 * after that waits for Leaf's word. The device's own clock never decides.
 */
export const newsMoment = (leaf: number, known: boolean, built: number): number => (known ? leaf : built);
/** The newest notes out at a moment of Leaf's clock, as many as the News tab shows. */
export const newestAt = (now: number, count = 10): readonly Note[] => notesAt(now).slice(0, count);

// ---------- posting to Discord ----------

/** How long the poster keeps trying a note a channel has not taken. */
export const KEPT_FOR = 7 * 86_400_000;

/**
 * One run of the poster (`.github/workflows/news.yml`) for one channel: its moment (`now`), when the
 * poster began keeping a record of what each channel took (`since`: the poster before it posted the
 * notes merged earlier), when each note was merged to main (`merged`), and whether this channel has
 * taken a note already (`taken`, its record).
 */
export interface Posting {
  readonly now: number;
  readonly since: number;
  readonly merged: (id: string) => number;
  readonly taken: (id: string) => boolean;
}

/**
 * The notes one run posts to one channel, oldest first: each whose `at` has come in the last
 * `KEPT_FOR`, merged since the record began or dated after it (the poster before it posted the
 * rest), and not taken by this channel yet. So none is posted
 * before its `at` or twice to one channel, and one a channel did not take is tried again next run.
 */
export function toPost(notes: readonly Note[], run: Posting): Note[] {
  const due = notes.filter((n) => {
    const at = noteAt(n);
    const ours = run.merged(n.id) >= run.since || at > run.since;
    return at <= run.now && at > run.now - KEPT_FOR && ours && !run.taken(n.id);
  });
  // The notes are newest first: reversed, then sorted, notes of one moment go out in a fixed order.
  return due.toReversed().toSorted((a, b) => noteAt(a) - noteAt(b));
}

/**
 * Posts each note to a channel (`send` gives back what it answered, 0 for no answer) and records
 * each one it took (`keep`, true once written): only a 2xx is taking it. A 429, a 5xx or no answer
 * leaves it for the next run. Gives back, by id, what it took, what it left, and what it took but
 * could not record (`unmarked`): the rest are still posted, and the run is to fail.
 */
export async function deliver(
  notes: readonly Note[],
  send: (n: Note) => Promise<number>,
  keep: (n: Note) => Promise<boolean>,
): Promise<{ took: string[]; left: string[]; unmarked: string[] }> {
  const took: string[] = [];
  const left: string[] = [];
  const unmarked: string[] = [];
  for (const n of notes) {
    // One after another, as Discord asks of a webhook.
    // oxlint-disable-next-line no-await-in-loop -- in order
    const answer = await send(n);
    if (answer < 200 || answer >= 300) {
      left.push(n.id);
      continue;
    }
    took.push(n.id);
    // oxlint-disable-next-line no-await-in-loop -- in order
    if (!(await keep(n))) unmarked.push(n.id);
  }
  return { took, left, unmarked };
}

/** Every item of a list read a page at a time (`read`, pages from 1 of `size` each), until a page comes back short. */
export async function everyPage<T>(read: (page: number) => Promise<readonly T[]>, size: number): Promise<T[]> {
  const all: T[] = [];
  const at = { page: 1, got: size };
  while (at.got >= size) {
    // oxlint-disable-next-line no-await-in-loop -- each page says whether there is another
    const got = await read(at.page);
    all.push(...got);
    at.got = got.length;
    at.page += 1;
  }
  return all;
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
