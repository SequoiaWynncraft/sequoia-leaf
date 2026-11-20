import { Context, Duration, Effect, Ref, Schedule, Stream } from "effect";
import { HttpServerResponse } from "effect/http";

import { Invalid } from "../api/errors.ts";
import { eventJsonText, type StoredEvent } from "../events/store.ts";

// The two ways a client reads events, a member's own or the guild's: a page at a
// time, or as server-sent events as they happen. Both find events by reading the
// table, so writing an event is all it takes for it to be sent.

/** The most events one answer or one look by a stream returns. */
export const EVENT_PAGE = 100;
/** How many events a page returns when the client does not say where it is. */
export const LATEST_EVENTS = 50;

/** How the event streams pace themselves. Tests shorten these. */
export interface StreamTuning {
  /** How often an open stream looks for new events. */
  readonly pollMs: number;
  /** A stream writes a comment this often, so proxies keep a quiet connection open. */
  readonly heartbeatMs: number;
  /** A stream is closed after this long. The client reconnects, which checks its session again. */
  readonly maxMs: number;
}

export const StreamTuning = Context.Reference<StreamTuning>("leaf/StreamTuning", {
  defaultValue: () => ({ pollMs: 2_000, heartbeatMs: 20_000, maxMs: 15 * 60_000 }),
});

export const invalidAfter = new Invalid({ code: "invalid_after", message: "after must be an event id" });

/** Reads an event id sent by a client. Undefined means it sent none; null means it sent something that is not one. */
export function eventId(value: string | undefined): number | null | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  return /^\d{1,15}$/.test(value) ? Number(value) : null;
}

/** A page of events as the API sends it. Their details are stored as the JSON they are sent as, so they are spliced in, not parsed. */
export function eventsPage(events: readonly StoredEvent[]) {
  return HttpServerResponse.text(`{"events":[${events.map(eventJsonText).join(",")}]}`, {
    contentType: "application/json",
  });
}

/**
 * The frames of one event stream, from just after `from`, with `after`
 * answering the events after an id. It finds new events by looking in the
 * database every `pollMs`, not by being told, so it also sees events written by
 * another process: during a deploy the old and the new container run side by side.
 */
export const eventStream = (
  after: (afterId: number, limit: number) => Effect.Effect<readonly StoredEvent[]>,
  from: number,
  tuning: StreamTuning,
) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const position = yield* Ref.make(from);
      const look = Effect.gen(function* () {
        const found = yield* after(yield* Ref.get(position), EVENT_PAGE);
        const last = found.at(-1);
        if (last !== undefined) {
          yield* Ref.set(position, last.id);
        }
        return found.map(sseFrame).join("");
      });
      const fresh = Stream.fromEffectSchedule(look, Schedule.spaced(Duration.millis(tuning.pollMs))).pipe(
        Stream.filter((frames) => frames !== ""),
      );
      // Clients ignore comments; proxies see traffic and keep a quiet connection open.
      const keepAlive = Stream.tick(Duration.millis(tuning.heartbeatMs)).pipe(
        Stream.drop(1),
        Stream.as(": keep-alive\n\n"),
      );
      // The first frame carries the starting position as its id, so a client whose
      // stream ends before any event arrives still reconnects from here and gets
      // what happened in between.
      return Stream.make(`id: ${from}\nretry: 3000\n\n`).pipe(
        Stream.concat(Stream.merge(fresh, keepAlive)),
        Stream.interruptWhen(Effect.sleep(Duration.millis(tuning.maxMs))),
        Stream.encodeText,
      );
    }),
  );

/** A stream's response, its frames as server-sent events. */
export function streamResponse(frames: ReturnType<typeof eventStream>) {
  return HttpServerResponse.stream(frames, {
    contentType: "text/event-stream",
    headers: { "cache-control": "no-cache", connection: "keep-alive" },
  });
}

function sseFrame(event: StoredEvent): string {
  return `event: ${event.type}\ndata: ${eventJsonText(event)}\nid: ${event.id}\n\n`;
}
