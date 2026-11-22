import { LIVE_PATH, LIVE_VERSION, readDevice, roomKind } from "@sequoia-leaf/core";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { BadOrigin, Unauthorized } from "../api/errors.ts";
import { sessionChecks } from "../http/handlers.ts";
import { Live } from "./live.ts";

/** An answer in the API's `{ "code", "message" }` shape, for a request that is not let through to a live connection. */
const answer = (status: number, code: string, message: string) =>
  HttpServerResponse.jsonUnsafe({ code, message }, { status, headers: { "cache-control": "no-store" } });

/**
 * `GET /v1/game/live?v=2&room=<kind>` (`livePath`): a WebSocket into a room, for anyone the game's
 * routes let in, members and guests, with the session as the cookie (from Leaf's own pages only)
 * or a Bearer header. `&device=phone` or `desktop` is what the page is on, for the player's visits;
 * anything else there is taken as nothing said. It is refused, before it is upgraded, as the API refuses: 401
 * `unauthorized`, 403 `bad_origin`, 503 `identity_unavailable`; 400 `unsupported_version`,
 * `unknown_room` or `not_websocket`; 503 `live_full`, or `restarting` while Leaf stops; and 429
 * `slow_down` for a player who opens connections too often. Each refusal is counted, by its code,
 * for Live's log line.
 */
export const LiveRoute = Layer.unwrap(
  Effect.gen(function* () {
    const checks = yield* sessionChecks;
    const live = yield* Live;
    const refuse = (status: number, code: string, message: string) =>
      Effect.as(live.refused(code), answer(status, code, message));
    const handler = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const query = new URL(request.url, "http://leaf").searchParams;
      if (query.get("v") !== String(LIVE_VERSION)) {
        return yield* refuse(400, "unsupported_version", `Leaf speaks version ${LIVE_VERSION} of the live connection`);
      }
      const kindName = query.get("room") ?? "";
      if (roomKind(kindName) === undefined) return yield* refuse(400, "unknown_room", "There is no such room");
      if (request.headers["upgrade"]?.toLowerCase() !== "websocket") {
        return yield* refuse(400, "not_websocket", "Open this as a WebSocket");
      }
      const identity = yield* checks.upgrade;
      // The session is asked about again as the connection goes on: it holds only while the session
      // does. The backend being out of reach is not taken to mean it has ended.
      const asked = yield* Effect.context<HttpServerRequest.HttpServerRequest | HttpServerRequest.ParsedSearchParams>();
      const session = checks.upgrade.pipe(
        Effect.map((again) => again.playerId === identity.playerId),
        Effect.catch((e) => Effect.succeed(!(e instanceof Unauthorized))),
        Effect.provideContext(asked),
      );
      const opened = yield* live.open(identity, kindName, request.upgrade, session, readDevice(query.get("device")));
      if (opened === "full") return yield* refuse(503, "live_full", "Live is full just now. Try again shortly");
      if (opened === "busy") return yield* refuse(429, "slow_down", "Opened too often. Try again in a little while");
      if (opened === "stopping") return yield* refuse(503, "restarting", "Leaf is restarting. Try again in a moment");
      return HttpServerResponse.empty();
    }).pipe(
      Effect.catch((e) =>
        refuse(e instanceof Unauthorized ? 401 : e instanceof BadOrigin ? 403 : 503, e.code, e.message),
      ),
    );
    return HttpRouter.add("GET", LIVE_PATH, handler);
  }),
);
