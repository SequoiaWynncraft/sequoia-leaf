import { Clock, Effect } from "effect";
import { HttpServerResponse } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

import { whoIsAbout } from "../../activity/about.ts";
import { Visits } from "../../activity/visits.ts";
import { CurrentIdentity, isGuest, LeafApi } from "../../api/api.ts";

export const GamePresenceHandlers = HttpApiBuilder.group(LeafApi, "gamePresence", (handlers) =>
  Effect.gen(function* () {
    const visits = yield* Visits;

    return (
      handlers
        .handle("presence", ({ payload }) =>
          Effect.gen(function* () {
            const identity = yield* CurrentIdentity;
            const now = yield* Clock.currentTimeMillis;
            const guest = isGuest(identity);
            yield* visits.called(
              { playerId: identity.playerId, username: identity.username, guest, device: payload.device ?? null },
              payload.place,
              payload.stay ?? null,
              now,
            );
            return HttpServerResponse.jsonUnsafe(yield* whoIsAbout(now));
          }),
        )
        // The same lists, writing nothing: for a page in a live room, where the room keeps the player's place.
        .handle("whoIsAbout", () =>
          Effect.gen(function* () {
            return HttpServerResponse.jsonUnsafe(yield* whoIsAbout(yield* Clock.currentTimeMillis));
          }),
        )
    );
  }),
);
