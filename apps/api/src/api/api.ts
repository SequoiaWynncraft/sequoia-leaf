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
  NotStaff,
  Refused,
  TradeForbidden,
  TradeInvalid,
  TradeMissing,
  TradeRefused,
  Unauthorized,
} from "./errors.ts";
import {
  BuyBody,
  CareBody,
  Cared,
  Companion,
  CompanionBody,
  ConesBody,
  ConesBought,
  ConesOpened,
  ConversionAnswer,
  ConversionBody,
  ConversionQueue,
  ConversionRates,
  DeclineBody,
  DisputeBody,
  Disputes,
  Events,
  Forest,
  Great,
  GroveMe,
  Health,
  Id,
  ListingAnswer,
  ListingBody,
  ListingEditBody,
  ListingQuery,
  Listings,
  Me,
  MyConversions,
  MyListings,
  OfferBody,
  Offered,
  OrderActed,
  OrderAnswer,
  Orders,
  Page,
  PayBody,
  Quests,
  Rates,
  RerollBody,
  Rerolled,
  ResolveBody,
  StaffConversionAnswer,
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

/**
 * Lets in staff only: members the backend marks as website administrators,
 * the narrowest notion of staff its session check gives. Runs inside `Session`.
 */
export class StaffOnly extends HttpApiMiddleware.Service<StaffOnly, { requires: CurrentIdentity }>()(
  "leaf/api/StaffOnly",
  { error: NotStaff },
) {}

/** Answers a marketplace or conversion request whose body, path or query doesn't decode with `invalid_request`. */
export class TradeBodyErrors extends HttpApiMiddleware.Service<TradeBodyErrors>()("leaf/api/TradeBodyErrors", {
  error: TradeInvalid,
}) {}

const EventPosition = { after: Schema.optional(Schema.String) };

const EventStream = Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/event-stream" }));

const ById = { id: Id };

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

/** The signed-in member's Grove: their tree, its care, their cones and spirits, and the Great Sequoia. */
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
    HttpApiEndpoint.get("great", "/great", { success: Great }),
    HttpApiEndpoint.post("offer", "/great/offer", {
      payload: OfferBody,
      success: Offered,
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

/** What anyone may see of what happens in the guild, signed in or not, for the Forest to show live. */
export class GuildApi extends HttpApiGroup.make("guild")
  .add(
    HttpApiEndpoint.get("events", "/events", { query: EventPosition, success: Events, error: Invalid }),
    HttpApiEndpoint.get("stream", "/events/stream", { query: EventPosition, success: EventStream, error: Invalid }),
  )
  .prefix("/v1/guild") {}

/** Every way a marketplace or conversion request can be turned down. */
const TradeErrors = [TradeInvalid, TradeRefused, TradeForbidden, TradeMissing];

/** The signed-in member's side of the marketplace: their listings, what they buy and what they sell. */
export class MarketApi extends HttpApiGroup.make("market")
  .add(
    HttpApiEndpoint.post("list", "/listings", {
      payload: ListingBody,
      success: ListingAnswer,
      error: TradeErrors,
    }),
    HttpApiEndpoint.patch("edit", "/listings/:id", {
      params: ById,
      payload: ListingEditBody,
      success: ListingAnswer,
      error: TradeErrors,
    }),
    HttpApiEndpoint.post("withdraw", "/listings/:id/withdraw", {
      params: ById,
      success: ListingAnswer,
      error: TradeErrors,
    }),
    HttpApiEndpoint.get("mine", "/my-listings", { query: Page, success: MyListings, error: TradeInvalid }),
    HttpApiEndpoint.post("buy", "/listings/:id/buy", {
      params: ById,
      payload: BuyBody,
      success: OrderActed,
      error: TradeErrors,
    }),
    HttpApiEndpoint.get("orders", "/orders", { query: Page, success: Orders, error: TradeInvalid }),
    HttpApiEndpoint.get("order", "/orders/:id", {
      params: ById,
      success: OrderAnswer,
      error: TradeErrors,
    }),
    HttpApiEndpoint.post("deliver", "/orders/:id/deliver", { params: ById, success: OrderActed, error: TradeErrors }),
    HttpApiEndpoint.post("confirm", "/orders/:id/confirm", { params: ById, success: OrderActed, error: TradeErrors }),
    HttpApiEndpoint.post("cancel", "/orders/:id/cancel", { params: ById, success: OrderActed, error: TradeErrors }),
    HttpApiEndpoint.post("dispute", "/orders/:id/dispute", {
      params: ById,
      payload: DisputeBody,
      success: OrderActed,
      error: TradeErrors,
    }),
  )
  .middleware(TradeBodyErrors)
  .middleware(Session)
  .prefix("/v1/market") {}

/** What anyone may see of the marketplace, signed in or not: the listings taking orders. */
export class MarketBrowseApi extends HttpApiGroup.make("marketBrowse")
  .add(
    HttpApiEndpoint.get("listings", "/listings", { query: ListingQuery, success: Listings, error: TradeInvalid }),
    HttpApiEndpoint.get("listing", "/listings/:id", {
      params: ById,
      success: ListingAnswer,
      error: TradeErrors,
    }),
  )
  .middleware(TradeBodyErrors)
  .prefix("/v1/market") {}

/** The signed-in member's claims of Leaf out to LE, tomes and aspects. */
export class ConversionsApi extends HttpApiGroup.make("conversions")
  .add(
    HttpApiEndpoint.post("claim", "/", {
      payload: ConversionBody,
      success: ConversionAnswer,
      error: TradeErrors,
    }),
    HttpApiEndpoint.get("mine", "/", { success: MyConversions }),
    HttpApiEndpoint.post("cancel", "/:id/cancel", {
      params: ById,
      success: ConversionAnswer,
      error: TradeErrors,
    }),
  )
  .middleware(TradeBodyErrors)
  .middleware(Session)
  .prefix("/v1/conversions") {}

/** The rates, limits and caps of conversions, for anyone to see. */
export class ConversionRatesApi extends HttpApiGroup.make("conversionRates")
  .add(HttpApiEndpoint.get("rates", "/rates", { success: ConversionRates }))
  .prefix("/v1/conversions") {}

/** What staff do: settle the marketplace's disputes, and pay or decline claims in the conversion queue. */
export class StaffApi extends HttpApiGroup.make("staff")
  .add(
    HttpApiEndpoint.get("disputes", "/market/disputes", { success: Disputes }),
    HttpApiEndpoint.post("resolve", "/market/orders/:id/resolve", {
      params: ById,
      payload: ResolveBody,
      success: OrderAnswer,
      error: TradeErrors,
    }),
    HttpApiEndpoint.get("queue", "/conversions", { success: ConversionQueue }),
    HttpApiEndpoint.post("pay", "/conversions/:id/pay", {
      params: ById,
      payload: PayBody,
      success: StaffConversionAnswer,
      error: TradeErrors,
    }),
    HttpApiEndpoint.post("decline", "/conversions/:id/decline", {
      params: ById,
      payload: DeclineBody,
      success: StaffConversionAnswer,
      error: TradeErrors,
    }),
  )
  .middleware(TradeBodyErrors)
  .middleware(StaffOnly)
  .middleware(Session)
  .prefix("/v1/staff") {}

export class LeafApi extends HttpApi.make("sequoia-leaf")
  .add(SystemApi)
  .add(MeApi)
  .add(GroveApi)
  .add(ForestApi)
  .add(GuildApi)
  .add(MarketApi)
  .add(MarketBrowseApi)
  .add(ConversionsApi)
  .add(ConversionRatesApi)
  .add(StaffApi)
  .middleware(Unexpected)
  .annotateMerge(OpenApi.annotations({ title: "Leaf", description: "The Sequoia guild currency and its game" })) {}
