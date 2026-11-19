// Corrects raid payments to each member's share, as described in the README
// under "Correcting raid shares, 2026-11-19". Run it where the server runs,
// with the server's environment:
//
//   bun run apps/api/scripts/correct-raid-shares.ts            # dry run: reports, keeps nothing
//   bun run apps/api/scripts/correct-raid-shares.ts --apply    # snapshots the database, then corrects
//
// It prints one JSON object, the report.

import { takeSnapshot } from "../src/backup/snapshot.ts";
import { readConfig } from "../src/config.ts";
import { type CorrectionMode, runRaidShareCorrection } from "../src/earning/raid-shares.ts";
import { liveServices } from "../src/services.ts";

const args = Bun.argv.slice(2);
const unknown = args.filter((arg) => arg !== "--apply" && arg !== "--dry-run");
if (unknown.length > 0 || (args.includes("--apply") && args.includes("--dry-run"))) {
  console.error("Usage: bun run apps/api/scripts/correct-raid-shares.ts [--dry-run | --apply]");
  process.exit(2);
}
const mode: CorrectionMode = args.includes("--apply") ? "apply" : "dry_run";

const config = readConfig(Bun.env);
const services = liveServices(config);
try {
  // Reversals cannot be reversed, so keep a copy of the database as it was to restore from.
  const snapshot = mode === "apply" ? takeSnapshot(services.db, config.backupDirectory, services.now()) : null;
  const report = await runRaidShareCorrection(services, mode);
  console.log(JSON.stringify({ database: config.databasePath, snapshot, ...report }, null, 2));
} finally {
  services.db.close();
}
