import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { draftEntry, leaf, playerId } from "@sequoia-leaf/core";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { SqlClient } from "effect/sql";

import { databaseAt } from "../src/db.ts";
import { Ledger } from "../src/ledger/store.ts";
import { MAX_WINDOW_MS, SETTLE_MS, windowedSync } from "../src/sync/windowed.ts";

const alice = playerId("00000000-0000-4000-8000-00000000000a");
const MINUTE = 60_000;
const T0 = 1_763_000_000_000;

let directory: string;
let path: string;
/** Another process's connection to the same file, such as a script run by hand. */
let other: Database;

/** Runs a program as the server does, on its own connection to the file. */
function server<A, E>(program: Effect.Effect<A, E, SqlClient.SqlClient | Ledger>): Promise<A> {
  return Effect.runPromise(program.pipe(Effect.provide(Ledger.layer.pipe(Layer.provideMerge(databaseAt(path))))));
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "leaf-windowed-"));
  path = join(directory, "leaf.db");
  await server(Effect.void);
  other = new Database(path);
  // It gives up at once instead of waiting for the lock, so the test shows who holds it.
  other.run("PRAGMA busy_timeout = 0");
});

afterEach(() => {
  other.close();
  rmSync(directory, { recursive: true, force: true });
});

/** A write that records nothing. */
const writeNothing = () => Effect.succeed({ recorded: 0, leafPaid: 0 });

/** A feed with nothing in it. */
const nothing = () => Effect.succeed([]);

describe("windowedSync", () => {
  it("holds the write lock for its whole write, so another connection's commit cannot land between its reads and its writes", async () => {
    let otherWrite: unknown;
    const result = await server(
      Effect.gen(function* () {
        yield* windowedSync("credits", T0, "recent", nothing, writeNothing);
        return yield* windowedSync("credits", T0 + MINUTE, "recent", nothing, () =>
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            const ledger = yield* Ledger;
            // The credit sync reads what it has recorded before it writes.
            yield* sql`SELECT COUNT(*) FROM activities`.pipe(Effect.orDie);
            try {
              other
                .query(
                  `INSERT INTO ledger_entries (player_id, kind, balance_delta, xp_delta, origin, idempotency_key, created_at)
                   VALUES (?, 'earn', 110, 110, 'raid', ?, ?)`,
                )
                .run(alice, `raid:1:${alice}`, T0 + MINUTE);
            } catch (error) {
              otherWrite = error;
            }
            yield* ledger.insert(
              draftEntry({
                kind: "earn",
                playerId: alice,
                amount: leaf(110),
                source: "raid",
                idempotencyKey: `raid:2:${alice}`,
              }),
              T0 + MINUTE,
            );
            return { recorded: 1, leafPaid: 110 };
          }),
        );
      }),
    );

    expect(result).toEqual({ status: "synced", recorded: 1, leafPaid: 110 });
    expect(otherWrite).toMatchObject({ code: "SQLITE_BUSY" });
    expect(other.query("SELECT idempotency_key FROM ledger_entries").all()).toEqual([
      { idempotency_key: `raid:2:${alice}` },
    ]);
  });

  it("leaves nothing half written when Leaf's stop interrupts it mid-write: it rolls back and lets go of its lease", async () => {
    await server(
      Effect.gen(function* () {
        yield* windowedSync("credits", T0, "recent", nothing, writeNothing);
        const writing = yield* Deferred.make<void>();
        const sync = yield* Effect.forkChild(
          windowedSync("credits", T0 + MINUTE, "recent", nothing, () =>
            Effect.gen(function* () {
              const ledger = yield* Ledger;
              yield* ledger.insert(
                draftEntry({
                  kind: "earn",
                  playerId: alice,
                  amount: leaf(110),
                  source: "raid",
                  idempotencyKey: `raid:1:${alice}`,
                }),
                T0 + MINUTE,
              );
              yield* Deferred.succeed(writing, undefined);
              return yield* Effect.never;
            }),
          ),
        );
        yield* Deferred.await(writing);
        yield* Fiber.interrupt(sync);
      }),
    );

    expect(other.query("SELECT COUNT(*) AS n FROM ledger_entries").get()).toEqual({ n: 0 });
    expect(other.query("SELECT cursor, locked_until FROM sync_state WHERE name = 'credits'").get()).toEqual({
      cursor: T0,
      locked_until: 0,
    });
  });

  it("catches up after a gap longer than the feeds answer a window for, a window per run", async () => {
    const windows: [number, number][] = [];
    const read = (from: number, to: number) =>
      Effect.sync(() => {
        windows.push([from, to]);
        return [];
      });
    const back = T0 + 45 * 24 * 60 * MINUTE;

    await server(
      Effect.gen(function* () {
        yield* windowedSync("credits", T0, "recent", read, writeNothing);
        yield* windowedSync("credits", back, "recent", read, writeNothing);
        yield* windowedSync("credits", back + MINUTE, "recent", read, writeNothing);
      }),
    );

    expect(windows.map(([from, to]) => to - from <= MAX_WINDOW_MS)).toEqual([true, true]);
    expect(windows[0]).toEqual([T0, T0 + MAX_WINDOW_MS]);
    expect(windows[1]?.[1]).toBe(back + MINUTE - SETTLE_MS);
  });
});
