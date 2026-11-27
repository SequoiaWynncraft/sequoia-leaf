import { wayOn } from "@sequoia-leaf/raid/way.ts";
import { Clock, Effect, Option } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { CurrentIdentity, LeafApi } from "../../api/api.ts";
import { PlayerNames } from "../../game/names.ts";
import { RaidDepths } from "../../play/depths.ts";
import { iso } from "./shared.ts";

/** The Little Raid's endless boards, their players named as the guild's news names them, and the rooms the caller holds. */
export const GameRaidHandlers = HttpApiBuilder.group(LeafApi, "gameRaid", (handlers) =>
  Effect.gen(function* () {
    const names = yield* PlayerNames;
    const depths = yield* RaidDepths;
    return handlers
      .handle("depths", ({ params, query }) =>
        Effect.gen(function* () {
          const { playerId } = yield* CurrentIdentity;
          const way = wayOn({ id: params.way }, query.pool === "own" ? {} : null);
          const board = yield* depths.board(way, params.span, playerId, yield* Clock.currentTimeMillis);
          const named = yield* names.of(board.top.map((row) => row.playerId));
          return {
            top: board.top.map((row) => ({
              place: row.place,
              id: row.playerId,
              name: named.get(row.playerId) ?? "Someone",
              room: row.room,
              at: iso(row.at),
              you: row.playerId === playerId,
            })),
            you: Option.getOrNull(Option.map(board.you, ({ place, room, at }) => ({ place, room, at: iso(at) }))),
          };
        }),
      )
      .handle("held", ({ query }) =>
        Effect.gen(function* () {
          const { playerId } = yield* CurrentIdentity;
          const way = wayOn({ id: "deep" }, query.pool === "own" ? {} : null);
          return { rooms: yield* depths.held(way, playerId, yield* Clock.currentTimeMillis) };
        }),
      );
  }),
);
