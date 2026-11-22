import type { PlayerId } from "@sequoia-leaf/core";
import { Context, Deferred, Duration, Effect, Layer, Option, PubSub, RcRef, Ref, Schedule, Stream } from "effect";

import { Events } from "../events/store.ts";
import { GUILD_EVENT_TYPES, type GuildEvent, guildEvents } from "../game/guild.ts";
import { PlayerNames } from "../game/names.ts";

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

/** One look for the guild's events after a position. */
export interface GuildPage {
  /** The events as the guild sees them. One left out, such as one whose member no one can name, is passed over. */
  readonly shown: readonly GuildEvent[];
  /** Where to look from next. */
  readonly position: number;
  /** Whether the look returned all it may, so more may be waiting. */
  readonly full: boolean;
}

/**
 * The guild's events as its members see them, and the guild's stream. Every
 * open guild stream is fed by one poll of the database, which runs while any
 * is open. It finds new events by looking in the database every `pollMs`,
 * not by being told, so it also sees events written by another process:
 * during a deploy the old and the new container run side by side.
 */
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
      const { pollMs } = yield* StreamTuning;

      const after = (position: number) =>
        Effect.gen(function* () {
          const found = yield* events.everyoneAfter(GUILD_EVENT_TYPES, position, GUILD_EVENT_PAGE);
          const shown = guildEvents(found, yield* names.of(found.map((event) => event.playerId)));
          return { shown, position: found.at(-1)?.id ?? position, full: found.length === GUILD_EVENT_PAGE };
        });

      // The one poll, publishing what it finds. It starts with the first stream
      // and stops with the last. Should it fail, the open streams end, and their
      // clients reconnect.
      const polled = yield* RcRef.make({
        acquire: Effect.gen(function* () {
          const pages = yield* Effect.acquireRelease(PubSub.unbounded<GuildPage>(), PubSub.shutdown);
          const position = yield* Ref.make(yield* events.latestId);
          const look = Effect.gen(function* () {
            const page = yield* after(yield* Ref.get(position));
            yield* Ref.set(position, page.position);
            if (page.shown.length > 0) {
              yield* PubSub.publish(pages, page);
            }
          });
          yield* look.pipe(
            Effect.repeat(Schedule.spaced(Duration.millis(pollMs))),
            Effect.tapDefect((defect) => Effect.logError("The guild's stream stopped looking for events", defect)),
            Effect.ensuring(PubSub.shutdown(pages)),
            Effect.forkScoped,
          );
          return pages;
        }),
      });

      return GuildFeed.of({
        after,
        frames: (from) =>
          Stream.unwrap(
            Effect.gen(function* () {
              // Subscribed before catching up, so nothing written meanwhile falls between the two.
              const live = yield* PubSub.subscribe(yield* RcRef.get(polled));
              const sent = yield* Ref.make(from);
              /** The frames of a page's events the client has not been sent yet. */
              const unsent = (page: GuildPage) =>
                Ref.modify(sent, (position) => [
                  page.shown
                    .filter((event) => event.id > position)
                    .map((event) => sseFrame(event.id, event.type, event.json))
                    .join(""),
                  Math.max(position, page.position),
                ]);
              const missed = Stream.paginate(from, (position) =>
                Effect.map(after(position), (page) => [[page], page.full ? Option.some(page.position) : Option.none()]),
              );
              return missed.pipe(
                Stream.concat(Stream.fromSubscription(live)),
                Stream.mapEffect(unsent),
                Stream.filter((frames) => frames !== ""),
              );
            }),
          ),
      });
    }),
  );
}
