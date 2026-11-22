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
  BodyTooLarge,
  IdentityUnavailable,
  InternalError,
  Invalid,
  MembersOnly,
  Missing,
  Moved,
  NotAMember,
  NotYou,
  Refused,
  SaveTooLarge,
  SlowDown,
  StaffOnly,
  Unauthorized,
  VersionConflict,
} from "./errors.ts";
import {
  ActivityReport,
  Events,
  GameMe,
  GuildEvents,
  Health,
  Hello,
  Me,
  PlayBody,
  Played,
  PlayShown,
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
 * Whether someone is in the game as a guest: signed in, but neither a member of the guild now nor a
 * website admin. Guests play, but have no Leaf, quests or news of the guild's.
 */
export const isGuest = (identity: Identity): boolean => identity.guildRank === null && !identity.admin;

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

/**
 * Lets in anyone with a Sequoia session, member of the guild or not, checked as `Session` checks
 * it but without its gate. The game's routes take it; whoever is neither a member nor an admin
 * plays as a guest (`isGuest`).
 */
export class Player extends HttpApiMiddleware.Service<Player, { provides: CurrentIdentity }>()("leaf/api/Player", {
  security: { bearer: HttpApiSecurity.bearer, cookie: SessionCookie },
  error: [Unauthorized, BadOrigin, IdentityUnavailable],
}) {}

/** Answers a failure nothing expected with `internal_error`, after logging it. */
export class Unexpected extends HttpApiMiddleware.Service<Unexpected>()("leaf/api/Unexpected", {
  error: InternalError,
}) {}

/** Reads a request's body only up to 16 KiB: a longer one gets 413 `body_too_large` unread. Saves read more. */
export class BodyLimit extends HttpApiMiddleware.Service<BodyLimit>()("leaf/api/BodyLimit", {
  error: BodyTooLarge,
}) {}

/** Answers a reroll whose body is not `{ "leaf": n }` with `invalid_cost`. */
export class RerollBodyErrors extends HttpApiMiddleware.Service<RerollBodyErrors>()("leaf/api/RerollBodyErrors", {
  error: Invalid,
}) {}

/** Answers a save whose body is not `{ "player", "version", "data" }`, or is too large to read, with `invalid_save` or `save_too_large`. */
export class SaveBodyErrors extends HttpApiMiddleware.Service<SaveBodyErrors>()("leaf/api/SaveBodyErrors", {
  error: [Invalid, SaveTooLarge],
}) {}

/** Answers a batch whose body is not `{ "commands": [...] }` with `invalid_command`. */
export class PlayBodyErrors extends HttpApiMiddleware.Service<PlayBodyErrors>()("leaf/api/PlayBodyErrors", {
  error: Invalid,
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
const GameParams = { game: Schema.String };

/**
 * What only the browser game uses, open to anyone signed in, members and guests alike, but for the
 * guild's own news. Its answers are recorded in `contracts/leaf-game-v1.json`.
 */
export class GameApi extends HttpApiGroup.make("game")
  .add(
    HttpApiEndpoint.get("me", "/me", { success: GameMe }),
    HttpApiEndpoint.get("saves", "/saves", { success: SaveList }),
    HttpApiEndpoint.get("save", "/saves/:slot", { params: SlotParams, success: Save, error: [Invalid, Missing] }),
    HttpApiEndpoint.put("write", "/saves/:slot", {
      params: SlotParams,
      payload: SaveBody,
      success: Saved,
      error: [Invalid, VersionConflict, NotYou, SaveTooLarge, SlowDown, Moved],
    }).middleware(SaveBodyErrors),
    HttpApiEndpoint.get("skin", "/skins/:uuid", {
      params: { uuid: Schema.String },
      success: Png,
      error: [Invalid, Missing],
    }),
    HttpApiEndpoint.get("guildEvents", "/guild/events", {
      query: EventPosition,
      success: GuildEvents,
      error: [Invalid, MembersOnly],
    }),
    HttpApiEndpoint.get("guildStream", "/guild/events/stream", {
      query: EventPosition,
      success: EventStream,
      error: [Invalid, MembersOnly],
    }),
    HttpApiEndpoint.put("presence", "/presence", {
      payload: PresenceBody,
      success: Present,
      error: Invalid,
    }).middleware(PresenceBodyErrors),
    HttpApiEndpoint.get("whoIsAbout", "/presence", { success: Present }),
    HttpApiEndpoint.get("play", "/play/:game", { params: GameParams, success: PlayShown, error: Missing }),
    HttpApiEndpoint.post("command", "/play/:game", {
      params: GameParams,
      payload: PlayBody,
      success: Played,
      error: [Invalid, Missing, SlowDown],
    }).middleware(PlayBodyErrors),
  )
  .middleware(Player)
  .prefix("/v1/game") {}

/**
 * The staff's routes: signed in as the game's routes are, but only for a session the guild's
 * backend marks as a website admin. Nothing here is sent to any other player.
 */
export class GameAdminApi extends HttpApiGroup.make("gameAdmin")
  .add(
    HttpApiEndpoint.get("activity", "/activity", {
      query: { days: Schema.optional(Schema.String) },
      success: ActivityReport,
      error: [Invalid, StaffOnly],
    }),
  )
  .middleware(Player)
  .prefix("/v1/game/admin") {}

export class LeafApi extends HttpApi.make("sequoia-leaf")
  .add(SystemApi)
  .add(MeApi)
  .add(GameHelloApi)
  .add(GameApi)
  .add(GameAdminApi)
  .middleware(BodyLimit)
  .middleware(Unexpected)
  .annotateMerge(OpenApi.annotations({ title: "Leaf", description: "The Sequoia guild currency and its game" })) {}
