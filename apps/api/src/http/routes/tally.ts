import { PERIODS, tallyBoard } from "@sequoia-leaf/core";
import { Effect } from "effect";
import { HttpServerResponse } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

import { CurrentIdentity, LeafApi } from "../../api/api.ts";
import { Missing } from "../../api/errors.ts";
import type * as Body from "../../api/schemas.ts";
import { Tallies } from "../../tally/store.ts";
import { iso } from "./shared.ts";

export const GameTallyHandlers = HttpApiBuilder.group(LeafApi, "gameTally", (handlers) =>
  Effect.gen(function* () {
    const tallies = yield* Tallies;

    return (
      handlers
        // A board of the Tally, as the caller is shown it.
        .handle("tally", ({ params }) =>
          Effect.gen(function* () {
            const board = tallyBoard(params.board);
            const period = PERIODS.find((p) => p === params.period);
            if (board === undefined || period === undefined || (period === "week" && !board.week)) {
              return yield* new Missing({ code: "no_such_board", message: "The Tally keeps no such board" });
            }
            const { playerId } = yield* CurrentIdentity;
            const shown = yield* tallies.board(board, period, playerId);
            return HttpServerResponse.jsonUnsafe({
              board: board.id,
              period,
              from: shown.from === null ? null : iso(shown.from),
              top: shown.top.map((row) => ({
                place: row.place,
                id: row.playerId,
                name: row.name,
                guest: row.guest,
                score: row.score,
                you: row.playerId === playerId,
              })),
              you: shown.you,
            } satisfies typeof Body.Tally.Type);
          }),
        )
    );
  }),
);
