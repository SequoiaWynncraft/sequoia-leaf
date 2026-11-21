import { LIVE_PATH, LIVE_VERSION } from "@sequoia-leaf/core";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { BadOrigin, Unauthorized } from "../api/errors.ts";
import { sessionChecks } from "../http/handlers.ts";
import { Live } from "./live.ts";

/** An answer in the API's `{ "code", "message" }` shape, for a request that is not let through to a live connection. */
const refuse = (status: number, code: string, message: string) =>
  HttpServerResponse.jsonUnsafe({ code, message }, { status, headers: { "cache-control": "no-store" } });

/**
 * `GET /v1/game/live?v=1`: a WebSocket for anyone the game's routes let in, members and guests,
 * with the session as the cookie (from Leaf's own pages only) or a Bearer header. It is refused,
 * before it is upgraded, as the API refuses: 401 `unauthorized`, 403 `bad_origin`, 503
 * `identity_unavailable`; and 400 `unsupported_version` or `not_websocket`.
 */
export const LiveRoute = Layer.unwrap(
  Effect.gen(function* () {
    const checks = yield* sessionChecks;
    const live = yield* Live;
    const handler = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const version = new URL(request.url, "http://leaf").searchParams.get("v");
      if (version !== String(LIVE_VERSION)) {
        return refuse(400, "unsupported_version", `Leaf speaks version ${LIVE_VERSION} of the live connection`);
      }
      if (request.headers["upgrade"]?.toLowerCase() !== "websocket") {
        return refuse(400, "not_websocket", "Open this as a WebSocket");
      }
      const identity = yield* checks.upgrade;
      const socket = yield* Effect.orDie(request.upgrade);
      yield* live.serve(socket, identity);
      return HttpServerResponse.empty();
    }).pipe(
      Effect.catch((e) =>
        Effect.succeed(refuse(e instanceof Unauthorized ? 401 : e instanceof BadOrigin ? 403 : 503, e.code, e.message)),
      ),
    );
    return HttpRouter.add("GET", LIVE_PATH, handler);
  }),
);
