import { type ByeCode, decodeMove, KIND, LIVE_VERSION, SERVER_HZ, type ToClient, TOKEN } from "@sequoia-leaf/core";
import { Clock, Context, Duration, Effect, Layer, Option, Queue, Schedule, Schema, type Scope } from "effect";
import { Socket } from "effect/socket";

import { type Identity, isGuest } from "../api/api.ts";
import { type Occupant, type Room, Rooms } from "./room.ts";

/**
 * What Bun is told about every WebSocket: no frame over 4 KiB, a client that falls a megabyte
 * behind is cut off rather than buffered for, a silent one goes after a minute (Bun pings it), and
 * nothing is compressed, which would cost time on every small frame.
 */
export const LIVE_SOCKETS = {
  maxPayloadLength: 4096,
  backpressureLimit: 1024 * 1024,
  closeOnBackpressureLimit: true,
  idleTimeout: 60,
  sendPings: true,
  perMessageDeflate: false,
} as const;

/** The longest text frame Leaf reads. Every message the game sends is far shorter. */
const MOST_TEXT = 512;

/** Allowances, as a steady rate a second and a burst: moves, then everything sent as text, then actions within it. */
const MOVES = { rate: 30, burst: 40 } as const;
const TEXTS = { rate: 8, burst: 20 } as const;
const ACTS = { rate: 3, burst: 6 } as const;
/** How many frames over an allowance, or that cannot be read, a connection may send before it is closed. */
const STRIKES = 200;
/** How many frames may wait to go to one connection before it is taken to be stuck and closed. */
const MOST_WAITING = 1024;

/** A token bucket: an allowance that refills at `rate` a second, up to `burst`. */
class Allowance {
  private readonly spec: { readonly rate: number; readonly burst: number };
  private tokens: number;
  private at: number;
  constructor(spec: { readonly rate: number; readonly burst: number }, now: number) {
    this.spec = spec;
    this.tokens = spec.burst;
    this.at = now;
  }
  take(now: number): boolean {
    this.tokens = Math.min(this.spec.burst, this.tokens + ((now - this.at) / 1000) * this.spec.rate);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** What the game may send as text. Anything else is not read. */
const ToServerJson = Schema.fromJsonString(
  Schema.Union([
    Schema.Struct({ t: Schema.Literal("join"), room: Schema.String }),
    Schema.Struct({ t: Schema.Literal("leave") }),
    Schema.Struct({ t: Schema.Literal("act"), kind: Schema.String, arg: Schema.String }),
    Schema.Struct({ t: Schema.Literal("ping"), c: Schema.Finite }),
  ]),
);
const readText = Schema.decodeUnknownOption(ToServerJson);

type Frame = string | Uint8Array | Socket.CloseEvent;

/** The close codes Leaf uses, by why it closes. */
const CLOSE: Readonly<Record<ByeCode, number>> = { replaced: 4001, restart: 1012, invalid: 1008, rate: 1008 };

/** One player's live connection: what waits to be sent to them, the room they are in, and their allowances. */
class Connection {
  occupant: Occupant | null = null;
  room: Room | null = null;
  strikes = 0;
  closing = false;
  readonly moves: Allowance;
  readonly texts: Allowance;
  readonly acts: Allowance;
  readonly identity: Identity;
  private readonly out: Queue.Queue<Frame>;
  private readonly writer: Socket.Writer;

  constructor(identity: Identity, out: Queue.Queue<Frame>, writer: Socket.Writer, now: number) {
    this.identity = identity;
    this.out = out;
    this.writer = writer;
    this.moves = new Allowance(MOVES, now);
    this.texts = new Allowance(TEXTS, now);
    this.acts = new Allowance(ACTS, now);
  }

  send(frame: string | Uint8Array): void {
    if (this.closing) return;
    if (Queue.sizeUnsafe(this.out) >= MOST_WAITING) {
      // The socket takes frames as fast as they come; a backlog this long means it is stuck.
      this.closing = true;
      Queue.offerUnsafe(this.out, new Socket.CloseEvent(1008, "too far behind"));
      return;
    }
    Queue.offerUnsafe(this.out, frame);
  }

  /** Says why, and closes. Nothing more is sent after it. */
  bye(code: ByeCode): void {
    if (this.closing) return;
    this.send(JSON.stringify({ t: "bye", code } satisfies ToClient));
    this.closing = true;
    Queue.offerUnsafe(this.out, new Socket.CloseEvent(CLOSE[code], code));
  }

  /**
   * Leaf is stopping: says so and closes, straight to the socket, ahead of anything still waiting,
   * since there is no time to wait for it.
   */
  goodbye(): Effect.Effect<void> {
    if (this.closing) return Effect.void;
    this.closing = true;
    return Effect.ignore(
      Effect.andThen(
        this.writer.write(JSON.stringify({ t: "bye", code: "restart" } satisfies ToClient)),
        this.writer.write(new Socket.CloseEvent(CLOSE.restart, "restart")),
      ),
    );
  }
}

/** What Live has done in the last minute, for its log line. */
interface Counts {
  opened: number;
  closed: number;
  movesIn: number;
  textsIn: number;
  dropped: number;
  framesOut: number;
}

const noCounts = (): Counts => ({ opened: 0, closed: 0, movesIn: 0, textsIn: 0, dropped: 0, framesOut: 0 });

/**
 * Live: players in the same room see each other move as it happens (the wire is in
 * `packages/core/src/live.ts`). Each player has one connection; a second, from another tab or
 * device, replaces the first. Rooms are in memory, in this process: during a deploy every player is
 * told Leaf is restarting and reconnects to the new container.
 */
export class Live extends Context.Service<
  Live,
  {
    /** Serves one player's connection until it closes, or until Leaf stops. */
    readonly serve: (socket: Socket.Socket, identity: Identity) => Effect.Effect<void, never, Scope.Scope>;
    /** How many are connected, and in which rooms (for tests and the log). */
    readonly census: Effect.Effect<{ readonly players: number; readonly rooms: Readonly<Record<string, number>> }>;
    /** Tells every player Leaf is restarting, and closes their connections, so that they come back to the next one. */
    readonly farewell: Effect.Effect<void>;
  }
>()("leaf/Live") {
  static readonly layer = Layer.effect(
    Live,
    Effect.gen(function* () {
      const rooms = new Rooms();
      const players = new Map<string, Connection>();
      let counts = noCounts();
      let tick = 0;

      const leaveRoom = (c: Connection): void => {
        const { room, occupant } = c;
        if (!room || !occupant) return;
        room.leave(occupant.member.id);
        rooms.tidy(room);
        c.room = null;
        c.occupant = null;
      };

      const join = (c: Connection, kindName: string, now: number): void => {
        const room = rooms.place(kindName);
        if (!room) {
          c.send(JSON.stringify({ t: "error", code: "unknown_room" } satisfies ToClient));
          return;
        }
        leaveRoom(c);
        const { identity } = c;
        const outbox = { send: (frame: string | Uint8Array) => c.send(frame) };
        const who = {
          player: identity.playerId,
          name: identity.username,
          rank: identity.guildRank,
          guest: isGuest(identity),
        };
        c.occupant = room.join(who, outbox, now, SERVER_HZ, LIVE_VERSION);
        c.room = room;
      };

      const strike = (c: Connection, why: ByeCode): void => {
        counts.dropped++;
        c.strikes++;
        if (c.strikes > STRIKES) c.bye(why);
      };

      /** One frame from the game. */
      const take = (c: Connection, frame: string | Uint8Array, now: number): void => {
        if (c.closing) return;
        if (typeof frame !== "string") {
          counts.movesIn++;
          const move = decodeMove(frame);
          if (!move) return strike(c, "invalid");
          if (!c.moves.take(now)) return strike(c, "rate");
          if (c.room && c.occupant) c.room.move(c.occupant.member.id, move.seq, move.motion);
          return;
        }
        counts.textsIn++;
        if (frame.length > MOST_TEXT) return strike(c, "invalid");
        if (!c.texts.take(now)) return strike(c, "rate");
        const message = readText(frame);
        if (Option.isNone(message)) return strike(c, "invalid");
        const m = message.value;
        switch (m.t) {
          case "ping":
            c.send(JSON.stringify({ t: "pong", c: m.c, s: now } satisfies ToClient));
            return;
          case "join":
            join(c, m.room, now);
            return;
          case "leave":
            leaveRoom(c);
            return;
          case "act":
            if (!KIND.test(m.kind) || !TOKEN.test(m.arg)) {
              c.send(JSON.stringify({ t: "error", code: "bad_act" } satisfies ToClient));
              return strike(c, "invalid");
            }
            if (!c.acts.take(now)) return strike(c, "rate");
            if (!c.room || !c.occupant) {
              c.send(JSON.stringify({ t: "error", code: "not_in_room" } satisfies ToClient));
              return;
            }
            c.room.act(c.occupant.member.id, m.kind, m.arg);
            return;
        }
      };

      // Every tick, each room with any change sends it to everyone in it.
      const flush = Effect.flatMap(Clock.currentTimeMillis, (now) =>
        Effect.sync(() => {
          tick++;
          for (const room of rooms.all()) if (room.flush(tick, now)) counts.framesOut += room.size;
        }),
      );
      yield* Effect.forkScoped(Effect.repeat(flush, Schedule.fixed(Duration.millis(1000 / SERVER_HZ))));

      // A line a minute while anybody is connected, or anything happened.
      const report = Effect.suspend(() => {
        const was = counts;
        counts = noCounts();
        if (players.size === 0 && was.opened === 0 && was.closed === 0) return Effect.void;
        const inRooms: Record<string, number> = {};
        for (const room of rooms.all()) inRooms[room.name] = room.size;
        return Effect.logInfo("live").pipe(Effect.annotateLogs({ players: players.size, rooms: inRooms, ...was }));
      });
      yield* Effect.forkScoped(Effect.repeat(report, Schedule.spaced(Duration.minutes(1))));

      const serve = (socket: Socket.Socket, identity: Identity) =>
        Effect.gen(function* () {
          const writer = yield* socket.writer;
          const out = yield* Queue.unbounded<Frame>();
          const connection = new Connection(identity, out, writer, yield* Clock.currentTimeMillis);
          const id = identity.playerId;
          players.get(id)?.bye("replaced");
          players.set(id, connection);
          counts.opened++;
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              leaveRoom(connection);
              if (players.get(id) === connection) players.delete(id);
              counts.closed++;
            }),
          );

          // Everything for this player goes out in the order it was sent, as soon as it is.
          yield* Effect.forkScoped(
            Effect.forever(
              Effect.flatMap(Queue.takeAll(out), (frames) => {
                counts.framesOut += frames.length;
                return Effect.forEach(frames, (frame) => writer.write(frame), { discard: true });
              }),
            ),
          );

          const { pull } = yield* socket.reader;
          yield* Effect.forever(
            Effect.flatMap(pull, (frames) =>
              Effect.flatMap(Clock.currentTimeMillis, (now) =>
                Effect.sync(() => {
                  for (const frame of frames) take(connection, frame, now);
                }),
              ),
            ),
          );
        }).pipe(
          // The player closed it, or Leaf did.
          Effect.catchTag("SocketError", () => Effect.void),
          // Leaf is stopping: the player is told to come back in a moment.
          Effect.onInterrupt(() =>
            Effect.gen(function* () {
              const writer = yield* socket.writer;
              yield* writer.write(JSON.stringify({ t: "bye", code: "restart" } satisfies ToClient));
              yield* writer.write(new Socket.CloseEvent(CLOSE.restart, "restart"));
            }).pipe(Effect.scoped, Effect.ignore),
          ),
        );

      const census = Effect.sync(() => {
        const inRooms: Record<string, number> = {};
        for (const room of rooms.all()) inRooms[room.name] = room.size;
        return { players: players.size, rooms: inRooms };
      });

      const farewell = Effect.suspend(() =>
        Effect.forEach([...players.values()], (c) => c.goodbye(), { discard: true }),
      );

      return Live.of({ serve, census, farewell });
    }),
  );
}

/**
 * Says farewell to every live player before the HTTP server underneath it stops. Put it on top of the
 * server (`LiveFarewell.pipe(Layer.provideMerge(server))`) so that it is taken down first: the
 * server's own stop closes WebSockets with no word of why.
 */
export const LiveFarewell = Layer.effectDiscard(
  Effect.gen(function* () {
    const live = yield* Live;
    yield* Effect.addFinalizer(() => live.farewell);
  }),
);
