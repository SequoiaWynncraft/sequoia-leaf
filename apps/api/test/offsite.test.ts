import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { BunServices } from "@effect/platform-bun";
import {
  Deferred,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Logger,
  Metric,
  Option,
  PlatformError,
  Redacted,
  Ref,
  References,
  Scope,
} from "effect";
import { TestClock } from "effect/testing";

import { copyNewest, Offsite, UploadFailed } from "../src/backup/offsite.ts";
import { AppConfig } from "../src/config.ts";
import { OffsiteCopies } from "../src/jobs.ts";
import { testConfig } from "./support.ts";

const T0 = Date.parse("2026-11-16T13:00:00Z");
const BACKUPS = "/data/backups";
const FIRST = "leaf-2026-11-16T13-00-00Z.db";
const SECOND = "leaf-2026-11-16T19-00-00Z.db";
const MARKER = `${BACKUPS}/offsite-copied`;

type Method = "readDirectory" | "readFileString" | "rename";

/** A file system in memory, of files and the directories they are in, whose methods can be made to fail. */
function memoryDisk() {
  const files = new Map<string, string>();
  const broken = new Set<Method>();
  const fail = (method: Method, path: string, tag: "NotFound" | "PermissionDenied") =>
    Effect.fail(PlatformError.systemError({ _tag: tag, module: "FileSystem", method, pathOrDescriptor: path }));
  const layer = FileSystem.layerNoop({
    readDirectory: (path) =>
      broken.has("readDirectory")
        ? fail("readDirectory", path, "PermissionDenied")
        : [...files.keys()].some((file) => dirname(file) === path)
          ? Effect.succeed(
              [...files.keys()].filter((file) => dirname(file) === path).map((file) => file.slice(path.length + 1)),
            )
          : fail("readDirectory", path, "NotFound"),
    readFileString: (path) => {
      const text = files.get(path);
      if (broken.has("readFileString")) return fail("readFileString", path, "PermissionDenied");
      return text === undefined ? fail("readFileString", path, "NotFound") : Effect.succeed(text);
    },
    writeFileString: (path, text) => Effect.sync(() => void files.set(path, text)),
    rename: (from, to) => {
      const text = files.get(from);
      if (broken.has("rename")) return fail("rename", from, "PermissionDenied");
      if (text === undefined) return fail("rename", from, "NotFound");
      return Effect.sync(() => {
        files.delete(from);
        files.set(to, text);
      });
    },
    remove: (path) => Effect.sync(() => void files.delete(path)),
  });
  const snapshot = (name: string) => files.set(`${BACKUPS}/${name}`, `the database, as ${name}`);
  return { files, broken, layer, snapshot };
}

/** A stand-in bucket: what it was given, failing while `failing` is set, and each upload held at `gate` while there is one. */
function stagedBucket() {
  const started: string[] = [];
  const uploaded: string[] = [];
  const state: { failing: boolean; gate: Deferred.Deferred<void> | null } = { failing: false, gate: null };
  const layer = Layer.succeed(Offsite)(
    Offsite.of({
      upload: (name) =>
        Effect.gen(function* () {
          started.push(name);
          if (state.gate !== null) yield* Deferred.await(state.gate);
          if (state.failing) {
            return yield* new UploadFailed({ snapshot: name, cause: new Error("the bucket is unreachable") });
          }
          uploaded.push(name);
        }),
    }),
  );
  return { started, uploaded, state, layer };
}

/** What the job logged: each line's message and annotations. */
type Logged = { readonly message: unknown; readonly annotations: Readonly<Record<string, unknown>> };

/**
 * The offsite job as Leaf runs it, every minute on its own fiber, over the disk and bucket given, on
 * a test clock set to T0. `start` builds it in a scope of its own, which `stop` closes.
 */
function harness(disk: ReturnType<typeof memoryDisk>, bucket: ReturnType<typeof stagedBucket>) {
  const lines: Logged[] = [];
  const environment = Layer.mergeAll(
    Layer.succeed(AppConfig)(testConfig({ backupDirectory: BACKUPS })),
    disk.layer,
    bucket.layer,
    Logger.layer([
      Logger.map(Logger.formatStructured, ({ message, annotations }) => void lines.push({ message, annotations })),
    ]),
    Layer.succeed(References.MinimumLogLevel)("All"),
    Layer.succeed(Metric.MetricRegistry)(new Map()),
    TestClock.layer(),
  );
  const run = <A, E>(test: (job: Job) => Effect.Effect<A, E, Layer.Success<typeof environment>>) =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(T0);
        const scope = yield* Scope.make();
        const job: Job = {
          // Built, its first run is the one at once.
          start: Layer.buildWithScope(OffsiteCopies, scope).pipe(Effect.andThen(TestClock.adjust(0))),
          stop: Scope.close(scope, Exit.void),
        };
        const result = yield* test(job);
        yield* job.stop;
        return result;
      }).pipe(Effect.provide(environment)),
    );
  /** The job's series: runs, failures and its last success, in seconds. */
  const series = Effect.map(Metric.snapshot, (all) =>
    ["background_job_runs_total", "background_job_failures_total", "background_job_last_success_timestamp_seconds"].map(
      (id) => {
        const one = all.find((metric) => metric.id === id && metric.attributes?.["name"] === "snapshot_offsite");
        return one === undefined
          ? undefined
          : "count" in one.state
            ? one.state.count
            : "value" in one.state
              ? one.state.value
              : undefined;
      },
    ),
  );
  const failures = () =>
    lines.filter((line) => line.annotations["reason"] !== undefined).map((line) => line.annotations);
  return { run, lines, series, failures };
}

interface Job {
  readonly start: Effect.Effect<void, never, Layer.Services<typeof OffsiteCopies>>;
  readonly stop: Effect.Effect<void>;
}

describe("copying snapshots off the server", () => {
  it("copies the newest snapshot once, and the next one when it appears, counting each copy", async () => {
    const disk = memoryDisk();
    const bucket = stagedBucket();
    const { run, series } = harness(disk, bucket);
    disk.snapshot(FIRST);

    const counted = await run((job) =>
      Effect.gen(function* () {
        yield* job.start;
        yield* TestClock.adjust("2 minutes");
        disk.snapshot(SECOND);
        yield* TestClock.adjust("1 minute");
        return yield* series;
      }),
    );

    expect(bucket.uploaded).toEqual([FIRST, SECOND]);
    expect(disk.files.get(MARKER)).toBe(SECOND);
    expect(counted).toEqual([2, undefined, (T0 + 3 * 60_000) / 1000]);
  });

  it("copies nothing while there is no directory yet, and nothing already copied, as Leaf starts again", async () => {
    const disk = memoryDisk();
    const bucket = stagedBucket();
    await harness(disk, bucket).run((job) => Effect.andThen(job.start, TestClock.adjust("1 minute")));
    expect(bucket.started).toEqual([]);

    disk.snapshot(FIRST);
    disk.files.set(MARKER, FIRST);
    const { run, series, failures } = harness(disk, bucket);
    const counted = await run((job) =>
      Effect.gen(function* () {
        yield* job.start;
        yield* TestClock.adjust("1 minute");
        return yield* series;
      }),
    );

    expect(bucket.started).toEqual([]);
    expect(failures()).toEqual([]);
    // As it starts, it last succeeded when the snapshot it copied last was taken.
    expect(counted).toEqual([undefined, undefined, T0 / 1000]);
  });

  it("skips a snapshot that a newer one replaced before it was copied", async () => {
    const disk = memoryDisk();
    const bucket = stagedBucket();
    disk.snapshot(FIRST);
    disk.snapshot(SECOND);

    await harness(disk, bucket).run((job) => job.start);

    expect(bucket.uploaded).toEqual([SECOND]);
  });

  it("logs a failed upload with why and when a copy last succeeded, counts it, and makes the whole attempt again ten minutes later", async () => {
    const disk = memoryDisk();
    const bucket = stagedBucket();
    const { run, series, failures } = harness(disk, bucket);
    disk.snapshot(FIRST);
    disk.files.set(MARKER, FIRST);
    disk.snapshot(SECOND);
    bucket.state.failing = true;

    const counted = await run((job) =>
      Effect.gen(function* () {
        yield* job.start;
        bucket.state.failing = false;
        yield* TestClock.adjust("9 minutes");
        const waited = bucket.started.length;
        // A snapshot taken meanwhile is the newest, and the one the next attempt copies.
        disk.snapshot("leaf-2026-11-17T01-00-00Z.db");
        yield* TestClock.adjust("1 minute");
        return { waited, series: yield* series };
      }),
    );

    expect(counted.waited).toBe(1);
    expect(bucket.started).toEqual([SECOND, "leaf-2026-11-17T01-00-00Z.db"]);
    expect(failures()).toEqual([{ reason: "upload_failed", last_copied_at: "2026-11-16T13:00:00.000Z" }]);
    expect(counted.series).toEqual([2, 1, (T0 + 10 * 60_000) / 1000]);
  });

  it("after a copy whose record could not be written, says so every ten minutes, leaves no half-written record, and only writes the record again, never uploading twice", async () => {
    const disk = memoryDisk();
    const bucket = stagedBucket();
    const { run, series, failures } = harness(disk, bucket);
    disk.snapshot(FIRST);
    disk.broken.add("rename");

    const counted = await run((job) =>
      Effect.gen(function* () {
        yield* job.start;
        const leftOver = [...disk.files.keys()].filter((path) => path.endsWith(".partial"));
        yield* TestClock.adjust("59 minutes");
        disk.broken.delete("rename");
        yield* TestClock.adjust("1 minute");
        return { leftOver, series: yield* series };
      }),
    );

    expect(counted.leftOver).toEqual([]);
    expect(bucket.uploaded).toEqual([FIRST]);
    expect(disk.files.get(MARKER)).toBe(FIRST);
    expect(failures()).toEqual(
      Array.from({ length: 6 }, () => ({ reason: "record_not_written", last_copied_at: null })),
    );
    expect(counted.series).toEqual([7, 6, (T0 + 60 * 60_000) / 1000]);
  });

  it("says when its record cannot be read as Leaf starts, and once it can, when the copy last succeeded, uploading nothing", async () => {
    const disk = memoryDisk();
    const bucket = stagedBucket();
    const { run, series, failures } = harness(disk, bucket);
    disk.snapshot(FIRST);
    disk.files.set(MARKER, FIRST);
    disk.broken.add("readFileString");

    const counted = await run((job) =>
      Effect.gen(function* () {
        yield* job.start;
        disk.broken.delete("readFileString");
        yield* TestClock.adjust("10 minutes");
        return yield* series;
      }),
    );

    expect(bucket.started).toEqual([]);
    expect(failures()).toEqual([{ reason: "record_not_read", last_copied_at: null }]);
    expect(counted).toEqual([1, 1, T0 / 1000]);
  });

  it("says when the snapshots cannot be read, rather than taking that for there being none", async () => {
    const disk = memoryDisk();
    const bucket = stagedBucket();
    const { run, series, failures } = harness(disk, bucket);
    disk.snapshot(FIRST);
    disk.broken.add("readDirectory");

    const counted = await run((job) => Effect.andThen(job.start, series));

    expect(bucket.started).toEqual([]);
    expect(failures()).toEqual([{ reason: "snapshots_unreadable", last_copied_at: null }]);
    expect(counted).toEqual([1, 1, 0]);
  });

  it("runs one copy at a time, and an interrupted copy records nothing, even should its upload finish after", async () => {
    const disk = memoryDisk();
    const bucket = stagedBucket();
    disk.snapshot(FIRST);

    await harness(disk, bucket).run((job) =>
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>();
        bucket.state.gate = gate;
        yield* job.start;
        yield* TestClock.adjust("5 minutes");
        expect(bucket.started).toEqual([FIRST]);
        yield* job.stop;
        yield* Deferred.succeed(gate, undefined);
        yield* TestClock.adjust("1 minute");
      }),
    );

    expect(bucket.uploaded).toEqual([]);
    expect(disk.files.has(MARKER)).toBe(false);
  });
});

describe("the record of what was copied, on a real disk", () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "leaf-offsite-"));
  });
  afterEach(() => rmSync(directory, { recursive: true }));

  it("is written whole and read back, and nothing else is left beside it", async () => {
    const backups = join(directory, "backups");
    mkdirSync(backups);
    writeFileSync(join(backups, FIRST), "a database");
    const bucket = stagedBucket();
    const taken = Effect.runSync(Ref.make(Option.none<string>()));
    const copy = copyNewest(backups, taken).pipe(Effect.provide(Layer.merge(bucket.layer, BunServices.layer)));
    const snapshot = { name: FIRST, takenAt: T0 };

    expect(await Effect.runPromise(copy)).toEqual(Option.some({ snapshot, now: true }));
    expect(await Effect.runPromise(copy)).toEqual(Option.some({ snapshot, now: false }));
    expect(bucket.uploaded).toEqual([FIRST]);
    expect(readdirSync(backups).toSorted()).toEqual([FIRST, "offsite-copied"]);
    expect(readFileSync(join(backups, "offsite-copied"), "utf8")).toBe(FIRST);
  });
});

describe("the bucket", () => {
  it("uploads the file with a signed S3 request", async () => {
    const received: { method: string; path: string; authorization: string; body: Uint8Array }[] = [];
    using server = Bun.serve({
      port: 0,
      async fetch(request) {
        received.push({
          method: request.method,
          path: new URL(request.url).pathname,
          authorization: request.headers.get("authorization") ?? "",
          body: new Uint8Array(await request.arrayBuffer()),
        });
        return new Response(null, { status: 200, headers: { ETag: '"1"' } });
      },
    });
    const directory = mkdtempSync(join(tmpdir(), "leaf-offsite-"));
    const path = join(directory, FIRST);
    writeFileSync(path, "a database");
    const bucket = Offsite.bucket({
      endpoint: server.url.origin,
      bucket: "leaf-backups",
      accessKeyId: "key-id",
      secretAccessKey: Redacted.make("key-secret"),
    });

    await Effect.runPromise(Offsite.use((offsite) => offsite.upload(FIRST, path)).pipe(Effect.provide(bucket)));
    rmSync(directory, { recursive: true });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ method: "PUT", path: `/leaf-backups/${FIRST}` });
    expect(received[0]?.authorization).toStartWith("AWS4-HMAC-SHA256 Credential=key-id/");
    expect(new TextDecoder().decode(received[0]?.body)).toBe("a database");
  });

  it("fails as an upload failure when the bucket refuses", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: () => new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 }),
    });
    const bucket = Offsite.bucket({
      endpoint: server.url.origin,
      bucket: "leaf-backups",
      accessKeyId: "key-id",
      secretAccessKey: Redacted.make("key-secret"),
    });
    const directory = mkdtempSync(join(tmpdir(), "leaf-offsite-"));
    writeFileSync(join(directory, FIRST), "a database");

    const failed = await Effect.runPromise(
      Effect.flip(Offsite.use((offsite) => offsite.upload(FIRST, join(directory, FIRST)))).pipe(Effect.provide(bucket)),
    );
    rmSync(directory, { recursive: true });

    expect(failed).toMatchObject({ _tag: "UploadFailed", snapshot: FIRST });
  });
});
