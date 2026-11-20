import type { PlayerId } from "@sequoia-leaf/core";
import { Context, Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
  HttpApiSecurity,
  OpenApi,
} from "effect/http-api";

import {
  GroveInvalid,
  GroveRefused,
  IdentityUnavailable,
  InternalError,
  Invalid,
  NotAMember,
  Refused,
  Unauthorized,
} from "./errors.ts";
import {
  CareBody,
  Cared,
  Companion,
  CompanionBody,
  ConesBody,
  ConesBought,
  ConesOpened,
  Events,
  Forest,
  GroveMe,
  Health,
  Me,
  Quests,
  Rates,
  RerollBody,
  Rerolled,
} from "./schemas.ts";

// Leaf's HTTP API, declared once: the server implements it, and its OpenAPI
// document (`/openapi.json`) is generated from it.

/** Who is making a request, as sequoia-backend vouches for them. */
export interface Identity {
  readonly playerId: PlayerId;
  readonly username: string;
  /** The player's rank in the guild, or null when they are not a member now. */
  readonly guildRank: string | null;
  readonly admin: boolean;
}

export class CurrentIdentity extends Context.Service<CurrentIdentity, Identity>()("leaf/api/CurrentIdentity") {}

/**
 * Lets in current guild members with a Sequoia session, the token
 * sequoia-backend issued, sent as `Authorization: Bearer`. Provides who they are.
 */
export class Session extends HttpApiMiddleware.Service<Session, { provides: CurrentIdentity }>()("leaf/api/Session", {
  security: { bearer: HttpApiSecurity.bearer },
  error: [Unauthorized, NotAMember, IdentityUnavailable],
}) {}

/** Answers a failure nothing expected with `internal_error`, after logging it. */
export class Unexpected extends HttpApiMiddleware.Service<Unexpected>()("leaf/api/Unexpected", {
  error: InternalError,
}) {}

/** Answers a reroll whose body is not `{ "leaf": n }` with `invalid_cost`. */
export class RerollBodyErrors extends HttpApiMiddleware.Service<RerollBodyErrors>()("leaf/api/RerollBodyErrors", {
  error: Invalid,
}) {}

/** Answers a Grove request whose body is not what the route takes with `invalid_request`. */
export class GroveBodyErrors extends HttpApiMiddleware.Service<GroveBodyErrors>()("leaf/api/GroveBodyErrors", {
  error: GroveInvalid,
}) {}

const EventPosition = { after: Schema.optional(Schema.String) };

export class SystemApi extends HttpApiGroup.make("system", { topLevel: true }).add(
  HttpApiEndpoint.get("healthz", "/healthz", { success: Health }),
) {}

export class MeApi extends HttpApiGroup.make("me")
  .add(
    HttpApiEndpoint.get("account", "/", { success: Me }),
    HttpApiEndpoint.get("quests", "/quests", { query: { sync: Schema.optional(Schema.String) }, success: Quests }),
    HttpApiEndpoint.post("reroll", "/quests/:id/reroll", {
      params: { id: Schema.String },
      payload: RerollBody,
      success: Rerolled,
      error: [Invalid, Refused],
    }).middleware(RerollBodyErrors),
    HttpApiEndpoint.get("events", "/events", { query: EventPosition, success: Events, error: Invalid }),
    HttpApiEndpoint.get("stream", "/events/stream", {
      query: EventPosition,
      success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/event-stream" })),
      error: Invalid,
    }),
  )
  .middleware(Session)
  .prefix("/v1/me") {}

/** The signed-in member's Grove: their tree, its care, their cones and spirits. */
export class GroveApi extends HttpApiGroup.make("grove")
  .add(
    HttpApiEndpoint.get("grove", "/", { success: GroveMe }),
    HttpApiEndpoint.post("care", "/care", { payload: CareBody, success: Cared, error: [GroveInvalid, GroveRefused] }),
    HttpApiEndpoint.post("buy", "/cones/buy", {
      payload: ConesBody,
      success: ConesBought,
      error: [GroveInvalid, GroveRefused],
    }),
    HttpApiEndpoint.post("open", "/cones/open", {
      payload: ConesBody,
      success: ConesOpened,
      error: [GroveInvalid, GroveRefused],
    }),
    HttpApiEndpoint.put("companion", "/companion", {
      payload: CompanionBody,
      success: Companion,
      error: [GroveInvalid, GroveRefused],
    }),
  )
  .middleware(GroveBodyErrors)
  .middleware(Session)
  .prefix("/v1/grove") {}

/** What anyone may see of the Grove, signed in or not: the published odds and the Forest. */
export class ForestApi extends HttpApiGroup.make("forest")
  .add(
    HttpApiEndpoint.get("rates", "/rates", { success: Rates }),
    HttpApiEndpoint.get("forest", "/forest", { success: Forest }),
  )
  .prefix("/v1/grove") {}

export class LeafApi extends HttpApi.make("sequoia-leaf")
  .add(SystemApi)
  .add(MeApi)
  .add(GroveApi)
  .add(ForestApi)
  .middleware(Unexpected)
  .annotateMerge(OpenApi.annotations({ title: "Leaf", description: "The Sequoia guild currency and its game" })) {}
