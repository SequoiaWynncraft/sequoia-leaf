import {
  CLOSE,
  decodeMove,
  type Device,
  isAct,
  LIVE_VERSION,
  type PlayerId,
  roomKind,
  SERVER_HZ,
  type ToClient,
} from "@sequoia-leaf/core";
import {
  Cause,
  Clock,
  Context,
  Deferred,
  Duration,
  Effect,
  Layer,
  Metric,
  Option,
  PubSub,
  Queue,
  Schedule,
  Schema,
  type Scope,
} from "effect";
import { Socket } from "effect/socket";

import { whoIsAbout } from "../activity/about.ts";
import { type Visitor, Visits } from "../activity/visits.ts";
import { Allowance } from "../allowance.ts";
import { type Identity, isGuest } from "../api/api.ts";
import { PLACES } from "../api/schemas.ts";
import { live as metrics, liveRefused, readOnAsk } from "../metrics.ts";
import { Tallies } from "../tally/store.ts";
import {
  graceOver,
  handedOver,
  handsOver,
  type Link,
  linked,
  NO_LINK,
  type Stop,
  stopped,
  unlinked,
} from "./lifecycle.ts";
import { type Occupant, type Room, Rooms } from "./room.ts";
import { Watchers } from "./watchers.ts";

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
  /**
   * How often the presence of everybody in a room is written again while they stay, as a game says
   * where it is every half minute: they count as here for 90 seconds after each.
   */
  readonly presenceMs: number;
}

export const LiveTuning = Context.Reference<LiveTuning>("leaf/LiveTuning", {
  defaultValue: () => ({ recheckMs: 30_000, graceMs: 10_000, mostPlayers: 1000, presenceMs: 30_000 }),
});

/** How long Live waits after a change to who is about before it tells the rooms, for the rest of a burst to come. */
const ABOUT_GATHER = Duration.millis(200);

/** Where a player's presence says they are while they are in a room of a kind, if it is one of the game's places. */
const placeOf = (kindName: string): string | null => PLACES.find((p) => p === kindName) ?? null;

/**
 * What Live has to write down about where players are, in the order it happened: players in a room
 * (come in, or still there), one gone from it, one who did something (for their time, and an act
 * for the Tally), and Leaf's farewell, when every open visit closes.
 */
type Whereabouts =
  | { readonly kind: "in"; readonly players: readonly Visitor[]; readonly place: string; readonly at: number }
  | { readonly kind: "left"; readonly playerId: PlayerId; readonly place: string; readonly at: number }
  | { readonly kind: "acted"; readonly playerId: PlayerId; readonly at: number }
  | {
      readonly kind: "act";
      readonly playerId: PlayerId;
      readonly act: string;
      readonly arg: string;
      readonly at: number;
    }
  | { readonly kind: "farewell"; readonly at: number; readonly done: Deferred.Deferred<void> };

/** A write of where players are that fails is logged, not tried again: the next one, at most `presenceMs` later, says as much. */
const quietly = (what: string, effect: Effect.Effect<void>) =>
  effect.pipe(
    Effect.catchCause((cause) => (Cause.hasInterruptsOnly(cause) ? Effect.interrupt : Effect.logWarning(what, cause))),
  );

/**
 * How long Leaf's farewell waits for the open visits to be closed before it closes the connections
 * anyway. Closing them takes a few milliseconds; a deploy waits on the whole stop, which has half a
 * second.
 */
const FAREWELL_WAIT = Duration.millis(200);

/** The longest text frame Leaf reads, in UTF-16 code units (as JavaScript counts a string's length). Every message the game sends is far shorter. */
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
/**
 * Openings that hand a player over between their own pages (`handsOver`: the town and a game open in
 * it, a reload): a few at once and one every two seconds, besides the openings proper. One past it
 * is charged as an opening proper; openings that fail, are refused or drop never hand over.
 */
const HANDOFFS = { rate: 0.5, burst: 10 } as const;
/** How soon after a page closed its connection itself an opening of the player's is taken as the next page. */
const HANDOFF_MS = 5000;
/**
 * The codes a connection closed by its page itself ends with: done with it (1000), going (1001: a
 * reload, a frame put away), or closed with no code given (1005). A drop has no closing at all (1006).
 */
const CLOSED_BY_PAGE: ReadonlySet<number> = new Set([CLOSE.done, 1001, 1005]);
const STRIKES = { rate: 1, burst: 200 } as const;

/** The most often a player's moves and acts are told to Leaf's count of their time (`Visits.acted`): it counts in half minutes. */
const ACTED_EVERY = 10_000;

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
  /** The code the page closed it with, once it did (1006 for a connection that dropped). */
  closedBy: number | null = null;
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

  /** Writes what waits, in order, as soon as it does, for as long as the connection lasts. */
  pump(): Effect.Effect<never, Socket.SocketError> {
    return Effect.forever(
      Effect.flatMap(Queue.takeAll(this.out), (frames) =>
        Effect.forEach(frames, (frame) => this.writer.write(frame), { discard: true }),
      ),
    );
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
  /** Where they are: in no room, or in one as its occupant, hearing what Leaf tells it if it is still (`Watchers`). */
  place: Place = NOWHERE;
  /** Their connection: none, open, or gone a moment ago, in their grace (`lifecycle.ts` moves it). */
  link: Link<Pipe> = NO_LINK;
  /** Connections of theirs let in and not yet open: while there are any, the record is theirs. */
  opening = 0;
  /** What their connection's page said it is on, if it did. */
  device: Device | null = null;
  /** When Leaf was last told they did something here (`Visits.acted`), at most every `ACTED_EVERY`. */
  actedTold = Number.NEGATIVE_INFINITY;
  readonly moves: Allowance;
  readonly texts: Allowance;
  readonly acts: Allowance;
  readonly opens: Allowance;
  readonly handoffs: Allowance;
  readonly strikes: Allowance;

  constructor(identity: Identity, now: number) {
    this.identity = identity;
    this.moves = new Allowance(MOVES, now);
    this.texts = new Allowance(TEXTS, now);
    this.acts = new Allowance(ACTS, now);
    this.opens = new Allowance(OPENS, now);
    this.handoffs = new Allowance(HANDOFFS, now);
    this.strikes = new Allowance(STRIKES, now);
  }

  /** Their connection, while one is open. */
  get pipe(): Pipe | null {
    return this.link.state === "open" ? this.link.pipe : null;
  }

  /** The room's outbox for this player: whichever connection they have now, or none. */
  send(frame: string | Uint8Array): void {
    this.pipe?.send(frame);
  }

  /** Whether nothing is left of them: no connection, opening, open or in its grace, no place, and nothing owed on any allowance. */
  gone(now: number): boolean {
    return (
      this.opening === 0 &&
      this.link.state === "none" &&
      this.place.at === "none" &&
      [this.moves, this.texts, this.acts, this.opens, this.handoffs, this.strikes].every((a) => a.full(now))
    );
  }
}

/** Where a player is in Live: in no room, or in one as its occupant, with what stops them hearing a still room. */
type Place =
  | { readonly at: "none" }
  | { readonly at: "room"; readonly room: Room; readonly occupant: Occupant; readonly hearing: (() => void) | null };
const NOWHERE: Place = { at: "none" };

/**
 * What Live has done in the last minute, for its log line: connections opened and closed, frames in
 * and dropped, and openings turned away before their upgrade, by the code they were refused with.
 */
interface Counts {
  opened: number;
  closed: number;
  movesIn: number;
  textsIn: number;
  dropped: number;
  refused: Record<string, number>;
}

const noCounts = (): Counts => ({ opened: 0, closed: 0, movesIn: 0, textsIn: 0, dropped: 0, refused: {} });

/** How a connection closed: by its page itself (`CLOSED_BY_PAGE`), dropped (no closing at all), or by Leaf. */
type Closed = "page" | "drop" | "leaf";

/** The census of who is here now. */
interface Census {
  readonly players: number;
  readonly connected: number;
  readonly rooms: Readonly<Record<string, number>>;
}

/** What a `live` log line says: who is here now, and what happened since the last line, with the frames Leaf told visits' rooms. */
export type LiveLine = Census & Readonly<Counts> & { readonly told: number };

/** What came of a player's asking to open a connection: served until it closed, or turned away. */
export type Opened = "served" | "full" | "busy" | "stopping";

/**
 * Live: players in the same room see each other move as it happens (the wire is in
 * `packages/core/src/live.ts`). Who is in which room is kept here and nowhere else, by player, not
 * by connection. Rooms are in memory, in this process: during a deploy every player is told Leaf is
 * restarting, and reconnects to the new container.
 *
 * A player in a room of one of the game's places (the town) is there as far as their visits know
 * (`Visits`), as if their game said so: their visit opens when they come in, is heard of every
 * `presenceMs` while they stay, and closes when they go, so that nobody's page need say where they
 * are while it is in a room; and Leaf's farewell closes every open visit before it closes any
 * connection. Whenever who is about changes, everybody in every room of the game's places is told
 * who is about now (`{ t: "about", who }`, the presence routes' answer), once for a burst of
 * changes within `ABOUT_GATHER`.
 *
 * A player in a visit's room (`visitRoom`: somebody's yard, from Top yards) hears what Leaf does to
 * the state they visit while they are in it, as the play service tells it (`Watchers`). A visit's
 * room is no place, so nobody's presence there is written.
 */
export class Live extends Context.Service<
  Live,
  {
    /**
     * Lets a player open a connection into a room of a kind, unless Live is full (`full`) or they
     * open them too fast (`busy`). Their place among the players is taken, and held, before
     * `upgrade` opens the socket, so that nobody can slip in between. Once it is open it is theirs,
     * and they are in the room, greeted, in one step. Then it is served until it closes, Leaf stops,
     * or `session` (asked every `recheckMs`) says the player's session has ended. `device` is what
     * the page said it is on, if it did, for the player's visits.
     */
    readonly open: (
      identity: Identity,
      kindName: string,
      upgrade: Effect.Effect<Socket.Socket, unknown>,
      session: Effect.Effect<boolean>,
      device?: Device | null,
    ) => Effect.Effect<Opened, never, Scope.Scope>;
    /** How many players there are, how many connected, and who is in which room (for tests and the log). */
    readonly census: Effect.Effect<Census>;
    /** Counts an opening turned away before its upgrade, by the code it was refused with, for the log line. */
    readonly refused: (code: string) => Effect.Effect<void>;
    /** What the next `live` log line would say, so far. */
    readonly line: Effect.Effect<LiveLine>;
    /**
     * Closes every open visit, then tells every player Leaf is restarting and closes their
     * connections, so that they come back to the next one.
     */
    readonly farewell: Effect.Effect<void>;
  }
>()("leaf/Live") {
  static readonly layer = Layer.effect(
    Live,
    Effect.gen(function* () {
      const tuning = yield* LiveTuning;
      const visits = yield* Visits;
      const watchers = yield* Watchers;
      const tallies = yield* Tallies;
      const rooms = new Rooms();
      const players = new Map<string, Player>();
      let counts = noCounts();
      // The same as the minute's counts, since Leaf started, for the metrics.
      const totals = {
        opened: 0,
        closed: { page: 0, drop: 0, leaf: 0 } satisfies Record<Closed, number>,
        dropped: 0,
        handoffs: 0,
      };
      let tick = 0;
      /** Leaf's stop: while it is not running, no connection is let in, and one still opening is told to come back. */
      let stop: Stop = "running";

      // ---- where players are, as their visits have it ----

      // Said here as it happens, without waiting, and written by one fiber in the same order.
      const whereabouts = yield* Queue.unbounded<Whereabouts>();
      const inRoom = (p: Player): Visitor => ({
        playerId: p.identity.playerId,
        username: p.identity.username,
        guest: isGuest(p.identity),
        device: p.device,
      });
      /**
       * Once every open visit was closed for Leaf's farewell, nothing more of visits is written: a
       * player who left as the connections closed may be back in the next Leaf already, in a visit
       * of its own.
       */
      const ofVisits = (effect: Effect.Effect<void>) =>
        Effect.suspend(() => (stop === "visits closed" ? Effect.void : quietly("live visits", effect)));
      const write = (w: Whereabouts): Effect.Effect<void> => {
        switch (w.kind) {
          case "in":
            return ofVisits(visits.inRoom(w.players, w.place, w.at));
          case "left":
            return ofVisits(visits.leftRoom(w.playerId, w.place, w.at));
          case "acted":
            return ofVisits(visits.acted(w.playerId, w.at));
          case "act":
            return quietly("live tallies", tallies.acted(w.playerId, w.act, w.arg, w.at));
          case "farewell":
            return ofVisits(visits.closeAll(w.at)).pipe(
              Effect.andThen(
                Effect.sync(() => {
                  stop = stopped(stop, "visits closed");
                }),
              ),
              Effect.ensuring(Deferred.succeed(w.done, undefined)),
            );
        }
      };
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.flatMap(Queue.takeAll(whereabouts), (all) => Effect.forEach(all, write, { discard: true })),
        ),
      );

      // Every change to who is about, once it is written (here, or by a page saying where it is), is
      // told to everybody in every room of the game's places: who is about now, read once for a
      // burst of changes. A visit's room is no place, and its pages show nobody about.
      const changed = yield* visits.changes;
      const tellAbout = Effect.gen(function* () {
        yield* PubSub.take(changed);
        yield* Effect.sleep(ABOUT_GATHER);
        const about = say({ t: "about", who: yield* whoIsAbout(yield* Clock.currentTimeMillis) });
        for (const room of rooms.all())
          if (placeOf(room.kindName)) for (const o of room.occupants.values()) o.outbox.send(about);
      });
      yield* Effect.forkScoped(Effect.forever(quietly("live about", Effect.provideService(tellAbout, Visits, visits))));

      // ---- who is in which room: these three alone change it ----

      const leave = (p: Player, now: number): void => {
        const was = p.place;
        p.place = NOWHERE;
        if (was.at !== "room") return;
        const { room, occupant } = was;
        was.hearing?.();
        room.leave(occupant.member.id);
        rooms.tidy(room);
        const place = placeOf(room.kindName);
        if (place) Queue.offerUnsafe(whereabouts, { kind: "left", playerId: p.identity.playerId, place, at: now });
      };

      /**
       * Puts a player in a room of a kind. One already in one, shown as they are now, is greeted there
       * again, keeping their place; shown otherwise (their rank or name changed), they leave and come
       * back, so that everybody sees them as they are.
       */
      const enter = (p: Player, kindName: string, now: number): void => {
        if (roomKind(kindName) === undefined) return p.send(say({ t: "error", code: "unknown_room" }));
        const { identity } = p;
        const who = {
          player: identity.playerId,
          name: identity.username,
          rank: identity.guildRank,
          guest: isGuest(identity),
        };
        const was = p.place;
        const shown = was.at === "room" ? was.occupant.member : undefined;
        const same = shown?.name === who.name && shown.rank === who.rank && shown.guest === who.guest;
        if (was.at === "room" && was.room.kindName === kindName && same) {
          return was.room.greet(was.occupant, now, SERVER_HZ, LIVE_VERSION);
        }
        leave(p, now);
        const room = rooms.place(kindName);
        if (!room) return;
        const occupant = room.join(who, p, now, SERVER_HZ, LIVE_VERSION);
        // In a visit's room they hear what Leaf does to the state visited.
        const hearing = room.kind.still === true ? watchers.hear(room.kindName, p) : null;
        p.place = { at: "room", room, occupant, hearing };
        const place = placeOf(kindName);
        if (place) Queue.offerUnsafe(whereabouts, { kind: "in", players: [inRoom(p)], place, at: now });
      };

      // ---- what a player sends ----

      /** The player did something in their room: Leaf's count of their time is told, now and then. */
      const acted = (p: Player, now: number): void => {
        if (now - p.actedTold < ACTED_EVERY) return;
        p.actedTold = now;
        Queue.offerUnsafe(whereabouts, { kind: "acted", playerId: p.identity.playerId, at: now });
      };

      const strike = (p: Player, now: number): void => {
        counts.dropped++;
        totals.dropped++;
        if (!p.strikes.take(now)) p.pipe?.close(CLOSE.policy, "too much that could not be taken");
      };

      const take = (p: Player, frame: string | Uint8Array, now: number): void => {
        if (typeof frame !== "string") {
          counts.movesIn++;
          const move = decodeMove(frame);
          if (!move || !p.moves.take(now)) return strike(p, now);
          const { place } = p;
          if (place.at === "room" && place.room.move(place.occupant.member.id, move.seq, move.motion, now))
            acted(p, now);
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
            return leave(p, now);
          case "act":
            if (!isAct(m.kind, m.arg)) {
              p.send(say({ t: "error", code: "bad_act" }));
              return strike(p, now);
            }
            if (!p.acts.take(now)) return strike(p, now);
            if (p.place.at !== "room") return p.send(say({ t: "error", code: "not_in_room" }));
            acted(p, now);
            Queue.offerUnsafe(whereabouts, {
              kind: "act",
              playerId: p.identity.playerId,
              act: m.kind,
              arg: m.arg,
              at: now,
            });
            return p.place.room.act(p.place.occupant.member.id, m.kind, m.arg);
        }
      };

      // ---- time ----

      // Every tick: players whose grace has run out leave their room, players of whom nothing is
      // left are forgotten, anybody shown walking whose game has gone quiet stops, and each room
      // with any change sends it to everyone in it.
      const flush = Effect.flatMap(Clock.currentTimeMillis, (now) =>
        Effect.sync(() => {
          tick++;
          for (const [id, p] of players) {
            if (graceOver(p.link, now, tuning.graceMs)) {
              p.link = NO_LINK;
              leave(p, now);
            }
            if (p.gone(now)) players.delete(id);
          }
          for (const room of rooms.all()) {
            room.quiet(now);
            room.flush(tick, now);
          }
        }),
      );
      yield* Effect.forkScoped(Effect.repeat(flush, Schedule.fixed(Duration.millis(1000 / SERVER_HZ))));

      // Everybody in a room of one of the game's places is there still, as their game would say.
      const stillHere = Effect.flatMap(Clock.currentTimeMillis, (now) =>
        Effect.sync(() => {
          const byPlace = new Map<string, Visitor[]>();
          for (const p of players.values()) {
            const place = p.place.at === "room" ? placeOf(p.place.room.kindName) : null;
            if (!place) continue;
            const those = byPlace.get(place) ?? [];
            those.push(inRoom(p));
            byPlace.set(place, those);
          }
          for (const [place, those] of byPlace)
            Queue.offerUnsafe(whereabouts, { kind: "in", players: those, place, at: now });
        }),
      );
      yield* Effect.forkScoped(Effect.repeat(stillHere, Schedule.spaced(Duration.millis(tuning.presenceMs))));

      const census = Effect.sync(() => {
        const inRooms: Record<string, number> = {};
        for (const room of rooms.all()) inRooms[room.name] = room.size;
        let connected = 0;
        for (const p of players.values()) if (p.link.state === "open") connected++;
        return { players: players.size, connected, rooms: inRooms };
      });

      const refused = (code: string) =>
        Effect.andThen(
          Effect.sync(() => {
            counts.refused[code] = (counts.refused[code] ?? 0) + 1;
          }),
          Metric.update(liveRefused({ reason: code }), 1),
        );
      // Who is here and what Live has done, read when the metrics are asked for.
      yield* readOnAsk(
        [
          [metrics.players, () => players.size],
          [metrics.connections, () => [...players.values()].filter((p) => p.link.state === "open").length],
          [metrics.rooms, () => [...rooms.all()].length],
        ],
        [
          [metrics.opened, () => totals.opened],
          ...(["page", "drop", "leaf"] as const).map(
            (how) => [metrics.closed({ how }), () => totals.closed[how]] as const,
          ),
          [metrics.framesDropped, () => totals.dropped],
          [metrics.handoffs, () => totals.handoffs],
        ],
      );
      /** How many frames Leaf had told visits' rooms when the last line was written. */
      let toldBefore = watchers.told();
      const line = Effect.map(census, (now): LiveLine => ({
        ...now,
        ...counts,
        refused: { ...counts.refused },
        told: watchers.told() - toldBefore,
      }));

      // A line a minute while anybody is about, or anything happened, refusals included.
      const report = Effect.flatMap(line, (said) => {
        counts = noCounts();
        toldBefore += said.told;
        if (said.players === 0 && said.opened === 0 && Object.keys(said.refused).length === 0) return Effect.void;
        return Effect.logInfo("live").pipe(Effect.annotateLogs({ ...said }));
      });
      yield* Effect.forkScoped(Effect.repeat(report, Schedule.spaced(Duration.minutes(1))));

      // ---- connections ----

      /** Asks about the session every `recheckMs`, and ends once it says the session has ended. */
      const watch = (session: Effect.Effect<boolean>): Effect.Effect<void> =>
        Effect.sleep(Duration.millis(tuning.recheckMs)).pipe(
          Effect.andThen(session),
          Effect.flatMap((ok) => (ok ? watch(session) : Effect.void)),
        );

      /**
       * Opens a player's connection and makes it theirs, in one step once the socket is open: it
       * takes over from any other of theirs, carries who they are now, and puts them in the room,
       * greeted, so that the welcome is the first thing it sends.
       */
      const attach = (
        p: Player,
        identity: Identity,
        kindName: string,
        upgrade: Effect.Effect<Socket.Socket, unknown>,
        device: Device | null,
      ) =>
        Effect.gen(function* () {
          const socket = yield* Effect.orDie(upgrade);
          const pipe = new Pipe(yield* Queue.unbounded<Frame>(), yield* socket.writer);
          // Whatever ends this connection, this decides what becomes of the player, and only while it
          // is still theirs: signed out, they leave at once; otherwise they wait out their grace.
          yield* Effect.addFinalizer(() =>
            Effect.flatMap(Clock.currentTimeMillis, (now) =>
              Effect.sync(() => {
                counts.closed++;
                // Closed by the page itself, done with it or going: what opens next may be its next page.
                const clean = pipe.closedWith === null && pipe.closedBy !== null && CLOSED_BY_PAGE.has(pipe.closedBy);
                totals.closed[pipe.closedWith !== null ? "leaf" : clean ? "page" : "drop"]++;
                const after = unlinked(p.link, pipe, pipe.closedWith === CLOSE.signedOut, now, clean);
                if (after === null) return;
                p.link = after.link;
                if (after.leaves) return leave(p, now);
                if (p.place.at === "room") p.place.room.halt(p.place.occupant.member.id);
              }),
            ),
          );
          const now = yield* Clock.currentTimeMillis;
          // From here to the end, nothing waits: whether Leaf is stopping is asked in the same step
          // as the connection is made the player's. Opened after the farewell, it is told to come
          // back, and is never anybody's.
          if (stop !== "running") {
            yield* pipe.closeNow(CLOSE.restart, "restart");
            return null;
          }
          const { link, replaced } = linked(p.link, pipe);
          replaced?.close(CLOSE.replaced, "replaced");
          p.link = link;
          p.identity = identity;
          p.device = device;
          if (p.place.at === "room") p.place.room.reconnected(p.place.occupant.member.id);
          enter(p, kindName, now);
          counts.opened++;
          totals.opened++;
          return { socket, pipe };
        });

      /** Serves an open connection: what goes out, the session's watch, and what comes in. */
      const serve = (socket: Socket.Socket, pipe: Pipe, p: Player, session: Effect.Effect<boolean>) =>
        Effect.gen(function* () {
          yield* Effect.forkScoped(pipe.pump());
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
          // The player closed it, or Leaf did, or it dropped: how the page closed it, if it did, is kept.
          Effect.catchTag("SocketError", (e) =>
            Effect.sync(() => {
              if (e.reason instanceof Socket.SocketCloseError) pipe.closedBy = e.reason.code;
            }),
          ),
        );

      const open = (
        identity: Identity,
        kindName: string,
        upgrade: Effect.Effect<Socket.Socket, unknown>,
        session: Effect.Effect<boolean>,
        device: Device | null = null,
      ) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          if (stop !== "running") return "stopping" as const;
          // Looked for, counted and taken in one step, with nothing in between: no two can both
          // take the last place.
          const id = identity.playerId;
          const known = players.get(id);
          if (!known && players.size >= tuning.mostPlayers) return "full" as const;
          const p = known ?? new Player(identity, now);
          players.set(id, p);
          // The player going from one of their pages to another is charged as that, not as an opening.
          if (handsOver(p.link, now, HANDOFF_MS) && p.handoffs.take(now)) {
            p.link = handedOver(p.link);
            totals.handoffs++;
          } else if (!p.opens.take(now)) return "busy" as const;
          // Held while the socket opens, however long it takes, and let go once it is theirs or never
          // opened: taking it and promising to let it go are one step that nothing can come between.
          const attached = yield* Effect.acquireUseRelease(
            Effect.sync(() => {
              p.opening++;
            }),
            () => attach(p, identity, kindName, upgrade, device),
            () =>
              Effect.sync(() => {
                p.opening--;
              }),
          );
          if (attached) yield* serve(attached.socket, attached.pipe, p, session);
          return "served" as const;
        });

      // Every open visit is closed first, after everything said before it, so that none a player
      // opens in the next Leaf, once their connection here has closed, is closed with them.
      const farewell = Effect.gen(function* () {
        const first = stop === "running";
        stop = stopped(stop, "farewell");
        if (first) {
          const done = yield* Deferred.make<void>();
          Queue.offerUnsafe(whereabouts, { kind: "farewell", at: yield* Clock.currentTimeMillis, done });
          yield* Deferred.await(done).pipe(Effect.timeout(FAREWELL_WAIT), Effect.ignore);
        }
        yield* Effect.forEach([...players.values()], (p) => p.pipe?.closeNow(CLOSE.restart, "restart") ?? Effect.void, {
          discard: true,
        });
      });

      return Live.of({ open, census, refused, line, farewell });
    }),
  );
}
