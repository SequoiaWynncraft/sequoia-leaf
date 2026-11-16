import type { Database } from "bun:sqlite";

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
  readonly fetcher: Fetcher;
  /** The current time in milliseconds since the Unix epoch. */
  readonly now: () => number;
}
