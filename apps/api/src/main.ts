import { createApp } from "./app.ts";
import { readConfig } from "./config.ts";
import { openDatabase } from "./db.ts";
import { startSchedule } from "./earning/run.ts";
import type { Services } from "./services.ts";

const config = readConfig(Bun.env);
const db = openDatabase(config.databasePath);
const services: Services = {
  db,
  backend: { url: config.backendUrl, token: config.backendToken },
  fetcher: (url, init) => fetch(url, init),
  now: () => Date.now(),
};

const server = Bun.serve({ port: config.port, fetch: createApp(services).fetch });
const schedule = startSchedule(services);

console.log(JSON.stringify({ event: "started", port: server.port, database: config.databasePath }));
if (config.backendToken === undefined) {
  console.warn("BACKEND_INTERNAL_TOKEN is not set: serving requests, but not reading the credit feed");
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
