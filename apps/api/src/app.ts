import { BunHttpServer } from "@effect/platform-bun";
import { Duration, Effect, Layer } from "effect";
import { SecureRandom } from "effect/crypto";
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
import { OpenStreams } from "./http/streams.ts";
import { Ledger } from "./ledger/store.ts";
import { Live, LIVE_SOCKETS } from "./live/live.ts";
import { LiveRoute } from "./live/route.ts";
import { Coins } from "./play/coins.ts";
import { PageCoins } from "./play/page.ts";
import { Play } from "./play/service.ts";
import { PlayStore } from "./play/store.ts";
import { Purchases } from "./purchases/store.ts";
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
 * How long a request already being answered has to finish once Leaf stops; whatever is still open
 * then is closed. The server stops listening at once, and a proxy that sends this process a request
 * before it has exited gets no answer, so Leaf does not linger.
 */
const STOP_GRACE = Duration.millis(200);

/**
 * Leaf's farewell, when it stops, before the HTTP server underneath it does: every live player is
 * told Leaf is restarting (the server's own stop closes WebSockets with no word of why), and every
 * event stream ends, which would otherwise hold the server's stop up for all of `STOP_GRACE`. Their
 * clients reconnect, to the next Leaf.
 */
const Farewell = Layer.effectDiscard(
  Effect.gen(function* () {
    const live = yield* Live;
    const streams = yield* OpenStreams;
    yield* Effect.addFinalizer(() => Effect.andThen(live.farewell, streams.end));
  }),
);

/**
 * Leaf served by Bun, as production and the tests both serve it: its routes and any `extra`, live
 * connections and all. The farewell sits on top of the server, so that when it stops, live players
 * and event streams are seen off first, and the server's own stop has only requests in flight to
 * wait for, for at most `STOP_GRACE`.
 */
export const serveLeaf = (options: {
  readonly port: number;
  readonly hostname?: string;
  readonly extra?: Layer.Layer<never, never, HttpRouter.HttpRouter>;
}) =>
  Farewell.pipe(
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
            gracefulShutdownTimeout: STOP_GRACE,
            websocket: LIVE_SOCKETS,
          }),
        ),
      ),
    ),
  );

/**
 * Leaf's stores: the ledger, the events and the quests, what the game keeps (the games' states and
 * Coins among them), who played it, and the requests the backend buys with Leaf, on whichever
 * database is provided. Skins and names come
 * from whichever Mojang is.
 */
export const Stores = Layer.mergeAll(
  Events.layer,
  Quests.layer,
  Saves.layer,
  Presence.layer,
  ActivityReport.layer.pipe(Layer.provideMerge(Visits.layer)),
  Skins.layer.pipe(Layer.provideMerge(PlayerNames.layer)),
  PlayStore.layer,
  Coins.layer,
  Purchases.layer,
).pipe(Layer.provideMerge(Ledger.layer));

/**
 * What Leaf reaches outside its own code (its settings, its database, Mojang, the network and the
 * machine's dice), the play service and the pages' Coins on the stores, and the live rooms, which the routes serve and
 * the server's farewell closes, and which write who is in them into the stores' presence and visits.
 */
export const Services = Layer.mergeAll(Play.layer, PageCoins.layer, Live.layer).pipe(
  Layer.provideMerge(Stores),
  Layer.provideMerge(Database),
  Layer.provide(Mojang.layer),
  Layer.provide(SecureRandom.layerWebCrypto),
  Layer.provideMerge(FetchHttpClient.layer),
  Layer.provideMerge(AppConfig.layer),
);
