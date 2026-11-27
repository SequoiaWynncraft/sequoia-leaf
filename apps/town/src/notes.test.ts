/**
 * Posting the notes to Discord (`.github/workflows/news.yml`): each channel gets each note once, none
 * before its `at`, and one a channel did not take (Discord said 429 or 5xx) is tried again on the next
 * run, so nothing is lost. What each channel took is its record.
 */
import { describe, expect, test } from "bun:test";

import { deliver, KEPT_FOR, messageOf, newsMoment, type Note, noteAt, NOTES, type Posting, toPost } from "./notes.ts";

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
    const answers = [429, 204, 503];
    const tried: string[] = [];
    const first = await deliver(
      [PLAIN, NIGHT, note("third", "2026-12-08T00:00Z")],
      async (n) => {
        tried.push(n.id);
        return answers.shift() ?? 204;
      },
      async (n) => void taken.push(n.id),
    );
    expect([first, tried, taken]).toEqual([
      { took: ["groot-night"], left: ["plain", "third"] },
      ["plain", "groot-night", "third"],
      ["groot-night"],
    ]);
    // The next run: what it took is not tried again; what it left is.
    const next = toPost([...NOTES_THEN, note("third", "2026-12-08T00:00Z")], run(OPENS + 30 * 60_000, taken));
    expect(ids(next)).toEqual(["plain", "third"]);
    const second = await deliver(
      next,
      async () => 204,
      async (n) => void taken.push(n.id),
    );
    expect(second).toEqual({ took: ["plain", "third"], left: [] });
    // A channel that sends nothing back at all (a timeout, 0) has not taken it either.
    expect(
      await deliver(
        [PLAIN],
        async () => 0,
        async () => undefined,
      ),
    ).toEqual({ took: [], left: ["plain"] });
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
  test("a note dated after the page's start-up stays hidden until the page has Leaf's clock; then Leaf's clock decides", () => {
    // A device whose clock is a day ahead: it starts up on 8 December, an hour after Groot Night's note.
    const started = Date.UTC(2026, 11, 8, 1);
    const night = note("groot-night", "2026-12-08T00:00Z");
    const plain = note("plain", "2026-11-28T14:59Z");
    const shown = (moment: number) => [night, plain].filter((n) => noteAt(n) <= moment).map((n) => n.id);
    // Before Leaf's word, the page's own clock runs on past its start-up, but news stops there.
    expect(newsMoment(started + 60_000, false, started)).toBe(started);
    expect(shown(newsMoment(started + 60_000, false, Date.UTC(2026, 11, 7)))).toEqual(["plain"]);
    // Once a sample or an answer gives Leaf's clock, it alone says what is out, before or after the start-up.
    expect(shown(newsMoment(Date.UTC(2026, 10, 30), true, started))).toEqual(["plain"]);
    expect(shown(newsMoment(Date.UTC(2026, 11, 8), true, Date.UTC(2026, 11, 7)))).toEqual(["groot-night", "plain"]);
  });
});
