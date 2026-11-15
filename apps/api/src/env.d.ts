/**
 * Secrets, which `wrangler types` cannot see because they are not in
 * wrangler.jsonc. Set them with `wrangler secret put`.
 */
interface SecretEnv {
  /**
   * sequoia-backend's internal API token. Without it the Worker serves
   * requests but does not read the credit feed.
   */
  BACKEND_INTERNAL_TOKEN?: string;
}

interface Env extends SecretEnv {}

declare namespace Cloudflare {
  interface Env extends SecretEnv {}
}
