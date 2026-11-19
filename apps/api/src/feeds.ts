import { Duration, Effect, type Redacted, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

/** A feed could not be read, or answered with something that is not that feed. Nothing from it is used. */
export class FeedError extends Schema.TaggedError<FeedError>()("FeedError", {
  feed: Schema.String,
  message: Schema.String,
}) {}

/** How long one read of a feed may take, from asking to the last byte of the answer. */
const TIMEOUT = Duration.seconds(10);

/** Where a feed is, and the internal token it takes. */
export interface FeedConfig {
  /** The service's origin, such as `http://sequoia-backend:8081`. */
  readonly baseUrl: string;
  readonly token: Redacted.Redacted;
}

/**
 * Reads one window, [from, to) in milliseconds since the Unix epoch, of an
 * internal feed and decodes it with `schema`. Any failure, from the network to
 * a field of the wrong type, fails the whole read: a malformed feed is never
 * partly paid out.
 */
export const readFeedWindow = <A, I>(
  feed: string,
  config: FeedConfig,
  path: string,
  schema: Schema.Codec<A, I>,
  from: number,
  to: number,
): Effect.Effect<A, FeedError, HttpClient.HttpClient> =>
  HttpClient.execute(
    HttpClientRequest.get(new URL(path, config.baseUrl), {
      urlParams: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
      acceptJson: true,
    }).pipe(HttpClientRequest.bearerToken(config.token)),
  ).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
    Effect.timeout(TIMEOUT),
    Effect.mapError((error) => new FeedError({ feed, message: error.message })),
  );
