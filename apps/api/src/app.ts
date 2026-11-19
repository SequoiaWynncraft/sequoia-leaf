import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";

import { Identities } from "./auth/session.ts";
import { AppConfig, type Config } from "./config.ts";
import { Db } from "./db.ts";
import { ApiRoutes, JsonFallbacks } from "./http/handlers.ts";

/** Leaf's HTTP routes. They need the services below. */
export const Routes = Layer.mergeAll(ApiRoutes, JsonFallbacks).pipe(Layer.provide(Identities.layer));

/** Effect's router takes `/healthz/` for `/healthz` unless told otherwise; Leaf's routes are exact. */
export const routerConfig = { ignoreTrailingSlash: false };

/** What Leaf reaches outside its own code: its configuration, its database and the network. */
export const services = (config: Config) =>
  Layer.mergeAll(Layer.succeed(AppConfig)(config), Db.layer(config.databasePath), FetchHttpClient.layer);
