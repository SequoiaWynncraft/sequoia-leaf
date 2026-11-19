import type { Database } from "bun:sqlite";

import type { Config } from "./config.ts";
import { openDatabase } from "./db.ts";

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** Everything the service reaches outside its own code. Tests pass stand-ins. */
export interface Services {
  readonly db: Database;
  readonly backend: {
    /** Origin of sequoia-backend, such as `https://api.seqwawa.com`. */
    readonly url: string;
    /** The backend's internal API token. Without it the credit feed is not read. */
    readonly token: string | undefined;
  };
  readonly sierra: {
    /** Origin of Sierra's internal API, such as `http://sequoia-sierra:8082`. Without it the awards feed is not read. */
    readonly url: string | undefined;
    /** The internal API token, which Sierra shares with the backend. */
    readonly token: string | undefined;
  };
  readonly fetcher: Fetcher;
  /** The current time in milliseconds since the Unix epoch. */
  readonly now: () => number;
}

/** The services the server runs with: the configured database file, the network and the system clock. */
export function liveServices(config: Config): Services {
  return {
    db: openDatabase(config.databasePath),
    backend: { url: config.backendUrl, token: config.backendToken },
    sierra: { url: config.sierraUrl, token: config.backendToken },
    fetcher: (url, init) => fetch(url, init),
    now: () => Date.now(),
  };
}
