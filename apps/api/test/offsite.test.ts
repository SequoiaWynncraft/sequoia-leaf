import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Redacted } from "effect";

import { bucketOffsite, type Offsite, offsiteCopier, RETRY_MS } from "../src/backup/offsite.ts";
import { takeSnapshot } from "../src/backup/snapshot.ts";
import { noNetwork, rejection, testLeaf } from "./support.ts";

const T0 = Date.parse("2026-11-16T13:00:00Z");
const HOUR = 60 * 60_000;

let directory: string;
let backups: string;
let leafServer: ReturnType<typeof testLeaf>;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "leaf-offsite-"));
  backups = join(directory, "backups");
  // On a file, as on the server: a snapshot is copied from the database's file.
  leafServer = testLeaf({ now: T0 }, noNetwork, { databasePath: join(directory, "leaf.db") });
});

afterEach(async () => {
  await leafServer.dispose();
  rmSync(directory, { recursive: true });
});

/** Records what it is asked to upload, and fails while `failing` is set. */
function recorder() {
  const uploads: { name: string; bytes: number }[] = [];
  const state = { failing: false };
  const offsite: Offsite = {
    async upload(name, path) {
      if (state.failing) {
        throw new Error("the bucket is unreachable");
      }
      uploads.push({ name, bytes: readFileSync(path).length });
    },
  };
  return { offsite, uploads, state };
}

describe("copying snapshots off the server", () => {
  it("does nothing while there is no snapshot", async () => {
    const { offsite, uploads } = recorder();

    expect(await offsiteCopier(offsite, backups)(T0)).toBeUndefined();
    expect(uploads).toEqual([]);
  });

  it("copies the newest snapshot once, and the next one when it appears", async () => {
    const { offsite, uploads } = recorder();
    const copy = offsiteCopier(offsite, backups);
    await leafServer.run(takeSnapshot(backups, T0));

    expect(await copy(T0)).toBe("leaf-2026-11-16T13-00-00Z.db");
    expect(await copy(T0 + 1)).toBeUndefined();
    await leafServer.run(takeSnapshot(backups, T0 + 6 * HOUR));
    expect(await copy(T0 + 6 * HOUR)).toBe("leaf-2026-11-16T19-00-00Z.db");

    expect(uploads.map((upload) => upload.name)).toEqual([
      "leaf-2026-11-16T13-00-00Z.db",
      "leaf-2026-11-16T19-00-00Z.db",
    ]);
    expect(uploads[0]?.bytes).toBeGreaterThan(0);
  });

  it("remembers what it copied when the server restarts", async () => {
    await leafServer.run(takeSnapshot(backups, T0));
    await offsiteCopier(recorder().offsite, backups)(T0);
    const { offsite, uploads } = recorder();

    expect(await offsiteCopier(offsite, backups)(T0 + 1)).toBeUndefined();
    expect(uploads).toEqual([]);
  });

  it("skips a snapshot that a newer one replaced before it was copied", async () => {
    const { offsite, uploads } = recorder();
    await leafServer.run(takeSnapshot(backups, T0));
    await leafServer.run(takeSnapshot(backups, T0 + 6 * HOUR));

    await offsiteCopier(offsite, backups)(T0 + 6 * HOUR);

    expect(uploads.map((upload) => upload.name)).toEqual(["leaf-2026-11-16T19-00-00Z.db"]);
  });

  it("waits ten minutes after a failed copy before trying again", async () => {
    const { offsite, uploads, state } = recorder();
    const copy = offsiteCopier(offsite, backups);
    await leafServer.run(takeSnapshot(backups, T0));
    state.failing = true;

    expect(await rejection(copy(T0))).toEqual(new Error("the bucket is unreachable"));
    state.failing = false;
    expect(await copy(T0 + RETRY_MS - 1)).toBeUndefined();
    expect(uploads).toEqual([]);
    expect(await copy(T0 + RETRY_MS)).toBe("leaf-2026-11-16T13-00-00Z.db");
  });

  it("does not start a second copy while one is still running", async () => {
    const { promise: finished, resolve: finish } = Promise.withResolvers<void>();
    const started: string[] = [];
    const slow: Offsite = {
      upload: async (name) => {
        started.push(name);
        await finished;
      },
    };
    const copy = offsiteCopier(slow, backups);
    await leafServer.run(takeSnapshot(backups, T0));

    const first = copy(T0);
    expect(await copy(T0 + 60_000)).toBeUndefined();
    finish();

    expect(await first).toBe("leaf-2026-11-16T13-00-00Z.db");
    expect(started).toEqual(["leaf-2026-11-16T13-00-00Z.db"]);
  });
});

describe("bucketOffsite", () => {
  it("uploads the file to the bucket with a signed S3 request", async () => {
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
    const path = await leafServer.run(takeSnapshot(backups, T0));
    const offsite = bucketOffsite({
      endpoint: server.url.origin,
      bucket: "leaf-backups",
      accessKeyId: "key-id",
      secretAccessKey: Redacted.make("key-secret"),
    });

    await offsite.upload("leaf-2026-11-16T13-00-00Z.db", path);

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ method: "PUT", path: "/leaf-backups/leaf-2026-11-16T13-00-00Z.db" });
    expect(received[0]?.authorization).toStartWith("AWS4-HMAC-SHA256 Credential=key-id/");
    expect(received[0]?.body).toEqual(new Uint8Array(readFileSync(path)));
  });
});
