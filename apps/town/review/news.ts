/**
 * The Discord poster's notes for one run, as Discord messages, one JSON line each, for
 * `.github/workflows/news.yml` to send:
 *
 *     bun apps/town/review/news.ts merge <notes.json as main had it before> <the merge's moment, ms>
 *     bun apps/town/review/news.ts clock <the last run's moment, ms> <this run's moment, ms>
 *
 * Which notes is `toPost`'s to say (`src/notes.ts`). By the clock, a note was merged when the commit
 * that added it to notes.json was made, from git's history: a checkout without it posts nothing.
 */
import { readFileSync } from "node:fs";

import { messageOf, NOTES, type Posting, toPost } from "../src/notes.ts";

const FILE = "apps/town/src/notes.json";

/** When the commit that added a note to the file was made; never, for one git's history does not have. */
function mergedAt(id: string): number {
  const log = Bun.spawnSync(["git", "log", "--reverse", "--format=%ct", `-S"id": "${id}"`, "--", FILE]);
  const first = log.stdout.toString().split("\n")[0] ?? "";
  return log.success && first !== "" ? Number(first) * 1000 : Number.POSITIVE_INFINITY;
}

/** The ids of the notes in a notes.json; none for a file that is not a list. */
function idsIn(path: string): string[] {
  const listed: unknown = JSON.parse(readFileSync(path, "utf8"));
  return Array.isArray(listed)
    ? listed.flatMap((n: unknown) =>
        typeof n === "object" && n !== null && "id" in n && typeof n.id === "string" ? [n.id] : [],
      )
    : [];
}

/** What this run is, from its arguments. */
function runOf([by = "", first = "", second = ""]: readonly string[]): Posting {
  const [since, moment] = [Number(first), Number(second)];
  if (by === "merge" && Number.isFinite(moment)) return { by, had: idsIn(first), at: moment };
  if (by === "clock" && Number.isFinite(since) && Number.isFinite(moment))
    return { by, since, now: moment, merged: mergedAt };
  throw new Error(`news.ts takes merge or clock and two moments, not: ${[by, first, second].join(" ")}`);
}

for (const note of toPost(NOTES, runOf(process.argv.slice(2)))) console.log(JSON.stringify(messageOf(note)));
