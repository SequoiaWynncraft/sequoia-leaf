import { parsePlayerId } from "@sequoia-leaf/core";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { CurrentIdentity, LeafApi } from "../../api/api.ts";
import { Invalid, Missing, Refused, SlowDown } from "../../api/errors.ts";
import { type Caller, Camps } from "../../camps/store.ts";
import { iso } from "./shared.ts";

/** Somebody who likes a camp or stayed in it, as the answer has them. */
const callerJson = (c: Caller) => ({ id: c.playerId, name: c.name, guest: c.guest, at: iso(c.at) });

export const GameCampsHandlers = HttpApiBuilder.group(LeafApi, "gameCamps", (handlers) =>
  Effect.gen(function* () {
    const camps = yield* Camps;

    /** A like given (`on`) or taken back, by the caller, of the camp a route names. */
    const like = (player: string, on: boolean) =>
      Effect.gen(function* () {
        const owner = parsePlayerId(player);
        if (owner === undefined) {
          return yield* new Invalid({ code: "invalid_uuid", message: "That is not a Minecraft UUID" });
        }
        const identity = yield* CurrentIdentity;
        const done = yield* camps.like(identity.playerId, identity.username, owner, on);
        switch (done.status) {
          case "slow":
            return yield* new SlowDown({
              code: "slow_down",
              message: "Likes are coming too fast. Try again in a moment",
            });
          case "refused":
            return yield* done.why === "own_camp"
              ? new Refused({ code: "own_camp", message: "That is your own camp" })
              : new Missing({ code: "nothing_to_visit", message: "There is no camp of theirs" });
          case "done":
            return { likes: done.likes, liked: done.liked };
        }
      });

    return handlers
      .handle("camps", () =>
        Effect.gen(function* () {
          const { playerId } = yield* CurrentIdentity;
          const listed = yield* camps.list(playerId);
          return {
            camps: listed.map((c) => ({
              id: c.playerId,
              name: c.name,
              guest: c.guest,
              set_out: c.setOut,
              likes: c.likes,
              liked: c.liked,
            })),
          };
        }),
      )
      .handle("visitors", () =>
        Effect.gen(function* () {
          const { playerId } = yield* CurrentIdentity;
          const { likes, stays } = yield* camps.visitors(playerId);
          return { likes: likes.map(callerJson), stays: stays.map(callerJson) };
        }),
      )
      .handle("like", ({ params }) => like(params.player, true))
      .handle("unlike", ({ params }) => like(params.player, false));
  }),
);
