import { type Cause, type Duration, Effect, Match, Schema } from "effect";
import type { HttpClientError } from "effect/http";

/** No answer came: the backend could not be reached, or the request could not be sent. */
export class Unreachable extends Schema.TaggedError<Unreachable>()("Unreachable", {}) {}

/** No answer came in the time Leaf gives the route. */
export class TimedOut extends Schema.TaggedError<TimedOut>()("TimedOut", {}) {}

/** An answer with a status the route is not meant to answer with. */
export class UnexpectedStatus extends Schema.TaggedError<UnexpectedStatus>()("UnexpectedStatus", {
  status: Schema.Number,
}) {}

/** An answer whose body is not what the route sends. */
export class SchemaMismatch extends Schema.TaggedError<SchemaMismatch>()("SchemaMismatch", {}) {}

/** sequoia-backend gave no answer Leaf could use: which route, and why. */
export class BackendFailure extends Schema.TaggedError<BackendFailure>()("BackendFailure", {
  route: Schema.String,
  reason: Schema.Union([Unreachable, TimedOut, UnexpectedStatus, SchemaMismatch]),
}) {}

/** What can go wrong asking the backend, before it is a `BackendFailure`. */
export type Asked = HttpClientError.HttpClientError | Schema.SchemaError | Cause.TimeoutError | UnexpectedStatus;

const reasonOf = (error: Asked): BackendFailure["reason"] =>
  Match.valueTags(error, {
    HttpClientError: ({ reason }) =>
      Match.valueTags(reason, {
        TransportError: () => new Unreachable(),
        EncodeError: () => new Unreachable(),
        InvalidUrlError: () => new Unreachable(),
        StatusCodeError: ({ response }) => new UnexpectedStatus({ status: response.status }),
        DecodeError: () => new SchemaMismatch(),
        EmptyBodyError: () => new SchemaMismatch(),
      }),
    SchemaError: () => new SchemaMismatch(),
    TimeoutError: () => new TimedOut(),
    UnexpectedStatus: (unexpected) => unexpected,
  });

/** Gives a question to the backend `within` to be answered, its failures a `BackendFailure` of `route`. */
export const askBackend =
  (route: string, within: Duration.Input) =>
  <A, R>(ask: Effect.Effect<A, Asked, R>): Effect.Effect<A, BackendFailure, R> =>
    ask.pipe(
      Effect.timeout(within),
      Effect.mapError((error) => new BackendFailure({ route, reason: reasonOf(error) })),
    );

/**
 * Logs a failure where Leaf recovers from it, with what is safe to say: the route, why, and the
 * status of an answer it did not expect. Never the request, which carries a session.
 */
export const logFailure = (message: string, failure: BackendFailure) =>
  Effect.logWarning(message).pipe(
    Effect.annotateLogs({
      route: failure.route,
      ...Match.valueTags(failure.reason, {
        Unreachable: () => ({ reason: "unreachable" }),
        TimedOut: () => ({ reason: "timeout" }),
        UnexpectedStatus: ({ status }) => ({ reason: "unexpected_status", status }),
        SchemaMismatch: () => ({ reason: "schema_mismatch" }),
      }),
    }),
  );
