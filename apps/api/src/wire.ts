import { parsePlayerId, type PlayerId } from "@sequoia-leaf/core";
import { Effect, Schema, SchemaIssue, SchemaTransformation } from "effect";

// How other Sequoia services write the values Leaf reads from them.

/** A player's Minecraft UUID as other services send it, dashed or not, in any case. Decodes to a `PlayerId`. */
export const PlayerUuid = Schema.String.pipe(
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

/** A time as other services send it, an ISO 8601 string. Decodes to milliseconds since the Unix epoch. */
export const IsoTime = Schema.String.pipe(
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
