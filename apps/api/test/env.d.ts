declare namespace Cloudflare {
  interface Env {
    /** The repository's D1 migrations, provided by vitest.config.ts. */
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}
