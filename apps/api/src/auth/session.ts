import { parsePlayerId } from "@sequoia-leaf/core";
import { Clock, Context, Duration, Effect, Layer, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse, type HttpServerRequest } from "effect/http";

import type { Identity } from "../api/api.ts";
import { AppConfig } from "../config.ts";

export type IdentityResult =
  | { readonly status: "ok"; readonly identity: Identity }
  /** The token is missing, expired, revoked or not a Sequoia session. */
  | { readonly status: "unauthorized" }
  /** The backend could not be asked. Nothing is known about the token. */
  | { readonly status: "unavailable" };

const TIMEOUT = Duration.seconds(3);
/** Sessions the backend confirmed this recently are not asked about again. */
const CACHE_MS = 60_000;
const CACHE_LIMIT = 500;

/** Who a session belongs to, as sequoia-backend's `/auth/web/me` answers. */
const BackendIdentity = Schema.Struct({
  minecraft_uuid: Schema.String,
  minecraft_username: Schema.String,
  guild_rank: Schema.optionalKey(Schema.NullOr(Schema.String)),
  website_admin: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
});

/**
 * Asks sequoia-backend who a session token belongs to. The backend issued the
 * token and is the only one that can tell whether it was revoked, so Leaf never
 * inspects the token itself. Sessions it confirmed in the last minute are
 * remembered, so a page that makes several requests asks once; a revoked
 * session stops working within a minute.
 */
export class Identities extends Context.Service<
  Identities,
  { readonly identify: (token: string) => Effect.Effect<IdentityResult> }
>()("leaf/Identities") {
  static readonly layer = Layer.effect(
    Identities,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const client = yield* HttpClient.HttpClient;
      const confirmed = new Map<string, { identity: Identity; until: number }>();

      const ask = (token: string) =>
        client
          .execute(
            HttpClientRequest.get(new URL("/auth/web/me", config.backendUrl)).pipe(
              HttpClientRequest.bearerToken(token),
              HttpClientRequest.acceptJson,
            ),
          )
          .pipe(
            Effect.flatMap((response) => {
              if (response.status === 401) {
                return Effect.succeed<IdentityResult>({ status: "unauthorized" });
              }
              if (response.status < 200 || response.status >= 300) {
                return Effect.succeed<IdentityResult>({ status: "unavailable" });
              }
              return HttpClientResponse.schemaBodyJson(BackendIdentity)(response).pipe(
                Effect.map((body): IdentityResult => {
                  const identity = toIdentity(body);
                  return identity === undefined ? { status: "unavailable" } : { status: "ok", identity };
                }),
              );
            }),
            Effect.timeout(TIMEOUT),
            Effect.catch(() => Effect.succeed<IdentityResult>({ status: "unavailable" })),
          );

      const identify = Effect.fn("Identities.identify")(function* (token: string) {
        const now = yield* Clock.currentTimeMillis;
        const cached = confirmed.get(token);
        if (cached !== undefined && cached.until > now) {
          return { status: "ok", identity: cached.identity } satisfies IdentityResult;
        }
        const result = yield* ask(token);
        if (result.status === "unauthorized") {
          confirmed.delete(token);
        } else if (result.status === "ok") {
          if (confirmed.size >= CACHE_LIMIT) {
            confirmed.clear();
          }
          confirmed.set(token, { identity: result.identity, until: now + CACHE_MS });
        }
        return result;
      });
      return Identities.of({ identify });
    }),
  );
}

function toIdentity(body: typeof BackendIdentity.Type): Identity | undefined {
  const playerId = parsePlayerId(body.minecraft_uuid);
  if (playerId === undefined) {
    return undefined;
  }
  const rank = body.guild_rank;
  return {
    playerId,
    username: body.minecraft_username,
    guildRank: typeof rank === "string" && rank !== "" ? rank : null,
    admin: body.website_admin === true,
  };
}

/** The session token of a request: a bearer token, or the site's `seq_session` cookie. */
export function sessionToken(request: HttpServerRequest.HttpServerRequest): string | undefined {
  const authorization = request.headers["authorization"];
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim() || undefined;
  }
  return request.cookies["seq_session"] || undefined;
}
