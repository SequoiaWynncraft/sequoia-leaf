import { CLOSE, decodeMove, isAct, LIVE_VERSION, roomKind, SERVER_HZ, type ToClient } from "@sequoia-leaf/core";
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

export interface LiveTuning {
  /** How often an open connection's session is checked again with the backend. */
  readonly recheckMs: number;
  /** How long a player whose connection dropped stays in their room, standing, for them to come back. */
  readonly graceMs: number;
  /** The most players Live holds at once, connected or in their grace. */
  readonly mostPlayers: number;
}

export const LiveTuning = Context.Reference<LiveTuning>("leaf/LiveTuning", {
  defaultValue: () => ({ recheckMs: 30_000, graceMs: 10_000, mostPlayers: 1000 }),
});

/** The longest text frame Leaf reads. Every message the game sends is far shorter. */
const MOST_TEXT = 512;
/** How many frames may wait to go to one connection before it is taken to be stuck and closed. */
const MOST_WAITING = 1024;

/**
 * Allowances, as a steady rate a second and a burst, all the player's own, kept across their
 * connections: moves, texts, actions within the texts, connections opened, and strikes (frames over
 * an allowance or that cannot be read; with none left, the connection is closed).
 */
const MOVES = { rate: 30, burst: 40 } as const;
const TEXTS = { rate: 8, burst: 20 } as const;
const ACTS = { rate: 3, burst: 6 } as const;
const OPENS = { rate: 0.1, burst: 10 } as const;
const STRIKES = { rate: 1, burst: 200 } as const;

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
  private refill(now: number): void {
    this.tokens = Math.min(this.spec.burst, this.tokens + (Math.max(0, now - this.at) / 1000) * this.spec.rate);
    this.at = now;
  }
  take(now: number): boolean {
    this.refill(now);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
  /** Whether it has filled up again: nothing is owed on it. */
  full(now: number): boolean {
    this.refill(now);
    return this.tokens >= this.spec.burst;
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

const say = (m: ToClient): string => JSON.stringify(m);

type Frame = string | Uint8Array | Socket.CloseEvent;

/**
 * One connection to a player's browser: frames wait here in order, and its own fiber writes them.
 * It is only a way through; everything about the player is on the `Player`.
 */
class Pipe {
  /** The code it was closed with, once Leaf closed it. */
  closedWith: number | null = null;
  private readonly out: Queue.Queue<Frame>;
  private readonly writer: Socket.Writer;

  constructor(out: Queue.Queue<Frame>, writer: Socket.Writer) {
    this.out = out;
    this.writer = writer;
  }

  get closed(): boolean {
    return this.closedWith !== null;
  }

  send(frame: string | Uint8Array): void {
    if (this.closed) return;
    // The socket takes frames as fast as they come; a backlog this long means it is stuck.
    if (Queue.sizeUnsafe(this.out) >= MOST_WAITING) return this.close(CLOSE.policy, "too far behind");
    Queue.offerUnsafe(this.out, frame);
  }

  /** Closes it after whatever is waiting, saying why by the code. */
  close(code: number, reason: string): void {
    if (this.closed) return;
    this.closedWith = code;
    Queue.offerUnsafe(this.out, new Socket.CloseEvent(code, reason));
  }

  /** Closes it at once, ahead of anything waiting: Leaf is stopping, and there is no time to wait. */
  closeNow(code: number, reason: string): Effect.Effect<void> {
    if (this.closed) return Effect.void;
    this.closedWith = code;
    return Effect.ignore(this.writer.write(new Socket.CloseEvent(code, reason)));
  }
}

/**
 * A player in Live: who they are, their place in a room, their allowances, and their connection now.
 * A player outlives their connections: a new one (after a drop, or from another tab) takes over the
 * same place, and the room never notices. A player with no connection stays, standing, for a grace
 * period, and then leaves the room. Their record is kept for as long as anything is left of them: a
 * connection, a place, or an allowance not yet filled up again, so that leaving and coming back
 * never refills one.
 */
class Player {
  identity: Identity;
  room: Room | null = null;
  occupant: Occupant | null = null;
  pipe: Pipe | null = null;
  /** When their last connection closed, while they have none. */
  goneAt: number | null = null;
  readonly moves: Allowance;
  readonly texts: Allowance;
  readonly acts: Allowance;
  readonly opens: Allowance;
  readonly strikes: Allowance;

  constructor(identity: Identity, now: number) {
    this.identity = identity;
    this.moves = new Allowance(MOVES, now);
    this.texts = new Allowance(TEXTS, now);
    this.acts = new Allowance(ACTS, now);
    this.opens = new Allowance(OPENS, now);
    this.strikes = new Allowance(STRIKES, now);
  }

  /** The room's outbox for this player: whichever connection they have now, or none. */
  send(frame: string | Uint8Array): void {
    this.pipe?.send(frame);
  }

  /** Whether nothing is left of them: no connection, no place, and nothing owed on any allowance. */
  gone(now: number): boolean {
    return (
      this.pipe === null &&
      this.room === null &&
      [this.moves, this.texts, this.acts, this.opens, this.strikes].every((a) => a.full(now))
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
}

const noCounts = (): Counts => ({ opened: 0, closed: 0, movesIn: 0, textsIn: 0, dropped: 0 });

/** What came of a player's asking to open a connection: served until it closed, or turned away. */
export type Opened = "served" | "full" | "busy";

/**
 * Live: players in the same room see each other move as it happens (the wire is in
 * `packages/core/src/live.ts`). Who is in which room is kept here and nowhere else, by player, not
 * by connection. Rooms are in memory, in this process: during a deploy every player is told Leaf is
 * restarting, and reconnects to the new container.
 */
export class Live extends Context.Service<
  Live,
  {
    /**
     * Lets a player open a connection, unless Live is full (`full`) or they open them too fast
     * (`busy`): their place among the players is taken before `upgrade` opens the socket, so that
     * nobody can slip in between. Then serves it until it closes, Leaf stops, or `session` (asked
     * every `recheckMs`) says the player's session has ended.
     */
    readonly open: (
      identity: Identity,
      upgrade: Effect.Effect<Socket.Socket, unknown>,
      session: Effect.Effect<boolean>,
    ) => Effect.Effect<Opened, never, Scope.Scope>;
    /** How many players there are, how many connected, and who is in which room (for tests and the log). */
    readonly census: Effect.Effect<{
      readonly players: number;
      readonly connected: number;
      readonly rooms: Readonly<Record<string, number>>;
    }>;
    /** Tells every player Leaf is restarting, and closes their connections, so that they come back to the next one. */
    readonly farewell: Effect.Effect<void>;
  }
>()("leaf/Live") {
  static readonly layer = Layer.effect(
    Live,
    Effect.gen(function* () {
      const tuning = yield* LiveTuning;
      const rooms = new Rooms();
      const players = new Map<string, Player>();
      let counts = noCounts();
      let tick = 0;

      // ---- who is in which room: these three alone change it ----

      const leave = (p: Player): void => {
        const { room, occupant } = p;
        p.room = null;
        p.occupant = null;
        if (!room || !occupant) return;
        room.leave(occupant.member.id);
        rooms.tidy(room);
      };

      /** Puts a player in a room of a kind; one already in one is greeted there again, keeping their place. */
      const enter = (p: Player, kindName: string, now: number): void => {
        if (roomKind(kindName) === undefined) return p.send(say({ t: "error", code: "unknown_room" }));
        if (p.room?.kindName === kindName && p.occupant) return p.room.greet(p.occupant, now, SERVER_HZ, LIVE_VERSION);
        leave(p);
        const room = rooms.place(kindName);
        if (!room) return;
        const { identity } = p;
        const who = {
          player: identity.playerId,
          name: identity.username,
          rank: identity.guildRank,
          guest: isGuest(identity),
        };
        p.occupant = room.join(who, p, now, SERVER_HZ, LIVE_VERSION);
        p.room = room;
      };

      // ---- what a player sends ----

      const strike = (p: Player, now: number): void => {
        counts.dropped++;
        if (!p.strikes.take(now)) p.pipe?.close(CLOSE.policy, "too much that could not be taken");
      };

      const take = (p: Player, frame: string | Uint8Array, now: number): void => {
        if (typeof frame !== "string") {
          counts.movesIn++;
          const move = decodeMove(frame);
          if (!move || !p.moves.take(now)) return strike(p, now);
          if (p.room && p.occupant) p.room.move(p.occupant.member.id, move.seq, move.motion);
          return;
        }
        counts.textsIn++;
        const message = frame.length > MOST_TEXT || !p.texts.take(now) ? Option.none() : readText(frame);
        if (Option.isNone(message)) return strike(p, now);
        const m = message.value;
        switch (m.t) {
          case "ping":
            return p.send(say({ t: "pong", c: m.c, s: now }));
          case "join":
            return enter(p, m.room, now);
          case "leave":
            return leave(p);
          case "act":
            if (!isAct(m.kind, m.arg)) {
              p.send(say({ t: "error", code: "bad_act" }));
              return strike(p, now);
            }
            if (!p.acts.take(now)) return strike(p, now);
            if (!p.room || !p.occupant) return p.send(say({ t: "error", code: "not_in_room" }));
            return p.room.act(p.occupant.member.id, m.kind, m.arg);
        }
      };

      // ---- time ----

      // Every tick: players whose grace has run out leave their room, players of whom nothing is
      // left are forgotten, and each room with any change sends it to everyone in it.
      const flush = Effect.flatMap(Clock.currentTimeMillis, (now) =>
        Effect.sync(() => {
          tick++;
          for (const [id, p] of players) {
            if (p.goneAt !== null && now - p.goneAt >= tuning.graceMs) {
              p.goneAt = null;
              leave(p);
            }
            if (p.gone(now)) players.delete(id);
          }
          for (const room of rooms.all()) room.flush(tick, now);
        }),
      );
      yield* Effect.forkScoped(Effect.repeat(flush, Schedule.fixed(Duration.millis(1000 / SERVER_HZ))));

      const census = Effect.sync(() => {
        const inRooms: Record<string, number> = {};
        for (const room of rooms.all()) inRooms[room.name] = room.size;
        let connected = 0;
        for (const p of players.values()) if (p.pipe) connected++;
        return { players: players.size, connected, rooms: inRooms };
      });

      // A line a minute while anybody is about, or anything happened.
      const report = Effect.flatMap(census, (now) => {
        const was = counts;
        counts = noCounts();
        if (now.players === 0 && was.opened === 0) return Effect.void;
        return Effect.logInfo("live").pipe(Effect.annotateLogs({ ...now, ...was }));
      });
      yield* Effect.forkScoped(Effect.repeat(report, Schedule.spaced(Duration.minutes(1))));

      // ---- connections ----

      /** Asks about the session every `recheckMs`, and ends once it says the session has ended. */
      const watch = (session: Effect.Effect<boolean>): Effect.Effect<void> =>
        Effect.sleep(Duration.millis(tuning.recheckMs)).pipe(
          Effect.andThen(session),
          Effect.flatMap((ok) => (ok ? watch(session) : Effect.void)),
        );

      /** Serves one connection of a player's: it becomes their connection, closing any other. */
      const serve = (socket: Socket.Socket, p: Player, session: Effect.Effect<boolean>) =>
        Effect.gen(function* () {
          const writer = yield* socket.writer;
          const out = yield* Queue.unbounded<Frame>();
          const pipe = new Pipe(out, writer);
          // Another tab of theirs, still open: this connection takes its place.
          p.pipe?.close(CLOSE.replaced, "replaced");
          p.pipe = pipe;
          p.goneAt = null;
          if (p.occupant) p.room?.reconnected(p.occupant.member.id);
          counts.opened++;
          // Whatever ends this connection, this decides what becomes of the player, and only while it
          // is still theirs: signed out, they leave at once; otherwise they wait out their grace.
          yield* Effect.addFinalizer(() =>
            Effect.flatMap(Clock.currentTimeMillis, (now) =>
              Effect.sync(() => {
                counts.closed++;
                if (p.pipe !== pipe) return;
                p.pipe = null;
                if (pipe.closedWith === CLOSE.signedOut) return leave(p);
                p.goneAt = now;
                if (p.occupant) p.room?.halt(p.occupant.member.id);
              }),
            ),
          );

          // Everything for this player goes out in the order it was sent, as soon as it is.
          yield* Effect.forkScoped(
            Effect.forever(
              Effect.flatMap(Queue.takeAll(out), (frames) =>
                Effect.forEach(frames, (frame) => writer.write(frame), { discard: true }),
              ),
            ),
          );

          // The connection lasts only as long as the session: once it has ended, this connection closes.
          yield* Effect.forkScoped(
            Effect.andThen(
              watch(session),
              Effect.sync(() => pipe.close(CLOSE.signedOut, "signed out")),
            ),
          );

          const { pull } = yield* socket.reader;
          yield* Effect.forever(
            Effect.flatMap(pull, (frames) =>
              Effect.flatMap(Clock.currentTimeMillis, (now) =>
                Effect.sync(() => {
                  for (const frame of frames) if (!pipe.closed) take(p, frame, now);
                }),
              ),
            ),
          );
        }).pipe(
          // The player closed it, or Leaf did.
          Effect.catchTag("SocketError", () => Effect.void),
        );

      const open = (
        identity: Identity,
        upgrade: Effect.Effect<Socket.Socket, unknown>,
        session: Effect.Effect<boolean>,
      ) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          // Looked for, counted and taken in one step, with nothing in between: no two can both
          // take the last place.
          const id = identity.playerId;
          const known = players.get(id);
          if (!known && players.size >= tuning.mostPlayers) return "full" as const;
          const p = known ?? new Player(identity, now);
          players.set(id, p);
          if (!p.opens.take(now)) return "busy" as const;
          p.identity = identity;
          // A socket that never opens leaves the player as they were; the tick forgets them once
          // nothing is left of them.
          const socket = yield* Effect.orDie(upgrade);
          yield* serve(socket, p, session);
          return "served" as const;
        });

      const farewell = Effect.suspend(() =>
        Effect.forEach([...players.values()], (p) => p.pipe?.closeNow(CLOSE.restart, "restart") ?? Effect.void, {
          discard: true,
        }),
      );

      return Live.of({ open, census, farewell });
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
