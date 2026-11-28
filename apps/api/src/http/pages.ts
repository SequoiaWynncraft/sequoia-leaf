import { BunHttpServer } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerError, HttpServerRequest, HttpServerResponse, HttpStaticServer } from "effect/http";

import { AppConfig } from "../config.ts";

/** What every page may do, whoever frames it. */
const OWN = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "frame-src 'self'",
];
const REST = ["connect-src 'self'", "base-uri 'self'", "form-action 'self'", "object-src 'none'"];

/**
 * What the game's pages may do: load and frame only what Leaf serves, talk only
 * to Leaf, and be framed only by Leaf's own pages. Their styles are partly
 * inline, their pictures are partly drawn in the page, and their font is
 * built into their styles as a `data:` address. A `<base>` may point only at
 * Leaf, a form may be sent only to Leaf, and no plugin content loads: none of
 * these falls back to `default-src`.
 */
export const PAGE_POLICY = [...OWN, "frame-ancestors 'self'", ...REST].join("; ");

/**
 * A page of Leaf in a Discord call: as every page, but with no rule on who frames it. Discord's
 * phone apps frame an Activity from a page with no origin of its own (its SDK takes messages from
 * the origin `null`), which no `frame-ancestors` list can name: with one, the phone shows a grey
 * frame and the page never runs. Nothing is lost by it: a site that frames this page gets it signed
 * out (Leaf's own cookie is not sent to another site's frame, and the frame's own cookie is kept
 * per site), and only Discord's client can answer the sign-in it asks for. Inside Discord `'self'`
 * is Discord's proxy for Leaf (`<client id>.discordsays.com`), which every request of the page goes
 * through; the town frames a game there as it does at Leaf's own address.
 */
export const CALL_PAGE_POLICY = [...OWN, ...REST].join("; ");

/** Where the game's pages are: the town, and the games it shows in its frame. */
const PAGES = "/play/";

/**
 * Whether a request is a page opened as part of a Discord launch: its query names the frame and the
 * launch, as Discord's every launch does (and its SDK needs to start), and as Leaf's own pages
 * carry it from page to page inside the call (the kit's `withLaunch`).
 */
const launchedByDiscord = (query: URLSearchParams): boolean =>
  (query.get("frame_id") ?? "") !== "" && (query.get("instance_id") ?? "") !== "";

/**
 * The policy a page is served with, chosen by its address alone: a page opened as part of a launch
 * gets `CALL_PAGE_POLICY`, every other page `PAGE_POLICY`, framed by Leaf's own pages alone.
 */
export function policyOf(url: string): string {
  const at = new URL(url, "http://leaf.invalid");
  return at.pathname.startsWith(PAGES) && launchedByDiscord(at.searchParams) ? CALL_PAGE_POLICY : PAGE_POLICY;
}

/**
 * A file whose name carries a hash of what it holds, as `bun build` names a page's script and styles
 * and each part of a page built in parts: `index-meamkakx.js`, `main-yxtpzszz.js`.
 */
const HASHED = /\/[\w.-]+-[0-9a-z]{8}\.(?:js|css)$/;

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

/** The town's page, where Leaf opens on the website and in a Discord call alike. */
const TOWN_PAGE = "/play/town/";

/**
 * `GET /`: the town; opened by Discord in a call, with Discord's query as it came (the page reads the
 * frame and the launch from it, and carries them on). Discord maps its proxy's `/` to Leaf's.
 */
const entry = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const { search, searchParams } = new URL(request.url, "http://leaf.invalid");
  if (!launchedByDiscord(searchParams)) return HttpServerResponse.redirect(TOWN_PAGE, { status: 302 });
  return HttpServerResponse.redirect(`${TOWN_PAGE}${search}`, {
    status: 302,
    headers: { "content-security-policy": CALL_PAGE_POLICY, "cache-control": "no-store" },
  });
});

/** The game's pages under `/play`, from the directory `root`, with `GET /` sent to the town (`entry`). */
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
          "content-security-policy": policyOf(request.originalUrl),
          "cache-control": cacheControl(request.url, response.status),
        });
      });
      yield* router.prefixed("/play").add("GET", "/*", served);
      yield* router.add("GET", "/", entry);
    }),
  ).pipe(Layer.provide(BunHttpServer.layerHttpServices));

/** The game's pages, when `PUBLIC_DIR` names where they are; otherwise neither `/play` nor `/` exists. */
export const Pages = Layer.unwrap(
  Effect.gen(function* () {
    const { publicDir } = yield* AppConfig;
    return publicDir === undefined ? Layer.empty : pagesFrom(publicDir);
  }),
);
