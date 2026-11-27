/**
 * A player's listener: a connection that hears what Leaf tells the player and what it says in its
 * room, and nothing of anybody, beside their presence connection (opened into a room of a listening
 * kind, core's `RoomKind.listens`: the open tables'). It is in no room of the game's: nobody sees it,
 * it says nowhere the player is, and it neither replaces their presence connection nor is replaced
 * by it. A player has at most one: a new one replaces the old (`CLOSE.replaced`). It has no grace:
 * gone, it is gone, and its page opens another.
 *
 * It is welcomed into its room by name, with nobody in it, so that a page knows it is heard from
 * then; hears what Leaf tells everybody listening there (`Watchers`: the open tables' changes); and,
 * as one of the player's connections, what Leaf tells the player of their own (`LivePlayers`: their
 * sittings' nudges). It sends nothing but pings: anything else is a strike against the player.
 *
 * It counts against Live's limits as its player: one place among `mostPlayers` for a player with a
 * presence connection, a listener or both, and the same allowances, of which opening one takes an
 * opening proper (a listener hands nothing over between pages).
 */
import { CLOSE, SERVER_HZ, type ToClient } from "@sequoia-leaf/core";
import { Clock, Effect, Option, Schema, type Scope } from "effect";
import type { Socket } from "effect/socket";

import type { LiveCounts } from "./counts.ts";
import { Pipe } from "./pipe.ts";
import type { Player } from "./player.ts";
import type { Outbox } from "./room.ts";
import type { Watchers } from "./watchers.ts";

/** What a connection does with each frame its page sends, at Leaf's clock. */
export type Takes = (p: Player, frame: string | Uint8Array, now: number) => void;

/** A listener open and the player's, to be served as any connection is, with what it does with what comes in. */
export interface Listened {
  readonly socket: Socket.Socket;
  readonly pipe: Pipe;
  readonly p: Player;
  readonly takes: Takes;
}

/** What a listener needs of Live: its counts, the rooms' watchers, and whether Leaf is still running. */
export interface Listening {
  readonly counts: LiveCounts;
  readonly watchers: Watchers["Service"];
  readonly running: () => boolean;
}

/** The longest frame a listener reads: a ping is far shorter. */
const MOST_TEXT = 128;
const readPing = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ t: Schema.Literal("ping"), c: Schema.Finite })),
);
const say = (m: ToClient): string => JSON.stringify(m);

/**
 * Opens a player's listener into a listening room (`kindName`), once the socket is open: it replaces
 * any listener of theirs, hears the room, and is welcomed into it, in one step. Opened while Leaf is
 * stopping, it is told to come back, and is never anybody's.
 */
export const listenerOf =
  ({ counts, watchers, running }: Listening) =>
  (
    p: Player,
    kindName: string,
    upgrade: Effect.Effect<Socket.Socket, unknown>,
    speaks: number,
  ): Effect.Effect<Listened | null, never, Scope.Scope> =>
    Effect.gen(function* () {
      const socket = yield* Effect.orDie(upgrade);
      const pipe = yield* Pipe.make(yield* socket.writer, speaks, (bytes) => counts.sent("motion", 1, bytes));
      const outbox: Outbox = { send: (frame) => pipe.send(frame), connection: () => pipe };
      const hearing = { stop: (): void => undefined };
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          counts.closed(pipe.how);
          hearing.stop();
          if (p.listener === pipe) p.listener = null;
        }),
      );
      const now = yield* Clock.currentTimeMillis;
      if (!running()) {
        yield* pipe.closeNow(CLOSE.restart, "restart");
        return null;
      }
      p.listener?.close(CLOSE.replaced, "replaced");
      p.listener = pipe;
      hearing.stop = watchers.hear(kindName, outbox);
      pipe.send(say({ t: "welcome", v: speaks, you: 0, room: kindName, hz: SERVER_HZ, time: now, roster: [] }));
      counts.opened();
      // A strike is the player's, as on their presence connection; with none left, this one closes.
      const takes: Takes = (player, frame, at) => {
        counts.minute.textsIn++;
        const ping =
          typeof frame === "string" && frame.length <= MOST_TEXT && player.texts.take(at)
            ? readPing(frame)
            : Option.none();
        if (Option.isSome(ping)) return void pipe.send(say({ t: "pong", c: ping.value.c, s: at }));
        counts.dropped();
        if (!player.strikes.take(at)) pipe.close(CLOSE.policy, "too much that could not be taken");
      };
      return { socket, pipe, p, takes };
    });
