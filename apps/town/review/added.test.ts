/**
 * The commit that added each patch note (`added.ts`), on a repository of its own: notes in the one
 * file, the move into a file each, and notes added since, one of them on one line as `bun fmt`
 * writes a short note.
 */
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { addedBy, unrecorded } from "./added.ts";

/** A long note, as a file or an entry of the one file keeps it. */
const long = (id: string): string =>
  `{\n  "id": "${id}",\n  "at": "2026-11-28T12:00Z",\n  "title": "Long",\n  "lines": ["One.", "Two."]\n}`;
/** A short note, on one line. */
const short = (id: string): string =>
  `{ "id": "${id}", "at": "2026-11-28T12:00Z", "title": "Short", "lines": ["One."] }`;

test("each note's commit is the one that added its file, or for a note of the one file, the one that put it there first", () => {
  const dir = mkdtempSync(join(tmpdir(), "leaf-notes-added-"));
  try {
    const git = (...args: string[]): string => {
      const out = Bun.spawnSync(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
        { cwd: dir, stdout: "pipe", stderr: "pipe" },
      );
      if (!out.success) throw new Error(`git ${args.join(" ")}: ${out.stderr.toString()}`);
      return out.stdout.toString().trim();
    };
    const write = (path: string, text: string): void => {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), `${text}\n`);
    };
    const commit = (message: string): string => {
      git("add", "-A");
      git("commit", "-qm", message);
      return git("rev-parse", "HEAD");
    };
    git("init", "-qb", "main");
    write("apps/town/src/notes.json", `[\n  ${short("old-short")},\n${long("old-long")}\n]`);
    const first = commit("the one file");
    // The move: a file for each, the one file gone.
    write("apps/town/notes/old-short.json", short("old-short"));
    write("apps/town/notes/old-long.json", long("old-long"));
    rmSync(join(dir, "apps/town/src/notes.json"));
    commit("a file each");
    write("apps/town/notes/new-short.json", short("new-short"));
    const added = commit("a short note");
    write("apps/town/notes/new-short.json", long("new-short"));
    write("apps/town/notes/new-long.json", long("new-long"));
    const later = commit("the short note grows, and a long one");
    const by = addedBy(dir);
    expect(Object.fromEntries([...by].map(([id, a]) => [id, a.sha]))).toEqual({
      "old-short": first,
      "old-long": first,
      "new-short": added,
      "new-long": later,
    });
    expect(unrecorded(["new-short", "nobody-wrote-it"], by)).toEqual(["nobody-wrote-it"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
