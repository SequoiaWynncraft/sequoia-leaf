import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env {
      /** The repository's D1 migrations, provided by vitest.config.ts. */
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
