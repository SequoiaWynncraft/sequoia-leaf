/**
 * Copies a database to a new file, consistent as of one moment, in a process of its own, so that
 * the copy never holds Leaf's thread: `bun vacuum.ts <database> <into>`. It reads the database as
 * any other reader would, beside Leaf writing it, and writes nothing to it. It exits 0 once the
 * copy is complete, and otherwise not, saying why.
 */
import { BunRuntime } from "@effect/platform-bun";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";

const [database, into] = process.argv.slice(2);
if (database === undefined || into === undefined) {
  console.error("Usage: bun vacuum.ts <database> <into>");
  process.exit(2);
}

BunRuntime.runMain(
  SqlClient.SqlClient.use((sql) => sql`VACUUM INTO ${into}`).pipe(
    Effect.provide(SqliteClient.layer({ filename: database, readonly: true })),
    Effect.orDie,
  ),
);
