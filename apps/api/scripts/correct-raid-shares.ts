// Corrects raid payments to each member's share, as described in the README
// under "Correcting raid shares, 2026-11-19". It prints one JSON object, the
// report.

import { existsSync } from "node:fs";
import { parseArgs } from "node:util";

import { takeSnapshot } from "../src/backup/snapshot.ts";
import { readConfig } from "../src/config.ts";
import { type CorrectionOptions, parseRfc3339, runRaidShareCorrection } from "../src/earning/raid-shares.ts";
import { liveServices } from "../src/services.ts";

const USAGE = `Usage: bun run apps/api/scripts/correct-raid-shares.ts --paid-before <time> [--dry-run | --apply]

--paid-before is required, and has no default. Give the moment the backend's
fix went live, as an RFC 3339 time such as 2026-11-19T07:53:00Z. Only raid
payments made before it are corrected; later ones were paid from the fixed feed
and stand. An earlier time is the safe side: it can leave an overpayment
standing, which the report lists, but never takes back a payment of the share.

It runs with the server's environment: DATABASE_PATH, BACKEND_URL and
BACKEND_INTERNAL_TOKEN. It refuses a DATABASE_PATH that does not exist.

A dry run (the default) reports what --apply would do and keeps nothing, but it
migrates the database, and holds its write lock until it ends, which stalls the
server's writes. Run it on a copy, in the server's container:

  bun -e 'import { Database } from "bun:sqlite"; new Database("/data/leaf.db", { readonly: true }).run("VACUUM INTO ?", ["/tmp/leaf-dry-run.db"])'
  DATABASE_PATH=/tmp/leaf-dry-run.db bun run apps/api/scripts/correct-raid-shares.ts --paid-before 2026-11-19T07:53:00Z
  rm /tmp/leaf-dry-run.db*

--apply snapshots the database, then corrects it one player at a time, each in
a short transaction of their own, so the server can keep running.`;

function readOptions(args: string[]): CorrectionOptions {
  const { values } = parseArgs({
    args,
    options: {
      apply: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      "paid-before": { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.apply && values["dry-run"]) {
    throw new Error("--apply and --dry-run do not go together");
  }
  const text = values["paid-before"];
  if (text === undefined) {
    throw new Error("--paid-before is required: the moment the backend's fix went live");
  }
  const paidBefore = parseRfc3339(text);
  if (paidBefore === undefined) {
    throw new Error(`--paid-before is not an RFC 3339 time with an offset, such as 2026-11-19T07:53:00Z: ${text}`);
  }
  return { mode: values.apply ? "apply" : "dry_run", paidBefore };
}

let options: CorrectionOptions;
try {
  options = readOptions(Bun.argv.slice(2));
} catch (error) {
  console.error(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
  process.exit(2);
}

const config = readConfig(Bun.env);
// Opening the database creates a missing file, and an empty database has
// nothing to correct, so a mistyped path would look like a clean run.
if (!existsSync(config.databasePath)) {
  console.error(`DATABASE_PATH ${config.databasePath} does not exist. Give the server's database, or a copy of it.`);
  process.exit(2);
}
const services = liveServices(config);
try {
  // Reversals cannot be reversed, so keep a copy of the database as it was to restore from.
  const snapshot = options.mode === "apply" ? takeSnapshot(services.db, config.backupDirectory, services.now()) : null;
  const report = await runRaidShareCorrection(services, options);
  console.log(JSON.stringify({ database: config.databasePath, snapshot, ...report }, null, 2));
} finally {
  services.db.close();
}
