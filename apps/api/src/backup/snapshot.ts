import type { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

/** A new snapshot is taken when the newest one is this old. */
export const SNAPSHOT_INTERVAL_MS = 6 * 60 * 60_000;
/** A week of snapshots at four a day. Older ones are deleted. */
export const SNAPSHOTS_KEPT = 28;

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
export function takeSnapshot(db: Database, directory: string, now: number): string {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, nameAt(now));
  // The copy is written under another name and renamed when it is complete,
  // so a copy that was cut short never counts as a snapshot.
  const unfinished = `${path}.partial`;
  rmSync(unfinished, { force: true });
  db.query("VACUUM INTO ?").run(unfinished);
  renameSync(unfinished, path);
  const snapshots = listSnapshots(directory);
  for (const old of snapshots.slice(0, Math.max(0, snapshots.length - SNAPSHOTS_KEPT))) {
    rmSync(join(directory, old.name));
  }
  return path;
}

/** Takes a snapshot when there is none younger than the interval. Returns its path, or undefined when none was due. */
export function snapshotIfDue(db: Database, directory: string, now: number): string | undefined {
  const newest = listSnapshots(directory).at(-1);
  if (newest !== undefined && now - newest.takenAt < SNAPSHOT_INTERVAL_MS) {
    return undefined;
  }
  return takeSnapshot(db, directory, now);
}
