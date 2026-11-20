import { Effect } from "effect";
import { HttpServerRequest } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

import { LeafApi } from "../api/api.ts";
import { GuildEvents } from "../guild/store.ts";
import {
  EVENT_PAGE,
  eventId,
  eventsPage,
  eventStream,
  invalidAfter,
  LATEST_EVENTS,
  streamResponse,
  StreamTuning,
} from "./stream.ts";

// The guild feed, for anyone: paged and streamed as `/v1/me/events` is.

export const GuildHandlers = HttpApiBuilder.group(LeafApi, "guild", (handlers) =>
  Effect.gen(function* () {
    const feed = yield* GuildEvents;
    return handlers
      .handle("events", ({ query }) =>
        Effect.gen(function* () {
          const after = eventId(query.after);
          if (after === null) {
            return yield* invalidAfter;
          }
          return eventsPage(
            after === undefined ? yield* feed.latest(LATEST_EVENTS) : yield* feed.after(after, EVENT_PAGE),
          );
        }),
      )
      .handle("stream", ({ query }) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const resumeFrom = eventId(request.headers["last-event-id"] ?? query.after);
          if (resumeFrom === null) {
            return yield* invalidAfter;
          }
          const from = resumeFrom ?? (yield* feed.latestId);
          return streamResponse(eventStream(feed.after, from, yield* StreamTuning));
        }),
      );
  }),
);
