/**
 * Posting the notes to Discord (`.github/workflows/news.yml`): each note once, and none before its
 * `at`, whether a merge brings it or it was merged ahead of its moment and waits for the clock.
 */
import { describe, expect, test } from "bun:test";

import { messageOf, type Note, noteAt, NOTES, type Posting, toPost } from "./notes.ts";

const MINUTE = 60_000;
const note = (id: string, at: string): Note => ({ id, at, title: id, lines: [`${id} happened.`] });
/** Groot Night's note, merged on 28 November for its banner's opening on 8 December. */
const NIGHT = note("groot-night", "2026-12-08T00:00Z");
const OPENS = Date.UTC(2026, 11, 8);
const MERGED = Date.UTC(2026, 10, 28, 15);
/** A note written as it merged, a minute before. */
const PLAIN = note("plain", "2026-11-28T14:59Z");
const NOTES_THEN: readonly Note[] = [NIGHT, PLAIN];
const merged = (id: string): number => (id === "groot-night" || id === "plain" ? MERGED : 0);

/** When a note was merged, for one git's history does not have. */
const never = (): number => Number.POSITIVE_INFINITY;
/** The notes as they are now that a merge at a moment would post. */
const outAt = (now: number): string[] => toPost(NOTES, { by: "merge", had: [], at: now }).map((n) => n.id);

/** What the clock posts over a run of runs from `from` to `to`, `every` apart: each run's ids. */
function clockRuns(from: number, to: number, every: number): string[][] {
  const out: string[][] = [];
  for (let since = from; since < to; since += every) {
    const run: Posting = { by: "clock", since, now: since + every, merged };
    out.push(toPost(NOTES_THEN, run).map((n) => n.id));
  }
  return out;
}

describe("the poster", () => {
  test("a merge posts the notes it added that are out at its moment, and never one still to come", () => {
    expect(toPost(NOTES_THEN, { by: "merge", had: [], at: MERGED }).map((n) => n.id)).toEqual(["plain"]);
    // Nothing it had before is posted again.
    expect(toPost(NOTES_THEN, { by: "merge", had: ["plain"], at: MERGED })).toEqual([]);
    // Merged at the very moment, it is out.
    expect(toPost([NIGHT], { by: "merge", had: [], at: OPENS }).map((n) => n.id)).toEqual(["groot-night"]);
    expect(toPost([NIGHT], { by: "merge", had: [], at: OPENS - 1 })).toEqual([]);
  });

  test("the clock posts a note that waited, in the run whose window its `at` falls in, and only that one", () => {
    // Runs half an hour apart from the merge to past the opening: the first run at or after it posts it.
    const runs = clockRuns(MERGED, OPENS + 2 * 60 * MINUTE, 30 * MINUTE);
    expect(runs.flat()).toEqual(["groot-night"]);
    const at = runs.findIndex((ids) => ids.length > 0);
    expect(MERGED + (at + 1) * 30 * MINUTE).toBeGreaterThanOrEqual(OPENS);
    expect(MERGED + at * 30 * MINUTE).toBeLessThan(OPENS);
    // A millisecond before, no run has posted it; a run that ends at the moment does.
    expect(toPost(NOTES_THEN, { by: "clock", since: OPENS - 30 * MINUTE, now: OPENS - 1, merged })).toEqual([]);
    expect(toPost(NOTES_THEN, { by: "clock", since: OPENS - 30 * MINUTE, now: OPENS, merged })).toEqual([NIGHT]);
  });

  test("the clock leaves a note a merge posted: one whose `at` had come when it merged", () => {
    expect(clockRuns(MERGED - 60 * MINUTE, MERGED + 60 * MINUTE, 30 * MINUTE).flat()).toEqual([]);
    // Merged after its moment, inside the clock's window: the merge posted it, not the clock.
    const late = (id: string): number => (id === "groot-night" ? OPENS + MINUTE : 0);
    expect(toPost([NIGHT], { by: "clock", since: OPENS - MINUTE, now: OPENS + 30 * MINUTE, merged: late })).toEqual([]);
    expect(toPost([NIGHT], { by: "merge", had: [], at: OPENS + MINUTE })).toEqual([NIGHT]);
    // One git's history has no merge for is never posted by the clock.
    expect(toPost([NIGHT], { by: "clock", since: OPENS - 1, now: OPENS, merged: never })).toEqual([]);
  });

  test("posts oldest first, each as a message with its lines and full notes, at its own moment", () => {
    const both = toPost(NOTES_THEN, { by: "merge", had: [], at: OPENS });
    expect(both.map((n) => n.id)).toEqual(["plain", "groot-night"]);
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

  test("the notes as they are now: Groot Night's waits for its banner, and every other is out", () => {
    const night = NOTES.find((n) => n.id === "groot-night");
    expect(night && noteAt(night)).toBe(OPENS);
    expect(outAt(OPENS - 1)).not.toContain("groot-night");
    expect(outAt(OPENS)).toContain("groot-night");
    expect(outAt(OPENS - 1).length).toBe(NOTES.length - 1);
  });
});
