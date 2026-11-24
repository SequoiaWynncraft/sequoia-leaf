import { parsePlayerId, type PlayerId } from "@sequoia-leaf/core";
import { Clock, Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { whoIsAbout } from "../../activity/about.ts";
import { type Spot, Visits } from "../../activity/visits.ts";
import { CurrentIdentity, isGuest, LeafApi } from "../../api/api.ts";
import { Invalid } from "../../api/errors.ts";
import type { PresenceBody } from "../../api/schemas.ts";
import { Camps } from "../../camps/store.ts";

/** A presence's camp refused: the whole call is, and nothing is written. */
const badCamp = (message: string) => new Invalid({ code: "invalid_camp", message });

export const GamePresenceHandlers = HttpApiBuilder.group(LeafApi, "gamePresence", (handlers) =>
  Effect.gen(function* () {
    const visits = yield* Visits;
    const camps = yield* Camps;

    /**
     * Where a presence says the caller (`caller`) is: its place, and at a camp whose, if it says.
     * Whose camp is said only at a camp, and must be the caller's own or one Leaf has.
     */
    const spotOf = (body: typeof PresenceBody.Type, caller: PlayerId) =>
      Effect.gen(function* () {
        if (body.camp_owner === undefined) return { place: body.place, camp: null } satisfies Spot;
        if (body.place !== "camp") return yield* badCamp('Say whose camp only with the place "camp"');
        const owner = parsePlayerId(body.camp_owner);
        if (owner === undefined) return yield* badCamp("The camp's owner is not a Minecraft UUID");
        if (owner !== caller && !(yield* camps.has(owner))) return yield* badCamp("There is no camp of theirs");
        return { place: body.place, camp: owner } satisfies Spot;
      });

    return (
      handlers
        .handle("presence", ({ payload }) =>
          Effect.gen(function* () {
            const identity = yield* CurrentIdentity;
            const spot = yield* spotOf(payload, identity.playerId);
            const now = yield* Clock.currentTimeMillis;
            const guest = isGuest(identity);
            yield* visits.called(
              { playerId: identity.playerId, username: identity.username, guest, device: payload.device ?? null },
              spot,
              payload.stay ?? null,
              now,
            );
            return yield* whoIsAbout(now);
          }),
        )
        // The same lists, writing nothing: for a page in a live room, where the room keeps the player's place.
        .handle("whoIsAbout", () =>
          Effect.gen(function* () {
            return yield* whoIsAbout(yield* Clock.currentTimeMillis);
          }),
        )
    );
  }),
);
