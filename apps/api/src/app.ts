import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";

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
import { Live } from "./live/live.ts";
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
 * Leaf's stores: the ledger, the events and the quests, and what the game keeps,
 * on whichever database is provided. Skins and names come from whichever Mojang is.
 */
export const Stores = Layer.mergeAll(
  Events.layer,
  Quests.layer,
  Saves.layer,
  Presence.layer,
  Skins.layer.pipe(Layer.provideMerge(PlayerNames.layer)),
).pipe(Layer.provideMerge(Ledger.layer));

/**
 * What Leaf reaches outside its own code (its settings, its database, Mojang and the network), and
 * the live rooms, which the routes serve and the server's farewell closes.
 */
export const Services = Stores.pipe(
  Layer.merge(Live.layer),
  Layer.provideMerge(Database),
  Layer.provide(Mojang.layer),
  Layer.provideMerge(FetchHttpClient.layer),
  Layer.provideMerge(AppConfig.layer),
);
