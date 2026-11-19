// Pays members the rest of their raid shares and takes back the Leaf of players
// who were never in the guild, as described in the README under "Correcting
// guild shares, 2026-11-19". It prints one JSON object, the report.

import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { parsePlayerId, type PlayerId } from "@sequoia-leaf/core";

import { takeSnapshot } from "../src/backup/snapshot.ts";
import { readConfig } from "../src/config.ts";
import { type GuildShareOptions, runGuildShareCorrection } from "../src/earning/guild-shares.ts";
import { liveServices } from "../src/services.ts";

const USAGE = `Usage: bun run apps/api/scripts/correct-guild-shares.ts --never-members <file> [--dry-run | --apply]

--never-members names a file of the players who were never Sequoia members, one
UUID per line, from the backend's membership records (see the README). Their
Leaf is taken back in full.

It runs with the server's environment: DATABASE_PATH, BACKEND_URL and
BACKEND_INTERNAL_TOKEN, and refuses a DATABASE_PATH that does not exist. A dry
run (the default) keeps nothing, but holds the database's write lock until it
ends, so run it on a copy made with VACUUM INTO. --apply snapshots the database
first, then corrects one player at a time.`;

function readNeverMembers(path: string): Set<PlayerId> {
  const players = new Set<PlayerId>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const text = line.trim();
    if (text === "") {
      continue;
    }
    const player = parsePlayerId(text);
    if (player === undefined) {
      throw new Error(`Not a player UUID in ${path}: ${text}`);
    }
    players.add(player);
  }
  return players;
}

function readOptions(args: string[]): GuildShareOptions {
  const { values } = parseArgs({
    args,
    options: {
      apply: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      "never-members": { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.apply && values["dry-run"]) {
    throw new Error("--apply and --dry-run do not go together");
  }
  const file = values["never-members"];
  if (file === undefined) {
    throw new Error("--never-members is required: the players who were never Sequoia members");
  }
  return { mode: values.apply ? "apply" : "dry_run", neverMembers: readNeverMembers(file) };
}

let options: GuildShareOptions;
try {
  options = readOptions(Bun.argv.slice(2));
} catch (error) {
  console.error(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
  process.exit(2);
}

const config = readConfig(Bun.env);
if (!existsSync(config.databasePath)) {
  console.error(`DATABASE_PATH ${config.databasePath} does not exist. Give the server's database, or a copy of it.`);
  process.exit(2);
}
const services = liveServices(config);
try {
  // Reversals cannot be reversed, so keep a copy of the database as it was to restore from.
  const snapshot = options.mode === "apply" ? takeSnapshot(services.db, config.backupDirectory, services.now()) : null;
  const report = await runGuildShareCorrection(services, options);
  console.log(
    JSON.stringify(
      { database: config.databasePath, snapshot, never_members: options.neverMembers.size, ...report },
      null,
      2,
    ),
  );
} finally {
  services.db.close();
}
