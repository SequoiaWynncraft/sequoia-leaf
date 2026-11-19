import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";

import { Identities } from "./auth/session.ts";
import { AppConfig } from "./config.ts";
import { Db } from "./db.ts";
import { ApiRoutes, NotFound } from "./http/handlers.ts";

/** Leaf's HTTP routes. They need the services below. */
export const Routes = Layer.mergeAll(ApiRoutes, NotFound).pipe(Layer.provide(Identities.layer));

/** Effect's router takes `/healthz/` for `/healthz` unless told otherwise; Leaf's routes are exact. */
export const routerConfig = { ignoreTrailingSlash: false };

/** What Leaf reaches outside its own code: its settings, its database and the network. */
export const Services = Layer.mergeAll(Db.layer, FetchHttpClient.layer).pipe(Layer.provideMerge(AppConfig.layer));
