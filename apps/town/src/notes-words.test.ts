/**
 * News reads like a person wrote it: every sentence of a note's `lines` is 25 words or fewer. It holds
 * for notes dated 28 November 2026 or later, those still to come and "TBD" too. The full notes
 * (`more`) are let be.
 */
import { describe, expect, test } from "bun:test";

import { type Note, NOTES } from "./notes.ts";

/** The most words a sentence of a note's lines may have. */
const MOST = 25;
/** The first day the rule holds for. */
const FROM = Date.UTC(2026, 10, 28);

/** Whether the rule holds for a note: dated on or after `FROM`, or not dated yet. */
const held = (n: Note): boolean => n.at === "TBD" || Date.parse(n.at) >= FROM;

/** The sentences of a line: each ends at a full stop, a question mark or an exclamation mark. */
const sentences = (line: string): string[] => line.split(/(?<=[.!?])\s+/).filter((s) => s.length > 0);

/** How many words a sentence has. */
const words = (s: string): number => s.split(/\s+/).filter((w) => w.length > 0).length;

/** Every sentence of the notes the rule holds for that has too many words, with its note's id. */
function tooLong(notes: readonly Note[]): string[] {
  return notes
    .filter(held)
    .flatMap((n) => n.lines.flatMap(sentences).flatMap((s) => (words(s) > MOST ? [`${n.id}: ${s}`] : [])));
}

describe("News", () => {
  test("every sentence of a note's lines is 25 words or fewer, from 28 November 2026", () => {
    expect(tooLong(NOTES)).toEqual([]);
  });

  test("the rule catches a long sentence in a new note, and lets an older note be", () => {
    const long = `${"word ".repeat(MOST).trim()} more.`;
    const of = (at: string): Note => ({ id: at, at, title: "t", lines: [`Short one. ${long}`] });
    expect(tooLong([of("TBD"), of("2027-01-01T00:00Z"), of("2026-11-28T00:00Z"), of("2026-11-27T23:59Z")])).toEqual([
      `TBD: ${long}`,
      `2027-01-01T00:00Z: ${long}`,
      `2026-11-28T00:00Z: ${long}`,
    ]);
  });
});
