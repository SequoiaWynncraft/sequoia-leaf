/**
 * Posting the notes to Discord (`.github/workflows/news.yml`): each channel gets each note once, none
 * before its `at`, and one a channel did not take (Discord said 429 or 5xx) is tried again on the next
 * run, so nothing is lost. What each channel took is its record.
 */
import { describe, expect, test } from "bun:test";

import {
  deliver,
  everyPage,
  KEPT_FOR,
  messageOf,
  newsMoment,
  type Note,
  noteAt,
  NOTES,
  notesAt,
  type Posting,
  toPost,
} from "./notes.ts";

const DAY = 86_400_000;
const note = (id: string, at: string): Note => ({ id, at, title: id, lines: [`${id} happened.`] });
/** Groot Night's note, merged on 28 November for its banner's opening on 8 December. */
const NIGHT = note("groot-night", "2026-12-08T00:00Z");
const OPENS = Date.UTC(2026, 11, 8);
const MERGED = Date.UTC(2026, 10, 28, 15);
/** A note written as it merged, a minute before, on 3 December. */
const PLAIN = note("plain", "2026-12-03T14:59Z");
const PLAIN_MERGED = Date.UTC(2026, 11, 3, 15);
/** One merged before the poster kept a record: the poster before it posted it. */
const OLD = note("old", "2026-11-27T10:00Z");
const NOTES_THEN: readonly Note[] = [NIGHT, PLAIN, OLD];
/** When the poster began keeping its record. */
const SINCE = Date.UTC(2026, 10, 28);
const merged = (id: string): number =>
  id === "old" ? Date.UTC(2026, 10, 27, 10) : id === "plain" ? PLAIN_MERGED : MERGED;
/** A run for one channel at a moment, with what it has taken. */
const run = (now: number, taken: readonly string[] = []): Posting => ({
  now,
  since: SINCE,
  merged,
  taken: (id) => taken.includes(id),
});
const ids = (notes: readonly Note[]): string[] => notes.map((n) => n.id);
/** Groot Night's note merged a moment before the record began: a commit before the one that began it. */
const early = (id: string): number => (id === "groot-night" ? SINCE - 1 : merged(id));
/** The notes as they are now that the News tab shows at a moment. */
const shown = (moment: number): string[] => ids(notesAt(moment));
/** The notes as they are now that one run would post at a moment, nothing taken. */
const outAt = (now: number): string[] => ids(toPost(NOTES, { now, since: 0, merged: () => now, taken: () => false }));

describe("the poster", () => {
  test("posts each note that is out and not yet taken by the channel, oldest first, and never one still to come", () => {
    expect(ids(toPost(NOTES_THEN, run(MERGED)))).toEqual([]);
    expect(ids(toPost(NOTES_THEN, run(PLAIN_MERGED)))).toEqual(["plain"]);
    expect(ids(toPost(NOTES_THEN, run(OPENS - 1, ["plain"])))).toEqual([]);
    expect(ids(toPost(NOTES_THEN, run(OPENS, ["plain"])))).toEqual(["groot-night"]);
    expect(ids(toPost(NOTES_THEN, run(OPENS)))).toEqual(["plain", "groot-night"]);
    // Taken, it is not posted again; merged and dated before the record began, the poster before posted it.
    expect(ids(toPost(NOTES_THEN, run(OPENS, ["plain", "groot-night"])))).toEqual([]);
    expect(ids(toPost(NOTES_THEN, run(Date.UTC(2026, 10, 28, 1))))).toEqual([]);
    // Merged before the record began but dated after it (a commit before the one that began it): it is this poster's.
    expect(ids(toPost([NIGHT], { ...run(OPENS), merged: early }))).toEqual(["groot-night"]);
    // A week on, a note never taken is no longer tried.
    expect(ids(toPost(NOTES_THEN, run(OPENS + KEPT_FOR + 1)))).toEqual([]);
    expect(KEPT_FOR).toBe(7 * DAY);
  });

  test("a note a channel did not take is not recorded, and the next run tries it again; nothing is lost", async () => {
    const taken: string[] = [];
    const answers = [429, 200, 503];
    const tried: string[] = [];
    const keep = async (n: Note): Promise<boolean> => taken.push(n.id) > 0;
    const first = await deliver(
      [PLAIN, NIGHT, note("third", "2026-12-08T00:00Z")],
      async (n) => {
        tried.push(n.id);
        return answers.shift() ?? 200;
      },
      keep,
    );
    expect([first, tried, taken]).toEqual([
      { took: ["groot-night"], left: ["plain", "third"], unmarked: [] },
      ["plain", "groot-night", "third"],
      ["groot-night"],
    ]);
    // The next run: what it took is not tried again; what it left is.
    const next = toPost([...NOTES_THEN, note("third", "2026-12-08T00:00Z")], run(OPENS + 30 * 60_000, taken));
    expect(ids(next)).toEqual(["plain", "third"]);
    const second = await deliver(next, async () => 200, keep);
    expect(second).toEqual({ took: ["plain", "third"], left: [], unmarked: [] });
    // A channel that sends nothing back at all (a timeout, 0) has not taken it either.
    expect(
      await deliver(
        [PLAIN],
        async () => 0,
        async () => true,
      ),
    ).toEqual({ took: [], left: ["plain"], unmarked: [] });
  });

  test("a note taken whose mark could not be written does not stop the rest, and is told so the run fails", async () => {
    const sent: string[] = [];
    const marks = [false, true];
    const done = await deliver(
      [PLAIN, NIGHT],
      async (n) => sent.push(n.id) && 200,
      async () => marks.shift() ?? true,
    );
    expect([done, sent]).toEqual([
      { took: ["plain", "groot-night"], left: [], unmarked: ["plain"] },
      ["plain", "groot-night"],
    ]);
  });

  test("a commit's record is read from every page of its statuses, until a page comes back short", async () => {
    const statuses = Array.from({ length: 230 }, (_, i) => `news/NEWS_WEBHOOK/note-${i}`);
    const asked: number[] = [];
    const read = async (page: number): Promise<readonly string[]> => {
      asked.push(page);
      return statuses.slice((page - 1) * 100, page * 100);
    };
    expect(await everyPage(read, 100)).toEqual(statuses);
    expect(asked).toEqual([1, 2, 3]);
    // A full last page: one more, empty, says it was the last.
    expect(await everyPage(async (page) => (page <= 2 ? statuses.slice(0, 100) : []), 100)).toHaveLength(200);
  });

  test("each note as a message with its lines and full notes, at its own moment", () => {
    const full: Note = { ...NIGHT, more: [{ head: "New figures", points: ["Peep.", "Munch."] }] };
    expect(messageOf(full)).toEqual({
      embeds: [
        {
          title: "groot-night",
          url: "https://leaf.seqwawa.com/play/town/",
          description: "groot-night happened.\n\n**New figures**\n- Peep.\n- Munch.",
          color: 16101685,
          timestamp: "2026-12-08T00:00:00.000Z",
        },
      ],
    });
  });

  test("the notes as they are now: Groot Night's waits for its banner", () => {
    const night = NOTES.find((n) => n.id === "groot-night");
    expect(night && noteAt(night)).toBe(OPENS);
    expect(outAt(OPENS - 1)).not.toContain("groot-night");
    expect(outAt(OPENS)).toContain("groot-night");
  });
});

describe("the News tab before Leaf's clock is known", () => {
  test("only notes dated by the page's build show until the page has Leaf's clock; the device's clock never decides", () => {
    // A page built as Groot Night's note merged, on a device whose clock reads 8 December 01:00.
    const built = MERGED;
    const device = Date.UTC(2026, 11, 8, 1);
    const notes = [NIGHT, note("plain", "2026-11-28T14:59Z")];
    const out = (moment: number): string[] => ids(notes.filter((n) => noteAt(n) <= moment));
    expect(newsMoment(device, false, built)).toBe(built);
    expect(out(newsMoment(device, false, built))).toEqual(["plain"]);
    expect(shown(newsMoment(device, false, built))).not.toContain("groot-night");
    // A device behind the build is not believed either.
    expect(newsMoment(Date.UTC(2026, 10, 1), false, built)).toBe(built);
    // Once a sample or an answer gives Leaf's clock, it alone says what is out.
    expect(out(newsMoment(Date.UTC(2026, 10, 30), true, built))).toEqual(["plain"]);
    expect(out(newsMoment(OPENS, true, built))).toEqual(["groot-night", "plain"]);
    expect(shown(newsMoment(OPENS, true, built))).toContain("groot-night");
  });
});
