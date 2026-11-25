import type { PlayerId } from "@sequoia-leaf/core";
import { Cache, Clock, Context, Duration, Effect, Exit, Layer, Option, Redacted, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import type { Identity } from "../api/api.ts";
import { askBackend, logFailure } from "../backend/failure.ts";
import { AppConfig } from "../config.ts";
import { Logins } from "../players/logins.ts";
import { DiscordId, MinecraftUuid } from "../wire.ts";

export type IdentityResult =
  | { readonly status: "ok"; readonly identity: Identity }
  /** The token is missing, expired, revoked or not a Sequoia session. */
  | { readonly status: "unauthorized" }
  /** The backend could not be asked. Nothing is known about the token. */
  | { readonly status: "unavailable" };

const TIMEOUT = Duration.seconds(3);
/** Sessions the backend confirmed this recently are not asked about again. */
const CONFIRMED_FOR = Duration.minutes(1);
/** How many confirmed sessions are remembered: enough that guests coming and going do not push members' out. */
const REMEMBERED = 2000;

/** Who a session belongs to, as sequoia-backend's `/auth/web/me` answers. */
const BackendIdentity = Schema.Struct({
  // Read loosely: a session is not refused for a Discord id Leaf cannot use, only not linked by it.
  discord_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  minecraft_uuid: MinecraftUuid,
  minecraft_username: Schema.String,
  guild_rank: Schema.optionalKey(Schema.NullOr(Schema.String)),
  website_admin: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  /** Whether the session's account is the member's primary one; the mod's may be an alternate's. */
  primary_account: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
});

/**
 * Asks sequoia-backend who a session token belongs to. The backend issued the
 * token and is the only one that can tell whether it was revoked, so Leaf never
 * inspects the token itself. Sessions it confirmed in the last minute are
 * remembered, so a page that makes several requests asks once, and requests
 * that arrive together share one question; a revoked session stops working
 * within a minute. Each confirmed session finds its player through `Logins`,
 * and the Discord account it came with is made to sign in as that player.
 */
export class Identities extends Context.Service<
  Identities,
  { readonly identify: (token: string) => Effect.Effect<IdentityResult> }
>()("leaf/Identities") {
  static readonly layer = Layer.effect(
    Identities,
    Effect.gen(function* () {
      const { backendUrl } = yield* AppConfig;
      const client = yield* HttpClient.HttpClient;
      const logins = yield* Logins;

      /** The player a session the backend vouched for signs in as. */
      const admitted = (token: string, body: typeof BackendIdentity.Type) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const playerId = yield* logins.player(body.minecraft_uuid);
          const discord = discordOf(body);
          // A Discord account signs in as its member's primary account's player, never an alternate's.
          if (discord !== null && body.primary_account === true) {
            const was = yield* logins.discordPlayer(discord);
            if (Option.getOrUndefined(was) !== playerId) {
              yield* logins.linkDiscord(discord, playerId, now);
            }
          }
          return toResult(token, body, playerId);
        });

      const ask = (token: string) =>
        client
          .execute(
            HttpClientRequest.get(new URL("/auth/web/me", backendUrl)).pipe(
              HttpClientRequest.bearerToken(token),
              HttpClientRequest.acceptJson,
            ),
          )
          .pipe(
            Effect.flatMap((response) =>
              response.status === 401
                ? Effect.succeed<IdentityResult>({ status: "unauthorized" })
                : HttpClientResponse.filterStatusOk(response).pipe(
                    Effect.flatMap(HttpClientResponse.schemaBodyJson(BackendIdentity)),
                    Effect.flatMap((body) => admitted(token, body)),
                  ),
            ),
            askBackend("/auth/web/me", TIMEOUT),
            Effect.catchTag("BackendFailure", (failure) =>
              logFailure("The backend could not say whose a session is", failure).pipe(
                Effect.as<IdentityResult>({ status: "unavailable" }),
              ),
            ),
          );

      const confirmed = yield* Cache.makeWith(ask, {
        capacity: REMEMBERED,
        // Only a confirmed session is remembered; a refusal or an outage is asked about again.
        timeToLive: (exit) => (Exit.isSuccess(exit) && exit.value.status === "ok" ? CONFIRMED_FOR : Duration.zero),
      });
      return Identities.of({ identify: (token) => Cache.get(confirmed, token) });
    }),
  );
}

const isDiscordId = Schema.is(DiscordId);

/** The Discord account a session came with, when the backend names one Leaf can key on. */
function discordOf(body: typeof BackendIdentity.Type): DiscordId | null {
  return isDiscordId(body.discord_id) ? body.discord_id : null;
}

function toResult(token: string, body: typeof BackendIdentity.Type, playerId: PlayerId): IdentityResult {
  const rank = body.guild_rank;
  return {
    status: "ok",
    identity: {
      playerId,
      minecraft: body.minecraft_uuid,
      discord: discordOf(body),
      username: body.minecraft_username,
      guildRank: typeof rank === "string" && rank !== "" ? rank : null,
      admin: body.website_admin === true,
      session: Redacted.make(token),
    },
  };
}
