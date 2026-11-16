import { createApp } from "./app.ts";
import { bucketOffsite, offsiteCopier } from "./backup/offsite.ts";
import { snapshotIfDue } from "./backup/snapshot.ts";
import { readConfig } from "./config.ts";
import { openDatabase } from "./db.ts";
import { runScheduledSync } from "./earning/run.ts";
import { everyMinute } from "./schedule.ts";
import type { Services } from "./services.ts";

const config = readConfig(Bun.env);
const db = openDatabase(config.databasePath);
const services: Services = {
  db,
  backend: { url: config.backendUrl, token: config.backendToken },
  fetcher: (url, init) => fetch(url, init),
  now: () => Date.now(),
};

const server = Bun.serve({
  port: config.port,
  // Seconds. An event stream with nothing to send writes a keep-alive every 20, well inside this.
  idleTimeout: 60,
  fetch: createApp(services).fetch,
});
const copyOffsite =
  config.offsite === undefined ? undefined : offsiteCopier(bucketOffsite(config.offsite), config.backupDirectory);
const schedule = everyMinute(async () => {
  await runScheduledSync(services);
  try {
    const path = snapshotIfDue(db, config.backupDirectory, services.now());
    if (path !== undefined) {
      console.log(JSON.stringify({ event: "snapshot", path }));
    }
  } catch (error) {
    console.error("Taking a snapshot of the database failed", error);
  }
  if (copyOffsite !== undefined) {
    try {
      const name = await copyOffsite(services.now());
      if (name !== undefined) {
        console.log(JSON.stringify({ event: "snapshot_copied_offsite", name }));
      }
    } catch (error) {
      console.error("Copying a snapshot off the server failed; trying again in ten minutes", error);
    }
  }
});

console.log(
  JSON.stringify({
    event: "started",
    port: server.port,
    database: config.databasePath,
    offsite_bucket: config.offsite?.bucket ?? null,
  }),
);
if (config.backendToken === undefined) {
  console.warn("BACKEND_INTERNAL_TOKEN is not set: serving requests, but not reading the credit feed");
}
if (config.offsitePartlySet.length > 0) {
  console.warn(
    `Only ${config.offsitePartlySet.join(", ")} of the BACKUP_S3_* variables are set: snapshots stay on this machine`,
  );
}

// A deploy stops the old container with SIGTERM. Finish the requests in
// flight, then close the database so its write-ahead log is folded back in.
function shutDown(): void {
  schedule.stop();
  void server.stop().then(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGTERM", shutDown);
process.on("SIGINT", shutDown);
