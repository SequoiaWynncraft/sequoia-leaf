/**
 * Moving a leftover one file of notes into a file each (`notes-move.ts`), held to each note as the
 * branch found it and as main has it now.
 */
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { moveNotes } from "./notes-move.ts";

interface Written {
  readonly id: string;
  readonly at: string;
  readonly title: string;
  readonly lines: readonly string[];
}
const note = (id: string, title: string): Written => ({
  id,
  at: "2026-11-28T12:00Z",
  title,
  lines: ["One."],
});

/** A root with main's note files and a branch's one file: the title each note's file has, and whether the one file is left. */
function scene(files: readonly Written[], incoming: readonly Written[]) {
  const root = mkdtempSync(join(tmpdir(), "leaf-notes-move-"));
  mkdirSync(join(root, "apps/town/notes"), { recursive: true });
  mkdirSync(join(root, "apps/town/src"), { recursive: true });
  for (const n of files) writeFileSync(join(root, "apps/town/notes", `${n.id}.json`), JSON.stringify(n));
  writeFileSync(join(root, "apps/town/src/notes.json"), JSON.stringify(incoming));
  const title = (id: string): unknown => {
    const read: unknown = JSON.parse(readFileSync(join(root, `apps/town/notes/${id}.json`), "utf8"));
    return typeof read === "object" && read !== null && "title" in read ? read.title : undefined;
  };
  const left = (): boolean => existsSync(join(root, "apps/town/src/notes.json"));
  return { root, title, left, done: () => rmSync(root, { recursive: true, force: true }) };
}

const BASE = new Map<string, unknown>([
  ["kept", note("kept", "Kept")],
  ["theirs", note("theirs", "Theirs")],
  ["mains", note("mains", "Mains")],
]);

test("a note the branch changed and main did not takes the branch's change; main's own change stays; a new note gets its file", () => {
  const s = scene(
    [note("kept", "Kept"), note("theirs", "Theirs"), note("mains", "Main's new title")],
    [note("new", "New"), note("kept", "Kept"), note("theirs", "The branch's new title"), note("mains", "Mains")],
  );
  try {
    expect(moveNotes(s.root, BASE)).toEqual({
      written: ["apps/town/notes/new.json", "apps/town/notes/theirs.json"],
      conflicts: [],
    });
    expect([s.title("new"), s.title("kept"), s.title("theirs"), s.title("mains"), s.left()]).toEqual([
      "New",
      "Kept",
      "The branch's new title",
      "Main's new title",
      false,
    ]);
  } finally {
    s.done();
  }
});

test("a note both changed, differently, is named, nothing is written, and the one file stays", () => {
  const s = scene(
    [note("theirs", "Theirs"), note("mains", "Main's new title")],
    [note("new", "New"), note("theirs", "The branch's new title"), note("mains", "The branch's other title")],
  );
  try {
    expect(moveNotes(s.root, BASE)).toEqual({ written: [], conflicts: ["mains"] });
    expect([s.title("theirs"), s.title("mains"), s.left()]).toEqual(["Theirs", "Main's new title", true]);
    expect(existsSync(join(s.root, "apps/town/notes/new.json"))).toBe(false);
    // Where the branch was cut is not known: every note changed is a conflict.
    expect(moveNotes(s.root, null).conflicts).toEqual(["theirs", "mains"]);
  } finally {
    s.done();
  }
});
