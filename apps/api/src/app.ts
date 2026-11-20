import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";

import { Identities } from "./auth/session.ts";
import { AppConfig } from "./config.ts";
import { Conversions } from "./conversions/store.ts";
import { Database } from "./db.ts";
import { Events } from "./events/store.ts";
import { Great } from "./great/store.ts";
import { Grove } from "./grove/store.ts";
import { GuildEvents } from "./guild/store.ts";
import { ApiRoutes, NotFound } from "./http/handlers.ts";
import { Ledger } from "./ledger/store.ts";
import { Market } from "./market/store.ts";
import { Quests } from "./quests/store.ts";
import { SecureRandom } from "./random.ts";

/** Leaf's HTTP routes. They need the services below. */
export const Routes = Layer.mergeAll(ApiRoutes, NotFound).pipe(Layer.provide(Identities.layer));

/** Effect's router takes `/healthz/` for `/healthz` unless told otherwise; Leaf's routes are exact. */
export const routerConfig = { ignoreTrailingSlash: false };

/**
 * Leaf's stores: the ledger, the events, the quests, the Grove, the Great
 * Sequoia, the marketplace, conversions and the guild feed, on whichever
 * database is provided.
 */
export const Stores = Layer.mergeAll(
  Events.layer,
  Quests.layer,
  Grove.layer,
  Great.layer,
  Market.layer,
  Conversions.layer,
  GuildEvents.layer,
).pipe(Layer.provideMerge(Ledger.layer));

/** What Leaf reaches outside its own code: its settings, its database, the network and its dice. */
export const Services = Stores.pipe(
  Layer.provideMerge(Database),
  Layer.provideMerge(FetchHttpClient.layer),
  Layer.provideMerge(AppConfig.layer),
  Layer.provideMerge(SecureRandom),
);
