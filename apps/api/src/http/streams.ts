import type { PlayerId } from "@sequoia-leaf/core";
import {
  Context,
  Deferred,
  Duration,
  Effect,
  Layer,
  Option,
  PubSub,
  RcMap,
  RcRef,
  Ref,
  Schedule,
  type Scope,
  Stream,
} from "effect";

import { eventJsonText, Events, type StoredEvent } from "../events/store.ts";
import { GUILD_EVENT_TYPES, type GuildEvent, guildEvents } from "../game/guild.ts";
import { PlayerNames } from "../game/names.ts";
import { EVENT_PAGE } from "./routes/shared.ts";

// The server-sent event streams: a member's own events and the guild's.

/** How the event streams pace themselves. Tests shorten these. */
export interface StreamTuning {
  /** How often the database is looked at for new events. */
  readonly pollMs: number;
  /** A stream writes a comment this often, so proxies keep a quiet connection open. */
  readonly heartbeatMs: number;
  /** A stream is closed after this long. The client reconnects, which checks its session again. */
  readonly maxMs: number;
}

export const StreamTuning = Context.Reference<StreamTuning>("leaf/StreamTuning", {
  defaultValue: () => ({ pollMs: 2_000, heartbeatMs: 20_000, maxMs: 15 * 60_000 }),
});

/**
 * The most streams one member may have open at once, their own and the guild's together. The town
 * opens two, so this is three tabs of it.
 */
export const STREAMS_PER_MEMBER = 6;

/** The most guild events one answer or one look returns. */
export const GUILD_EVENT_PAGE = 200;

export function sseFrame(id: number, type: string, json: string): string {
  return `event: ${type}\ndata: ${json}\nid: ${id}\n\n`;
}

/**
 * The event streams members have open. A member may have six open, their
 * own and the guild's together; opening a seventh closes their oldest, whose
 * client may reconnect, which closes the next oldest. Kept in memory: during a
 * deploy, Leaf's farewell ends every stream on the old container, and their
 * clients reconnect, to the new one.
 */
export class OpenStreams extends Context.Service<
  OpenStreams,
  {
    /**
     * A member's stream of `frames` as server-sent events from position `from`:
     * first a frame with only that id, so a client whose stream ends before any
     * event still knows where to resume, then the frames with a comment between
     * them now and then. It closes after `maxMs`, when the member opens too
     * many others, or when Leaf stops (`end`).
     */
    readonly open: <E, R>(
      playerId: PlayerId,
      from: number,
      frames: Stream.Stream<string, E, R>,
    ) => Stream.Stream<Uint8Array, E, R>;
    /**
     * Ends every open stream, and any opened after it as soon as it opens: Leaf
     * is stopping. A stream never ends by itself before `maxMs`, so the server
     * would otherwise wait for it.
     */
    readonly end: Effect.Effect<void>;
  }
>()("leaf/OpenStreams") {
  static readonly layer = Layer.effect(
    OpenStreams,
    Effect.gen(function* () {
      const tuning = yield* StreamTuning;
      /** Each member's open streams, oldest first, as what closes each one. */
      const open = new Map<PlayerId, Deferred.Deferred<void>[]>();
      /** Done once Leaf is stopping, which ends every stream. */
      const stopping = yield* Deferred.make<void>();

      /** Counts a new stream of the member's, closing their oldest past the limit. It is uncounted when it ends. */
      const counted = (playerId: PlayerId) =>
        Effect.acquireRelease(
          Effect.gen(function* () {
            const closed = yield* Deferred.make<void>();
            const theirs = [...(open.get(playerId) ?? []), closed];
            open.set(playerId, theirs.slice(-STREAMS_PER_MEMBER));
            yield* Effect.forEach(theirs.slice(0, -STREAMS_PER_MEMBER), (oldest) =>
              Deferred.succeed(oldest, undefined),
            );
            return closed;
          }),
          (closed) =>
            Effect.sync(() => {
              const left = (open.get(playerId) ?? []).filter((each) => each !== closed);
              if (left.length === 0) {
                open.delete(playerId);
              } else {
                open.set(playerId, left);
              }
            }),
        );

      // Clients ignore comments; proxies see traffic and keep a quiet connection open.
      const keepAlive = Stream.tick(Duration.millis(tuning.heartbeatMs)).pipe(
        Stream.drop(1),
        Stream.as(": keep-alive\n\n"),
      );

      return OpenStreams.of({
        open: (playerId, from, frames) =>
          Stream.unwrap(
            Effect.map(counted(playerId), (closed) =>
              Stream.make(`id: ${from}\nretry: 3000\n\n`).pipe(
                Stream.concat(Stream.merge(frames, keepAlive)),
                Stream.interruptWhen(Effect.sleep(Duration.millis(tuning.maxMs))),
                Stream.interruptWhen(Deferred.await(closed)),
                Stream.interruptWhen(Deferred.await(stopping)),
                Stream.encodeText,
              ),
            ),
          ),
        end: Effect.asVoid(Deferred.succeed(stopping, undefined)),
      });
    }),
  );
}

/** What a look at the events table found for one stream: each event's id and frame, oldest first, and how far it read. */
export interface Framed {
  readonly frames: readonly { readonly id: number; readonly frame: string }[];
  readonly position: number;
}

/** A page a stream reads of what it missed, and whether the read returned all it may, so more may be waiting. */
interface Missed extends Framed {
  readonly full: boolean;
}

/**
 * A stream's frames from position `from`: those of the pages `missed` reads, one after another
 * until one is not full, then those of the pages `live` hears, each event once. `live` is to be
 * subscribed to before this is called, so that nothing written meanwhile falls between the two:
 * an event read and heard both is sent the first time, and so is one heard twice.
 */
export const caughtUp = (
  from: number,
  missed: (position: number) => Effect.Effect<Missed>,
  live: Stream.Stream<Framed>,
) =>
  Stream.unwrap(
    Effect.map(Ref.make(from), (sent) =>
      Stream.paginate(from, (position) =>
        Effect.map(missed(position), (page) => [[page], page.full ? Option.some(page.position) : Option.none()]),
      ).pipe(
        Stream.concat(live),
        Stream.mapEffect((page: Framed) =>
          Ref.modify(sent, (position) => [
            page.frames
              .filter((framed) => framed.id > position)
              .map((framed) => framed.frame)
              .join(""),
            Math.max(position, page.position),
          ]),
        ),
        Stream.filter((frames) => frames !== ""),
      ),
    ),
  );

/** The most events the tail reads in one look; one that reads this many looks again at once. */
const TAIL_PAGE = 200;

/** A player's events as their own stream sends them. */
const ownFrames = (found: readonly StoredEvent[], position: number): Framed => ({
  frames: found.map((event) => ({ id: event.id, frame: sseFrame(event.id, event.type, eventJsonText(event)) })),
  position,
});

/** The tail while any stream follows it: who hears each player's events and the guild's, and what is done once it stops. */
interface Tail {
  readonly own: RcMap.RcMap<PlayerId, PubSub.PubSub<Framed>>;
  readonly guild: PubSub.PubSub<Framed>;
  readonly ended: Deferred.Deferred<void>;
}

/**
 * The tail, looking from the newest event as it starts: each look reads every event after the last
 * (`TAIL_PAGE` at a time), makes each event's frame once, and tells it to the streams of its player
 * that are open (`own`), and the guild's events, as the guild sees them, to the guild's streams.
 */
const startTail = (events: Events["Service"], names: PlayerNames["Service"], pollMs: number) =>
  Effect.gen(function* () {
    const own = yield* RcMap.make<PlayerId, PubSub.PubSub<Framed>, never, Scope.Scope>({
      lookup: () => Effect.acquireRelease(PubSub.unbounded<Framed>(), PubSub.shutdown),
    });
    const guild = yield* Effect.acquireRelease(PubSub.unbounded<Framed>(), PubSub.shutdown);
    const ended = yield* Deferred.make<void>();
    const position = yield* Ref.make(yield* events.latestId);
    const tellOwn = (playerId: PlayerId, framed: Framed) =>
      Effect.scoped(
        Effect.flatMap(RcMap.getOption(own, playerId), (heard) =>
          Option.isSome(heard) ? Effect.asVoid(PubSub.publish(heard.value, framed)) : Effect.void,
        ),
      );
    const look = Effect.gen(function* () {
      const after = yield* Ref.get(position);
      const found = yield* events.allAfter(after, TAIL_PAGE);
      const to = found.at(-1)?.id ?? after;
      yield* Ref.set(position, to);
      for (const [playerId, theirs] of Map.groupBy(found, (event) => event.playerId)) {
        yield* tellOwn(playerId, ownFrames(theirs, to));
      }
      const guildsOwn = found.filter((event) => GUILD_EVENT_TYPES.some((type) => type === event.type));
      const shown = guildEvents(guildsOwn, yield* names.of(guildsOwn.map((event) => event.playerId)));
      if (shown.length > 0) {
        const frames = shown.map((event) => ({ id: event.id, frame: sseFrame(event.id, event.type, event.json) }));
        yield* PubSub.publish(guild, { frames, position: to });
      }
      return found.length === TAIL_PAGE;
    });
    yield* look.pipe(
      Effect.repeat({ while: (full) => full }),
      Effect.repeat(Schedule.spaced(Duration.millis(pollMs))),
      Effect.tapDefect((defect) => Effect.logError("The event streams stopped looking for events", defect)),
      Effect.ensuring(Deferred.succeed(ended, undefined)),
      Effect.forkScoped,
    );
    return { own, guild, ended } satisfies Tail;
  });

/** What a stream hears of the tail's pages, from now until the tail stops. */
const heard = (pages: PubSub.PubSub<Framed>, ended: Deferred.Deferred<void>) =>
  Effect.map(PubSub.subscribe(pages), (subscription) =>
    Stream.fromSubscription(subscription).pipe(Stream.interruptWhen(Deferred.await(ended))),
  );

/**
 * The tail of the events table, read once for every open event stream: one look every `pollMs`
 * while any stream is open, at every event written since the last, each event's frame made once
 * and told to the open streams it belongs to. It finds new events by looking in the database, not
 * by being told, so it also sees events written by another process: during a deploy the old and
 * the new container run side by side. Should a look fail, every open stream ends, and its client
 * reconnects.
 */
export class EventTail extends Context.Service<
  EventTail,
  {
    /** The frames of a player's own stream from a position: what they missed, then what happens. */
    readonly own: (playerId: PlayerId, from: number) => Stream.Stream<string>;
    /** The pages of the guild's events as they happen, from a look after this: for the guild's streams. */
    readonly guild: Effect.Effect<Stream.Stream<Framed>, never, Scope.Scope>;
  }
>()("leaf/EventTail") {
  static readonly layer = Layer.effect(
    EventTail,
    Effect.gen(function* () {
      const events = yield* Events;
      const names = yield* PlayerNames;
      const { pollMs } = yield* StreamTuning;
      // It starts with the first stream and stops with the last.
      const tail = yield* RcRef.make({ acquire: startTail(events, names, pollMs) });
      const missed = (playerId: PlayerId) => (position: number) =>
        Effect.map(events.after(playerId, position, EVENT_PAGE), (found) => ({
          ...ownFrames(found, found.at(-1)?.id ?? position),
          full: found.length === EVENT_PAGE,
        }));
      return EventTail.of({
        own: (playerId, from) =>
          Stream.unwrap(
            Effect.gen(function* () {
              const { own, ended } = yield* RcRef.get(tail);
              return caughtUp(from, missed(playerId), yield* heard(yield* RcMap.get(own, playerId), ended));
            }),
          ),
        guild: Effect.flatMap(RcRef.get(tail), ({ guild, ended }) => heard(guild, ended)),
      });
    }),
  );
}

/** One look for the guild's events after a position. */
export interface GuildPage {
  /** The events as the guild sees them. One left out, such as one whose member no one can name, is passed over. */
  readonly shown: readonly GuildEvent[];
  /** Where to look from next. */
  readonly position: number;
  /** Whether the look returned all it may, so more may be waiting. */
  readonly full: boolean;
}

/** The guild's events as its members see them, and the guild's stream, which hears what happens from the events' tail (`EventTail`). */
export class GuildFeed extends Context.Service<
  GuildFeed,
  {
    /** The guild's events after a position, oldest first, up to `GUILD_EVENT_PAGE` of them. */
    readonly after: (position: number) => Effect.Effect<GuildPage>;
    /** The frames of a guild stream from a position: what the client missed, then what happens. */
    readonly frames: (from: number) => Stream.Stream<string>;
  }
>()("leaf/GuildFeed") {
  static readonly layer = Layer.effect(
    GuildFeed,
    Effect.gen(function* () {
      const events = yield* Events;
      const names = yield* PlayerNames;
      const tail = yield* EventTail;

      const after = (position: number) =>
        Effect.gen(function* () {
          const found = yield* events.everyoneAfter(GUILD_EVENT_TYPES, position, GUILD_EVENT_PAGE);
          const shown = guildEvents(found, yield* names.of(found.map((event) => event.playerId)));
          return { shown, position: found.at(-1)?.id ?? position, full: found.length === GUILD_EVENT_PAGE };
        });
      const missed = (position: number) =>
        Effect.map(after(position), (page) => ({
          frames: page.shown.map((event) => ({ id: event.id, frame: sseFrame(event.id, event.type, event.json) })),
          position: page.position,
          full: page.full,
        }));

      return GuildFeed.of({
        after,
        frames: (from) => Stream.unwrap(Effect.map(tail.guild, (live) => caughtUp(from, missed, live))),
      });
    }),
  );
}
