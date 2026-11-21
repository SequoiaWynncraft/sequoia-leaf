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
  BadOrigin,
  IdentityUnavailable,
  InternalError,
  Invalid,
  Missing,
  NotAMember,
  Refused,
  SaveTooLarge,
  Unauthorized,
  VersionConflict,
} from "./errors.ts";
import {
  Events,
  GameMe,
  GuildEvents,
  Health,
  Hello,
  Me,
  Png,
  PresenceBody,
  Present,
  Quests,
  RerollBody,
  Rerolled,
  Save,
  SaveBody,
  Saved,
  SaveList,
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
 * The cookie the Sequoia website signs members in with. It is set for the whole
 * `seqwawa.com` domain, so browsers send it to Leaf too.
 */
export const SessionCookie = HttpApiSecurity.apiKey({ key: "seq_session", in: "cookie" });

/**
 * Lets in current guild members with a Sequoia session, the token
 * sequoia-backend issued, sent as `Authorization: Bearer` or as the website's
 * session cookie. Provides who they are.
 */
export class Session extends HttpApiMiddleware.Service<Session, { provides: CurrentIdentity }>()("leaf/api/Session", {
  security: { bearer: HttpApiSecurity.bearer, cookie: SessionCookie },
  error: [Unauthorized, NotAMember, BadOrigin, IdentityUnavailable],
}) {}

/** Answers a failure nothing expected with `internal_error`, after logging it. */
export class Unexpected extends HttpApiMiddleware.Service<Unexpected>()("leaf/api/Unexpected", {
  error: InternalError,
}) {}

/** Answers a reroll whose body is not `{ "leaf": n }` with `invalid_cost`. */
export class RerollBodyErrors extends HttpApiMiddleware.Service<RerollBodyErrors>()("leaf/api/RerollBodyErrors", {
  error: Invalid,
}) {}

/** Answers a save whose body is not `{ "version", "data" }`, or is too large to read, with `invalid_save` or `save_too_large`. */
export class SaveBodyErrors extends HttpApiMiddleware.Service<SaveBodyErrors>()("leaf/api/SaveBodyErrors", {
  error: [Invalid, SaveTooLarge],
}) {}

/** Answers a presence whose body is not `{ "place" }` with one of the places with `invalid_place`. */
export class PresenceBodyErrors extends HttpApiMiddleware.Service<PresenceBodyErrors>()("leaf/api/PresenceBodyErrors", {
  error: Invalid,
}) {}

const EventPosition = { after: Schema.optional(Schema.String) };

const EventStream = Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/event-stream" }));

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
    HttpApiEndpoint.get("stream", "/events/stream", { query: EventPosition, success: EventStream, error: Invalid }),
  )
  .middleware(Session)
  .prefix("/v1/me") {}

/** The one game route open to anyone: the game asks it to learn whether it is on a live server. */
export class GameHelloApi extends HttpApiGroup.make("gameHello")
  .add(HttpApiEndpoint.get("hello", "/hello", { success: Hello }))
  .prefix("/v1/game") {}

const SlotParams = { slot: Schema.String };

/** What only the browser game uses. Its answers are recorded in `contracts/leaf-game-v1.json`. */
export class GameApi extends HttpApiGroup.make("game")
  .add(
    HttpApiEndpoint.get("me", "/me", { success: GameMe }),
    HttpApiEndpoint.get("saves", "/saves", { success: SaveList }),
    HttpApiEndpoint.get("save", "/saves/:slot", { params: SlotParams, success: Save, error: [Invalid, Missing] }),
    HttpApiEndpoint.put("write", "/saves/:slot", {
      params: SlotParams,
      payload: SaveBody,
      success: Saved,
      error: [Invalid, VersionConflict, SaveTooLarge],
    }).middleware(SaveBodyErrors),
    HttpApiEndpoint.get("skin", "/skins/:uuid", {
      params: { uuid: Schema.String },
      success: Png,
      error: [Invalid, Missing],
    }),
    HttpApiEndpoint.get("guildEvents", "/guild/events", { query: EventPosition, success: GuildEvents, error: Invalid }),
    HttpApiEndpoint.get("guildStream", "/guild/events/stream", {
      query: EventPosition,
      success: EventStream,
      error: Invalid,
    }),
    HttpApiEndpoint.put("presence", "/presence", {
      payload: PresenceBody,
      success: Present,
      error: Invalid,
    }).middleware(PresenceBodyErrors),
  )
  .middleware(Session)
  .prefix("/v1/game") {}

export class LeafApi extends HttpApi.make("sequoia-leaf")
  .add(SystemApi)
  .add(MeApi)
  .add(GameHelloApi)
  .add(GameApi)
  .middleware(Unexpected)
  .annotateMerge(OpenApi.annotations({ title: "Leaf", description: "The Sequoia guild currency and its game" })) {}
