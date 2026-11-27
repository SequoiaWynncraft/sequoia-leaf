import { BunHttpServer } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerError, HttpServerRequest, HttpServerResponse, HttpStaticServer } from "effect/http";

import { AppConfig } from "../config.ts";

/**
 * What the game's pages may do: load and frame only what Leaf serves, talk only
 * to Leaf, and be framed only by Leaf's own pages. Their styles are partly
 * inline, their pictures are partly drawn in the page, and their font is
 * built into their styles as a `data:` address. A `<base>` may point only at
 * Leaf, a form may be sent only to Leaf, and no plugin content loads: none of
 * these falls back to `default-src`.
 */
export const PAGE_POLICY = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "connect-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

/** A file whose name carries a hash of what it holds, as `bun build` names a page's script and styles. */
const HASHED = /\/index-[0-9a-z]+\.(?:js|css)$/;

/**
 * Hashed files never change under their name; anything else is asked about
 * again each time, decided by the path alone (a query names no other file).
 * A failure is never kept: while Leaf is updating, the Leaf going away has no
 * file the new pages name, and a browser keeping that 404 for a year would
 * open the page without it until then.
 */
function cacheControl(url: string, status: number): string {
  if (status >= 400) return "no-store";
  const [path = ""] = url.split("?", 1);
  return HASHED.test(path) ? "public, max-age=31536000, immutable" : "no-cache";
}

const notFound = HttpServerResponse.jsonUnsafe({ code: "not_found", message: "No such route" }, { status: 404 });
const failed = HttpServerResponse.jsonUnsafe(
  { code: "internal_error", message: "Something went wrong" },
  { status: 500 },
);

/** The game's pages under `/play`, from the directory `root`, with `GET /` sent to the town. */
const pagesFrom = (root: string) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const router = yield* HttpRouter.HttpRouter;
      const files = yield* HttpStaticServer.make({ root, index: "index.html" });
      const served = Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const response = yield* files.pipe(
          Effect.catch((error) =>
            error.reason instanceof HttpServerError.RouteNotFound
              ? Effect.succeed(notFound)
              : Effect.logError("A page could not be served", error).pipe(Effect.as(failed)),
          ),
        );
        return HttpServerResponse.setHeaders(response, {
          "content-security-policy": PAGE_POLICY,
          "cache-control": cacheControl(request.url, response.status),
        });
      });
      yield* router.prefixed("/play").add("GET", "/*", served);
      yield* router.add("GET", "/", HttpServerResponse.redirect("/play/town/", { status: 302 }));
    }),
  ).pipe(Layer.provide(BunHttpServer.layerHttpServices));

/** The game's pages, when `PUBLIC_DIR` names where they are; otherwise neither `/play` nor `/` exists. */
export const Pages = Layer.unwrap(
  Effect.gen(function* () {
    const { publicDir } = yield* AppConfig;
    return publicDir === undefined ? Layer.empty : pagesFrom(publicDir);
  }),
);
