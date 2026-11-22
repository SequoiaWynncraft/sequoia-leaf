import { BunHttpServer } from "@effect/platform-bun";
import { type Duration, Layer } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/http";

import { ActivityReport } from "./activity/report.ts";
import { Visits } from "./activity/visits.ts";
import { Identities } from "./auth/session.ts";
import { AppConfig } from "./config.ts";
import { Database } from "./db.ts";
import { Events } from "./events/store.ts";
import { Mojang } from "./game/mojang.ts";
import { PlayerNames } from "./game/names.ts";
import { Presence } from "./game/presence.ts";
import { Saves } from "./game/saves.ts";
import { Skins } from "./game/skins.ts";
import { ApiRoutes, NotFound } from "./http/handlers.ts";
import { SafetyHeaders } from "./http/headers.ts";
import { Pages } from "./http/pages.ts";
import { Ledger } from "./ledger/store.ts";
import { Live, LIVE_SOCKETS, LiveFarewell } from "./live/live.ts";
import { LiveRoute } from "./live/route.ts";
import { Quests } from "./quests/store.ts";

/**
 * Leaf's HTTP routes, the game's live connection, and the game's pages when there are any, with the
 * headers every answer carries. They need the services below.
 */
export const Routes = Layer.mergeAll(ApiRoutes, LiveRoute, Pages, NotFound, SafetyHeaders).pipe(
  Layer.provide(Identities.layer),
);

/** Effect's router takes `/healthz/` for `/healthz` unless told otherwise; Leaf's routes are exact. */
export const routerConfig = { ignoreTrailingSlash: false };

/**
 * Leaf served by Bun, as production and the tests both serve it: its routes and any `extra`, live
 * connections and all. The live rooms sit on top of the server, so that when it stops they say
 * farewell first (the server's own stop closes WebSockets with no word of why).
 */
export const serveLeaf = (options: {
  readonly port: number;
  readonly hostname?: string;
  /** How long requests in flight have to finish when Leaf stops. */
  readonly gracefulShutdownTimeout: Duration.Input;
  readonly extra?: Layer.Layer<never, never, HttpRouter.HttpRouter>;
}) =>
  LiveFarewell.pipe(
    Layer.provideMerge(
      HttpRouter.serve(Layer.mergeAll(Routes, options.extra ?? Layer.empty), {
        routerConfig,
        disableLogger: true,
      }).pipe(
        Layer.provideMerge(
          BunHttpServer.layer({
            port: options.port,
            ...(options.hostname === undefined ? {} : { hostname: options.hostname }),
            // No route reads more than a save's body; Leaf refuses anything near this itself.
            maxRequestBodySize: 1024 * 1024,
            // Seconds. An event stream writes a keep-alive every 20, well inside this.
            idleTimeout: 60,
            gracefulShutdownTimeout: options.gracefulShutdownTimeout,
            websocket: LIVE_SOCKETS,
          }),
        ),
      ),
    ),
  );

/**
 * Leaf's stores: the ledger, the events and the quests, what the game keeps, and who played it,
 * on whichever database is provided. Skins and names come from whichever Mojang is.
 */
export const Stores = Layer.mergeAll(
  Events.layer,
  Quests.layer,
  Saves.layer,
  Presence.layer,
  ActivityReport.layer.pipe(Layer.provideMerge(Visits.layer)),
  Skins.layer.pipe(Layer.provideMerge(PlayerNames.layer)),
).pipe(Layer.provideMerge(Ledger.layer));

/**
 * What Leaf reaches outside its own code (its settings, its database, Mojang and the network), and
 * the live rooms, which the routes serve and the server's farewell closes, and which write who is
 * in them into the stores' presence and visits.
 */
export const Services = Live.layer.pipe(
  Layer.provideMerge(Stores),
  Layer.provideMerge(Database),
  Layer.provide(Mojang.layer),
  Layer.provideMerge(FetchHttpClient.layer),
  Layer.provideMerge(AppConfig.layer),
);
