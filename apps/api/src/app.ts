import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";

import { Identities } from "./auth/session.ts";
import { AppConfig } from "./config.ts";
import { Database } from "./db.ts";
import { Events } from "./events/store.ts";
import { ApiRoutes, NotFound } from "./http/handlers.ts";
import { Ledger } from "./ledger/store.ts";
import { Quests } from "./quests/store.ts";

/** Leaf's HTTP routes. They need the services below. */
export const Routes = Layer.mergeAll(ApiRoutes, NotFound).pipe(Layer.provide(Identities.layer));

/** Effect's router takes `/healthz/` for `/healthz` unless told otherwise; Leaf's routes are exact. */
export const routerConfig = { ignoreTrailingSlash: false };

/** Leaf's stores: the ledger, the events and the quests, on whichever database is provided. */
export const Stores = Layer.mergeAll(Events.layer, Quests.layer).pipe(Layer.provideMerge(Ledger.layer));

/** What Leaf reaches outside its own code: its settings, its database and the network. */
export const Services = Stores.pipe(
  Layer.provideMerge(Database),
  Layer.provideMerge(FetchHttpClient.layer),
  Layer.provideMerge(AppConfig.layer),
);
