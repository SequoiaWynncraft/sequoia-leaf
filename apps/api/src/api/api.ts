import type { PlayerId } from "@sequoia-leaf/core";
import { Context, Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema, OpenApi } from "effect/http-api";

import {
  CostChanged,
  IdentityUnavailable,
  InsufficientLeaf,
  InvalidAfter,
  InvalidCost,
  InvalidQuest,
  NotAMember,
  NotCurrent,
  NotRerollable,
  Unauthorized,
} from "./errors.ts";
import { Events, Health, Me, Quests, RerollBody, Rerolled } from "./schemas.ts";

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
 * Lets in current guild members with a Sequoia session, sent as
 * `Authorization: Bearer` or as the site's `seq_session` cookie, and provides
 * who they are.
 */
export class Session extends HttpApiMiddleware.Service<Session, { provides: CurrentIdentity }>()("leaf/api/Session", {
  error: [Unauthorized, NotAMember, IdentityUnavailable],
}) {}

/** Answers a reroll whose body is not `{ "leaf": n }` with `invalid_cost`. */
export class RerollBodyErrors extends HttpApiMiddleware.Service<RerollBodyErrors>()("leaf/api/RerollBodyErrors", {
  error: InvalidCost,
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
      error: [InvalidQuest, NotCurrent, NotRerollable, CostChanged, InsufficientLeaf],
    }).middleware(RerollBodyErrors),
    HttpApiEndpoint.get("events", "/events", { query: EventPosition, success: Events, error: InvalidAfter }),
    HttpApiEndpoint.get("stream", "/events/stream", {
      query: EventPosition,
      success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/event-stream" })),
      error: InvalidAfter,
    }),
  )
  .middleware(Session)
  .prefix("/v1/me") {}

export class LeafApi extends HttpApi.make("sequoia-leaf")
  .add(SystemApi)
  .add(MeApi)
  .annotateMerge(OpenApi.annotations({ title: "Leaf", description: "The Sequoia guild currency and its game" })) {}
