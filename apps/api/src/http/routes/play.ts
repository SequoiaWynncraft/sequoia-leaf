import { parsePlayerId } from "@sequoia-leaf/core";
import { Clock, Effect, Option, Schema } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { Visits } from "../../activity/visits.ts";
import { CurrentIdentity, LeafApi } from "../../api/api.ts";
import { BadOrigin, Invalid, Missing, SlowDown } from "../../api/errors.ts";
import { PlayerNames } from "../../game/names.ts";
import type { Played } from "../../play/games.ts";
import { type Opening, Play, type Shown } from "../../play/service.ts";
import { PlayStore } from "../../play/store.ts";
import { Tallies } from "../../tally/store.ts";
import { iso, notYou, playedGame, playingOf, unreadable } from "./shared.ts";

/** Leaf's answer to a batch: the state as it now shows (`Shown`), what each command came to, and Leaf's rules. */
const answerOf = <R>(shown: Shown, played: Played, results: readonly R[]) => ({
  rev: shown.rev,
  now: iso(shown.now),
  results,
  state: shown.view,
  purse: shown.purse,
  rules: played.rules,
});

/**
 * A batch from a page playing by other rules than Leaf's, answered as a read is: none of it done,
 * with Leaf's rules, on which the page loads again, as any page does on seeing them.
 */
const asRead = (shown: Opening, played: Played) =>
  shown.status === "unreadable" ? Effect.fail(unreadable) : Effect.succeed(answerOf(shown, played, []));

/** A command of the pulls that is a draw, which Leaf makes only on its own website, never in a Discord call. */
const isDraw = Schema.is(Schema.Struct({ do: Schema.Literal("pull") }));

/**
 * The game a batch of `commands` is for, as the route names it; refused, all of it undone, when it
 * holds a draw and its session was signed in inside a Discord call, wherever the request comes from:
 * the pulls are on the website.
 */
const playedFrom = (name: string, commands: readonly unknown[]) =>
  Effect.gen(function* () {
    const played = yield* playedGame(name);
    if (played.id !== "pulls" || !commands.some(isDraw) || !(yield* CurrentIdentity).inCall) return played;
    return yield* new BadOrigin({ code: "bad_origin", message: "Pulls are made on Leaf's website" });
  });

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
            return {
              rev: shown.rev,
              now: iso(shown.now),
              state: shown.view,
              purse: shown.purse,
              rules: played.rules,
            };
          }),
        )
        // Commands, done in order in one transaction. A command whose id was seen before answers as
        // it did then, so a page that sends a batch again after losing the answer changes nothing.
        .handle("command", ({ params, payload }) =>
          Effect.gen(function* () {
            const played = yield* playedFrom(params.game, payload.commands);
            const identity = yield* CurrentIdentity;
            if (payload.player !== identity.playerId) {
              return yield* notYou;
            }
            // A page playing by other rules than Leaf's names places and things as those rules have
            // them: none of its commands is done (`asRead`). A page from before pages said their rules
            // says none and is done as before: answered with Leaf's rules, it loads again if they are
            // not its own, and a page of a game whose rules have not changed has nothing to load.
            if (payload.rules !== undefined && payload.rules !== played.rules) {
              return yield* asRead(yield* play.open(playingOf(identity), played, undefined), played);
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
            return answerOf(batch, played, batch.results);
          }),
        )
        // A game's board, its players named as the guild's news names them.
        .handle("standings", ({ params }) =>
          Effect.gen(function* () {
            const played = yield* playedGame(params.game);
            const { playerId } = yield* CurrentIdentity;
            const board = yield* store.board(played.id, playerId);
            const named = yield* names.of(board.top.map((row) => row.playerId));
            return {
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
            };
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
            return {
              rev: shown.rev,
              now: iso(shown.now),
              state: shown.view,
              purse: shown.purse,
              rules: played.rules,
            };
          }),
        )
    );
  }),
);
