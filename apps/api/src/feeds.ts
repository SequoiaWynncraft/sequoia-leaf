import { parsePlayerId, type PlayerId } from "@sequoia-leaf/core";
import { Duration, Effect, Schema, SchemaIssue, SchemaTransformation } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";

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
  readonly token: string;
}

/** A player's Minecraft UUID as a feed sends it, dashed or not, in any case. Decodes to a `PlayerId`. */
export const FeedPlayerId = Schema.String.pipe(
  Schema.decodeTo(
    Schema.declare((input): input is PlayerId => typeof input === "string" && parsePlayerId(input) === input),
    SchemaTransformation.transformEffect<PlayerId, string>({
      decode: (text, options) => {
        const id = parsePlayerId(text);
        return id === undefined
          ? Effect.fail(new SchemaIssue.InvalidValue({ expected: "a UUID" }, text, options))
          : Effect.succeed(id);
      },
      encode: (id) => Effect.succeed(id),
    }),
  ),
);

/** A time as a feed sends it, an ISO 8601 string. Decodes to milliseconds since the Unix epoch. */
export const FeedInstant = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Number,
    SchemaTransformation.transformEffect<number, string>({
      decode: (text, options) => {
        const at = Date.parse(text);
        return Number.isNaN(at)
          ? Effect.fail(new SchemaIssue.InvalidValue({ expected: "an ISO 8601 time" }, text, options))
          : Effect.succeed(at);
      },
      encode: (at) => Effect.succeed(new Date(at).toISOString()),
    }),
  ),
);

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
  HttpClient.get(new URL(path, config.baseUrl), {
    urlParams: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
    headers: { authorization: `Bearer ${config.token}` },
    acceptJson: true,
  }).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
    Effect.timeout(TIMEOUT),
    Effect.mapError((error) => new FeedError({ feed, message: error.message })),
  );
