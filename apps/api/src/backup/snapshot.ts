import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import { Effect, FileSystem, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { AppConfig } from "../config.ts";

/** A new snapshot is taken when the newest one is this old. */
export const SNAPSHOT_INTERVAL_MS = 6 * 60 * 60_000;
/** A week of snapshots at four a day. Older ones are deleted. */
export const SNAPSHOTS_KEPT = 28;

/** An unfinished copy this old was abandoned by a server that stopped mid-copy. A copy takes seconds at most. */
const ABANDONED_AFTER_MS = 60 * 60_000;

/** The script that copies the database in a process of its own. */
const VACUUM = join(import.meta.dir, "vacuum.ts");

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

/** A snapshot of the database: its file's name in the directory, and when it was taken. */
export interface Snapshot {
  readonly name: string;
  readonly takenAt: number;
}

/** The directory of snapshots could not be read, for anything but its not being there yet. */
export class SnapshotsUnreadable extends Schema.TaggedError<SnapshotsUnreadable>()("SnapshotsUnreadable", {
  directory: Schema.String,
  cause: Schema.Defect(),
}) {}

/** The snapshots in a directory, oldest first: none while there is no directory yet. */
export const snapshotsIn = (directory: string): Effect.Effect<Snapshot[], SnapshotsUnreadable, FileSystem.FileSystem> =>
  FileSystem.FileSystem.use((fs) => fs.readDirectory(directory)).pipe(
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed<string[]>([])),
    Effect.mapError((cause) => new SnapshotsUnreadable({ directory, cause })),
    Effect.map((names) =>
      names
        .flatMap((name) => {
          const at = takenAt(name);
          return at === undefined ? [] : [{ name, takenAt: at }];
        })
        .toSorted((a, b) => a.takenAt - b.takenAt),
    ),
  );

/**
 * Writes a complete copy of the database, consistent as of one moment, to a
 * new file in the directory, then deletes all but the newest `SNAPSHOTS_KEPT`.
 * Returns the new file's path. The copy is an ordinary database file: to
 * restore, stop the server and put it in place of the database. Another
 * process copies it (`vacuum.ts`), reading the database file beside Leaf, so
 * that Leaf's thread goes on answering meanwhile; a database in memory has no
 * file, and is not copied: that is a defect.
 */
export const takeSnapshot = Effect.fn("takeSnapshot")(function* (directory: string, now: number) {
  const { databasePath } = yield* AppConfig;
  if (databasePath === ":memory:") {
    return yield* Effect.die(new Error("A database in memory has no file to copy"));
  }
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const path = join(directory, nameAt(now));
  // The copy is written under another name and renamed when it is complete,
  // so a copy that was cut short never counts as a snapshot. The name is
  // unique to this attempt: during a deploy two servers can copy at once.
  const unfinished = `${path}.${crypto.randomUUID()}.partial`;
  yield* Effect.sync(() => mkdirSync(directory, { recursive: true }));
  const copy = Effect.scoped(
    Effect.gen(function* () {
      const copier = yield* spawner.spawn(ChildProcess.make(process.execPath, [VACUUM, databasePath, unfinished]));
      const [said, code] = yield* Effect.all([Stream.mkString(Stream.decodeText(copier.all)), copier.exitCode], {
        concurrency: 2,
      });
      if (code !== 0) return yield* Effect.die(new Error(`Copying the database failed (${code}): ${said.trim()}`));
    }),
  );
  yield* copy.pipe(
    Effect.orDie,
    Effect.andThen(Effect.sync(() => renameSync(unfinished, path))),
    Effect.ensuring(Effect.sync(() => rmSync(unfinished, { force: true }))),
  );
  yield* Effect.sync(() => removeAbandonedCopies(directory));
  const snapshots = yield* snapshotsIn(directory);
  yield* Effect.sync(() => {
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
  snapshotsIn(directory).pipe(
    Effect.flatMap((snapshots) => {
      const newest = snapshots.at(-1);
      return newest !== undefined && now - newest.takenAt < SNAPSHOT_INTERVAL_MS
        ? Effect.succeed(undefined)
        : takeSnapshot(directory, now);
    }),
  );
