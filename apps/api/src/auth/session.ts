import type { MinecraftId, PlayerId } from "@sequoia-leaf/core";
import { Cache, Clock, Context, Duration, Effect, Exit, Layer, Redacted, Schema } from "effect";
import { SecureRandom } from "effect/crypto";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { SqlClient } from "effect/sql";

import type { Identity } from "../api/api.ts";
import { askBackend, logFailure } from "../backend/failure.ts";
import { AppConfig } from "../config.ts";
import { accountPlayer } from "../players/link.ts";
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

/** How a Minecraft account stands in the guild now, as the backend's `/internal/leaf/members/{uuid}` answers. */
const BackendStanding = Schema.Struct({
  guild_rank: Schema.optionalKey(Schema.NullOr(Schema.String)),
  website_admin: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
});

/** How someone stands in the guild: their rank (null when they are not a member now), and whether they run the website. */
export interface Standing {
  readonly guildRank: string | null;
  readonly admin: boolean;
}

/** A guest's standing: what anyone has when the backend does not say otherwise. */
const GUEST: Standing = { guildRank: null, admin: false };

/**
 * Asks sequoia-backend who a session token belongs to. The backend issued the
 * token and is the only one that can tell whether it was revoked, so Leaf never
 * inspects the token itself. Sessions it confirmed in the last minute are
 * remembered, so a page that makes several requests asks once, and requests
 * that arrive together share one question; a revoked session stops working
 * within a minute. Each confirmed session finds its player through `Logins`;
 * one on its member's primary account also makes the Discord account it came
 * with sign in as that player.
 *
 * It also asks how a player's linked Minecraft account stands in the guild (`standing`), for a Leaf
 * session, which the backend did not issue: the rank and the website's say a website session of that
 * account would have. Answers are remembered as confirmed sessions are; when the backend does not
 * answer, the player stands as a guest for that request, as they did before Leaf asked.
 */
export class Identities extends Context.Service<
  Identities,
  {
    readonly identify: (token: string) => Effect.Effect<IdentityResult>;
    readonly standing: (minecraft: MinecraftId, discord: DiscordId) => Effect.Effect<Standing>;
  }
>()("leaf/Identities") {
  static readonly layer = Layer.effect(
    Identities,
    Effect.gen(function* () {
      const { backendUrl, backendToken } = yield* AppConfig;
      const client = yield* HttpClient.HttpClient;
      const logins = yield* Logins;
      const sql = yield* SqlClient.SqlClient;
      const random = yield* SecureRandom.SecureRandom;

      /** The player a session the backend vouched for signs in as. */
      const admitted = (token: string, body: typeof BackendIdentity.Type) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const discord = discordOf(body);
          // A Discord account and its member's primary account sign in as one player (`accountPlayer`);
          // an alternate's session, as the mod's may be, is its own account's player and changes nothing.
          const playerId =
            discord !== null && body.primary_account === true
              ? yield* sql
                  .withTransaction(accountPlayer(discord, body.minecraft_uuid, body.minecraft_username, now))
                  .pipe(Effect.provideService(SecureRandom.SecureRandom, random), Effect.orDie)
              : yield* logins.player(body.minecraft_uuid);
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
      /** The backend's word on an account's standing (`<minecraft> <discord>`), or none when it does not answer. */
      const askStanding = (key: string) => {
        const [minecraft = "", discord = ""] = key.split(" ");
        const url = new URL(`/internal/leaf/members/${encodeURIComponent(minecraft)}`, backendUrl);
        url.searchParams.set("discord_id", discord);
        return client
          .execute(
            HttpClientRequest.get(url).pipe(
              HttpClientRequest.bearerToken(backendToken === undefined ? "" : Redacted.value(backendToken)),
              HttpClientRequest.acceptJson,
            ),
          )
          .pipe(
            Effect.flatMap(HttpClientResponse.filterStatusOk),
            Effect.flatMap(HttpClientResponse.schemaBodyJson(BackendStanding)),
            Effect.map((body): Standing | null => ({
              guildRank: typeof body.guild_rank === "string" && body.guild_rank !== "" ? body.guild_rank : null,
              admin: body.website_admin === true,
            })),
            askBackend("/internal/leaf/members", TIMEOUT),
            Effect.catchTag("BackendFailure", (failure) =>
              logFailure("The backend could not say how an account stands", failure).pipe(Effect.as(null)),
            ),
          );
      };
      const standings = yield* Cache.makeWith(askStanding, {
        capacity: REMEMBERED,
        timeToLive: (exit) => (Exit.isSuccess(exit) && exit.value !== null ? CONFIRMED_FOR : Duration.zero),
      });
      return Identities.of({
        identify: (token) => Cache.get(confirmed, token),
        standing: (minecraft, discord) =>
          Effect.map(Cache.get(standings, `${minecraft} ${discord}`), (said) => said ?? GUEST),
      });
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
      via: "sequoia",
      linked: true,
      askLink: false,
      username: body.minecraft_username,
      guildRank: typeof rank === "string" && rank !== "" ? rank : null,
      inCall: false,
      admin: body.website_admin === true,
      session: Redacted.make(token),
    },
  };
}
