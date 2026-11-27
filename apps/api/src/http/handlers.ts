import { Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

import { LeafApi } from "../api/api.ts";
import { BackendLive, InternalHandlers, PurchaseBodyErrorsLive } from "./internal.ts";
import { GameAdminHandlers } from "./routes/admin.ts";
import { GameCampsHandlers } from "./routes/camps.ts";
import { MeHandlers } from "./routes/me.ts";
import {
  BodyLimitLive,
  PageErrorBodyErrorsLive,
  PlayBodyErrorsLive,
  PlayerLive,
  PresenceBodyErrorsLive,
  RequestBodyErrorsLive,
  RerollBodyErrorsLive,
  SessionLive,
  UnexpectedLive,
} from "./routes/middleware.ts";
import { GamePeopleHandlers } from "./routes/people.ts";
import { GamePlayHandlers } from "./routes/play.ts";
import { GamePresenceHandlers } from "./routes/presence.ts";
import { GameRaidHandlers } from "./routes/raid.ts";
import { GameReportsHandlers } from "./routes/reports.ts";
import { GameRequestsHandlers } from "./routes/requests.ts";
import { GameHelloHandlers, RatesHandlers, SystemHandlers } from "./routes/system.ts";
import { GameTallyHandlers } from "./routes/tally.ts";
import { EventTail, GuildFeed, OpenStreams } from "./streams.ts";

/**
 * The API's routes and the implementations of its middleware, with the event streams they hold open,
 * which Leaf's farewell ends when it stops.
 */
export const ApiRoutes = HttpApiBuilder.layer(LeafApi, { openapiPath: "/openapi.json" }).pipe(
  Layer.provide([
    SystemHandlers,
    RatesHandlers,
    MeHandlers,
    GameHelloHandlers,
    GameReportsHandlers,
    GamePeopleHandlers,
    GamePresenceHandlers,
    GamePlayHandlers,
    GameRaidHandlers,
    GameCampsHandlers,
    GameRequestsHandlers,
    GameTallyHandlers,
    GameAdminHandlers,
    InternalHandlers,
  ]),
  Layer.provide(GuildFeed.layer.pipe(Layer.provideMerge(EventTail.layer))),
  Layer.provideMerge(OpenStreams.layer),
  Layer.provide([
    SessionLive,
    PlayerLive,
    BodyLimitLive,
    RerollBodyErrorsLive,
    PresenceBodyErrorsLive,
    PlayBodyErrorsLive,
    PageErrorBodyErrorsLive,
    RequestBodyErrorsLive,
    BackendLive,
    PurchaseBodyErrorsLive,
    UnexpectedLive,
  ]),
);

/** Any request no route takes, answered in the same `{ "code", "message" }` shape as every other error. */
export const NotFound = HttpRouter.add(
  "*",
  "/*",
  HttpServerResponse.jsonUnsafe({ code: "not_found", message: "No such route" }, { status: 404 }),
);
