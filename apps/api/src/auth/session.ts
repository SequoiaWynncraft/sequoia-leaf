import { parsePlayerId, type PlayerId } from "@sequoia-leaf/core";

import type { Fetcher } from "../backend/credits.ts";

/** Who is making a request, as sequoia-backend vouches for them. */
export interface Identity {
  readonly playerId: PlayerId;
  readonly username: string;
  /** The player's rank in the guild, or null when they are not a member now. */
  readonly guildRank: string | null;
  readonly admin: boolean;
}

export type IdentityResult =
  | { readonly status: "ok"; readonly identity: Identity }
  /** The token is missing, expired, revoked or not a Sequoia session. */
  | { readonly status: "unauthorized" }
  /** The backend could not be asked. Nothing is known about the token. */
  | { readonly status: "unavailable" };

const TIMEOUT_MS = 3_000;
const CACHE_MS = 60_000;
const CACHE_LIMIT = 500;

// Sessions the backend confirmed in the last minute, so a page that makes
// several requests asks the backend once. It lives in this isolate's memory
// only, and a revoked session stops working within a minute.
const confirmed = new Map<string, { identity: Identity; until: number }>();

/** The session token of a request: a bearer token, or the site's `seq_session` cookie. */
export function sessionToken(headers: Headers): string | undefined {
  const authorization = headers.get("Authorization");
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim() || undefined;
  }
  for (const part of (headers.get("Cookie") ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === "seq_session") {
      return value.join("=") || undefined;
    }
  }
  return undefined;
}

/**
 * Asks sequoia-backend who a session token belongs to. The backend issued the
 * token and is the only one that can tell whether it was revoked, so the
 * Worker never inspects the token itself.
 */
export async function identify(
  fetcher: Fetcher,
  backendUrl: string,
  token: string,
  now: number,
): Promise<IdentityResult> {
  const cached = confirmed.get(token);
  if (cached !== undefined && cached.until > now) {
    return { status: "ok", identity: cached.identity };
  }
  let response: Response;
  try {
    response = await fetcher(new URL("/auth/web/me", backendUrl).toString(), {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { status: "unavailable" };
  }
  if (response.status === 401) {
    confirmed.delete(token);
    return { status: "unauthorized" };
  }
  if (!response.ok) {
    return { status: "unavailable" };
  }
  const identity = toIdentity(await response.json());
  if (identity === undefined) {
    return { status: "unavailable" };
  }
  if (confirmed.size >= CACHE_LIMIT) {
    confirmed.clear();
  }
  confirmed.set(token, { identity, until: now + CACHE_MS });
  return { status: "ok", identity };
}

/** Forgets every confirmed session. For tests. */
export function forgetSessions(): void {
  confirmed.clear();
}

function toIdentity(body: unknown): Identity | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const fields: Record<string, unknown> = { ...body };
  const uuid = fields["minecraft_uuid"];
  const username = fields["minecraft_username"];
  const rank = fields["guild_rank"];
  const playerId = typeof uuid === "string" ? parsePlayerId(uuid) : undefined;
  if (playerId === undefined || typeof username !== "string") {
    return undefined;
  }
  return {
    playerId,
    username,
    guildRank: typeof rank === "string" && rank !== "" ? rank : null,
    admin: fields["website_admin"] === true,
  };
}
