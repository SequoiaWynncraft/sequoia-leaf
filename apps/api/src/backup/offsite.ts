import { join } from "node:path";

import { S3Client } from "bun";
import { Context, Effect, FileSystem, Layer, Option, Redacted, Ref, Schedule, Schema } from "effect";

import { type Snapshot, snapshotsIn, type SnapshotsUnreadable } from "./snapshot.ts";

/** The bucket did not take a snapshot. */
export class UploadFailed extends Schema.TaggedError<UploadFailed>()("UploadFailed", {
  snapshot: Schema.String,
  cause: Schema.Defect(),
}) {}

/** The record of which snapshot was copied last could not be read, or written after a copy. */
export class MarkerFailed extends Schema.TaggedError<MarkerFailed>()("MarkerFailed", {
  doing: Schema.Literals(["reading", "writing"]),
  cause: Schema.Defect(),
}) {}

/** An S3-compatible bucket, such as Cloudflare R2. */
export interface BucketConfig {
  /** For R2, `https://<account id>.r2.cloudflarestorage.com`. */
  readonly endpoint: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: Redacted.Redacted;
}

/** Somewhere off the server that snapshots are copied to. */
export class Offsite extends Context.Service<
  Offsite,
  {
    /** Copies a local file there under this name, replacing anything already under it. */
    readonly upload: (name: string, path: string) => Effect.Effect<void, UploadFailed>;
  }
>()("leaf/backup/Offsite") {
  /**
   * An S3-compatible bucket. Bun's client cannot be stopped mid-upload: an interrupted upload may
   * still finish, but nothing after it runs, so the copy is not recorded and is made again.
   */
  static readonly bucket = (config: BucketConfig) =>
    Layer.sync(Offsite, () => {
      const client = new S3Client({
        ...config,
        secretAccessKey: Redacted.value(config.secretAccessKey),
        region: "auto",
      });
      return Offsite.of({
        upload: (name, path) =>
          Effect.tryPromise({
            try: () => client.write(name, Bun.file(path), { type: "application/vnd.sqlite3" }),
            catch: (cause) => new UploadFailed({ snapshot: name, cause }),
          }).pipe(Effect.asVoid),
      });
    });
}

/** After a failed attempt the whole attempt is made again this long after, until one succeeds. */
export const RETRY = Schedule.spaced("10 minutes");

/** Holds the name of the newest snapshot copied off the server. It does not look like a snapshot, so it is never pruned. */
const COPIED = "offsite-copied";

/** The name of the snapshot last copied off the server, if any has been. */
const lastCopied = (directory: string) =>
  FileSystem.FileSystem.use((fs) => fs.readFileString(join(directory, COPIED))).pipe(
    Effect.map(Option.some),
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeedNone),
    Effect.mapError((cause) => new MarkerFailed({ doing: "reading", cause })),
  );

/**
 * Records `name` as the snapshot copied last. It is written under another name and renamed, so the
 * record is never half written; that other file is the scope's, and is gone however it ends.
 */
const markCopied = (directory: string, name: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const marker = join(directory, COPIED);
      const unfinished = yield* Effect.acquireRelease(
        Effect.sync(() => `${marker}.${crypto.randomUUID()}.partial`),
        (path) => Effect.ignore(fs.remove(path, { force: true })),
      );
      yield* fs.writeFileString(unfinished, name);
      yield* fs.rename(unfinished, marker);
    }),
  ).pipe(Effect.mapError((cause) => new MarkerFailed({ doing: "writing", cause })));

/** The snapshot copied last, of those still in the directory, if any is. */
export const copiedLast = (directory: string) =>
  Effect.gen(function* () {
    const name = yield* lastCopied(directory);
    const snapshots = yield* snapshotsIn(directory);
    return Option.flatMap(name, (copied) => Option.fromUndefinedOr(snapshots.find((one) => one.name === copied)));
  });

/** The newest snapshot, and whether this attempt finished copying it (`now`) or it was copied before. */
export interface Copied {
  readonly snapshot: Snapshot;
  readonly now: boolean;
}

/**
 * One attempt at copying the newest snapshot off the server: the newest, or none when there is
 * none. Only the newest is copied: one replaced by a newer one before it could be copied is
 * skipped, since the newer one holds everything it held. The bucket deletes old copies by itself.
 *
 * `taken` holds the name of the snapshot the bucket last took. One it took whose record could not
 * be written is not uploaded again: the next attempt only writes the record, unless a newer
 * snapshot has come meanwhile.
 */
export const copyNewest = (
  directory: string,
  taken: Ref.Ref<Option.Option<string>>,
): Effect.Effect<Option.Option<Copied>, CopyFailed, Offsite | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const newest = (yield* snapshotsIn(directory)).at(-1);
    if (newest === undefined) return Option.none();
    if (Option.contains(yield* lastCopied(directory), newest.name))
      return Option.some({ snapshot: newest, now: false });
    if (!Option.contains(yield* Ref.get(taken), newest.name)) {
      yield* Offsite.use((offsite) => offsite.upload(newest.name, join(directory, newest.name)));
      yield* Ref.set(taken, Option.some(newest.name));
    }
    yield* markCopied(directory, newest.name);
    return Option.some({ snapshot: newest, now: true });
  });

/** Why an attempt failed: the snapshots could not be read, the bucket did not take one, or the record of it was not kept. */
export type CopyFailed = SnapshotsUnreadable | UploadFailed | MarkerFailed;
