import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import { Effect } from "effect";
import { SqlClient } from "effect/sql";

/** A new snapshot is taken when the newest one is this old. */
export const SNAPSHOT_INTERVAL_MS = 6 * 60 * 60_000;
/** A week of snapshots at four a day. Older ones are deleted. */
export const SNAPSHOTS_KEPT = 28;

/** An unfinished copy this old was abandoned by a server that stopped mid-copy. A copy takes seconds at most. */
const ABANDONED_AFTER_MS = 60 * 60_000;

const NAME = /^leaf-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})Z\.db$/;

/** `leaf-2026-11-16T13-00-00Z.db`: sorts by time, and has no colon, which some file systems refuse. */
function nameAt(at: number): string {
  return `leaf-${new Date(at).toISOString().slice(0, 19).replaceAll(":", "-")}Z.db`;
}

function takenAt(name: string): number | undefined {
  const stamp = NAME.exec(name)?.[1];
  if (stamp === undefined) {
    return undefined;
  }
  const [date, time] = stamp.split("T");
  return Date.parse(`${date}T${time?.replaceAll("-", ":")}Z`);
}

/** The snapshots in a directory, oldest first. */
export function listSnapshots(directory: string): { name: string; takenAt: number }[] {
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    return [];
  }
  return names
    .flatMap((name) => {
      const at = takenAt(name);
      return at === undefined ? [] : [{ name, takenAt: at }];
    })
    .toSorted((a, b) => a.takenAt - b.takenAt);
}

/**
 * Writes a complete copy of the database, consistent as of one moment, to a
 * new file in the directory, then deletes all but the newest `SNAPSHOTS_KEPT`.
 * Returns the new file's path. The copy is an ordinary database file: to
 * restore, stop the server and put it in place of the database.
 */
export const takeSnapshot = Effect.fn("takeSnapshot")(function* (directory: string, now: number) {
  const sql = yield* SqlClient.SqlClient;
  const path = join(directory, nameAt(now));
  // The copy is written under another name and renamed when it is complete,
  // so a copy that was cut short never counts as a snapshot. The name is
  // unique to this attempt: during a deploy two servers can copy at once.
  const unfinished = `${path}.${crypto.randomUUID()}.partial`;
  yield* Effect.sync(() => mkdirSync(directory, { recursive: true }));
  yield* sql`VACUUM INTO ${unfinished}`.pipe(
    Effect.andThen(Effect.sync(() => renameSync(unfinished, path))),
    Effect.ensuring(Effect.sync(() => rmSync(unfinished, { force: true }))),
  );
  yield* Effect.sync(() => {
    removeAbandonedCopies(directory);
    const snapshots = listSnapshots(directory);
    for (const old of snapshots.slice(0, Math.max(0, snapshots.length - SNAPSHOTS_KEPT))) {
      rmSync(join(directory, old.name));
    }
  });
  return path;
});

/** Deletes unfinished copies left behind by a server that stopped mid-copy. */
function removeAbandonedCopies(directory: string): void {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    // File times come from the real clock, so this compares against it too.
    if (name.endsWith(".partial") && Date.now() - statSync(path).mtimeMs > ABANDONED_AFTER_MS) {
      rmSync(path, { force: true });
    }
  }
}

/** Takes a snapshot when there is none younger than the interval. Returns its path, or undefined when none was due. */
export const snapshotIfDue = (directory: string, now: number) =>
  Effect.suspend(() => {
    const newest = listSnapshots(directory).at(-1);
    return newest !== undefined && now - newest.takenAt < SNAPSHOT_INTERVAL_MS
      ? Effect.succeed(undefined)
      : takeSnapshot(directory, now);
  });
