import { Effect } from "effect";
import { HttpEffect, HttpRouter, HttpServerResponse } from "effect/http";

/**
 * What an answer that is not one of the game's pages may do in a browser:
 * nothing. It loads nothing, runs nothing and is framed by no page.
 */
export const API_POLICY = "default-src 'none'; frame-ancestors 'none'";

/**
 * Headers on every answer, errors included, just before it is sent: browsers
 * use the type it was sent as and never guess another, and one with no
 * `Content-Security-Policy` of its own, which is all but the game's pages, gets
 * `API_POLICY`.
 */
export const SafetyHeaders = HttpRouter.middleware(
  (httpEffect) =>
    HttpEffect.withPreResponseHandler(httpEffect, (_request, response) =>
      Effect.succeed(
        HttpServerResponse.setHeaders(response, {
          "x-content-type-options": "nosniff",
          "content-security-policy": response.headers["content-security-policy"] ?? API_POLICY,
        }),
      ),
    ),
  { global: true },
);
