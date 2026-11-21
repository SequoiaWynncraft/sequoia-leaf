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
 * `identity_unavailable`; 400 `unsupported_version` or `not_websocket`; 503 `live_full`; and 429
 * `slow_down` for a player who opens connections too often.
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
      const admission = yield* live.admit(identity);
      if (admission === "full") return refuse(503, "live_full", "Live is full just now. Try again shortly");
      if (admission === "busy") return refuse(429, "slow_down", "Opened too often. Try again in a little while");
      // The session is asked about again as the connection goes on: it holds only while the session
      // does. The backend being out of reach is not taken to mean it has ended.
      const asked = yield* Effect.context<HttpServerRequest.HttpServerRequest | HttpServerRequest.ParsedSearchParams>();
      const session = checks.upgrade.pipe(
        Effect.map((again) => again.playerId === identity.playerId),
        Effect.catch((e) => Effect.succeed(!(e instanceof Unauthorized))),
        Effect.provideContext(asked),
      );
      const socket = yield* Effect.orDie(request.upgrade);
      yield* live.serve(socket, identity, session);
      return HttpServerResponse.empty();
    }).pipe(
      Effect.catch((e) =>
        Effect.succeed(refuse(e instanceof Unauthorized ? 401 : e instanceof BadOrigin ? 403 : 503, e.code, e.message)),
      ),
    );
    return HttpRouter.add("GET", LIVE_PATH, handler);
  }),
);
