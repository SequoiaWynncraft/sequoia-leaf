import { Cause, Clock, Context, Effect, Exit, Metric, Option, Schema } from "effect";
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/http";

import { httpDuration, httpRequests } from "../metrics.ts";

/**
 * What a request's own code found out on its way that its log line says: the defect behind a 500,
 * which `Unexpected` turns into `internal_error` (`routes/middleware.ts`). Null outside a request.
 */
export interface RequestNote {
  defect: Option.Option<unknown>;
}
export const RequestNote = Context.Reference<RequestNote | null>("leaf/RequestNote", { defaultValue: () => null });

const METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]);
/** A request slower than this to its answer's head is logged. */
const SLOW_MS = 1000;

/** Seconds since `began`, a monotonic clock's nanoseconds. */
export const since = (began: bigint) =>
  Clock.clockWith((clock) => Effect.sync(() => Number(clock.monotonicTimeNanosUnsafe() - began) / 1e9));

/** Counts an answered request: by method (`OTHER` past the usual ones), route template and status, and how long it took. */
export const countRequest = (method: string, route: string, status: number, seconds: number) => {
  const labels = { method: METHODS.has(method) ? method : "OTHER", route, status: String(status) };
  return Effect.andThen(Metric.update(httpRequests(labels), 1), Metric.update(httpDuration(labels), seconds));
};

/** The `code` of an error answer's `{ "code", "message" }`, if it is one. */
const readCode = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ code: Schema.String })));
const codeOf = ({ body }: HttpServerResponse.HttpServerResponse): string | null =>
  "body" in body && body.body instanceof Uint8Array
    ? Option.match(readCode(new TextDecoder().decode(body.body)), {
        onNone: () => null,
        onSome: (said) => (/^[a-z_]{1,64}$/.test(said.code) ? said.code : null),
      })
    : null;

/**
 * Every route but the live connection's, which counts its own (`live/route.ts`): each answer is
 * counted (`countRequest`) once its head is ready, by its route's template (`unmatched` for none);
 * each 5xx is logged once, as `http_error`, an error for a 500 with the defect behind it and a warning
 * otherwise, and any other answer slower than `SLOW_MS` as `http_slow`. The lines say the method,
 * route, status, error code and time, never a body, a cookie or a header. A request whose client went
 * before it was answered is not counted.
 */
export const Observed = HttpRouter.middleware((httpEffect) =>
  Effect.gen(function* () {
    const began = yield* Clock.clockWith((clock) => clock.monotonicTimeNanos);
    const { method } = yield* HttpServerRequest.HttpServerRequest;
    const { route: matched } = yield* HttpRouter.RouteContext;
    const route = matched.path === "/*" ? "unmatched" : matched.path;
    const note: RequestNote = { defect: Option.none() };
    const exit = yield* Effect.exit(Effect.provideService(httpEffect, RequestNote, note));
    if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) return yield* exit;
    const status = Exit.isSuccess(exit) ? exit.value.status : 500;
    const seconds = yield* since(began);
    yield* countRequest(method, route, status, seconds);
    const said = { method, route, status, ms: Math.round(seconds * 1000) };
    if (status >= 500) {
      const code = Exit.isSuccess(exit) ? codeOf(exit.value) : null;
      const why = Exit.isFailure(exit)
        ? exit.cause
        : Option.match(note.defect, { onNone: () => Cause.empty, onSome: Cause.die });
      yield* (status === 500 ? Effect.logError("http_error", why) : Effect.logWarning("http_error", why)).pipe(
        Effect.annotateLogs({ ...said, code }),
      );
    } else if (seconds * 1000 > SLOW_MS) {
      yield* Effect.logWarning("http_slow").pipe(Effect.annotateLogs(said));
    }
    return yield* exit;
  }),
);
