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
import { type Identity, isGuest } from "../api/api.ts";
import { PLACES } from "../api/schemas.ts";
import { AppConfig, LIVE_MOST_PLAYERS } from "../config.ts";
import { Tallies } from "../tally/store.ts";
import { AboutTold, CHANGES_FROM } from "./about.ts";
import { type Census, LiveCounts, type LiveLine, reportLive } from "./counts.ts";
import { graceOver, handedOver, handsOver, linked, NO_LINK, type Stop, stopped, unlinked } from "./lifecycle.ts";
import { Pipe } from "./pipe.ts";
import { NOWHERE, Player } from "./player.ts";
import { type Room, Rooms } from "./room.ts";
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
  defaultValue: () => ({ recheckMs: 30_000, graceMs: 10_000, mostPlayers: LIVE_MOST_PLAYERS, presenceMs: 30_000 }),
});

/** Live's tuning as Leaf runs it: the defaults, but for how many players it holds, which is a setting (`LIVE_MOST_PLAYERS`). */
export const LiveTuned = Layer.effect(
  LiveTuning,
  AppConfig.useSync((settings) => ({ ...LiveTuning.defaultValue(), mostPlayers: settings.liveMostPlayers })),
);

/** How often Live forgets the players of whom nothing is left (`Player.gone`). */
const FORGET_EVERY = Duration.seconds(1);

/** How long Live waits after a change to who is about before it tells the rooms, for the rest of a burst to come. */
const ABOUT_GATHER = Duration.millis(200);

/**
 * How long a tick is: `SERVER_HZ` a second, to the whole millisecond. A fixed schedule measures its
 * window by a clock in whole milliseconds, so with a fraction in the window its wait comes out under
 * a millisecond again and again at the window's end, which a test clock never moves past.
 */
export const TICK = Duration.millis(Math.floor(1000 / SERVER_HZ));

/** Where a player's presence says they are while they are in a room of a kind, if it is one of the game's places. */
const placeOf = (kindName: string): string | null => PLACES.find((p) => p === kindName) ?? null;

/** Whether a player is in a room of one of the game's places. */
const inPlace = (p: Player): boolean => p.place.at === "room" && placeOf(p.place.room.kindName) !== null;

/** A player in a room of one of the game's places, as their visits write them. */
const inRoom = (p: Player): Visitor => ({
  playerId: p.identity.playerId,
  username: p.identity.username,
  guest: isGuest(p.identity),
  device: p.device,
});

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

/** How soon after a page closed its connection itself an opening of the player's is taken as the next page. */
const HANDOFF_MS = 5000;
/**
 * The codes a connection closed by its page itself ends with: done with it (1000), going (1001: a
 * reload, a frame put away), or closed with no code given (1005). A drop has no closing at all (1006).
 */
const CLOSED_BY_PAGE: ReadonlySet<number> = new Set([CLOSE.done, 1001, 1005]);

/** The most often a player's moves and acts are told to Leaf's count of their time (`Visits.acted`): it counts in half minutes. */
const ACTED_EVERY = 10_000;

/** What the game may send as text. Anything else is not read. */
const ToServerJson = Schema.fromJsonString(
  Schema.Union([
    Schema.Struct({ t: Schema.Literal("join"), room: Schema.String }),
    Schema.Struct({ t: Schema.Literal("leave") }),
    Schema.Struct({ t: Schema.Literal("act"), kind: Schema.String, arg: Schema.String }),
    Schema.Struct({ t: Schema.Literal("ping"), c: Schema.Finite }),
    Schema.Struct({ t: Schema.Literal("about") }),
  ]),
);
const readText = Schema.decodeUnknownOption(ToServerJson);

const say = (m: ToClient): string => JSON.stringify(m);

export type { LiveLine } from "./counts.ts";

/** What came of a player's asking to open a connection: served until it closed, or turned away. */
export type Opened = "served" | "full" | "busy" | "stopping";

/** What a page opening a connection says of itself: what it is on, and the version of the wire it speaks. */
export interface Page {
  readonly device?: Device | null;
  readonly speaks?: number;
}

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
 * connection. Whenever who is about changes, everybody in every room of the game's places is told,
 * once for a burst of changes within `ABOUT_GATHER` (`AboutTold`): a page of version 3 what changed
 * (`aboutChanged`), having been given all of it as it came in; a page of version 2 all of who is
 * about now (`about`, the presence routes' answer).
 *
 * Everybody in a room hears what Leaf does there while they are in it, as the play service tells it
 * (`Watchers`): in a visit's room (`visitRoom`: somebody's yard, from Top yards), each batch done to
 * the state visited; in a camp's (`campRoom`), each that changed what a visitor sees of it. Neither
 * is a place, so nobody's presence there is written: a page in a camp says where it is itself.
 */
export class Live extends Context.Service<
  Live,
  {
    /**
     * Lets a player open a connection into a room of a kind, unless Live is full (`full`) or they
     * open them too fast (`busy`). Their place among the players is taken, and held, before
     * `upgrade` opens the socket, so that nobody can slip in between. Once it is open it is theirs,
     * and they are in the room, greeted, in one step. Then it is served until it closes, Leaf stops,
     * or `session` (asked every `recheckMs`) says the player's session has ended. Of the page, what
     * it said it is on (`device`), if it did, for the player's visits; and the version of the wire it
     * speaks (`speaks`, the newest by default).
     */
    readonly open: (
      identity: Identity,
      kindName: string,
      upgrade: Effect.Effect<Socket.Socket, unknown>,
      session: Effect.Effect<boolean>,
      page?: Page,
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
      /** Live's own scope: what it runs beyond any one connection (a player's grace) lasts as long as it does. */
      const lives = yield* Effect.scope;
      const visits = yield* Visits;
      const watchers = yield* Watchers;
      const tallies = yield* Tallies;
      const rooms = new Rooms();
      const players = new Map<string, Player>();
      const counts = new LiveCounts();
      let tick = 0;
      /** Leaf's stop: while it is not running, no connection is let in, and one still opening is told to come back. */
      let stop: Stop = "running";

      // ---- where players are, as their visits have it ----

      // Said here as it happens, without waiting, and written by one fiber in the same order.
      const whereabouts = yield* Queue.unbounded<Whereabouts>();
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
      // burst of changes, and told in one step, so that each page has every change in order, or
      // came in after it and was given all of it. A visit's room is no place, and its pages show
      // nobody about.
      const about = new AboutTold();
      const changed = yield* visits.changes;
      const tellAbout = Effect.gen(function* () {
        yield* PubSub.takeAll(changed);
        yield* Effect.sleep(ABOUT_GATHER);
        // The rest of the burst, heard meanwhile, is in what is read now: told once, not once a change.
        yield* PubSub.takeUpTo(changed, Number.POSITIVE_INFINITY);
        const frames = about.next(yield* whoIsAbout(yield* Clock.currentTimeMillis));
        for (const p of players.values()) {
          if (!inPlace(p)) continue;
          const frame = p.speaks >= CHANGES_FROM ? frames.changed : frames.whole;
          p.send(frame);
          counts.sent("about", frame.length);
        }
      });
      yield* Effect.forkScoped(Effect.forever(quietly("live about", Effect.provideService(tellAbout, Visits, visits))));

      // ---- who is in which room: these three alone change it ----

      const leave = (p: Player, now: number): void => {
        const was = p.place;
        p.place = NOWHERE;
        if (was.at !== "room") return;
        const { room, occupant } = was;
        was.hearing();
        room.leave(occupant.member.id);
        rooms.tidy(room);
        const place = placeOf(room.kindName);
        if (place) Queue.offerUnsafe(whereabouts, { kind: "left", playerId: p.identity.playerId, place, at: now });
      };

      /** All of who is about, as last told, to a player in a room of the game's places whose page is told what changes. */
      const tellAllAbout = (p: Player): void => {
        const whole = about.whole();
        if (whole === null || !inPlace(p) || p.speaks < CHANGES_FROM) return;
        p.send(whole);
        counts.sent("about", whole.length);
      };

      /**
       * Puts a player in a room of a kind. One already in one, shown as they are now, is greeted there
       * again, keeping their place; shown otherwise (their rank or name changed), they leave and come
       * back, so that everybody sees them as they are. Either way, in a room of the game's places a
       * page told what changes in who is about is given all of it after its welcome.
       */
      const enter = (p: Player, kindName: string, now: number): void => {
        if (welcome(p, kindName, now)) tellAllAbout(p);
      };
      /** Puts a player in a room of a kind and greets them there (`enter`); says whether it did. */
      const welcome = (p: Player, kindName: string, now: number): boolean => {
        if (roomKind(kindName) === undefined) {
          p.send(say({ t: "error", code: "unknown_room" }));
          return false;
        }
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
          was.room.greet(was.occupant, now, SERVER_HZ, p.speaks);
          return true;
        }
        leave(p, now);
        const room = rooms.place(kindName);
        if (!room) return false;
        const occupant = room.join(who, p, now, SERVER_HZ, p.speaks);
        p.place = { at: "room", room, occupant, hearing: watchers.hear(room.kindName, p) };
        const place = placeOf(kindName);
        if (place) Queue.offerUnsafe(whereabouts, { kind: "in", players: [inRoom(p)], place, at: now });
        return true;
      };

      // ---- what a player sends ----

      /** The player did something in their room: Leaf's count of their time is told, now and then. */
      const acted = (p: Player, now: number): void => {
        if (now - p.actedTold < ACTED_EVERY) return;
        p.actedTold = now;
        Queue.offerUnsafe(whereabouts, { kind: "acted", playerId: p.identity.playerId, at: now });
      };

      const strike = (p: Player, now: number): void => {
        counts.dropped();
        if (!p.strikes.take(now)) p.pipe?.close(CLOSE.policy, "too much that could not be taken");
      };

      const take = (p: Player, frame: string | Uint8Array, now: number): void => {
        if (typeof frame !== "string") {
          counts.minute.movesIn++;
          const move = decodeMove(frame);
          if (!move || !p.moves.take(now)) return strike(p, now);
          const { place } = p;
          if (place.at === "room" && place.room.move(place.occupant.member.id, move.seq, move.motion, now))
            acted(p, now);
          return;
        }
        counts.minute.textsIn++;
        const message = frame.length > MOST_TEXT || !p.texts.take(now) ? Option.none() : readText(frame);
        if (Option.isNone(message)) return strike(p, now);
        const m = message.value;
        switch (m.t) {
          case "ping":
            return p.send(say({ t: "pong", c: m.c, s: now }));
          case "about":
            return tellAllAbout(p);
          case "join":
            return enter(p, m.room, now);
          case "leave":
            return leave(p, now);
          case "act":
            return act(p, m.kind, m.arg, now);
        }
      };

      /** Something the player did that others in the room see once (core's `ACTS`), for them and for the Tally. */
      const act = (p: Player, kind: string, arg: string, now: number): void => {
        if (!isAct(kind, arg)) {
          p.send(say({ t: "error", code: "bad_act" }));
          return strike(p, now);
        }
        if (!p.acts.take(now)) return strike(p, now);
        if (p.place.at !== "room") return p.send(say({ t: "error", code: "not_in_room" }));
        acted(p, now);
        Queue.offerUnsafe(whereabouts, { kind: "act", playerId: p.identity.playerId, act: kind, arg, at: now });
        p.place.room.act(p.place.occupant.member.id, kind, arg);
      };

      // ---- time ----

      /**
       * A room's snapshot written to everybody in it, from the fiber this runs in. Whoever has left
       * the room by the time their turn comes is passed over: the fiber may let others run between
       * one write and the next, and a page in another room by then must never hear this one's.
       */
      const tellRoom = (room: Room, frame: Uint8Array) =>
        Effect.forEach(
          [...room.occupants.values()],
          (o) =>
            Effect.suspend(() => {
              if (!room.has(o)) return Effect.void;
              counts.sent("motion", frame.byteLength);
              return o.outbox.write(frame);
            }),
          { discard: true },
        );

      // Every tick, each room with work (`Room`): anybody shown walking whose game has gone quiet
      // stops, and what changed goes to everyone in it.
      const flush = Effect.flatMap(Clock.currentTimeMillis, (now) =>
        Effect.suspend(() => {
          tick++;
          const told: [Room, Uint8Array][] = [];
          for (const room of rooms.busy()) {
            const frame = room.flush(tick, now);
            if (frame) told.push([room, frame]);
          }
          counts.ticked(told.length);
          return Effect.forEach(told, ([room, frame]) => tellRoom(room, frame), { discard: true });
        }),
      );
      yield* Effect.forkScoped(Effect.repeat(flush, Schedule.fixed(TICK)));

      /**
       * A player's grace, begun as their connection went: once it is over, if they are in it still
       * (no connection of theirs has come back, nor dropped and begun a grace of its own), they
       * leave their room, and have no connection.
       */
      const graceEnds = (p: Player) =>
        Effect.sleep(Duration.millis(tuning.graceMs)).pipe(
          Effect.andThen(Clock.currentTimeMillis),
          Effect.map((now) => {
            if (!graceOver(p.link, now, tuning.graceMs)) return;
            p.link = NO_LINK;
            leave(p, now);
          }),
        );

      // Players of whom nothing is left are forgotten, once a second: one held a second longer only
      // keeps their place among `mostPlayers` that long.
      const forget = Effect.flatMap(Clock.currentTimeMillis, (now) =>
        Effect.sync(() => {
          for (const [id, p] of players) if (p.gone(now)) players.delete(id);
        }),
      );
      yield* Effect.forkScoped(Effect.repeat(forget, Schedule.spaced(FORGET_EVERY)));

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

      const censusNow = (): Census => {
        const inRooms: Record<string, number> = {};
        for (const room of rooms.all()) inRooms[room.name] = room.size;
        let connected = 0;
        for (const p of players.values()) if (p.link.state === "open") connected++;
        return { players: players.size, connected, rooms: inRooms };
      };
      const line = yield* reportLive(counts, censusNow, watchers.told);

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
        speaks: number,
      ) =>
        Effect.gen(function* () {
          const socket = yield* Effect.orDie(upgrade);
          const pipe = yield* Pipe.make(yield* socket.writer, speaks);
          // Whatever ends this connection, this decides what becomes of the player, and only while it
          // is still theirs: signed out, they leave at once; otherwise they wait out their grace.
          yield* Effect.addFinalizer(() =>
            Effect.flatMap(Clock.currentTimeMillis, (now) =>
              Effect.suspend(() => {
                // Closed by the page itself, done with it or going: what opens next may be its next page.
                const clean = pipe.closedWith === null && pipe.closedBy !== null && CLOSED_BY_PAGE.has(pipe.closedBy);
                counts.closed(pipe.closedWith !== null ? "leaf" : clean ? "page" : "drop");
                const after = unlinked(p.link, pipe, pipe.closedWith === CLOSE.signedOut, now, clean);
                if (after === null) return Effect.void;
                p.link = after.link;
                if (after.leaves) return Effect.sync(() => leave(p, now));
                if (p.place.at === "room") p.place.room.halt(p.place.occupant.member.id);
                return Effect.asVoid(Effect.forkIn(graceEnds(p), lives));
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
          counts.opened();
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
          // Read once for the connection: every frame that comes in is timed by it.
          const clock = yield* Clock.Clock;
          yield* Effect.forever(
            Effect.flatMap(pull, (frames) =>
              Effect.sync(() => {
                const now = clock.currentTimeMillisUnsafe();
                for (const frame of frames) if (!pipe.closed) take(p, frame, now);
              }),
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
        page: Page = {},
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
            counts.handedOver();
          } else if (!p.opens.take(now)) return "busy" as const;
          // Held while the socket opens, however long it takes, and let go once it is theirs or never
          // opened: taking it and promising to let it go are one step that nothing can come between.
          const attached = yield* Effect.acquireUseRelease(
            Effect.sync(() => {
              p.opening++;
            }),
            () => attach(p, identity, kindName, upgrade, page.device ?? null, page.speaks ?? LIVE_VERSION),
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

      return Live.of({
        open,
        census: Effect.sync(censusNow),
        refused: (code) => counts.refused(code),
        line,
        farewell,
      });
    }),
  );
}
