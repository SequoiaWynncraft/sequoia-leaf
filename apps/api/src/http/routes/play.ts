import { parsePlayerId } from "@sequoia-leaf/core";
import { Clock, Effect, Option } from "effect";
import { HttpServerResponse } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

import { Visits } from "../../activity/visits.ts";
import { CurrentIdentity, LeafApi } from "../../api/api.ts";
import { Invalid, Missing, SlowDown } from "../../api/errors.ts";
import type * as Body from "../../api/schemas.ts";
import { PlayerNames } from "../../game/names.ts";
import { Play } from "../../play/service.ts";
import { PlayStore } from "../../play/store.ts";
import { Tallies } from "../../tally/store.ts";
import { iso, notYou, playedGame, playingOf, unreadable } from "./shared.ts";

export const GamePlayHandlers = HttpApiBuilder.group(LeafApi, "gamePlay", (handlers) =>
  Effect.gen(function* () {
    const names = yield* PlayerNames;
    const visits = yield* Visits;
    const play = yield* Play;
    const store = yield* PlayStore;
    const tallies = yield* Tallies;

    return (
      handlers
        .handle("play", ({ params, query }) =>
          Effect.gen(function* () {
            const played = yield* playedGame(params.game);
            const identity = yield* CurrentIdentity;
            // A page whose copy turned out not to be Leaf's says at which tick as it asks for the state.
            const differs = /^\d{1,13}$/.test(query.differs ?? "") ? Number(query.differs) : undefined;
            const shown = yield* play.open(playingOf(identity), played, differs);
            if (shown.status === "unreadable") {
              return yield* unreadable;
            }
            return HttpServerResponse.jsonUnsafe({
              rev: shown.rev,
              now: iso(shown.now),
              state: shown.view,
              purse: shown.purse,
              rules: played.rules,
            } satisfies typeof Body.PlayShown.Type);
          }),
        )
        // Commands, done in order in one transaction. A command whose id was seen before answers as
        // it did then, so a page that sends a batch again after losing the answer changes nothing.
        .handle("command", ({ params, payload }) =>
          Effect.gen(function* () {
            const played = yield* playedGame(params.game);
            const identity = yield* CurrentIdentity;
            if (payload.player !== identity.playerId) {
              return yield* notYou;
            }
            const batch = yield* play.send(playingOf(identity), played, payload.commands);
            if (batch.status === "invalid") {
              return yield* new Invalid({ code: "invalid_command", message: batch.why });
            }
            if (batch.status === "unreadable") {
              return yield* unreadable;
            }
            if (batch.status === "slow") {
              return yield* new SlowDown({
                code: "slow_down",
                message: "Commands are coming faster than Leaf takes them. Send them again in a moment",
              });
            }
            // In a batch Leaf took, anything but what the page sends by itself is the player at the keys, done or refused.
            if (payload.commands.some((command) => !played.chore(command))) {
              yield* visits.acted(identity.playerId, yield* Clock.currentTimeMillis);
            }
            return HttpServerResponse.jsonUnsafe({
              rev: batch.rev,
              now: iso(batch.now),
              results: batch.results,
              state: batch.view,
              purse: batch.purse,
              rules: played.rules,
            } satisfies typeof Body.Played.Type);
          }),
        )
        // A game's board, its players named as the guild's news names them.
        .handle("standings", ({ params }) =>
          Effect.gen(function* () {
            const played = yield* playedGame(params.game);
            const { playerId } = yield* CurrentIdentity;
            const board = yield* store.board(played.id, playerId);
            const named = yield* names.of(board.top.map((row) => row.playerId));
            return HttpServerResponse.jsonUnsafe({
              top: board.top.map((row) => ({
                place: row.place,
                id: row.playerId,
                name: named.get(row.playerId) ?? "Someone",
                guest: row.guest,
                score: row.score,
                also: row.also,
                you: row.playerId === playerId,
              })),
              you: Option.getOrNull(board.you),
            } satisfies typeof Body.Standings.Type);
          }),
        )
        // Somebody's state as a visitor is given it: brought to now, and kept so as any job keeps a
        // state it ran on; nothing of the visitor's is written.
        .handle("visit", ({ params }) =>
          Effect.gen(function* () {
            const played = yield* playedGame(params.game);
            const identity = yield* CurrentIdentity;
            const player = parsePlayerId(params.player);
            const shown = player === undefined ? null : yield* play.visit(player, played, playingOf(identity));
            // A camp read again while the visitor stays in it counts toward the Tally's visits.
            if (player !== undefined && played.id === "town" && shown?.status === "open") {
              yield* tallies.visited(identity.playerId, player, yield* Clock.currentTimeMillis);
            }
            if (shown === null || shown.status === "nothing") {
              return yield* new Missing({
                code: "nothing_to_visit",
                message: "There is nothing of theirs to visit there",
              });
            }
            if (shown.status === "unreadable") {
              return yield* unreadable;
            }
            if (shown.status === "slow") {
              return yield* new SlowDown({
                code: "slow_down",
                message: "Visits are coming faster than Leaf takes them. Ask again in a moment",
              });
            }
            return HttpServerResponse.jsonUnsafe({
              rev: shown.rev,
              now: iso(shown.now),
              state: shown.view,
              purse: shown.purse,
              rules: played.rules,
            } satisfies typeof Body.PlayShown.Type);
          }),
        )
    );
  }),
);
